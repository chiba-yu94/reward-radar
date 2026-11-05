import copy
import json
import socket
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from radar.net import fetch_json, https_url, PinnedHTTPS, public_ip
from radar.pipeline import collect, inputs, publish, validate


class TestPipeline(unittest.TestCase):
    def setUp(self):
        self.rows, self.sources = inputs()
        self.now = datetime(2026, 11, 5, 7, tzinfo=timezone.utc)
        self.record = self.rows[0]
        self.source = self.sources[self.record["source_id"]]
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.output = Path(temp.name) / "public.json"
        self.database = Path(temp.name) / "operations.sqlite"

    def run_publish(self, report=None):
        return publish(self.rows, self.sources, report or {}, self.output, self.database, self.now)

    def test_publish_and_retain_expired(self):
        active = self.run_publish()
        self.assertIn("prolific", active)
        self.assertNotIn("rakuten-app-draw", active)
        with closing(sqlite3.connect(self.database)) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM opportunities").fetchone()[0], len(self.rows))
        public = json.loads(self.output.read_text())["records"]
        self.assertTrue(all("source_id" not in item and "affiliate_review" not in item for item in public))
        self.assertTrue(all(item["affiliate_url"] is None for item in public))
        self.assertEqual(next(item for item in public if item["id"] == "macromill")["reward_amount"], None)

    def test_failed_source_preserves_previous_output(self):
        self.run_publish()
        previous = self.output.read_bytes()
        with self.assertRaises(ValueError):
            self.run_publish({"github-student": {"status": "failed"}})
        self.assertEqual(self.output.read_bytes(), previous)

    def test_changed_revision_and_fetch_error(self):
        self.assertEqual(collect(self.sources, lambda *_: b'{"type":"file","sha":"0000000000000000000000000000000000000000"}')
                         ["github-student"]["status"], "failed")
        def unavailable(*_):
            raise TimeoutError
        self.assertEqual(collect(self.sources, unavailable)["github-student"]["status"], "failed")

    def test_successful_collection_is_scoped(self):
        source = self.sources["github-student"]
        with patch("radar.pipeline.datetime") as clock:
            clock.now.return_value = self.now
            report = collect(self.sources, lambda *_: json.dumps({"type":"file","sha":source["reviewed_revision"]}))
        self.assertEqual(list(report), ["github-student"])
        self.run_publish(report)
        public = {row["id"]: row for row in json.loads(self.output.read_text())["records"]}
        self.assertEqual(public["github-student"]["last_checked_at"], "2026-11-05T07:00:00Z")
        self.assertEqual(public["macromill"]["last_checked_at"], self.record["last_checked_at"])

    def test_duplicates_do_not_overwrite(self):
        self.run_publish()
        previous = self.output.read_bytes()
        duplicate = copy.deepcopy(self.record)
        duplicate["id"] = "distinct-id"
        for row in (self.record, duplicate):
            self.rows.append(row)
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                self.run_publish()
            self.rows.pop()
        self.assertEqual(self.output.read_bytes(), previous)

    def test_disabled_source_and_empty_failure(self):
        self.source["active"] = False
        self.assertNotIn(self.record["id"], self.run_publish())
        previous = self.output.read_bytes()
        for source in self.sources.values():
            source["active"] = False
        with self.assertRaisesRegex(ValueError, "empty"):
            self.run_publish()
        self.assertEqual(self.output.read_bytes(), previous)

    def test_invalid_input_and_affiliate(self):
        for field, value in {
            "description_ja":"<script>alert(1)</script>", "id":"../../etc",
            "deadline":"2026-05-31T14:59:00+09:00", "title_en":self.record["title_ja"],
            "official_url":"https://example.com", "eligible_countries":"worldwide",
            "reward_amount":float("nan"), "affiliate_url":"javascript:alert(1)",
        }.items():
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate({**self.record,field:value}, self.source, self.now)
        with self.assertRaises(KeyError):
            validate({**self.record, "affiliate_approval_status":"approved"}, self.source, self.now)

    def test_redirect_rejected_without_a_second_connection(self):
        with patch("radar.net.PinnedHTTPS") as tls:
            tls.return_value.getresponse.return_value.status = 302
            with self.assertRaisesRegex(ValueError, "Redirect"):
                fetch_json("https://example.com/a", "https://example.com/a")
            tls.assert_called_once()

    def test_hostname_checks_and_dns_rebinding(self):
        for url in ["http://example.com", "javascript:alert(1)", "https://example.com@evil.com",
                    "https://127.0.0.1/", "https://[::1]/", "https://a.local/",
                    "https://example.com\\evil.com/", "https://example.com:443/"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                https_url(url)
        for address in ["127.0.0.1","169.254.169.254","10.0.0.1","100.64.0.1",
                        "::1","::ffff:127.0.0.1","224.0.0.1","::","fc00::1","2002:0808:0808::1"]:
            self.assertFalse(public_ip(address), address)
        with patch("radar.net.socket.getaddrinfo", return_value=[
            (socket.AF_INET,socket.SOCK_STREAM,6,"",("8.8.8.8",443)),
            (socket.AF_INET,socket.SOCK_STREAM,6,"",("169.254.169.254",443)),
        ]), patch("radar.net.socket.socket") as opened:
            with self.assertRaisesRegex(ValueError,"prohibited"):
                PinnedHTTPS("example.com").connect()
            opened.assert_not_called()

    def test_unreviewed_endpoint_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unreviewed"):
            fetch_json("https://example.com/x","https://example.com/y")
