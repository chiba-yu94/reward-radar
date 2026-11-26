import json
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from radar.discovery_leads import discover_leads
from radar.discovery_watch import KAGGLE, MAKEFUN, collect, feed_rows
from radar.net import UpstreamHTTPError

NOW = datetime(2026, 11, 26, 9, tzinfo=timezone.utc)
HOST = 'www.pref.saitama.lg.jp'
URL = f'https://{HOST}/news/example.html'


def source(identifier, kind, endpoint, market='JP', **fields):
    return {'id': identifier, 'kind': kind, 'endpoint': endpoint, 'permission_url': endpoint,
            'market': market, 'lane': 'giveaway', 'timezone': 'Asia/Tokyo', **fields}


def rss(*links):
    entries = ''.join(f'<item><title>食品プレゼント</title><link>{url}</link><dc:date>2026-11-25T07:00:00+09:00</dc:date></item>' for url in links)
    return (f'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" '
            f'xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">'
            f'<channel/>{entries}</rdf:RDF>').encode()


class TestDiscovery(unittest.TestCase):
    def test_deduplicate_allowlisted_feed_and_keep_first_seen_date(self):
        sources = [source(key, 'feed', f'https://{HOST}/{key}.xml') for key in ('one', 'two')]
        requested = []

        def fetch(endpoint, allowed, types, headers, **_):
            self.assertEqual(endpoint, allowed)
            requested.append(endpoint)
            return rss(URL, URL, URL + '?code=1', URL.replace(HOST, 'evil.example'),
                       URL.replace(HOST, '127.0.0.1'), URL.replace('/news/', '/news/../'))

        report, state = collect(sources, set(), {}, NOW, fetch=fetch)
        self.assertEqual(requested, [row['endpoint'] for row in sources])
        self.assertEqual(len(report['candidates']), 1)
        candidate, = report['candidates']
        self.assertEqual(candidate['feeds'], ['one', 'two'])
        self.assertEqual(candidate['official_published_at'], '2026-11-24T22:00:00Z')
        self.assertEqual(candidate['first_seen_at'], '2026-11-26T09:00:00Z')
        repeated, state = collect(sources, set(), state, NOW.replace(day=27), fetch=fetch)
        self.assertEqual(repeated['candidates'], [candidate])
        reviewed, _ = collect(sources, {URL}, state, NOW, fetch=fetch)
        self.assertEqual(reviewed['candidates'], [])

    def test_new_and_updated_feed_articles_are_inspected_and_dated(self):
        endpoint = 'https://news.example.org/feed/'
        article = 'https://news.example.org/docs/20261125/'
        feed = (f'<rss><channel><item><title>住民向けお知らせ</title><link>{article}</link>'
                '<pubDate>Wed, 25 Nov 2026 06:00:00 GMT</pubDate></item></channel></rss>').encode()
        src = source('news', 'feed', endpoint, article_path=r'/docs/\d+/', detail_limit=1, inspect_feed_articles=True,
                     partial_year=True, date_patterns={'official_published_at':r'公開日 (\d+年\d+月\d+日)',
                                                        'opens_at':r'受付開始 (\d+月\d+日（.）\d+時)'})
        requests = []

        def fetch(url, *_args, **_):
            requests.append(url)
            return feed if url == endpoint else '<main>公開日 2026年11月25日 受付開始 12月14日（月）9時 お返事の中から抽選</main>'.encode()

        report, state = collect([src], set(), {}, NOW, fetch=fetch)
        candidate, = report['candidates']
        self.assertEqual(candidate['opens_at'], '2026-12-14T00:00:00Z')
        self.assertEqual(candidate['availability'], 'upcoming')
        self.assertEqual(requests, [endpoint, article])
        requests.clear()
        collect([src], set(), state, NOW.replace(day=27), fetch=fetch)
        self.assertEqual(requests, [endpoint])

    def test_links_from_organizer_include_devpost_and_independent_site_without_fetching_them(self):
        root = 'https://events.example.org/'
        article = root + 'project/challenge'
        src = source('organizer', 'index', root, article_path=r'/project/[a-z-]+', detail_limit=3,
                     linked_devpost=True, linked_independent=True, prefer_linked=True)
        responses = {root: b'<a href="/project/challenge">Hackathon prize</a>',
                     article: b'<main>Hackathon <a href="https://event-example.org/">event-example.org</a>'
                              b'<a href="https://test-hack.devpost.com/rules">Official rules</a>'
                              b'<a href="https://evil.example/project">falsely linked</a></main>'}

        def fetch(url, *_args, **_):
            return responses[url]

        report, _ = collect([src], set(), {}, NOW, fetch=fetch)
        self.assertEqual({item['platform']: item['url'] for item in report['candidates']}, {
            'organizer-site': 'https://event-example.org/', 'devpost': 'https://test-hack.devpost.com/',
        })

    def test_fixed_rules_pdf_is_only_parsed_on_change_and_deadline_is_used(self):
        endpoint = 'https://tourism.example.org/contest/'
        pdf = 'https://tourism.example.org/contest/rules.pdf'
        src = source('tourism', 'page', endpoint, rules_pdf={endpoint: pdf},
                     pdf_date_patterns={'deadline': 'final (.*)'})
        with patch('radar.discovery_watch.pdf_dates', return_value={'deadline': '2026-11-30T14:00:00Z'}) as read_pdf:
            fetch = lambda *_args, **_: b'<main>Prize draw</main>'
            report, state = collect([src], set(), {}, NOW, fetch=fetch)
            again, _ = collect([src], set(), state, NOW.replace(day=27), fetch=fetch)
            self.assertEqual(again['candidates'], report['candidates'])
            self.assertEqual(report['candidates'][0]['deadline'], '2026-11-30T14:00:00Z')
            read_pdf.assert_called_once()

    def test_signate_page_link_has_a_canonical_competition_id(self):
        endpoint = 'https://organizer.example.org/announcement'
        src = source('signate-organizer', 'page', endpoint, linked_signate=True, prefer_linked=True)
        identifier = '1234567890abcdef1234567890abcdef'
        href = f'https://user.competition.signate.jp/ja/competition/detail?competition={identifier}&amp;from=organizer'
        raw = f'<main>データ分析コンペ<a href="{href}">SIGNATE</a></main>'.encode()
        report, _ = collect([src], set(), {}, NOW, fetch=lambda *_args, **_: raw)
        item, = report['candidates']
        self.assertEqual(item['url'], f'https://user.competition.signate.jp/ja/competition/detail/?competition={identifier}')
        self.assertEqual(item['platform'], 'signate')
        self.assertEqual(item['evidence_url'], endpoint)

    def test_search_returns_review_leads_without_fetching_result_urls(self):
        requests = []

        def send(body, token):
            self.assertEqual(token, 'mock-search-key')
            request = json.loads(body)
            self.assertFalse(request['store'])
            self.assertEqual(request['max_tool_calls'], 1)
            self.assertEqual(request['tool_choice'], {'type': 'web_search'})
            self.assertIn(NOW.date().isoformat(), request['input'])
            requests.append(request['tools'][0]['user_location']['country'])
            citations = [{'type': 'url_citation', 'url': url} for url in (
                'https://newhost.org/official/#rules', 'https://www.known.org/',
                'https://127.0.0.1/private', 'https://other.org/?id=123')]
            return {'status': 'completed', 'output': [
                {'type': 'web_search_call', 'status': 'completed'},
                {'type': 'message', 'role': 'assistant', 'content': [
                    {'type': 'output_text', 'text': 'https://uncited.org/', 'annotations': citations}]}],
                'usage': {'input_tokens': 50, 'output_tokens': 10}}

        result = discover_leads('mock-search-key', {'known.org'}, NOW.date(), send=send)
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['links'], [{'url':'https://newhost.org/official/', 'market':'JP', 'status':'review-source'}])
        self.assertEqual(requests, ['JP', 'GB', 'US'])
        self.assertEqual(result['markets']['JP']['input_tokens'], 50)

    def test_search_quota_failure_stops_before_other_markets(self):
        calls = []

        def send(body, token):
            calls.append(token)
            raise UpstreamHTTPError(429)

        result = discover_leads('mock-search-key', set(), NOW.date(), send=send)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['markets'], {'JP': {'status': 'http-error', 'http_status': 429}})
        self.assertEqual(calls, ['mock-search-key'])

    def test_platforms_exclude_closed_and_unrewarded_rows_and_do_not_leak_auth(self):
        sources = [source('make', 'makefun', MAKEFUN), source('kaggle', 'kaggle', KAGGLE)]
        make = {'slug':'paid-challenge', 'status':'open', 'demo':False, 'visibility':'public', 'rewardAmount':25,
                'deadline':'2026-11-29T20:00:00Z', 'publishedAt':'2026-11-27T20:00:00Z', 'entryFeeUsd':None}
        kaggle = {'ref':'https://www.kaggle.com/competitions/prize-competition', 'reward':'1,000 Usd',
                  'deadline':'2026-12-01T20:00:00Z', 'newEntrantDeadline':'2026-11-30T20:00:00Z',
                  'userHasEntered':True}

        def fetch(url, allowed, types, headers, **_):
            self.assertEqual(url, allowed)
            if url.startswith(MAKEFUN):
                self.assertIsNone(headers)
                return json.dumps({'items':[make, {**make, 'slug':'closed', 'deadline':'2026-11-26T08:59:59Z'}]}).encode()
            self.assertTrue(url.startswith(KAGGLE))
            self.assertEqual(headers, {'Authorization':'Bearer mock-test-token'})
            return json.dumps([kaggle, {**kaggle, 'reward':'Knowledge'}]).encode()

        report, _ = collect(sources, set(), {}, NOW, fetch=fetch, kaggle_token='mock-test-token')
        by_platform = {row['platform']: row for row in report['candidates']}
        self.assertEqual(set(by_platform), {'makefun', 'kaggle'})
        self.assertEqual(by_platform['makefun']['availability'], 'upcoming')
        self.assertEqual(by_platform['kaggle']['deadline'], '2026-11-30T20:00:00Z')
        self.assertNotIn('mock-test-token', json.dumps(report))
        self.assertNotIn('userHasEntered', json.dumps(report))
        missing, _ = collect(sources, set(), {}, NOW, fetch=fetch)
        self.assertEqual(missing['feeds']['kaggle']['status'], 'credentials-missing')

    def test_unavailable_source_and_unsafe_xml(self):
        src = source('one', 'feed', f'https://{HOST}/one.xml')

        def unavailable(*_args, **_):
            raise TimeoutError()

        report, _ = collect([src], set(), {}, NOW, fetch=unavailable)
        self.assertEqual(report['feeds']['one']['status'], 'failed')
        with self.assertRaises(ValueError):
            list(feed_rows(b'<!DOCTYPE rss [<!ENTITY a "expansion">]>' + rss(), src))

    def test_explicit_japanese_feed_encoding(self):
        src = source('legacy-jp', 'feed', f'https://{HOST}/press.rdf', encoding='cp932')
        document = '<?xml version="1.0" encoding="Shift_JIS"?>' + rss(URL).decode()
        item, = feed_rows(document.encode('cp932'), src)
        self.assertEqual(item['url'], URL)
        self.assertTrue(item['matched'])
