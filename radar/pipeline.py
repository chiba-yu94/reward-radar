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
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .application import application_profile
from .net import fetch_json, https_url

ROOT = Path(__file__).resolve().parents[1]
TAXONOMY = json.loads((ROOT / "data/taxonomy.json").read_text())
CATEGORIES = set(TAXONOMY["categories"])
COUNTRIES = set(TAXONOMY["countries"])
KINDS = {"cash", "points", "gift-card", "prize", "cashback", "commission", "software"}
METHODS = {"form", "account", "survey", "study", "shopping", "application", "app", "social"}
CERTAINTIES = {"guaranteed", "conditional", "chance"}
ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
UTC = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ")
SHA = re.compile(r"[a-f0-9]{40}")
PRIZES = set(TAXONOMY["prizes"])
PERSONAL = {"email", "name", "address", "phone", "social-account", "identity"}
UNKNOWN_ENTRY = {"registration": "unknown", "application": None, "winner": None, "steps": None}
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


def inputs(directory=None):
    directory = directory or ROOT / "data"
    rows = read(directory / "opportunities.json")
    sources = read(directory / "sources.json")
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
        for link in source.get("supporting_urls", []):
            https_url(link)
        if source["method"] == "github-content":
            url = https_url(source["endpoint"])
            require(url.hostname == "api.github.com" and url.path.startswith("/repos/github/docs/contents/")
                    and not url.fragment and url.query == "ref=main"
                    and source["permission"] == "authorized-api"
                    and SHA.fullmatch(source["reviewed_revision"]), "API source not approved")
            https_url(source["permission_url"])
        index[sid] = source
    return rows, index


def consumer_public(row):
    return (row.get("audience", "consumer") == "consumer"
            and row["required_expense"]["kind"] == "free")


def validate_entry(row, source):
    enum(row.get("audience", "consumer"), {"consumer", "professional"})
    enum(row.get("prize_category"), PRIZES | {None})
    entry = row.get("entry", UNKNOWN_ENTRY)
    require(isinstance(entry, dict) and set(entry) == set(UNKNOWN_ENTRY), "Invalid entry requirements")
    enum(entry["registration"], {"none", "organizer", "social", "unknown"})
    for stage in ("application", "winner"):
        values = entry[stage]
        require(values is None or isinstance(values, list) and len(values) == len(set(values))
                and set(values) <= PERSONAL, "Invalid personal information requirements")
    if entry["steps"] is not None:
        require(set(entry["steps"]) == {"ja", "en"}, "Missing entry steps translation")
        for value in entry["steps"].values():
            plain(value)
    if row["category"] != "sweepstakes" or not consumer_public(row) or row["published_status"] != "approved":
        return
    require(row["prize_category"] in PRIZES and entry["steps"]
            and source.get("organizer_verified") is True
            and source.get("free_entry_reviewed") is True
            and source.get("privacy_reviewed") is True, "Giveaway requires a documented consumer review")
    if row["reward_type"] in {"cash", "gift-card"} or row["prize_category"] == "electronics" or row.get("high_value"):
        require(source.get("enhanced_review") is True and row["eligibility_verified"]
                and entry["application"] is not None and entry["winner"] is not None,
                "Cash, gift card or high-value giveaway requires enhanced review")


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
    currencies = row.get("reward_currencies", [])
    require(isinstance(currencies, list) and len(set(currencies)) == len(currencies)
            and all(re.fullmatch(r"[A-Z]{3}", currency) for currency in currencies)
            and (not currencies or (row["reward_currency"] is None and row["reward_amount"] is None)),
            "Invalid variable currencies")
    if row["category"] == "sweepstakes":
        require(row["certainty"] == "chance", "Sweepstakes certainty mismatch")
    if row["category"] == "affiliate" and row["commission"] is None:
        require(row["reward_type"] in {"cash", "points", "gift-card"}
                and row["certainty"] == "conditional", "Sponsored rewards classification mismatch")
        if row["published_status"] == "approved" and row["affiliate_approval_status"] == "approved":
            require(isinstance(row.get("promotion_countries"), list), "Sponsored rewards require a verified promotion territory list")
    elif row["category"] == "affiliate":
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
        require(isinstance(countries, list) and countries and all(c in COUNTRIES for c in countries)
                and len(set(countries)) == len(countries) and row["eligibility_verified"], "Invalid countries")
    for key in ("shipping_countries", "service_countries", "promotion_countries"):
        values = row.get(key)
        require(values is None or isinstance(values, list) and values
                and all(isinstance(c, str) and c in COUNTRIES for c in values)
                and len(values) == len(set(values)), f"Invalid {key}")
    if any(row.get(key) for key in ("shipping_countries", "service_countries")):
        evidence = row.get("geography_source_url")
        require(evidence in [row["source_url"], *source.get("supporting_urls", [])],
                "Geography requires a reviewed source")
    enum(row.get("availability", "unknown"), {"ongoing", "unknown", "ended"})
    require(not (row.get("availability") == "ongoing" and row["deadline"]),
            "Ongoing service cannot have a deadline")
    first, checked = stamp(row["first_seen_at"]), stamp(row["last_checked_at"])
    require(first <= checked <= now + CLOCK_SKEW, "Invalid verification dates")
    require(type(row.get("deadline_date_only", False)) is bool
            and (not row.get("deadline_date_only") or row["deadline"] is not None), "Invalid deadline precision")
    if row["deadline"] is not None:
        stamp(row["deadline"])
    if row.get("deadline_timezone"):
        require(row["deadline"] is not None, "Timezone requires a deadline")
        try:
            ZoneInfo(row["deadline_timezone"])
        except (ZoneInfoNotFoundError, ValueError, TypeError):
            raise ValueError("Invalid deadline timezone")
    if row.get("deadline_date_only"):
        require(row.get("deadline_timezone"), "Date-only deadline requires a source timezone")
        local = stamp(row["deadline"]).astimezone(ZoneInfo(row["deadline_timezone"]))
        require((local.hour, local.minute, local.second) == (23, 59, 59),
                "Date-only deadline must represent the final second in its source timezone")
    if row.get("availability") == "ended" and (deadline_end(row) is None or deadline_end(row) > now):
        require(row.get("ended_source_url") in [row["source_url"], *source.get("supporting_urls", [])]
                and first <= stamp(row.get("ended_checked_at")) <= now + CLOCK_SKEW,
                "Early or undated ending requires reviewed evidence")
    require(isinstance(row["risk_flags"], list) and all(flag in {
        "waitlist", "third-party-id", "approval", "purchase", "variable", "capacity", "account",
    } for flag in row["risk_flags"]), "Invalid risk flags")
    validate_entry(row, source)
    profile = application_profile(row.get("application"), expense["kind"] == "free")
    if profile["source_url"]:
        require(profile["source_url"] in [row["source_url"], *source.get("supporting_urls", [])]
                and first <= stamp(profile["checked_at"]) <= now + CLOCK_SKEW,
                "Application facts require a reviewed source and date")
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
        if row.get("promotion_countries"):
            require(approval.get("promotion_countries") == row["promotion_countries"],
                    "Promotion scope requires documented review")
    else:
        require(row["affiliate_url"] is None, "Unapproved affiliate URL")


