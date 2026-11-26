"""Run the read-only daily watch and write its queue and resumable snapshot."""
import argparse
import os
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .discovery_leads import discover_leads
from .discovery_watch import collect, load_state
from .net import https_url
from .pipeline import ROOT, dump, inputs, read


def kaggle_token():
    token = os.environ.get('KAGGLE_DISCOVERY_TOKEN') or os.environ.get('KAGGLE_API_TOKEN')
    if token or os.environ.get('GITHUB_ACTIONS') == 'true':
        return token
    token_path = Path.home() / '.kaggle' / 'access_token'
    return token_path.read_text(encoding='utf-8').strip() if token_path.is_file() else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'var/candidates.json')
    parser.add_argument('--state', type=Path, default=ROOT / 'var/discovery-state.json')
    args = parser.parse_args()
    _, sources = inputs()
    editorial = read(ROOT / 'data/editorial.json')
    reviewed = {url for source in sources.values() for url in (source['official_url'], source['approved_destination'])}
    reviewed.update(row['official_url'] for row in editorial['quests'] if row['status'] == 'approved')
    now = datetime.now(timezone.utc)
    watch = read(ROOT / 'data/discovery-sources.json')
    report, state = collect(watch, reviewed, load_state(args.state), now,
                            kaggle_token=kaggle_token())
    if os.environ.get('FREEBIE_SOURCE_SEARCH_ENABLED') == 'true':
        report['source_leads'] = discover_leads(os.environ.get('OPENAI_API_KEY'),
                                               {https_url(row['endpoint']).hostname for row in watch},
                                               now.astimezone(ZoneInfo('Asia/Tokyo')).date())
    dump(args.output, report)
    dump(args.state, state)
    for key, result in report['feeds'].items():
        if result['status'] != 'ok':
            print(f"::warning::Discovery {key}: {result['status']} ({result.get('error_type', 'see queue metadata')})")
    print(f"Discovery: {len(report['candidates'])} candidate(s) awaiting review")
    return int(all(source['status'] not in ('ok', 'partial') for source in report['feeds'].values()))


if __name__ == '__main__':
    raise SystemExit(main())
