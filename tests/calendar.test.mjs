import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {calendarEvent} from '../site/calendar.mjs';

const quests = JSON.parse(readFileSync('data/editorial.json','utf8')).quests;
const timee = quests.find(row => row.id === 'timee-note-work-contest-2026');
const opportunities = JSON.parse(readFileSync('data/opportunities.json','utf8'));
const rice = opportunities.find(row => row.id === 'ja-wakayama-rice-2026-11');
const now = Date.parse('2026-11-25T06:00:00Z');
const make = (row, scope, lang = 'ja', zone = row.deadline_timezone, at = now) =>
  calendarEvent(row,{scope,lang,zone,title:'締切、漢字\\テスト; a,b\n' + '長'.repeat(32),
    now:at,detailUrl:`https://freebietrail.com/${lang}/${scope}/${row.id}/`});
const unfold = body => body.replace(/\r\n /g,'');

test('Timee calendar uses the exact UTC instant for the JST deadline and one bilingual UID', () => {
  const ja = make(timee,'quests','ja','Asia/Tokyo');
  const en = make(timee,'quests','en','Asia/Tokyo');
  assert.match(ja,/DTSTART:20261225T145900Z\r\n/);
  assert.match(ja,/DTSTAMP:20261125T033113Z\r\n/);
  assert.equal(ja.match(/UID:.+/)[0],en.match(/UID:.+/)[0]);
  assert.match(unfold(ja),/URL:https:\/\/freebietrail\.com\/ja\/quests\/timee-note-work-contest-2026\//);
  assert.match(unfold(en),/URL:https:\/\/freebietrail\.com\/en\/quests\/timee-note-work-contest-2026\//);
  assert.match(unfold(ja),/SUMMARY:締切、漢字\\\\テスト\\; a\\,b\\n/);
  assert.ok(ja.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  assert.doesNotMatch(ja,/VALARM|^DTEND:/m);
});

test('Wakayama date-only deadline uses an exclusive next-day end with no invented time', () => {
  const result = make(rice,'opportunities');
  assert.match(result,/DTSTART;VALUE=DATE:20261130\r\nDTEND;VALUE=DATE:20261201\r\n/);
  assert.doesNotMatch(result,/DTSTART:/);
  assert.equal(make(rice,'opportunities','ja',rice.deadline_timezone,Date.parse('2026-11-30T15:00:00Z')),null);
});

test('calendar omits unknown, expired, stale or unzoned deadlines; foreign timed displays include JST', () => {
  assert.equal(make({...rice,deadline:null},'opportunities'),null);
  assert.equal(make({...rice,availability:'ended'},'opportunities'),null);
  assert.equal(make({...rice,last_checked_at:'2026-10-01T00:00:00Z'},'opportunities'),null);
  assert.equal(make({...rice,deadline_timezone:null},'opportunities'),null);
  const london = opportunities.find(row => row.id === 'penguin-white-company-calendar-2026');
  const event = make(london,'opportunities','en');
  assert.match(event,/DTSTART:20261128T235900Z/);
  assert.match(unfold(event),/Europe\/London.*08:59.*\(JST\)/);
});
