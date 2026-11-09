"""Offline publication gate and bounded, permission-scoped link diagnostics."""
import argparse
import os
import ssl
import tempfile
from collections import Counter
from datetime import datetime, timezone
from http.client import HTTPException
from pathlib import Path

from .net import PinnedHTTPS, https_url
from .pipeline import (ROOT, STALE, dump, inputs,
                       publish, read, stamp, utc, validate)

KNOWN_CLASSIFICATIONS = {
    'stanley-review-november-2026': ('sweepstakes', 'household'),
    'takaratomy-conan-card-2026': ('sweepstakes', 'collectibles'),
    'tombow-mono-2026': ('sweepstakes', 'household'),
}


def link_status(status):
    if 200 <= status < 300:
        return 'reachable'
    if status in (404, 410):
        return 'needs-review'
    if 300 <= status < 400:
        return 'redirect-needs-review'
    return 'inconclusive'  # Includes 401/403/405/429/5xx; never label these broken.


def head(url):
    parts = https_url(url)
    connection = PinnedHTTPS(parts.hostname, timeout=8, context=ssl.create_default_context())
    try:
        target = parts.path or '/'
        if parts.query:
            target += '?' + parts.query
        connection.request('HEAD', target, headers={'User-Agent': 'FreebieTrail-QA/1.0', 'Connection': 'close'})
        return connection.getresponse().status
    finally:
        connection.close()


def links(rows, sources, online=False, probe=head):
    inventory = {}
    for row in rows:
        source = sources[row['source_id']]
        for role, values in (
            ('source', [row['source_url'], *source.get('supporting_urls', [])]),
            ('application', [row['official_url']]), ('affiliate', [row['affiliate_url']]),
            ('api', [source.get('endpoint')]),
        ):
            for url in filter(None, values):
                https_url(url)
                entry = inventory.setdefault(url, {'url': url, 'roles': [], 'records': [], 'permitted': False})
                entry['roles'] = sorted(set([*entry['roles'], role]))
                entry['records'] = sorted(set([*entry['records'], row['id']]))
                if source['active'] and (
                    (role == 'api' and source['method'] == 'github-content')
                    or (role in {'source', 'application'} and source.get('link_check_allowed') is True)
                ):
                    entry['permitted'] = True
    counts = Counter()
    for item in inventory.values():
        item['status'] = 'not-requested'
        if 'affiliate' in item['roles']:
            item['status'] = 'skipped-affiliate-tracking'
        elif not item.pop('permitted'):
            item['status'] = 'skipped-permission-review'
        elif online:
            host = https_url(item['url']).hostname
            if sum(counts.values()) >= 40 or counts[host] >= 2:
                item['status'] = 'deferred-budget'
                continue
            counts[host] += 1
            try:
                item['http_status'] = probe(item['url'])
                item['status'] = link_status(item['http_status'])
            except (OSError, ValueError, HTTPException) as error:
                item.update(status='inconclusive', error_type=type(error).__name__)
        item.pop('permitted', None)
    return list(inventory.values())


