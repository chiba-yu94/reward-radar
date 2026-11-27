import assert from 'node:assert/strict';
import test from 'node:test';
import {feedPath, publicationDates, renderFeed} from '../site/feed.mjs';

const origin = 'https://freebietrail.com';
const first = '2026-11-23T08:37:52Z';
const now = Date.parse('2026-11-25T06:00:00Z');
const evidence_url = 'https://github.com/example/site/actions/runs/1';
const datesFor = (listing, first_published_at = first, languages = ['ja','en']) =>
  ({listing,first_published_at,languages,evidence_url});
const dateOnly = '2026-11-30T14:59:59Z';
const regular = {
  id:'rice',category:'sweepstakes',affiliate_url:null,affiliate_approval_status:'none',
  title_ja:'お米 & 応募',title_en:'Rice & entry',
  eligibility_ja:'日本在住者',eligibility_en:'Japan residents',
  entry:{steps:{ja:'フォームを送信',en:'Submit the form'}},
  deadline:dateOnly,deadline_date_only:true,deadline_timezone:'Asia/Tokyo',
  first_seen_at:'2026-11-01T00:00:00Z',last_checked_at:'2026-11-24T00:00:00Z',
};
const creative = {
  id:'contest',deadline:'2026-12-25T14:59:00Z',locales:['en'],
  copy:{en:{title:'Work contest',eligibility:'An account is required',task:'Publish a post'}},
};
const opts = {
  lang:'en',now,origin,rows:[regular],quests:[creative],
  copy:{title:'New & recent',description:'New listings'},deadlineLabel:'Deadline',
};
const render = (registry, patch) => renderFeed({...opts,dates:publicationDates(registry),...patch});

test('RSS orders confirmed first publications and keeps canonical same-language detail URLs', () => {
  const feed = render([datesFor('opportunities/rice'),datesFor('quests/contest','2026-11-25T03:35:54Z',['en'])]);
  assert.equal(feedPath('en'),'/en/feed.xml');
  assert.ok(feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.match(feed,/<rss version="2.0"/);
  assert.match(feed,/<title>New &amp; recent<\/title>/);
  assert.match(feed,/<atom:link href="https:\/\/freebietrail\.com\/en\/feed\.xml" rel="self" type="application\/rss\+xml"\/>/);
  assert.match(feed,/<title>Rice &amp; entry<\/title>/);
  assert.match(feed,/<link>https:\/\/freebietrail\.com\/en\/opportunities\/rice\/<\/link>/);
  assert.match(feed,/<guid isPermaLink="false">urn:freebietrail:en:opportunities\/rice<\/guid>/);
  assert.match(feed,/<pubDate>Mon, 23 Nov 2026 08:37:52 GMT<\/pubDate>/);
  assert.match(feed,/Japan residents Submit the form Deadline · 30 Nov 2026<\/description>/);
  assert.match(feed,/Deadline · 25 Dec 2026, 23:59 GMT\+9/);
  assert.match(feed,/<link>https:\/\/freebietrail\.com\/en\/opportunities\/contest\/<\/link>/);
  assert.match(feed,/<guid isPermaLink="false">urn:freebietrail:en:quests\/contest<\/guid>/);
  assert.ok(feed.indexOf('Work contest') < feed.indexOf('Rice &amp; entry'));
});

test('RSS excludes missing, future, old, sponsored and unavailable locale items', () => {
  const rows = [regular,
    {...regular,id:'future'},
    {...regular,id:'old'},
    {...regular,id:'ad',category:'affiliate'},
    {...regular,id:'linked-ad',affiliate_approval_status:'approved',affiliate_url:'https://affiliate.example.com/'},
  ];
  const results = [
    datesFor('opportunities/future','2026-11-26T00:00:00Z'),
    datesFor('opportunities/old','2026-10-10T00:00:00Z'),
    datesFor('opportunities/ad'),datesFor('opportunities/linked-ad'),
    datesFor('quests/contest',first,['en']),
  ];
  assert.doesNotMatch(render(results,{lang:'ja',rows}),/<item>|affiliate\.example\.com/);
  assert.match(render(results,{lang:'en',rows}),/<title>Work contest<\/title>/);
});

test('copy and review changes preserve GUID and pubDate without adding another item', () => {
  const dates = [datesFor('opportunities/rice')];
  const before = render(dates);
  const after = render(dates,{rows:[{...regular,title_en:'New title',
    eligibility_en:'Japan residents; registration required <script>\u0000',
    first_seen_at:'2026-11-25T00:00:00Z',last_checked_at:'2026-11-25T00:00:00Z'}]});
  assert.equal((after.match(/<item>/g) || []).length,1);
  assert.deepEqual(after.match(/<guid[^>]*>[^<]+|<pubDate>[^<]+/g),before.match(/<guid[^>]*>[^<]+|<pubDate>[^<]+/g));
  assert.match(after,/registration required &amp;lt;script&amp;gt;/);
  assert.doesNotMatch(after,/<script>|\u0000/);
});

test('registry rejects duplicate language dates and accepts a separately published translation', () => {
  const key = 'opportunities/rice';
  assert.throws(() => publicationDates([datesFor(key),datesFor(key,first,['en'])]),/Duplicate RSS publication/);
  assert.throws(() => publicationDates([datesFor(key,'2026-11-23')]),/Invalid RSS publication/);
  assert.throws(() => publicationDates([{...datesFor(key),evidence_url:'http://example.com/'}]),/Invalid RSS publication/);
  const dates = publicationDates([datesFor(key,first,['ja']),datesFor(key,'2026-11-24T15:00:00Z',['en'])]);
  assert.notEqual(dates.get('ja/' + key),dates.get('en/' + key));
});
