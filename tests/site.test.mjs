import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {copy, email, verifyLocales} from '../site/locales.mjs';
import {eligible, matches, ordered, date, money, stale, expired, allowedFilters} from '../site/domain.mjs';

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
  assert.match(read('ja/index.html'), /<span>懸賞さんぽ<\/span>/);
  assert.match(read('en/index.html'), /<span>Freebie Trail<\/span>/);
  assert.match(read('index.html'), /<span>Freebie Trail \/ 懸賞さんぽ<\/span>/);
  assert.throws(() => verifyLocales(copy.ja,{...copy.en,search:''}), /localization/);
  assert.match(read('ja/index.html'), /html lang="ja".*無料で応募/s);
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
      assert.equal((html.match(new RegExp(`class="language"[^>]*href="${counterpart}"`,"g")) || []).length,2);
    }
    for (const [,href] of html.matchAll(/href="(\/[^"]*)"/g)) {
      const path = new URL(href,origin).pathname;
      assert.ok(existsSync('dist' + path + (path.endsWith('/') ? 'index.html' : '')),href);
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
    assert.doesNotMatch(read(`en/opportunities/${live.id}/index.html`), /winning odds: [0-9]+%/i);
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
    assert.ok(dataset.records.every(row => row.id === 'freecash' || row.affiliate_url === null));
    const sample = dataset.records[0];
    sample.affiliate_url = 'https://example.com/approved?key=1&context=2';
    sample.affiliate_approval_status = 'approved';
    sample.affiliate_expires_at = new Date(Date.now() + 86_400_000).toISOString();
    // Fixture for the renderer only. Python rejects links lacking an approval record.
    const fixture = JSON.stringify(dataset);
    execFileSync(process.execPath,['-e','require("node:fs").writeFileSync("var/published.json",process.argv[1])',fixture]);
    execFileSync(process.execPath,['site/build.mjs'], {env:{...process.env,SITE_ORIGIN:origin}});
    const html = read('en/opportunities/' + sample.id + '/index.html');
    assert.match(html,/context=2" target="_blank" rel="sponsored nofollow noopener noreferrer"/);
    assert.match(html,/Affiliate link/);
  } finally {
    build();
  }
});

