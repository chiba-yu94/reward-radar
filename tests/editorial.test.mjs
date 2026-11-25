import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {publicEditorial} from '../site/editorial.mjs';
import {updateDates} from '../site/status.mjs';

const checked = '2026-11-08T12:00:00Z';
const deadline = '2026-11-08T14:59:59Z';
const cutoff = Date.parse('2026-11-08T15:00:00Z');
const source = 'https://example.invalid/rules';
const quest = {
  id:'sample', status:'approved', type:'design', deadline, deadline_date_only:true,
  last_checked_at:checked, official_url:source,
  review:{accepting:true,japan_eligible:true,no_upfront_cost:true,payment_verified:true,evidence_url:source},
  reward:{kind:'prize',amount:10000,currency:'JPY'},
  copy:{ja:{title:'検証用の作品募集',description:'作品募集のテストデータ。',task:'作品を提出',eligibility:'国内在住者',
    expenses:'応募時の費用なし',reward_terms:'審査で選ばれた1名',payment:'銀行振込',organizer:'検証用の主催者'}},
};

test('quest gates require reviewed evidence, a supported reward, and a fresh open window', () => {
  const select = (row, at = cutoff - 1) => publicEditorial({quests:[row],guides:[]},at).quests;
  assert.deepEqual(select(quest).map(row => row.id),['sample']);
  assert.deepEqual(select(quest,cutoff),[]);
  assert.deepEqual(select({...quest,deadline:'2026-12-31T14:59:59Z'},Date.parse(checked) + 30 * 86_400_000),[]);
  assert.deepEqual(select(quest,Date.parse(checked) - 1),[]);
  assert.deepEqual(select({...quest,status:'candidate',review:null}),[]);
  assert.deepEqual(select({...quest,status:'closed'}),[]);
  for (const key of ['accepting','japan_eligible','no_upfront_cost','payment_verified']) {
    assert.throws(() => select({...quest,review:{...quest.review,[key]:false}}),/Invalid editorial data/);
  }
  for (const value of [null, undefined, 'unknown']) {
    assert.throws(() => select({...quest,review:{...quest.review,japan_eligible:value}}),/Invalid editorial data/);
  }
  assert.equal(select({...quest,review:{...quest.review,japan_eligible:'not-stated'}})[0].id,'sample');
  assert.throws(() => select({...quest,deadline:null}),/open period/);
  assert.throws(() => select({...quest,official_url:'javascript:alert(1)'}),/source/);
  assert.throws(() => select({...quest,type:'user-test'}),/task or reward/);
  for (const [type, kind] of [['user-test','completion'],['writing','selection']]) {
    assert.equal(select({...quest,type,reward:{...quest.reward,kind}})[0].reward.kind,kind);
  }
});

test('cached quest pages hide official actions at the cutoff', () => {
  const notice = {hidden:true};
  const quest = {dataset:{expiring:new Date(cutoff).toISOString(),expireWhenStale:checked},
    hasAttribute:key => ['data-expire-when-stale','data-quest-listing'].includes(key),
    nextElementSibling:notice};
  const root = {querySelectorAll:selector => selector === '[data-record], [data-expiring]' ? [quest] : [],querySelector:() => null};
  updateDates(root,cutoff - 1,'en');
  assert.deepEqual([quest.hidden,notice.hidden],[false,true]);
  updateDates(root,cutoff,'en');
  assert.deepEqual([quest.hidden,notice.hidden],[true,false]);
});

