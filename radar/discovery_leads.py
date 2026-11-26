"""Find possible additional source URLs for a human to review via an opt-in search API."""
import json
import re
from urllib.parse import urlencode

from .net import UpstreamHTTPError, fetch_document, https_url

ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'
QUERIES = (
    ('JP', 'ja', '抽選 アンケート 体験 募集 公式 新着'),
    ('GB', 'en', 'visitor survey prize draw venue official announcement'),
    ('US', 'en', 'newsletter visitor survey sweepstakes official rules'),
    ('US', 'en', 'hackathon prize submission deadline organizer official website'),
)


def discover_leads(token, known_hosts, *, fetch=fetch_document):
    if not token:
        return {'status': 'credentials-missing', 'links': []}
    if not re.fullmatch(r'[!-~]{1,512}', token):
        return {'status': 'invalid-credential', 'links': []}
    links, errors = {}, []
    for market, lang, query in QUERIES:
        params = {'q': query, 'country': market, 'search_lang': lang, 'freshness': 'pw', 'count': 10}
        url = ENDPOINT + '?' + urlencode(params)
        try:
            raw = fetch(url, url, ('application/json',), {'X-Subscription-Token': token})
            data = json.loads(raw)
            results = data.get('web', {}).get('results', [])
            for row in results[:10]:
                try:
                    result = https_url(row.get('url', ''))
                except ValueError:
                    continue
                if result.hostname in known_hosts or result.query or result.fragment:
                    continue
                links.setdefault(result.geturl(), {'url': result.geturl(), 'market': market, 'status': 'review-source'})
        except (OSError, ValueError, AttributeError, TypeError) as error:
            errors.append(type(error).__name__)
            if isinstance(error, UpstreamHTTPError) and error.status in {401, 403, 429}:
                break
    return {'status': 'partial' if errors else 'ok', 'errors': errors, 'links': list(links.values())}
