"""Read reviewed publisher indexes and competition APIs into the editorial queue."""
import hashlib
import io
import json
import math
import re
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlencode, urljoin
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo

from .net import fetch_document, https_url

XML_TYPES = ('application/rss+xml', 'application/rdf+xml', 'application/atom+xml', 'application/xml', 'text/xml')
HTML_TYPES = ('text/html', 'application/xhtml+xml')
MAKEFUN = 'https://make.fun/api/competitions'
KAGGLE = 'https://api.kaggle.com/v1/competitions/list'
HINT = re.compile(r'プレゼント|懸賞|抽選|賞品|賞金|副賞|コンペティション|ハッカソン|'
                  r'prize\s*draw|sweepstakes|giveaway|hackathon|win\s+(?:a|an|the|£|\$)|'
                  r'competition.{0,45}prize|コンペ[^ー]|データ分析チャレンジ', re.I)
RULE_LINK = re.compile(r'official rules|terms.and.conditions|prize draw terms|応募規約|募集要項|応募要項', re.I)
SLUG = re.compile(r'[a-z0-9][a-z0-9-]{0,119}')
MONEY = re.compile(r'([$£€¥])?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(USD|GBP|EUR|JPY)?', re.I)


def compact(value):
    return ' '.join(value.split())


def sha(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def date_value(value, zone):
    """Keep date-only evidence date-only, and normalize timestamps with a known zone."""
    if not isinstance(value, str) or not value.strip():
        return None
    value = compact(value)
    if re.fullmatch(r'\d{4}\.\d{1,2}\.\d{1,2}', value):
        value = '-'.join(f'{int(part):02d}' for part in value.split('.'))
    try:
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            day = date.fromisoformat(value)
            return day.isoformat() if day.year >= 2000 else None
        found = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        try:
            found = parsedate_to_datetime(value)
        except (ValueError, OverflowError):
            return None
    if found.year < 2000:
        return None
    return (found if found.tzinfo else found.replace(tzinfo=ZoneInfo(zone))).astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def named_date(value, zone, publication=None):
    iso = date_value(value, zone)
    if iso:
        return iso
    value = compact(value)
    japan = re.fullmatch(r'(?:(\d{4})年\s*)?(\d{1,2})月\s*(\d{1,2})日(?:[（(][^）)]{1,4}[）)])?(?:\s*(\d{1,2})[:時](\d{1,2})?分?)?', value)
    try:
        if japan:
            year, month, day, hour, minute = japan.groups()
            if not year:
                if not publication:
                    return None
                first = date.fromisoformat(publication[:10])
                year = first.year + (int(month) < first.month)
                if not 0 <= (date(int(year), int(month), int(day)) - first).days <= 90:
                    return None
            prefix = f'{int(year):04d}-{int(month):02d}-{int(day):02d}'
            return date_value(f'{prefix}T{int(hour):02d}:{int(minute or 0):02d}:00' if hour else prefix, zone)
        value = re.sub(r'\b([ap])\s*\.\s*m\.', r'\1m', value, flags=re.I)
        early_clock = re.fullmatch(r'(\d{1,2}:\d\d[ap]m) on \w+ (\d{1,2} \w+ \d{4})', value, re.I)
        if early_clock:
            value = f'{early_clock[2]} {early_clock[1]}'
        for pattern, clock in (('%B %d, %Y, %H:%M', True), ('%d %B %Y %I:%M%p', True),
                               ('%B %d, %Y at %I:%M:%S %p', True), ('%B %d, %Y at %I:%M %p', True),
                               ('%B %d, %Y', False), ('%d %B %Y', False)):
            try:
                found = datetime.strptime(value, pattern)
                return date_value(found.isoformat() if clock else found.date().isoformat(), zone)
            except ValueError:
                continue
    except (ValueError, OverflowError):
        return None
    return None


def campaign_url(base, raw, source):
    if not raw or raw.startswith(('#', '?', '//')):
        return None
    try:
        url = https_url(urljoin(base, raw))
    except ValueError:
        return None
    if (url.query or url.fragment or '//' in url.path or '%' in url.path
            or any(part in ('.', '..') for part in raw.split('/'))):
        return None
    if (url.hostname == https_url(source['endpoint']).hostname
            and re.fullmatch(source.get('article_path', r'/[a-zA-Z0-9_/-]+\.html'), url.path)):
        return url.geturl()
    if url.geturl() in source.get('external_urls', []):
        return url.geturl()
    return None


def devpost_link(raw):
    try:
        url = https_url(raw)
    except ValueError:
        return None
    if (url.hostname not in {'www.devpost.com', 'info.devpost.com', 'help.devpost.com'}
            and url.hostname.endswith('.devpost.com')
            and SLUG.fullmatch(url.hostname.removesuffix('.devpost.com'))
            and url.path in ('', '/', '/rules') and not url.query and not url.fragment):
        return f'https://{url.hostname}/'
    return None


class Page(HTMLParser):
    """Read visible text and links only. Publisher scripts are never executed."""

    def __init__(self, raw):
        super().__init__(convert_charrefs=True)
        self.title = ''
        self.published = None
        self.links = []
        self.text = []
        self.main = []
        self.in_main = False
        self.skip = 0
        self.in_title = False
        self.anchor = None
        self.feed(raw.decode('utf-8-sig', 'replace'))
        self.body = compact(' '.join(self.main or self.text))

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style', 'noscript', 'svg'):
            self.skip += 1
        if self.skip:
            return
        if tag == 'main' or attrs.get('role') == 'main':
            self.in_main = True
        if tag == 'title':
            self.in_title = True
        if tag == 'meta' and (attrs.get('property') == 'article:published_time' or attrs.get('itemprop') == 'datePublished'):
            self.published = attrs.get('content')
        if tag == 'a':
            self.anchor = (attrs.get('href', ''), [])

    def handle_data(self, data):
        if self.skip or not data.strip():
            return
        if self.in_title:
            self.title += data
        self.text.append(data)
        if self.in_main:
            self.main.append(data)
        if self.anchor:
            self.anchor[1].append(data)

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript', 'svg') and self.skip:
            self.skip -= 1
        if tag == 'main':
            self.in_main = False
        if tag == 'title':
            self.in_title = False
        if tag == 'a' and self.anchor:
            href, label = self.anchor
            self.links.append((href, compact(' '.join(label))))
            self.anchor = None


def get(fetch, url, types, *, headers=None, limit=256_000):
    return fetch(url, url, types, headers, max_bytes=limit)


def page_dates(page, source):
    zone = source['timezone']
    fields = {'official_published_at': date_value(page.published, zone)}
    for key, pattern in source.get('date_patterns', {}).items():
        found = re.search(pattern, page.body, re.I)
        if found:
            fields[key] = named_date(found[1], zone, fields.get('official_published_at') if source.get('partial_year') else None) or fields.get(key)
    return fields


def inspect_page(fetch, url, source, raw=None):
    page = Page(raw if raw is not None else get(fetch, url, HTML_TYPES, limit=800_000))
    dates = page_dates(page, source)
    # A configured rules PDF is exact and belongs to the project source. Keep
    # the link for review even when no machine-readable date is available.
    rules = source.get('rules_pdf', {}).get(url)
    if not rules:
        for link, label in page.links:
            candidate = campaign_url(url, link, source)
            if candidate and candidate.endswith('.pdf') and RULE_LINK.search(label):
                rules = candidate
                break
    extras = related_destinations(page, url, source)
    return dates, rules, extras, page


def related_destinations(page, evidence, source):
    links = {}
    for href, label in page.links:
        if source.get('linked_devpost'):
            url = devpost_link(href)
            if url:
                links[url] = 'devpost'
        if source.get('linked_signate') or source.get('linked_independent'):
            try:
                url = https_url(href)
            except ValueError:
                continue
            if (source.get('linked_signate') and url.hostname == 'user.competition.signate.jp'
                    and re.fullmatch(r'/(?:ja/|en/)?competition/detail/?', url.path)
                    and not url.fragment):
                competition = parse_qs(url.query).get('competition', [''])[0]
                if re.fullmatch(r'[a-f0-9]{32}', competition):
                    links[f'https://user.competition.signate.jp/ja/competition/detail/?competition={competition}'] = 'signate'
            if (source.get('linked_independent') and url.hostname != https_url(evidence).hostname
                    and not url.query and not url.fragment and url.path in ('', '/')
                    and (url.hostname == label or url.hostname.removeprefix('www.') == label)
                    and source.get('kind') == 'index' and '/project/' in evidence):
                links.setdefault(url.geturl(), 'organizer-site')
    return [{'url': url, 'evidence_url': evidence, 'platform': platform}
            for url, platform in sorted(links.items())[:30]]


def pdf_dates(fetch, url, source):
    from pypdf import PdfReader

    data = get(fetch, url, ('application/pdf',), limit=1_500_000)
    if not data.startswith(b'%PDF-'):
        raise ValueError('Unexpected PDF format')
    doc = PdfReader(io.BytesIO(data), strict=True)
    if doc.is_encrypted:
        raise ValueError('Encrypted PDF')
    text = compact(' '.join(page.extract_text() or '' for page in doc.pages[:4]))
    fields = {}
    for key, pattern in source.get('pdf_date_patterns', {}).items():
        found = re.search(pattern, text, re.I)
        if found:
            fields[key] = named_date(found[1], source['timezone'])
    return fields


def feed_rows(raw, source):
    document = raw.decode(source.get('encoding', 'utf-8-sig'))
    if '\x00' in document or re.search(r'<!DOCTYPE|<!ENTITY', document, re.I):
        raise ValueError('Unsafe feed XML')
    root = ET.fromstring(document)
    ns = '{http://purl.org/rss/1.0/}'
    dc = '{http://purl.org/dc/elements/1.1/}'
    atom = '{http://www.w3.org/2005/Atom}'
    if root.tag == '{http://www.w3.org/1999/02/22-rdf-syntax-ns#}RDF':
        items, ns_item = root.findall(ns + 'item'), ns
    elif root.tag == 'rss' and root.find('channel') is not None:
        items, ns_item = root.findall('channel/item'), ''
    elif root.tag == atom + 'feed':
        items, ns_item = root.findall(atom + 'entry'), atom
    else:
        raise ValueError('Unexpected feed format')
    for item in items[:120]:
        title = compact(item.findtext(ns_item + 'title', ''))
        description = compact(item.findtext(ns_item + 'description', '') or item.findtext(atom + 'summary', ''))
        publication = (item.findtext('pubDate') or item.findtext(dc + 'date')
                       or item.findtext(atom + 'published'))
        updated = item.findtext(atom + 'updated')
        links = item.findall(ns_item + 'link')
        href = next((link.get('href') or link.text or '' for link in links if link.get('rel', 'alternate') == 'alternate'), '')
        url = campaign_url(source['endpoint'], href.strip(), source)
        if url:
            yield {'url': url, 'fingerprint': sha([title, description, publication, updated]),
                   'official_published_at': date_value(publication, source['timezone']),
                   'matched': bool(HINT.search(title + ' ' + description))}


def sitemap_rows(raw, source):
    document = raw.decode('utf-8-sig')
    if '\x00' in document or re.search(r'<!DOCTYPE|<!ENTITY', document, re.I):
        raise ValueError('Unsafe sitemap XML')
    root = ET.fromstring(document)
    ns = '{http://www.sitemaps.org/schemas/sitemap/0.9}'
    if root.tag != ns + 'urlset':
        raise ValueError('Expected a reviewed sitemap URL set')
    entries = []
    for item in root.findall(ns + 'url'):
        url = campaign_url(source['endpoint'], item.findtext(ns + 'loc', '').strip(), source)
        if url:
            modified = date_value(item.findtext(ns + 'lastmod'), source['timezone'])
            entries.append((modified or '', url))
    for modified, url in sorted(entries, reverse=True)[:25]:
        yield {'url': url, 'fingerprint': sha([url, modified]), 'matched': False, 'detail': True}


def makefun_rows(fetch, endpoint):
    rows, cursor, truncated = [], None, False
    for _ in range(3):
        query = {'status': 'open', 'limit': '50', 'activity': 'times'}
        if cursor:
            query['cursor'] = cursor
        url = endpoint + '?' + urlencode(query)
        data = json.loads(get(fetch, url, ('application/json',), limit=3_000_000))
        items = data['items']
        if not isinstance(items, list):
            raise ValueError('Unexpected Make.fun list')
        rows.extend(items)
        cursor = data.get('next_cursor')
        if not cursor:
            break
        if not isinstance(cursor, str) or len(cursor) > 1024:
            raise ValueError('Invalid Make.fun cursor')
    else:
        truncated = bool(cursor)
    result = []
    for item in rows:
        slug, amount = item.get('slug'), item.get('rewardAmount')
        if (not isinstance(slug, str) or not SLUG.fullmatch(slug) or item.get('status') != 'open'
                or item.get('demo') is not False or item.get('visibility') != 'public'
                or type(amount) not in (int, float) or not math.isfinite(amount) or amount <= 0):
            continue
        opens = date_value(item.get('publishedAt'), 'UTC')
        deadline = date_value(item.get('deadline'), 'UTC')
        if not deadline:
            continue
        fee = item.get('entryFeeUsd')
        result.append({'url': f'https://make.fun/bounty/{slug}', 'evidence_url': f'https://make.fun/api/competitions/{slug}',
                       'platform': 'makefun', 'opens_at': opens, 'deadline': deadline,
                       'category': item.get('category') if item.get('category') in {
                           'Trading', 'Forecasting', 'Security', 'Automation', 'Growth', 'Games', 'Code'} else None,
                       'reward': {'amount': amount, 'currency': 'USD', 'kind': 'prize-pool'},
                       'entry_fee': 'none-reported' if 'entryFeeUsd' in item and fee is None else 'check-rules'})
    return result, truncated


def kaggle_rows(fetch, endpoint, token):
    if endpoint != KAGGLE or not re.fullmatch(r'[!-~]{1,512}', token):
        raise ValueError('Invalid Kaggle endpoint or credential format')
    rows, truncated = [], False
    for number in range(1, 4):
        url = endpoint + '?' + urlencode({'sortBy': 'recentlyCreated', 'page': number})
        block = json.loads(get(fetch, url, ('application/json',), headers={'Authorization': 'Bearer ' + token}))
        if not isinstance(block, list):
            raise ValueError('Unexpected Kaggle list')
        rows.extend(block)
        if len(block) < 20:
            break
    else:
        truncated = True
    result = []
    for item in rows:
        url = item.get('ref', '')
        if (not isinstance(url, str) or not re.fullmatch(r'https://www\.kaggle\.com/competitions/[a-z0-9-]+', url)
                or item.get('submissionsDisabled') is True):
            continue
        reward = MONEY.fullmatch(item.get('reward') or '')
        symbol, amount, currency = reward.groups() if reward else (None, '0', None)
        currency = currency or {'$': 'USD', '£': 'GBP', '€': 'EUR', '¥': 'JPY'}.get(symbol)
        value = float(amount.replace(',', ''))
        deadline = date_value(item.get('newEntrantDeadline'), 'UTC') or date_value(item.get('deadline'), 'UTC')
        if not currency or not math.isfinite(value) or value <= 0 or not deadline:
            continue
        result.append({'url': url, 'evidence_url': url + '/rules', 'platform': 'kaggle',
                       'official_published_at': date_value(item.get('enabledDate'), 'UTC'),
                       'deadline': deadline, 'submission_deadline': date_value(item.get('deadline'), 'UTC'),
                       'reward': {'amount': value, 'currency': currency.upper(), 'kind': 'listed-reward'}})
    return result, truncated


def page_rows(fetch, source):
    endpoint = source['endpoint']
    raw = get(fetch, endpoint, HTML_TYPES, limit=800_000)
    page = Page(raw)
    if not page.body:
        raise ValueError('Empty publisher page')
    if source['kind'] == 'page':
        dates, rules, extras, _ = inspect_page(fetch, endpoint, source, raw)
        common = {'fingerprint': sha([page.body, dates, rules, extras]), 'evidence_url': endpoint}
        result = [] if extras and source.get('prefer_linked') else [{**common, **dates,
                  'url': source.get('candidate_url', endpoint), 'rules_url': rules,
                  'matched': source.get('always_candidate') or bool(HINT.search(page.body))}]
        result.extend({**common, **dates, **extra, 'matched': True} for extra in extras)
        return result
    result = {}
    for href, title in page.links:
        url = campaign_url(endpoint, href, source)
        if url and url != endpoint and (source.get('scan_all') or HINT.search(title) or url in source.get('external_urls', [])):
            result[url] = {'url': url, 'fingerprint': sha(title), 'matched': bool(HINT.search(title)), 'detail': True}
    for extra in related_destinations(page, endpoint, source):
        result[extra['url']] = {**extra, 'fingerprint': sha(extra), 'matched': True}
    if source.get('required_path') and not result:
        raise ValueError('Publisher index yielded no recognized links')
    return list(result.values())


def alive(candidate, now, timezone_name):
    deadline = candidate.get('deadline')
    if not deadline:
        return True
    if len(deadline) == 10:
        day = datetime.fromisoformat(now.replace('Z', '+00:00')).astimezone(ZoneInfo(timezone_name)).date()
        return deadline >= day.isoformat()
    return deadline > now


def load_state(path):
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding='utf-8'))
    if data.get('version') != 1 or not isinstance(data.get('sources'), dict):
        raise ValueError('Invalid discovery state')
    return data


