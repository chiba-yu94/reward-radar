"""Collect official RSS links for editorial review, independently of publication."""
import argparse
import re
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree

from .net import fetch_document, https_url
from .pipeline import ROOT, dump, inputs, read, require, utc

RSS = "{http://purl.org/rss/1.0/}"
RDF = "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}"
ARTICLE_PATH = re.compile(r"/[a-zA-Z0-9_/-]+\.html")
GIVEAWAY = re.compile(r"プレゼント|懸賞|抽選で.*当た")
REVIEW_CHECKS = ("organizer", "eligibility", "free-entry", "destination",
                 "application-and-winner-privacy", "ja-en-copy", "editorial-approval")


def extract(body, origin, reviewed):
    # UTF-8 only. Reject DTDs, entities, alternate encodings and oversized input.
    document = body.decode("utf-8-sig")
    require("\x00" not in document and not re.search(r"<!DOCTYPE|<!ENTITY", document, re.I),
            "Unsafe feed XML")
    root = ElementTree.fromstring(document)
    require(root.tag == RDF + "RDF" and root.find(RSS + "channel") is not None,
            "Unexpected RSS format")
    links = set()
    for item in root.iterfind(RSS + "item"):
        title = item.findtext(RSS + "title", "")
        if not GIVEAWAY.search(title):
            continue
        link = item.findtext(RSS + "link", "").strip()
        try:
            url = https_url(link)
        except ValueError:
            continue
        if (url.hostname == origin and ARTICLE_PATH.fullmatch(url.path)
                and "//" not in url.path and not url.query and not url.fragment and link not in reviewed):
            links.add(link)
    return sorted(links)[:40]


def discover(feeds, reviewed, fetch=fetch_document):
    pending, results = {}, {}
    for source in feeds:
        endpoint = https_url(source["endpoint"])
        permission = https_url(source["permission_url"])
        require(endpoint.hostname == permission.hostname and endpoint.path.endswith(".xml")
                and not endpoint.query and not endpoint.fragment, "Unreviewed RSS endpoint")
        try:
            body = fetch(source["endpoint"], source["endpoint"],
                         ("application/rss+xml", "application/rdf+xml", "application/xml", "text/xml"))
            links = extract(body, endpoint.hostname, reviewed)
            results[source["id"]] = {"status": "ok", "matches": len(links)}
            for link in links:
                pending.setdefault(link, []).append(source["id"])
        except (OSError, ValueError, ElementTree.ParseError) as error:
            results[source["id"]] = {"status": "failed", "error_type": type(error).__name__}
    return {
        "checked_at": utc(datetime.now(timezone.utc)),
        "feeds": results,
        "candidates": [{"url": url, "feeds": ids, "status": "candidate", "pending_checks": REVIEW_CHECKS}
                       for url, ids in sorted(pending.items())],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "var/candidates.json")
    args = parser.parse_args()
    _, sources = inputs()
    reviewed = {url for source in sources.values()
                for url in (source["official_url"], source["approved_destination"])}
    report = discover(read(ROOT / "data/discovery-sources.json"), reviewed)
    dump(args.output, report)
    for key, result in report["feeds"].items():
        if result["status"] == "failed":
            print(f"::warning::Discovery feed unavailable or changed: {key} ({result['error_type']})")
    print(f"Discovery: {len(report['candidates'])} candidate(s) awaiting review")
    return int(any(result["status"] == "failed" for result in report["feeds"].values()))


if __name__ == "__main__":
    raise SystemExit(main())
