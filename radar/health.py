"""Report stale records in GitHub's run summary and warnings."""
import os
from datetime import datetime, timezone

from .pipeline import ROOT, read, stamp


def main():
    dataset = read(ROOT / "var/published.json")
    now = datetime.now(timezone.utc)
    records = dataset["records"]
    stale = [row["id"] for row in records if stamp(row["stale_at"]) <= now]
    result = f"Active records: {len(records)}. Stale records: {len(stale)}."
    print(result)
    if stale:
        print("::warning::Reverify stale listings: " + ", ".join(stale))
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(summary, "a", encoding="utf-8") as output:
            print("## Dataset health\n\n" + result, file=output)
            if stale:
                print("\nReview: " + ", ".join(stale), file=output)


if __name__ == "__main__":
    main()
