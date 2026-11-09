import copy
import json
import tempfile
import unittest
from contextlib import closing
from datetime import timedelta
from http.client import BadStatusLine
from pathlib import Path

from radar.pipeline import deadline_end, inputs, publish, stamp, validate
from radar.qa import KNOWN_CLASSIFICATIONS, audit, link_status, links

NOW = stamp('2026-11-08T12:00:00Z')


class QualityTests(unittest.TestCase):
    def setUp(self):
        self.rows, self.sources = inputs(Path(__file__).parent / "fixtures/reviewed")
        self.by_id = {row['id']: row for row in self.rows}

    def test_known_category_regressions_are_enforced(self):
        for rid, expected in KNOWN_CLASSIFICATIONS.items():
            with self.subTest(rid=rid):
                row = self.by_id[rid]
                self.assertEqual((row['category'], row['prize_category']), expected)
                row['prize_category'] = 'food'
                report = audit(self.rows, self.sources, NOW)
                self.assertTrue(any(error['code'] == 'known-classification' for error in report['errors']))
                row['category'], row['prize_category'] = expected
        self.by_id['tombow-mono-2026']['category'] = 'survey'
        self.assertTrue(audit(self.rows, self.sources, NOW)['errors'])

    def test_all_regions_reported_and_shipping_not_used_as_residence(self):
        report = audit(self.rows, self.sources, NOW)
        self.assertEqual(report['errors'], [])
        self.assertEqual(len(report['geography']), report['public_records'])
        row = next(row for row in report['geography'] if row['id'] == 'doutor-latte-2026')
        self.assertIsNone(row['entry_countries'])
        self.assertEqual(row['shipping_countries'], ['JP'])
        self.assertIn('eligible_countries', row['missing'])
        fc = next(row for row in report['geography'] if row['id'] == 'freecash')
        self.assertIsNone(fc['entry_countries'])
        self.assertIsNone(fc['service_countries'])
        self.assertEqual(len(fc['promotion_countries']), 15)

    def test_service_regions_keep_their_meaning_and_reviewed_google_countries(self):
        microsoft = self.by_id['microsoft-rewards']
        self.assertIsNone(microsoft['eligible_countries'])
        self.assertFalse(microsoft['eligibility_verified'])
        self.assertIn('JP', microsoft['service_countries'])
        google = self.by_id['google-opinion-android']
        self.assertEqual(len(google['service_countries']), 39)
        self.assertEqual(google['service_countries'], google['eligible_countries'])
        self.assertTrue({'CO','FI','HU','ZA','VN'} <= set(google['service_countries']))

    def test_invalid_country_codes_and_geography_evidence(self):
        row = self.by_id['doutor-latte-2026']
        for changes in ({'shipping_countries': ['ZZ']}, {'shipping_countries': ['JP', 'JP']},
                        {'eligible_countries': ['QQ'], 'eligibility_verified': True},
                        {'geography_source_url': 'https://example.com/unreviewed'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate({**row, **changes}, self.sources[row['source_id']], NOW)

    def test_strict_timestamps_and_future_verification(self):
        row = self.rows[0]
        for value in ('2026-11-05', '2026-11-05T06:19:00', '2026-02-30T00:00:00Z',
                      '2026-11-05T06:19:00+09:00', '2026-11-09T00:00:00Z', None):
            with self.subTest(value=value), self.assertRaises((ValueError, TypeError)):
                validate({**row, 'last_checked_at': value}, self.sources[row['source_id']], NOW)

    def test_date_only_cutoff_includes_the_entire_japanese_day(self):
        row = self.by_id['ja-wakayama-rice-2026-11']
        end = deadline_end(row)
        self.assertEqual(end, stamp('2026-11-30T15:00:00Z'))
        with tempfile.TemporaryDirectory() as folder:
            for offset, expected in ((-86400, True), (-1, True), (0, False), (1, False)):
                with self.subTest(offset=offset):
                    active = publish(self.rows, self.sources, {}, Path(folder)/'out.json', Path(folder)/'db.sqlite', end + timedelta(seconds=offset))
                    self.assertEqual(row['id'] in active, expected)

    def test_date_only_requires_zone_and_final_second(self):
        row = self.by_id['ja-wakayama-rice-2026-11']
        for changes in ({'deadline_timezone': None}, {'deadline': '2026-11-29T15:00:00Z'}):
            with self.assertRaises(ValueError):
                validate({**row, **changes}, self.sources[row['source_id']], NOW)

    def test_ongoing_and_unknown_do_not_mean_ended(self):
        row = self.by_id['freecash']
        self.assertIsNone(deadline_end(row))
        self.assertEqual(row['availability'], 'ongoing')
        with self.assertRaisesRegex(ValueError, 'Ongoing'):
            validate({**row, 'deadline': '2026-11-30T00:00:00Z'}, self.sources[row['source_id']], NOW)
        report = audit(self.rows, self.sources, NOW)
        self.assertFalse(any(e['code'] == 'publication' for e in report['errors']))

    def test_early_or_undated_ending_requires_evidence(self):
        row = self.by_id['ja-wakayama-rice-2026-11']
        for deadline in (None, row['deadline']):
            ended = {**row, 'availability': 'ended', 'deadline': deadline, 'deadline_date_only': False}
            if deadline is None:
                ended.pop('deadline_timezone', None)
            with self.assertRaisesRegex(ValueError, 'reviewed evidence'):
                validate(ended, self.sources[row['source_id']], NOW)
            validate({**ended, 'ended_source_url': row['source_url'], 'ended_checked_at': '2026-11-08T11:00:00Z'}, self.sources[row['source_id']], NOW)

    def test_published_tampering_fails_gate(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)/'out.json'
            publish(self.rows, self.sources, {}, output, Path(folder)/'db.sqlite', NOW)
            dataset = json.loads(output.read_text())
            dataset['records'][0]['stale_at'] = '2020-01-01T00:00:00Z'
            self.assertTrue(any(e['code'] == 'published-values' for e in audit(self.rows, self.sources, NOW, dataset)['errors']))

    def test_invalid_update_leaves_last_valid_dataset_and_database(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as folder:
            output, dbfile = Path(folder)/'out.json', Path(folder)/'db.sqlite'
            publish(self.rows, self.sources, {}, output, dbfile, NOW)
            previous = output.read_bytes()
            with closing(sqlite3.connect(dbfile)) as db:
                before = db.execute('SELECT * FROM opportunities ORDER BY id').fetchall()
            self.rows[-1]['last_checked_at'] = 'bad-date'
            with self.assertRaises(ValueError):
                publish(self.rows, self.sources, {}, output, dbfile, NOW)
            self.assertEqual(previous, output.read_bytes())
            with closing(sqlite3.connect(dbfile)) as db:
                self.assertEqual(before, db.execute('SELECT * FROM opportunities ORDER BY id').fetchall())

    def test_link_responses_do_not_overstate_failure(self):
        for status in (401, 403, 405, 429, 500, 503):
            self.assertEqual(link_status(status), 'inconclusive')
        self.assertEqual(link_status(404), 'needs-review')
        self.assertEqual(link_status(410), 'needs-review')
        self.assertEqual(link_status(302), 'redirect-needs-review')
        self.assertEqual(link_status(200), 'reachable')

    def test_links_are_deduplicated_bounded_and_never_follow_affiliates(self):
        called = []
        def probe(url):
            called.append(url)
            return 429
        report = links(self.rows, self.sources, True, probe)
        self.assertEqual(len(called), 1)  # Only the reviewed official API allows automatic requests.
        self.assertEqual(len(report), len({item['url'] for item in report}))
        self.assertNotIn(self.by_id['freecash']['affiliate_url'], called)
        self.assertTrue(any(x['status'] == 'skipped-affiliate-tracking' for x in report))
        self.assertTrue(any(x['status'] == 'inconclusive' for x in report))

    def test_malformed_head_response_does_not_block_publication(self):
        def malformed(_url):
            raise BadStatusLine("invalid HTTP response")

        report = audit(self.rows, self.sources, NOW, online=True, probe=malformed)
        self.assertEqual(report['errors'], [])
        self.assertTrue(any(item['status'] == 'inconclusive' for item in report['links']))

    def test_promotion_scope_matches_existing_approval(self):
        row = self.by_id['freecash']
        self.assertIn('16', row['eligibility_ja'])
        self.assertEqual(set(row['promotion_countries']), set('US DE FR CA AU AT NL BE IT GB PL CH JP KR SE'.split()))
        self.assertEqual(row['affiliate_url'], 'https://freecash.pxf.io/GbyNa2')
        bad = copy.deepcopy(row)
        bad['promotion_countries'].remove('JP')
        with self.assertRaisesRegex(ValueError, 'documented review'):
            validate(bad, self.sources[row['source_id']], NOW)