test('Freecash uses the scoped sponsored route in both languages while current', () => {
  const freecash = rows.find(row => row.id === 'freecash');
  for (const lang of ['ja','en']) {
    const path = `${lang}/opportunities/freecash/index.html`;
    const affiliates = read(`${lang}/affiliates/index.html`);
    assert.match(read(`${lang}/opportunities/index.html`), /data-record="freecash"/);
    assert.equal(existsSync('dist/' + path), Boolean(freecash));
    if (!freecash) continue;
    assert.doesNotMatch(affiliates, /data-record="freecash"/);
    assert.match(read(`${lang}/rewards/index.html`), /class="card sponsored-card task-card" data-record="freecash"/);
    const html = read(path);
    assert.ok(html.includes(copy[lang].affiliateDisclosure));
    assert.ok(html.includes(`href="${freecash.official_url}" target="_blank" rel="noopener noreferrer"`));
    assert.ok(html.includes(`href="${freecash.affiliate_url}" target="_blank" rel="sponsored nofollow noopener noreferrer"`));
    assert.match(html, /itemtype="https:\/\/schema.org\/BreadcrumbList"/);
    assert.equal(freecash.eligible_countries.length,15);
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


test('search indexes verified concepts without inventing eligibility or free entry', () => {
  const live = Date.parse('2026-11-07T00:00:00Z');
  const fixtures = JSON.parse(readFileSync('data/opportunities.json','utf8'));
  for (const [q,id] of [['懸賞','club-sunstar-november-2026'],['お米','ja-wakayama-rice-2026-11'],['米','ja-wakayama-rice-2026-11'],['rice','ja-wakayama-rice-2026-11'],['Freecash','freecash'],['タスク報酬','freecash'],['United States','stanley-review-november-2026'],['sweepstakes','penguin-white-company-calendar-2026']]) {
    assert.ok(matches(fixtures.find(row => row.id === id),{q},'ja',live),q);
  }
  assert.equal(matches(jp,{q:'United States'},'en',live),false);
  assert.equal(matches({...draw,title_en:'Example',title_ja:'例',description_en:'Survey panel',description_ja:'調査',reward_conditions:{ja:'回答',en:'Answer'}},{q:'Japan'},'en',live),false);
  assert.equal(matches(jp,{q:'SNS不要'},'ja',live),false);
  const fc = fixtures.find(row => row.id === 'freecash');
  assert.equal(matches(fc,{q:'米'},'ja',live),false);
  assert.equal(matches({...jp,title_en:'Example',title_ja:'例',description_en:'Low price',description_ja:'価格',reward_conditions:{en:'Terms',ja:'条件'}},{q:'rice'},'en',live),false);
  assert.equal(matches({...jp,description_en:'No purchase; social media entry required',application:{sns_required:true}},{q:'no social media'},'en',live),false);
  assert.equal(matches(fc,{freeEntry:'yes'},'ja',live),false);
  assert.equal(matches(fc,{q:'no social media'},'en',live),false);
  const input = new URLSearchParams('q=rice&country=US&noSns=yes&sort=deadline&unknown=secret&category=invalid');
  assert.deepEqual(allowedFilters(input,{q:[],country:['JP','US'],noSns:['yes'],sort:['','deadline'],category:['sweepstakes']}),
    {q:'rice',country:'US',noSns:'yes',sort:'deadline'});
});

test('primary action precedes secondary information and prizes omit monetary placeholders', () => {
  for (const lang of ['ja','en']) {
    const draw = rows.find(row => row.category === 'sweepstakes');
    if (draw) {
      const html = read(`${lang}/opportunities/${draw.id}/index.html`);
      assert.ok(html.indexOf('entry-action') < html.indexOf('detail-body'));
      assert.ok(!html.includes(copy[lang].varies));
      assert.ok(!html.includes(copy[lang].organizerVerified));
    }
    if (rows.some(row => row.id === 'freecash')) {
      const fc = read(`${lang}/opportunities/freecash/index.html`);
      assert.ok(fc.indexOf('sponsored-button') < fc.indexOf('detail-body'));
      assert.ok(fc.includes('class="country-details"'));
    }
    assert.match(read(`${lang}/index.html`),/form class="home-search".*method="get"/);
    assert.match(read(`${lang}/index.html`),/og:image/);
  }
  assert.ok(existsSync('dist/favicon.ico'));
  assert.ok(existsSync('dist/assets/social.png'));
});

test('permanent canonical redirects and query pages are noindex', async () => {
  const {default:worker} = await import('../site/worker.mjs');
  const env = {SITE_ORIGIN:origin,ASSETS:{fetch:() => new Response('asset')}};
  const http = worker.fetch(new Request('http://freebietrail.com/ja/'),env);
  assert.equal(http.status,301);
  assert.equal(http.headers.get('location'),origin + '/ja/');
  const slash = worker.fetch(new Request(origin + '/ja?q=rice'),env);
  assert.equal(slash.status,308);
  assert.equal(slash.headers.get('location'),origin + '/ja/?q=rice');
  const query = worker.fetch(new Request(origin + '/en/opportunities/?q=rice'),env);
  assert.equal(query.headers.get('x-robots-tag'),'noindex, follow');
});


test('Freecash comparison cards lead with tasks, disclose costs and link through the approved partner', () => {
  const row = rows.find(row => row.id === 'freecash');
  if (!row) return;
  for (const lang of ['ja','en']) for (const path of ['index.html','rewards/index.html','opportunities/index.html']) {
    const html = read(`${lang}/${path}`);
    const card = html.match(/<article class="card sponsored-card task-card"[^>]*>[\s\S]*?<\/article>/)?.[0];
    assert.ok(card,path);
    for (const key of ['freecashCardSummary','freecashCardCost','freecashCardConditions','freecashCardDetails','freecashCardDisclosure','sponsoredLabel']) assert.ok(card.includes(copy[lang][key]),key);
    assert.ok(card.indexOf(copy[lang].freecashCardSummary) < card.indexOf(copy[lang].freecashCardDisclosure));
    assert.equal((card.match(/class="button /g) || []).length,1);
    assert.ok(card.includes(`href="${row.affiliate_url}"`));
    assert.match(card,/rel="sponsored nofollow noopener noreferrer"/);
    assert.doesNotMatch(card,/<dl|15 countries|Ad markets|広告の対象地域/);
    const detail = read(`${lang}/opportunities/freecash/index.html`);
    assert.ok(detail.includes(copy[lang].freecashPayout));
    assert.ok(detail.includes(copy[lang].freecashRestrictions));
  }
});
