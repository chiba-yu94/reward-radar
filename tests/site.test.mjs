import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {copy, email, verifyLocales} from '../site/locales.mjs';
import {eligible, matches, ordered, date, money, stale, expired} from '../site/domain.mjs';

const origin = 'https://freebietrail.com';
const build = () => {
  execFileSync('python3',['-m','radar.pipeline','publish']);
  execFileSync(process.execPath,['site/build.mjs'], {env:{...process.env,SITE_ORIGIN:origin}});
};
build();
const read = path => readFileSync('dist/' + path,'utf8');
const rows = JSON.parse(read('opportunities.json')).records;
const jp = rows.find(row => row.id === 'macromill');
const draw = {...jp, eligible_countries:null, eligibility_verified:false, deadline:null};
const now = Date.parse('2026-11-06T00:00:00Z');

test('locale structure, missing translation and actual HTML', () => {
  verifyLocales();
  assert.throws(() => verifyLocales(copy.ja,{...copy.en,search:''}), /localization/);
  assert.match(read('ja/index.html'), /html lang="ja".*買わずに応募/s);
  assert.match(read('en/index.html'), /html lang="en".*Find free giveaways/s);
  assert.match(read('ja/opportunities/index.html'), /検索・絞り込み/);
  assert.match(read('en/opportunities/index.html'), /Search and filters/);
  for (const lang of ['ja','en']) {
    for (const page of ['contact','privacy','disclosure']) {
      assert.ok(read(`${lang}/${page}/index.html`).includes('mailto:' + email));
    }
  }
});

test('canonical, hreflang, language switching and internal links', () => {
  const files = readdirSync('dist',{recursive:true}).filter(file => file.endsWith('index.html'));
  for (const file of files) {
    const html = read(file);
    const path = '/' + file.replace('index.html','');
    assert.ok(html.includes(`rel="canonical" href="${origin}${path}"`));
    if (/^(ja|en)\//.test(file)) {
      const alternate = file.startsWith('ja') ? 'en' : 'ja';
      const counterpart = '/' + alternate + path.slice(3);
      assert.ok(html.includes(`hreflang="${alternate}" href="${origin}${counterpart}"`));
      assert.equal(html.split(`class="language" href="${counterpart}"`).length,3);
    }
    for (const [,href] of html.matchAll(/href="(\/[^"]*)"/g)) {
      assert.ok(existsSync('dist' + href + (href.endsWith('/') ? 'index.html' : '')), href);
    }
  }
  assert.match(read('sitemap.xml'), /xhtml:link rel="alternate" hreflang="ja"/);
  assert.ok(!read('sitemap.xml').includes('rakuten-app-draw'));
});

test('country filtering keeps unknown out and explicitly accepts Japan', () => {
  assert.equal(eligible(jp,'JP'),true);
  assert.equal(eligible(jp,'US'),false);
  assert.equal(eligible(draw,'JP'),false);
  assert.equal(matches(draw,{country:'unknown'},'en',now),true);
  assert.equal(matches(draw,{explicitJapan:'yes'},'en',now),false);
  assert.equal(matches({...jp,eligible_countries:'worldwide'},{explicitJapan:'yes'},'en',now),false);
  assert.equal(matches(jp,{q:'ＭＡＣＲＯＭＩＬＬ',country:'JP',language:'ja',expense:'free'},'en',now),true);
  assert.equal(matches(jp,{effort:5},'en',now),false);
  const study = rows.find(row => row.id === 'prolific');
  assert.equal(matches(study,{reward_currency:'GBP'},'en',now),true);
  assert.equal(matches(study,{reward_currency:'unknown'},'en',now),false);
});

test('currency, null and timezone behavior', () => {
  assert.match(money(1000,'JPY','ja','unknown'), /1,000/);
  assert.match(money(7.5,'USD','en','unknown'), /USD.*7\.50/);
  assert.equal(money(null,'JPY','ja','unknown'),'unknown');
  assert.match(date('2026-11-05T18:00:00Z','ja',true), /6日.*03:00.*JST/);
  assert.match(date('2026-11-05T18:00:00Z','en',true), /5 Nov.*18:00.*UTC/);
});

test('expiration, stale ranking, and unknown winning odds', () => {
  assert.equal(expired({...draw,deadline:'2026-11-05T18:00:00Z'},now),true);
  assert.equal(stale({...jp,stale_at:'2026-11-05T18:00:00Z'},now),true);
  const old = {...jp,id:'older',stale_at:'2026-11-05T18:00:00Z'};
  assert.equal(ordered([old,jp],now)[0].id,jp.id);
  for (const live of rows.filter(row => row.category === 'sweepstakes')) {
    assert.match(read(`en/opportunities/${live.id}/index.html`), /no verified winning odds/);
    assert.ok(!Object.hasOwn(live,'winning_probability'));
  }
});

