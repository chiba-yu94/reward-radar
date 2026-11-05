"""Validate reviewed inputs, collect bounded observations, and publish an allowlisted dataset."""
import argparse
import hashlib
import json
import math
import re
import sqlite3
import sys
import tempfile
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .net import fetch_json, https_url

ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = {"sweepstakes", "guaranteed", "points", "survey", "research",
              "gift", "cashback", "registration", "international", "affiliate"}
KINDS = {"cash", "points", "gift-card", "prize", "cashback", "commission", "software"}
METHODS = {"form", "account", "survey", "study", "shopping", "application", "app"}
CERTAINTIES = {"guaranteed", "conditional", "chance"}
GEO = re.compile(r"[A-Z]{2}")
ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
UTC = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ")
SHA = re.compile(r"[a-f0-9]{40}")
STALE = timedelta(days=30)
CLOCK_SKEW = timedelta(minutes=5)
PUBLIC = (
    "id provider title_ja title_en description_ja description_en category "
    "eligible_countries eligibility_verified eligibility_ja eligibility_en "
    "reward_type reward_currency reward_amount reward_conditions required_expense "
    "estimated_effort_minutes participation_method deadline official_url affiliate_url "
    "affiliate_approval_status source_url source_permission_status first_seen_at "
    "last_checked_at verification_status risk_flags published_status language "
    "certainty redemption_difficulty commission"
).split()


def stamp(value):
    if not isinstance(value, str) or not UTC.fullmatch(value):
        raise ValueError("Expected a UTC timestamp with seconds")
    return datetime.fromisoformat(value)


def utc(now):
    return now.isoformat(timespec="seconds").replace("+00:00", "Z")


def require(ok, detail):
    if not ok:
        raise ValueError(detail)


def enum(value, values):
    require(value in values, f"Unexpected enum: {value!r}")


def plain(value):
    require(isinstance(value, str) and 0 < len(value.strip()) <= 1000
            and not any(ord(c) < 32 or c in "<>" for c in value), "Invalid plain text")


def money(value):
    require(value is None or type(value) in (int, float)
            and math.isfinite(value) and 0 <= value <= 1e12, "Invalid amount")


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def atomic(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, mode="w", encoding="utf-8",
                                     delete=False) as output:
        output.write(content)
        temp = Path(output.name)
    temp.replace(path)


