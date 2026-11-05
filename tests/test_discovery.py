import unittest

from radar.discovery import discover, extract

HOST = "www.pref.saitama.lg.jp"
URL = "https://www.pref.saitama.lg.jp/news/example.html"
SOURCES = [{"id": key, "endpoint": f"https://{HOST}/{key}.xml",
            "permission_url": f"https://{HOST}/rss.html"} for key in ("one", "two")]


def feed(*links):
    entries = "".join(f"<item><title>食品プレゼント</title><link>{url}</link></item>" for url in links)
    return (f'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" '
            f'xmlns="http://purl.org/rss/1.0/"><channel/>{entries}</rdf:RDF>').encode()


class TestDiscovery(unittest.TestCase):
    def test_deduplicate_and_quarantine_candidate_without_following_links(self):
        requested = []

        def fetch(endpoint, allowed, types):
            self.assertEqual(endpoint, allowed)
            requested.append(endpoint)
            return feed(URL, URL, URL + "?code=1", URL.replace(HOST, "evil.example"),
                        URL.replace(HOST, "127.0.0.1"), URL.replace("/news/", "/news/../"))

        result = discover(SOURCES, set(), fetch=fetch)
        self.assertEqual(requested, [source["endpoint"] for source in SOURCES])
        self.assertEqual(len(result["candidates"]), 1)
        candidate = result["candidates"][0]
        self.assertEqual(candidate["url"], URL)
        self.assertEqual(candidate["feeds"], ["one", "two"])
        self.assertEqual(candidate["status"], "candidate")
        self.assertIn("editorial-approval", candidate["pending_checks"])

    def test_empty_after_known_urls_removed_is_success(self):
        result = discover(SOURCES, {URL}, fetch=lambda *_: feed(URL))
        self.assertEqual(result["candidates"], [])
        self.assertTrue(all(item["status"] == "ok" for item in result["feeds"].values()))

    def test_unavailable_source_and_unsafe_xml(self):
        def unavailable(*_):
            raise TimeoutError()

        result = discover(SOURCES, set(), fetch=unavailable)
        self.assertEqual(result["candidates"], [])
        self.assertTrue(all(item["status"] == "failed" for item in result["feeds"].values()))
        with self.assertRaises(ValueError):
            extract(b'<!DOCTYPE rss [<!ENTITY a "expansion">]>' + feed(), HOST, set())