test('consumer filters do not turn unverified requirements into promises', () => {
  const candidate = {...jp, prize_category:'food', organizer_verified:true,
    entry:{registration:'none',application:['email']}};
  assert.equal(matches(candidate,{emailOnly:'yes',organizer:'yes',prize_category:'food'},'en',now),true);
  assert.equal(matches({...candidate,entry:{registration:'none',application:null}},{emailOnly:'yes'},'en',now),false);
  assert.equal(matches({...candidate,entry:{registration:'social',application:['social-account']}},{registration:'none'},'en',now),false);
  assert.equal(matches({...candidate,organizer_verified:false},{organizer:'yes'},'en',now),false);
  assert.ok(rows.every(row => row.category === 'affiliate' || row.required_expense.kind === 'free'));
  assert.ok(!rows.some(row => row.id === 'github-student'));
});

test('application filters require verified facts and prioritize low effort', () => {
  const basic = {...jp, category:'sweepstakes'};
  const web = {...basic,id:'web',application:{web_only:true,sns_required:false,step_count:3,difficulty:'easy'}};
  const social = {...basic,id:'social',application:{sns_required:true,step_count:2,difficulty:'easy'}};
  const hard = {...basic,id:'hard',reward_amount:100000,application:{sns_required:true,step_count:2,difficulty:'hard'}};
  assert.equal(matches(web,{noSns:'yes',webOnly:'yes',easyApply:'yes'},'en',now),true);
  assert.equal(matches(basic,{noSns:'yes'},'en',now),false);
  assert.equal(matches(social,{webOnly:'yes'},'en',now),false);
  assert.deepEqual(ordered([hard,social,web],now).map(row => row.id),['web','social','hard']);
  assert.doesNotMatch(read('ja/index.html'), /hapitas\.jp\/register/);
});

test('sponsored link attributes only after validated approval', () => {
  const original = readFileSync('var/published.json','utf8');
  try {
    const dataset = JSON.parse(original);
    assert.ok(dataset.records.every(row => row.affiliate_url === null));
    const sample = dataset.records[0];
    sample.affiliate_url = 'https://example.com/approved?key=1&context=2';
    // Fixture for the renderer only. Python rejects links lacking an approval record.
    const fixture = JSON.stringify(dataset);
    execFileSync(process.execPath,['-e','require("node:fs").writeFileSync("var/published.json",process.argv[1])',fixture]);
    execFileSync(process.execPath,['site/build.mjs'], {env:{...process.env,SITE_ORIGIN:origin}});
    const html = read('en/opportunities/' + sample.id + '/index.html');
    assert.match(html,/context=2" rel="sponsored nofollow noopener noreferrer"/);
    assert.match(html,/Affiliate link/);
  } finally {
    build();
  }
});

test('asset configuration, security headers and no secrets in assets', () => {
  const config = JSON.parse(readFileSync('wrangler.jsonc','utf8'));
  assert.equal(config.assets.directory,'./dist');
  assert.equal(config.assets.not_found_handling,'404-page');
  assert.equal(config.main,'./site/worker.mjs');
  assert.equal(config.assets.run_worker_first,true);
  assert.equal(config.preview_urls,false);
  assert.match(read('_headers'), /script-src 'self'/);
  assert.match(read('_headers'), /frame-ancestors 'none'/);
  for (const file of readdirSync('dist',{recursive:true,withFileTypes:true}).filter(item => item.isFile())) {
    const data = readFileSync(file.parentPath + '/' + file.name,'utf8');
    assert.doesNotMatch(data, /-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[0-9a-z]{25,}|sb_secret_[\w-]{12,}|ca-pub-\d{8,}|adsbygoogle/i);
    assert.doesNotMatch(data, /\bhref\s*=\s*"\s*(?:javascript|data):/i);
  }
});

test('host migration preserves paths and queries and waits for cutover', async () => {
  const {default: worker} = await import('../site/worker.mjs');
  const legacy = 'https://reward-radar.rewardradar42.workers.dev';
  const path = '/ja/opportunities/prolific/?ref=example';
  const assets = {fetch: () => new Response('asset')};
  for (const alias of [legacy, 'https://www.freebietrail.com']) {
    const request = new Request(alias + path);
    assert.equal(await worker.fetch(request, {ASSETS:assets, SITE_ORIGIN:legacy}).text(), 'asset');
    const redirect = worker.fetch(request, {ASSETS:assets, SITE_ORIGIN:origin});
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), origin + path);
    assert.equal(new URL(worker.fetch(new Request(alias + '//example.org/'), {
      ASSETS:assets, SITE_ORIGIN:origin,
    }).headers.get('location')).origin, origin);
  }
  assert.equal(await worker.fetch(new Request(origin + path), {ASSETS:assets, SITE_ORIGIN:origin}).text(), 'asset');
});
