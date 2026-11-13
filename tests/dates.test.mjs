import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {date, expiration, expired, freshness, listingState, matches, timestamp} from '../site/domain.mjs';
import {copy} from '../site/locales.mjs';

const now = timestamp('2026-11-08T12:00:00Z');
const DAY = 86400000;
test('freshness at 29d23:59:59, exactly 30d, future and invalid dates', () => {
  for (const [age,state,days] of [[0,'fresh',0],[29*DAY,'fresh',29],[30*DAY-1,'fresh',29],[30*DAY,'stale',30],[31*DAY,'stale',31],[-1,'future',null]]) {
    assert.deepEqual(freshness({last_checked_at:new Date(now-age).toISOString()}, now), {state,days});
  }
  for (const value of [null,'','invalid','2026-11-05','2026-11-05T00:00:00','2026-02-30T00:00:00Z']) {
    assert.deepEqual(freshness({last_checked_at:value}, now), {state:'unknown',days:null});
  }
});

test('recent checks override inconsistent legacy stale_at and publication timestamps', () => {
  const row = {last_checked_at:'2026-11-07T00:00:00Z',stale_at:'2020-01-01T00:00:00Z',generated_at:'2020-01-01T00:00:00Z'};
  assert.equal(freshness(row, now).state,'fresh');
});

test('explicit ISO zones agree while timezone-free and rollover dates are rejected', () => {
  assert.equal(timestamp('2026-11-08T21:00:00+09:00'),now);
  assert.equal(timestamp('2026-11-08T07:00:00-05:00'),now);
  for (const value of ['2026-02-29T00:00:00Z','2026-11-31T00:00:00Z','2026-11-08T24:00:00Z','2026-11-08T00:00:00+24:00','2026-11-08T12:00:00']) assert.ok(Number.isNaN(timestamp(value)),value);
  assert.ok(Number.isFinite(timestamp('2028-02-29T00:00:00Z')));
});

test('deadline before, at and after exact cutoff is shared by both languages', () => {
  const row={deadline:'2026-11-30T14:59:00Z'};
  const end=expiration(row);
  for (const lang of ['ja','en']) {
    assert.equal(expired(row, now),false);
    assert.equal(expired(row, end-1),false);
    assert.equal(expired(row, end),true);
    assert.equal(expired(row, end+1),true);
    assert.equal(matches({...row,required_expense:{kind:'free'}},{},lang,end),false);
  }
});

test('date-only deadline remains open throughout the final local day', () => {
  const row={deadline:'2026-11-30T14:59:59Z',deadline_date_only:true,deadline_timezone:'Asia/Tokyo'};
  assert.equal(expiration(row),timestamp('2026-11-30T15:00:00Z'));
  assert.equal(expired(row,timestamp('2026-11-30T14:59:59.999Z')),false);
  assert.equal(expired(row,timestamp('2026-11-30T15:00:00Z')),true);
  assert.match(date(row.deadline,'ja',false,row.deadline_timezone),/30日/);
  assert.match(date(row.deadline,'en',false,row.deadline_timezone),/30 Nov/);
});

test('unknown and continuous services never expire because verification is old', () => {
  for(const deadline of [null,undefined,'','bad','2026-11-30','2026-11-30T00:00:00']) {
    const row={deadline,last_checked_at:'2020-01-01T00:00:00Z'};
    assert.equal(expired(row,now),false);
    assert.equal(listingState(row,now),'unknown');
    assert.equal(listingState({...row,availability:'ongoing'},now),'ongoing');
  }
  assert.equal(listingState({deadline:null,availability:'ended'},now),'ended');
});

test('category vocabularies and bilingual labels agree without fallback reassignment', () => {
  const taxonomy=JSON.parse(readFileSync('data/taxonomy.json'));
  for(const lang of ['ja','en']) {
    assert.deepEqual(Object.keys(copy[lang].categories).sort(),taxonomy.categories.toSorted());
    assert.deepEqual(Object.keys(copy[lang].prizes).sort(),taxonomy.prizes.toSorted());
    const names = new Intl.DisplayNames(lang,{type:'region',fallback:'none'});
    assert.ok(taxonomy.countries.every(code=>names.of(code)),lang);
  }
});