def deadline_end(row):
    if row["deadline"] is None:
        return None
    return stamp(row["deadline"]) + (timedelta(seconds=1) if row.get("deadline_date_only") else timedelta())


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
            result = observation.get(sid)
            db.execute("""INSERT INTO sources VALUES (?, ?, ?)
                          ON CONFLICT(id) DO UPDATE SET registry=excluded.registry,
                          observation=COALESCE(excluded.observation, sources.observation)""", (
                sid, json.dumps(source), json.dumps(result) if result else None))
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
            expired = row.get("availability") == "ended" or (deadline_end(row) is not None and deadline_end(row) <= now)
            if expired or (row["category"] != "affiliate" and not consumer_public(row)):
                continue  # The reviewed snapshot and SQLite retain these entries.
            public = {key: row[key] for key in PUBLIC}
            for key in ("shipping_countries", "service_countries", "promotion_countries", "geography_source_url"):
                public[key] = row.get(key)
            public["availability"] = row.get("availability", "unknown")
            public["deadline_timezone"] = row.get("deadline_timezone")
            public["deadline_date_only"] = row.get("deadline_date_only", False)
            public["application"] = application_profile(row.get("application"), row["required_expense"]["kind"] == "free")
            public["entry"] = row.get("entry", UNKNOWN_ENTRY)
            public["prize_category"] = row.get("prize_category")
            public["organizer_verified"] = source.get("organizer_verified") is True
            public["stale_at"] = utc(stamp(row["last_checked_at"]) + STALE)
            public["reward_currencies"] = row.get("reward_currencies", [])
            public["supporting_urls"] = source.get("supporting_urls", [])
            public["affiliate_expires_at"] = None
            if row["affiliate_approval_status"] == "approved":
                expiry = row["affiliate_review"]["expires_at"]
                if stamp(expiry) <= now:
                    public["affiliate_url"] = None
                    public["affiliate_approval_status"] = "revoked"
                else:
                    public["affiliate_expires_at"] = expiry
            if row["category"] == "affiliate" and row["commission"] is None and not public["affiliate_url"]:
                continue
            approved.append(public)
            active.append(row["id"])
        require(any(row["category"] != "affiliate" for row in approved),
                "Refusing to replace the dataset with an empty consumer directory")
    dump(output, {"generated_at": utc(now), "records": sorted(approved, key=lambda item: item["id"])})
    return active


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["collect", "publish"])
    parser.add_argument("--now", help="Fixed UTC clock for reproducible local QA")
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
    active = publish(rows, sources, observation, args.output, args.database, stamp(args.now) if args.now else datetime.now(timezone.utc))
    print(f"{len(active)} validated active records")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, KeyError, TypeError, OSError) as error:
        sys.exit(str(error))