def dump(path, data):
    atomic(path, json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n")


def inputs():
    rows = read(ROOT / "data/opportunities.json")
    sources = read(ROOT / "data/sources.json")
    index = {}
    for source in sources:
        sid = source["id"]
        require(ID.fullmatch(sid) and sid not in index, "Duplicate or invalid source")
        for key in ("provider", "country", "terms_status", "collection_frequency"):
            plain(source[key])
        enum(source["language"], {"ja", "en"})
        enum(source["permission"], {"editorial-summary", "authorized-api"})
        enum(source["method"], {"manual", "github-content"})
        require(type(source["active"]) is bool, "Invalid source status")
        stamp(source["last_verification_date"])
        https_url(source["official_url"])
        if source["method"] == "github-content":
            url = https_url(source["endpoint"])
            require(url.hostname == "api.github.com" and url.path.startswith("/repos/github/docs/contents/")
                    and not url.fragment and url.query == "ref=main"
                    and source["permission"] == "authorized-api"
                    and SHA.fullmatch(source["reviewed_revision"]), "API source not approved")
            https_url(source["permission_url"])
        index[sid] = source
    return rows, index


def validate(row, source, now):
    missing = set(PUBLIC) - row.keys()
    require(not missing, f"Missing fields: {sorted(missing)}")
    require(ID.fullmatch(row["id"]) and len(row["id"]) <= 80, "Unsafe record ID")
    require(row["provider"] == source["provider"], "Provider mismatch")
    require(row["source_url"] == source["official_url"]
            and row["official_url"] == source["approved_destination"], "Destination requires review")
    for key in ("official_url", "source_url"):
        https_url(row[key])
    require(row["source_permission_status"] == source["permission"], "Permission mismatch")
    for key in ("title", "description", "eligibility"):
        for lang in ("ja", "en"):
            plain(row[f"{key}_{lang}"])
        require(row[f"{key}_ja"] != row[f"{key}_en"], f"Missing {key} translation")
    require(set(row["reward_conditions"]) == {"ja", "en"}, "Missing conditions translation")
    for value in row["reward_conditions"].values():
        plain(value)
    enum(row["category"], CATEGORIES)
    enum(row["reward_type"], KINDS)
    enum(row["participation_method"], METHODS)
    enum(row["language"], {"ja", "en", "multiple", "unknown"})
    enum(row["certainty"], CERTAINTIES)
    enum(row["verification_status"], {"verified", "review"})
    enum(row["published_status"], {"approved", "draft", "withdrawn"})
    enum(row["redemption_difficulty"], {None, "low", "medium", "high"})
    require(row["reward_currency"] is None or re.fullmatch(r"[A-Z]{3}", row["reward_currency"]),
            "Invalid currency")
    if row["category"] == "sweepstakes":
        require(row["certainty"] == "chance", "Sweepstakes certainty mismatch")
    if row["category"] == "affiliate":
        require(row["reward_type"] == "commission" and row["certainty"] == "conditional",
                "Affiliate classification mismatch")
        commission = row["commission"]
        require(isinstance(commission, dict) and set(commission) == {
            "percent", "structure", "months", "threshold", "threshold_currency"}, "Invalid commission")
        for key in ("percent", "months", "threshold"):
            money(commission[key])
        require(commission["percent"] is None or commission["percent"] <= 100, "Invalid commission rate")
        enum(commission["structure"], {"recurring", "one-time", "mixed", "unknown"})
        require((commission["threshold"] is None and commission["threshold_currency"] is None)
                or (commission["threshold"] is not None
                    and re.fullmatch(r"[A-Z]{3}", commission["threshold_currency"] or "")),
                "Invalid payout threshold")
    else:
        require(row["commission"] is None, "Unexpected commission")
    for key in ("reward_amount", "estimated_effort_minutes"):
        money(row[key])
    if row["reward_amount"] is not None:
        require(row["reward_currency"] or row["reward_type"] == "points", "Missing reward unit")
    expense = row["required_expense"]
    require(isinstance(expense, dict) and set(expense) == {"kind", "amount", "currency"}, "Invalid expense")
    enum(expense["kind"], {"free", "purchase", "unknown"})
    money(expense["amount"])
    require((expense["kind"] == "free" and expense["amount"] == 0 and expense["currency"] is None)
            or (expense["kind"] != "free" and expense["amount"] is None and expense["currency"] is None)
            or (expense["kind"] == "purchase" and expense["amount"] > 0
                and re.fullmatch(r"[A-Z]{3}", expense["currency"] or "")), "Inconsistent expense")
    countries = row["eligible_countries"]
    require(type(row["eligibility_verified"]) is bool, "Invalid eligibility verification")
    if countries in (None, "worldwide"):
        require(row["eligibility_verified"] == (countries == "worldwide")
                and (countries != "worldwide" or source.get("worldwide_reviewed") is True),
                "Inconsistent eligibility")
    else:
        require(isinstance(countries, list) and countries and all(GEO.fullmatch(c) for c in countries)
                and len(set(countries)) == len(countries) and row["eligibility_verified"], "Invalid countries")
    first, checked = stamp(row["first_seen_at"]), stamp(row["last_checked_at"])
    require(first <= checked <= now + CLOCK_SKEW, "Invalid verification dates")
    if row["deadline"] is not None:
        stamp(row["deadline"])
    require(isinstance(row["risk_flags"], list) and all(flag in {
        "waitlist", "third-party-id", "approval", "purchase", "variable", "capacity", "account",
    } for flag in row["risk_flags"]), "Invalid risk flags")
    enum(row["affiliate_approval_status"], {"none", "pending", "approved", "revoked"})
    if row["affiliate_approval_status"] == "approved":
        approval = row["affiliate_review"]
        https_url(row["affiliate_url"])
        require(approval["approved_url"] == row["affiliate_url"]
                and approval["channel"] == "reward-radar-website"
                and approval["territory_reviewed"] is True
                and approval["disclosure_reviewed"] is True
                and approval["commission_reviewed"] is True
                and approval["destination_reviewed"] == row["official_url"]
                and isinstance(approval["review_id"], str)
                and re.fullmatch(r"[a-z0-9-]{6,80}", approval["review_id"])
                and stamp(approval["expires_at"]) > checked, "Affiliate requires scoped review")
    else:
        require(row["affiliate_url"] is None, "Unapproved affiliate URL")


def collect(sources, fetch=fetch_json):
    report = {}
    for sid, source in sources.items():
        if not source["active"] or source["method"] != "github-content":
            continue
        endpoint = source["endpoint"]
        try:
            doc = json.loads(fetch(endpoint, endpoint))
            require(doc["type"] == "file" and SHA.fullmatch(doc["sha"]), "Unexpected API document")
            require(doc["sha"] == source["reviewed_revision"], "Source revision changed; review required")
            report[sid] = {"status": "unchanged", "revision": doc["sha"],
                           "checked_at": utc(datetime.now(timezone.utc))}
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            report[sid] = {"status": "failed", "error_type": type(error).__name__}
    return report


def publish(rows, sources, observation, output, database, now):
    require(isinstance(observation, dict), "Invalid collection artifact")
    for sid, result in observation.items():
        require(sid in sources and sources[sid]["active"] and sources[sid]["method"] == "github-content"
                and result["status"] == "unchanged"
                and result["revision"] == sources[sid]["reviewed_revision"]
                and now - timedelta(days=1) <= stamp(result["checked_at"]) <= now + CLOCK_SKEW,
                "Collection failed or requires review")
    require(not observation or set(observation) == {
        sid for sid, src in sources.items() if src["active"] and src["method"] != "manual"
    }, "Incomplete observation")
    approved, active, seen, links = [], [], set(), set()
    database.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(database)) as db, db:
        db.execute("CREATE TABLE IF NOT EXISTS opportunities (id TEXT PRIMARY KEY, record TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, registry TEXT NOT NULL, observation TEXT)")
        for sid, source in sources.items():
            db.execute("INSERT OR REPLACE INTO sources VALUES (?, ?, ?)", (
                sid, json.dumps(source), json.dumps(observation.get(sid))))
        for record in rows:
            row = dict(record)
            sid = row["source_id"]
            source = sources[sid]
            validate(row, source, now)
            require(row["id"] not in seen, "Duplicate record ID")
            seen.add(row["id"])
            url = row["official_url"].split("#", 1)[0].rstrip("/")
            require(url not in links, "Duplicate destination")
            links.add(url)
            if sid in observation:
                row["last_checked_at"] = max(row["last_checked_at"], observation[sid]["checked_at"])
            db.execute("INSERT OR REPLACE INTO opportunities VALUES (?, ?)",
                       (row["id"], json.dumps(row, ensure_ascii=False)))
            if not (source["active"] and row["published_status"] == "approved"
                    and row["verification_status"] == "verified"):
                continue
            expired = row["deadline"] is not None and stamp(row["deadline"]) <= now
            if expired:
                continue  # The reviewed snapshot and SQLite retain expired entries.
            public = {key: row[key] for key in PUBLIC}
            public["stale_at"] = utc(stamp(row["last_checked_at"]) + STALE)
            public["affiliate_expires_at"] = None
            if row["affiliate_approval_status"] == "approved":
                expiry = row["affiliate_review"]["expires_at"]
                if stamp(expiry) <= now:
                    public["affiliate_url"] = None
                    public["affiliate_approval_status"] = "revoked"
                else:
                    public["affiliate_expires_at"] = expiry
            approved.append(public)
            active.append(row["id"])
        require(approved, "Refusing to replace the dataset with an empty publication")
        dump(output, {"generated_at": utc(now), "records": sorted(approved, key=lambda item: item["id"])})
    return active


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["collect", "publish"])
    parser.add_argument("--observation", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "var/published.json")
    parser.add_argument("--database", type=Path, default=ROOT / "var/operations.sqlite")
    args = parser.parse_args()
    rows, sources = inputs()
    if args.mode == "collect":
        require(args.observation, "Specify --observation for collection")
        report = collect(sources)
        dump(args.observation, report)
        for sid, result in report.items():
            print(f"{sid}: {result['status']}")
        return int(any(result["status"] == "failed" for result in report.values()))
    observation = read(args.observation) if args.observation else {}
    if args.observation:
        require(set(observation) == {sid for sid, source in sources.items()
                                    if source["active"] and source["method"] != "manual"},
                "Missing configured API results")
    active = publish(rows, sources, observation, args.output, args.database, datetime.now(timezone.utc))
    print(f"{len(active)} validated active records")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, KeyError, TypeError, OSError) as error:
        sys.exit(str(error))