def collect(sources, reviewed, state, now, *, fetch=fetch_document, kaggle_token=None):
    stamp = now.strftime('%Y-%m-%dT%H:%M:%SZ')
    retained = (now.date().toordinal() - 45)
    output, statuses, candidate_map = {}, {}, {}
    for source in sources:
        sid, endpoint = source['id'], source['endpoint']
        https_url(source['permission_url'])
        https_url(endpoint)
        earlier = state.get('sources', {}).get(sid, {})
        previous = {url: item for url, item in earlier.items()
                    if date.fromisoformat(item['last_seen_at'][:10]).toordinal() >= retained}
        current = dict(previous)
        output[sid] = current
        clipped = False
        errors = 0
        kind = source['kind']
        try:
            if kind == 'feed':
                records = list(feed_rows(get(fetch, endpoint, XML_TYPES, limit=800_000), source))
                records.sort(key=lambda row: (row['matched'], row['official_published_at'] or ''), reverse=True)
            elif kind == 'sitemap':
                records = list(sitemap_rows(get(fetch, endpoint, XML_TYPES, limit=800_000), source))
            elif kind in ('page', 'index'):
                records = page_rows(fetch, source)
            elif kind == 'makefun':
                if endpoint != MAKEFUN:
                    raise ValueError('Unreviewed Make.fun API')
                records, clipped = makefun_rows(fetch, endpoint)
            elif kind == 'kaggle':
                if not kaggle_token:
                    statuses[sid] = {'status': 'credentials-missing'}
                    continue
                records, clipped = kaggle_rows(fetch, endpoint, kaggle_token)
            else:
                raise ValueError('Unknown discovery source kind')
        except (OSError, ValueError, KeyError, TypeError, AttributeError, ET.ParseError) as exc:
            statuses[sid] = {'status': 'failed', 'error_type': type(exc).__name__}
            continue

        detected = []
        detail_budget = source.get('detail_limit', 0)
        for row in records:
            url = row['url']
            if url in reviewed:
                current.pop(url, None)
                continue
            old = previous.get(url)
            fingerprint = row.get('fingerprint') or sha(row)
            if old and old['fingerprint'] == fingerprint:
                old = {**old, 'last_seen_at': stamp}
                current[url] = old
                if old.get('candidate'):
                    detected.append(old['candidate'])
                continue
            matched = row.get('matched', True)
            extras = []
            if row.get('detail') or (source.get('inspect_feed_articles')
                                    and (matched or not source.get('only_matched_details'))):
                if not detail_budget:
                    clipped = True
                    continue
                detail_budget -= 1
                try:
                    fields, rules, extras, page = inspect_page(fetch, url, source)
                    matched = (matched or bool(HINT.search(page.body))) and not (extras and source.get('prefer_linked'))
                    row = {**row, **{key: value for key, value in fields.items() if value},
                           'rules_url': rules, 'evidence_url': url}
                except (OSError, ValueError, ET.ParseError):
                    errors += 1
                    continue
            rules = row.get('rules_url')
            pdf_status = None
            if rules and source.get('pdf_date_patterns'):
                try:
                    row.update({k: v for k, v in pdf_dates(fetch, rules, source).items() if v})
                    pdf_status = 'read'
                except (OSError, ValueError, ImportError, KeyError, IndexError):
                    errors += 1
                    pdf_status = 'pending'
            former = old.get('candidate') if old else None
            rotated = (former and source.get('rotating') and row.get('deadline')
                       and not alive(former, stamp, source['timezone']) and alive(row, stamp, source['timezone']))
            first = old['first_seen_at'] if old and not rotated else stamp
            candidate = None
            if matched:
                candidate = {k: v for k, v in row.items() if k not in ('matched', 'detail', 'fingerprint')}
                candidate.update(first_seen_at=first, last_changed_at=stamp, status='candidate')
                if pdf_status:
                    candidate['rules_pdf_status'] = pdf_status
                detected.append(candidate)
            current[url] = {'first_seen_at': first, 'last_seen_at': stamp, 'fingerprint': None if pdf_status == 'pending' else fingerprint,
                            'candidate': candidate}
            for extra in extras:
                link = extra['url']
                if link in reviewed:
                    continue
                seen = previous.get(link, {})
                child = {**extra, 'first_seen_at': seen.get('first_seen_at', stamp),
                         'last_changed_at': stamp, 'status': 'candidate'}
                detected.append(child)
                current[link] = {'first_seen_at': child['first_seen_at'], 'last_seen_at': stamp,
                                 'fingerprint': sha(extra), 'candidate': child}
        # Keep discovered links across short upstream failures and rotating feed windows.
        for item in current.values():
            if item.get('candidate'):
                detected.append(item['candidate'])
        statuses[sid] = {'status': 'partial' if errors else 'ok', 'matches': len({x['url'] for x in detected if alive(x, stamp, source['timezone'])}),
                         'detail_errors': errors, 'truncated': clipped}
    for source in sources:
        sid = source['id']
        for url, item in output[sid].items():
            row = item.get('candidate')
            if not row or url in reviewed or not alive(row, stamp, source['timezone']):
                continue
            values = {'market': source['market'], 'lane': source['lane'], **row}
            candidate = candidate_map.get(url)
            if candidate:
                feeds = sorted(set(candidate['feeds'] + [sid]))
                first = min(candidate['first_seen_at'], values['first_seen_at'])
                candidate.update({key: value for key, value in values.items() if value is not None and not candidate.get(key)})
                candidate.update(first_seen_at=first, feeds=feeds)
            else:
                candidate_map[url] = {**values, 'feeds': [sid]}
    for row in candidate_map.values():
        for field in ('official_published_at', 'opens_at', 'deadline'):
            row.setdefault(field, None)
        row['availability'] = ('upcoming' if row.get('opens_at') and row['opens_at'] > stamp else
                               'window-reported' if row.get('deadline') else 'unconfirmed')
        row['pending_checks'] = ['official-rules', 'eligibility', 'entry-cost', 'prize-claim', 'editorial-approval']
        if row['lane'] == 'skill-competition':
            row['pending_checks'].append('ai-use-terms')
    candidates = sorted(candidate_map.values(), key=lambda row: row['url'])
    candidates.sort(key=lambda row: (row['last_changed_at'], row['first_seen_at']), reverse=True)
    return {'checked_at': stamp, 'feeds': statuses, 'candidates': candidates}, {'version': 1, 'sources': output}
