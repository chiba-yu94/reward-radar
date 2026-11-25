import {date, timestamp} from './domain.mjs';
import {languages} from './locales.mjs';

export const feedType = 'application/rss+xml';
export const feedPath = lang => `/${lang}/feed.xml`;
const maxAge = 30 * 86_400_000;
const maxItems = 20;
const entities = {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'};
const escape = text => text.replace(/[&<>"']/g, char => entities[char]);
const xml = text => escape(text.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu,''));

export function publicationDates(registry) {
  if (!Array.isArray(registry)) throw new Error('Invalid RSS publication registry');
  const dates = new Map();
  for (const entry of registry) {
    const published = timestamp(entry.first_published_at);
    const evidence = new URL(entry.evidence_url);
    if (!/^(opportunities|quests)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.listing) ||
        !Number.isFinite(published) || evidence.protocol !== 'https:' || evidence.username || evidence.password ||
        !Array.isArray(entry.languages) || !entry.languages.length || !entry.languages.every(lang => languages.includes(lang))) {
      throw new Error('Invalid RSS publication evidence');
    }
    for (const lang of entry.languages) {
      const key = `${lang}/${entry.listing}`;
      if (dates.has(key)) throw new Error('Duplicate RSS publication: ' + key);
      dates.set(key,published);
    }
  }
  return dates;
}

function summary(value, limit) {
  const text = value?.replace(/\s+/g,' ').trim();
  if (!text) return '';
  const chars = Array.from(text);
  return chars.length > limit ? chars.slice(0,limit).join('').trimEnd() + '…' : text;
}

export function renderFeed({lang, origin, now, rows, quests, dates, copy, deadlineLabel}) {
  const entries = [
    ...rows.filter(row => row.category !== 'affiliate' && row.affiliate_approval_status === 'none' && !row.affiliate_url)
      .map(row => ({
        key:'opportunities/' + row.id,row,title:row['title_' + lang],
        eligibility:row['eligibility_' + lang],steps:row.entry?.steps?.[lang],zone:row.deadline_timezone || 'UTC',
      })),
    ...quests.filter(entry => entry.locales.includes(lang)).map(row => ({
      key:'quests/' + row.id,row,title:row.copy[lang].title,
      eligibility:row.copy[lang].eligibility,steps:row.copy[lang].task,zone:row.deadline_timezone || 'Asia/Tokyo',
    })),
  ];
  const items = entries.map(entry => ({...entry,published:dates.get(lang + '/' + entry.key)}))
    .filter(({published}) => Number.isFinite(published) && published <= now && published >= now - maxAge)
    .sort((a,b) => b.published - a.published || a.key.localeCompare(b.key))
    .slice(0,maxItems).map(({key,row,title,eligibility,steps,zone,published}) => {
      const link = `${origin}/${lang}/${key}/`;
      const description = [summary(eligibility,145),summary(steps,135)];
      if (row.deadline) {
        description.push(deadlineLabel + ' · ' + date(row.deadline,lang,!row.deadline_date_only,zone));
      }
      // RSS readers may interpret the description as HTML after decoding XML.
      return `<item><title>${xml(title)}</title><link>${xml(link)}</link>
<guid isPermaLink="false">${xml('urn:freebietrail:' + lang + ':' + key)}</guid>
<pubDate>${new Date(published).toUTCString()}</pubDate>
<description>${xml(escape(description.filter(Boolean).join(' ')))}</description></item>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${xml(copy.title)}</title><link>${xml(`${origin}/${lang}/`)}</link>
<description>${xml(copy.description)}</description><language>${lang}</language>
<atom:link href="${xml(origin + feedPath(lang))}" rel="self" type="${feedType}"/>
${items.join('\n')}
</channel></rss>
`;
}