test('build emits approved translated pages only and removes closed listings on rebuild', () => {
  const folder = mkdtempSync(join(tmpdir(),'reward-radar-editorial-'));
  const canon = 'https://freebietrail.com';
  const read = path => readFileSync(join(folder,'dist',path),'utf8');
  const exists = path => existsSync(join(folder,'dist',path));
  const build = at => execFileSync(process.execPath,[resolve('site/build.mjs')],{cwd:folder,
    env:{...process.env,SITE_ORIGIN:canon,QA_NOW:new Date(at).toISOString()}});
  try {
    mkdirSync(join(folder,'data'));
    mkdirSync(join(folder,'var'));
    symlinkSync(resolve('site'),join(folder,'site'));
    copyFileSync('data/taxonomy.json',join(folder,'data/taxonomy.json'));
    execFileSync('python3',['-c',`
from pathlib import Path
from sys import argv
from radar.pipeline import inputs, publish, stamp
rows, sources = inputs(Path('tests/fixtures/reviewed'))
folder = Path(argv[1]) / 'var'
publish(rows, sources, {}, folder / 'published.json', folder / 'operations.sqlite', stamp('2026-11-08T12:00:00Z'))
`,folder]);
    const content = JSON.parse(readFileSync('data/editorial.json','utf8'));
    content.quests.push(quest);
    content.guides.push({id:'private-draft',status:'draft'});
    writeFileSync(join(folder,'data/editorial.json'),JSON.stringify(content));
    build(cutoff - 1);
    const questPath = 'ja/quests/sample/index.html';
    assert.match(read(questPath),/入賞者のみ賞金.*JPY.*銀行振込/s);
    assert.ok(read(questPath).includes('href="/ja/guides/"'));
    assert.ok(read('ja/quests/index.html').includes('href="/ja/quests/sample/"'));
    assert.doesNotMatch(read(questPath),/rel="alternate"|hreflang="en"/);
    assert.match(read(questPath),/class="language"[^>]*href="\/en\/"/);
    assert.equal(exists('en/quests/sample/index.html'),false);
    assert.match(read('en/quests/index.html'),/noindex, follow/);
    const guide = 'guides/before-entering-a-creative-contest/';
    for (const lang of ['ja','en']) {
      assert.ok(read(lang + '/' + guide + 'index.html').includes('href="/' + lang + '/quests/"'));
      assert.ok(read(lang + '/guides/index.html').includes('href="/' + lang + '/' + guide + '"'));
    }
    assert.ok(read('ja/' + guide + 'index.html').includes('hreflang="en" href="' + canon + '/en/' + guide + '"'));
    assert.match(read('sitemap.xml'),/<loc>https:\/\/freebietrail\.com\/ja\/quests\/sample\/<\/loc><\/url>/);
    assert.doesNotMatch(read('sitemap.xml'),/\/en\/quests\/|korezo-yamanashi-2026|private-draft/);
    assert.equal(exists('ja/guides/private-draft/index.html'),false);
    assert.doesNotMatch(read('ja/quests/index.html'),/korezo-yamanashi-2026|freecash\.pxf\.io/);
    build(cutoff);
    assert.equal(exists(questPath),false);
    assert.match(read('ja/quests/index.html'),/noindex, follow/);
    assert.doesNotMatch(read('ja/quests/index.html'),/quests\/sample/);
    assert.doesNotMatch(read('sitemap.xml'),/\/quests\//);

    const newQuest = content.quests.find(entry => entry.id === 'hacktale-award-2027');
    const path = 'quests/hacktale-award-2027/';
    const liveAt = Date.parse('2026-11-23T09:00:00Z');
    build(liveAt);
    assert.match(read('ja/' + path + 'index.html'),/現物の搬入・郵送は不要.*入賞者のみ賞金.*ライセンス契約を締結.*指定した口座へ振込/s);
    assert.match(read('en/' + path + 'index.html'),/no physical delivery or mailing.*Prize for winners only.*sign a production license agreement.*Bank transfer/s);
    for (const [lang, alternate] of [['ja','en'],['en','ja']]) {
      const localized = lang + '/' + path;
      const html = read(localized + 'index.html');
      assert.ok(html.includes('href="' + newQuest.official_url + '"'));
      assert.ok(html.includes('rel="canonical" href="' + canon + '/' + localized + '"'));
      assert.ok(html.includes('hreflang="' + alternate + '" href="' + canon + '/' + alternate + '/' + path + '"'));
      assert.ok(read(lang + '/quests/index.html').includes('href="/' + localized + '"'));
      assert.ok(read('sitemap.xml').includes('<loc>' + canon + '/' + localized + '</loc>'));
      assert.ok(exists(lang + '/quests/life-design-art-2026/index.html'));
      assert.ok(exists(lang + '/' + guide + 'index.html'));
    }

    const timee = content.quests.find(entry => entry.id === 'timee-note-work-contest-2026');
    const timeePath = 'quests/' + timee.id + '/';
    assert.equal(exists('ja/' + timeePath + 'index.html'),false);
    build(Date.parse('2026-11-25T04:00:00Z'));
    for (const [lang, alternate, notice] of [
      ['ja','en','居住条件は未確認'],
      ['en','ja','Residency eligibility unconfirmed'],
    ]) {
      const base = lang + '/';
      const board = read(base + 'quests/index.html');
      const detail = read(base + timeePath + 'index.html');
      assert.ok(read(base + 'index.html').includes('href="/' + base + 'quests/"'));
      assert.ok(board.includes('href="/' + base + timeePath + '"'));
      assert.equal(board.split(notice).length,2);
      assert.ok(detail.includes(notice));
      assert.ok(detail.includes('href="https://note.com/info/n/n3cd095e43966"'));
      assert.ok(detail.includes('hreflang="' + alternate + '" href="' + canon + '/' + alternate + '/' + timeePath + '"'));
      assert.ok(detail.includes('datetime="2026-12-25T14:59:00Z"'));
      assert.match(detail,/23:59 (JST|GMT\+9)/);
      assert.ok(detail.includes('#あの日の仕事をきっかけに'));
      assert.match(detail,/Amazon\.co\.jp/);
      assert.ok(read('sitemap.xml').includes('<loc>' + canon + '/' + base + timeePath + '</loc>'));
      assert.ok(!read(base + 'sweepstakes/index.html').includes(timee.id));
    }
    // A review close to the deadline keeps the test focused on expiration.
    timee.last_checked_at = '2026-12-24T12:00:00Z';
    writeFileSync(join(folder,'data/editorial.json'),JSON.stringify(content));
    const timeeCutoff = Date.parse('2026-12-25T14:59:00Z');
    build(timeeCutoff - 1);
    assert.ok(exists('ja/' + timeePath + 'index.html'));
    assert.ok(exists('en/' + timeePath + 'index.html'));
    build(timeeCutoff);
    for (const lang of ['ja','en']) {
      assert.equal(exists(lang + '/' + timeePath + 'index.html'),false);
      assert.ok(!read(lang + '/quests/index.html').includes(timeePath));
    }
    assert.ok(!read('sitemap.xml').includes(timeePath));

    const timedCutoff = Date.parse('2027-02-28T14:59:00Z');
    // Recheck in the fixture so the deadline, independent of review freshness, controls removal.
    newQuest.last_checked_at = '2027-02-27T00:00:00Z';
    writeFileSync(join(folder,'data/editorial.json'),JSON.stringify(content));
    build(timedCutoff - 1);
    assert.ok(exists('ja/' + path + 'index.html'));
    assert.ok(exists('en/' + path + 'index.html'));
    build(timedCutoff);
    for (const lang of ['ja','en']) {
      assert.equal(exists(lang + '/' + path + 'index.html'),false);
      assert.ok(!read(lang + '/quests/index.html').includes(path));
    }
    assert.ok(!read('sitemap.xml').includes(path));
  } finally {
    rmSync(folder,{recursive:true,force:true});
  }
});