def audit(rows, sources, now, dataset=None, online=False, probe=head):
    errors, warnings, geography = [], [], []
    def issue(target, code, detail, fatal=False):
        (errors if fatal else warnings).append({'id': target, 'code': code, 'detail': detail})
    for row in rows:
        rid = row.get('id', '<missing>')
        try:
            validate(row, sources[row['source_id']], now)
            expected = KNOWN_CLASSIFICATIONS.get(rid)
            if expected and (row['category'], row.get('prize_category')) != expected:
                issue(rid, 'known-classification', str(expected), True)
        except (ValueError, KeyError, TypeError) as error:
            issue(rid, 'schema', str(error), True)
    # Reuse the actual publisher for duplicates, approval scope, active-set and safety checks.
    try:
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'published.json'
            publish(rows, sources, {}, output, Path(folder) / 'qa.sqlite', now)
            expected = read(output)
    except (ValueError, KeyError, TypeError) as error:
        issue('dataset', 'publication', str(error), True)
        expected = {'records': []}
    if dataset is not None:
        actual = {row['id']: row for row in dataset['records']}
        wanted = {row['id']: row for row in expected['records']}
        if len(actual) != len(dataset['records']) or actual.keys() != wanted.keys():
            issue('dataset', 'published-ids', 'Published IDs differ from validated inputs', True)
        for rid in actual.keys() & wanted.keys():
            # Observation can advance last_checked_at only for configured API adapters.
            expected_row = dict(wanted[rid])
            source = sources[next(row['source_id'] for row in rows if row['id'] == rid)]
            if source['method'] != 'manual':
                expected_row['last_checked_at'] = actual[rid]['last_checked_at']
                expected_row['stale_at'] = utc(stamp(actual[rid]['last_checked_at']) + STALE)
            if actual[rid] != expected_row:
                issue(rid, 'published-values', 'Published values differ from validated inputs', True)
    for row in expected['records']:
        rid = row['id']
        missing = [key for key in ('eligible_countries', 'shipping_countries', 'service_countries')
                   if row.get(key) is None and (key != 'shipping_countries' or row['category'] == 'sweepstakes')
                   and (key != 'service_countries' or row['category'] != 'sweepstakes')]
        geography.append({
            'id': rid, 'entry_countries': row['eligible_countries'],
            'shipping_countries': row.get('shipping_countries'), 'service_countries': row.get('service_countries'),
            'promotion_countries': row.get('promotion_countries'), 'missing': missing,
            'eligibility_ja': row['eligibility_ja'], 'eligibility_en': row['eligibility_en'],
            'source_url': row['source_url'], 'geography_source_url': row.get('geography_source_url'),
        })
        if missing:
            issue(rid, 'geography-unverified', ', '.join(missing))
        if stamp(row['last_checked_at']) > now:
            issue(rid, 'future-verification', 'Future verification within accepted clock skew; review clock')
        if stamp(row['last_checked_at']) + STALE <= now:
            issue(rid, 'stale', 'Reverify with original organizer; this does not mean ended')
        if row['category'] == 'sweepstakes' and row.get('prize_category') in (None, 'other'):
            issue(rid, 'unclassified-prize', 'Editorial classification review required')
        if row['deadline'] is None and row.get('availability') != 'ongoing':
            issue(rid, 'deadline-unverified', 'Unknown deadline; do not infer ended')
    try:
        inventory = links(rows, sources, online, probe)
    except (ValueError, KeyError, TypeError) as error:
        issue('links', 'url', str(error), True)
        inventory = []
    return {'checked_at': utc(now), 'errors': errors, 'warnings': warnings,
            'public_records': len(expected['records']), 'geography': geography, 'links': inventory}


def markdown(report):
    lines = ['# Listing quality QA', '',
             f"Checked: {report['checked_at']}; public records: {report['public_records']}; "
             f"errors: {len(report['errors'])}; review warnings: {len(report['warnings'])}", '',
             'Missing geography is a review item, not evidence of residence or shipping eligibility.', '',
             '| ID | Entry | Shipping | Service | Promotion | Missing |',
             '| --- | --- | --- | --- | --- | --- |']
    for row in report['geography']:
        values = [row['id'], *[', '.join(row[key]) if isinstance(row.get(key), list) else row.get(key) or 'unverified'
                   for key in ('entry_countries', 'shipping_countries', 'service_countries', 'promotion_countries')], ', '.join(row['missing'])]
        lines.append('| ' + ' | '.join(values) + ' |')
    for label in ('errors', 'warnings'):
        lines += ['', f'## {label}', '']
        lines += [f"- {i['id']}: {i['code']} — {i['detail']}" for i in report[label]] or ['None.']
    lines += ['', '## Link diagnostics', '']
    lines += [f"- {x['status']}: {x['url']}" for x in report['links']]
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'var/quality-report.json')
    parser.add_argument('--dataset', type=Path)
    parser.add_argument('--now')
    parser.add_argument('--check-links', action='store_true')
    args = parser.parse_args()
    rows, sources = inputs()
    dataset = read(args.dataset) if args.dataset else None
    now = stamp(args.now) if args.now else stamp(dataset['generated_at']) if dataset else datetime.now(timezone.utc)
    report = audit(rows, sources, now, dataset, args.check_links)
    dump(args.output, report)
    summary = markdown(report)
    args.output.with_suffix('.md').write_text(summary)
    if destination := os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(destination, 'a') as output:
            output.write(summary)
    print(f"QA: {len(report['errors'])} error(s), {len(report['warnings'])} review warning(s); report: {args.output}")
    for error in report['errors']:
        print(f"::error::{error['id']}: {error['code']} — {error['detail']}")
    return int(bool(report['errors']))


if __name__ == '__main__':
    raise SystemExit(main())
