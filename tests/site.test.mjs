import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {copy, email, verifyLocales} from '../site/locales.mjs';
import {eligible, matches, ordered, date, money, stale, expired, allowedFilters, verifiedJapanGiveaway} from '../site/domain.mjs';

const origin = 'https://freebietrail.com';
const build = () => execFileSync(process.execPath,['tests/build-fixture.mjs']);
build();
const read = path => readFileSync('dist/' + path,'utf8');
const rows = JSON.parse(read('opportunities.json')).records;
const jp = rows.find(row => row.id === 'macromill');
const draw = {...jp, eligible_countries:null, eligibility_verified:false, deadline:null};
const now = Date.parse('2026-11-06T00:00:00Z');

test('root and localized pages share the pixel mark and home screen icon', () => {
  for (const path of ['index.html','ja/index.html','en/index.html','ja/sweepstakes/index.html','en/sweepstakes/index.html']) {
    const page = read(path);
    assert.match(page, /<link rel="icon" href="\/favicon-5cf2e8207d44\.ico">/);
    assert.match(page, /<link rel="icon" type="image\/svg\+xml" href="\/assets\/mark-5cf2e8207d44\.svg">/);
    assert.match(page, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon-5cf2e8207d44\.png">/);
    assert.equal((page.match(/<img src="\/assets\/mark-5cf2e8207d44\.svg" alt="" width="32" height="32">/g) || []).length, path === 'index.html' ? 1 : 2);
  }
  for (const path of ['favicon.ico','assets/mark.svg','apple-touch-icon.png']) {
    const versioned = path.replace(/\.([^.]+)$/,'-5cf2e8207d44.$1');
    assert.deepEqual(readFileSync('dist/' + versioned), readFileSync('dist/' + path));
  }
  const svg = read('assets/mark.svg');
  assert.match(svg, /viewBox="0 0 48 48" shape-rendering="crispEdges"/);
  const touch = readFileSync('dist/apple-touch-icon.png');
  assert.equal(touch.readUInt32BE(0),0x89504e47);
  assert.equal(touch.readUInt32BE(16),180);
  assert.equal(touch.readUInt32BE(20),180);
  const ico = readFileSync('dist/favicon.ico');
  assert.equal(ico.readUInt16LE(2),1);
  assert.equal(ico.readUInt16LE(4),3);
  assert.deepEqual([ico[6],ico[22],ico[38]].sort((a,b)=>a-b),[16,32,48]);
});

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

test('only quest board footers offer a localized organizer email draft', () => {
  const expected = {
    ja:{
      link:'主催者の方へ：掲載を相談する',
      note:'掲載可否の確認は無料です。掲載を保証するものではありません。',
      subject:'公募・モニター募集の掲載相談',
      fields:['企画名','公式URL','応募条件','応募対象の国・地域','居住条件','締切日時とタイムゾーン','賞品','賞品の受け渡し方法'],
    },
    en:{
      link:'Organizers: Ask about a listing',
      note:'We review submissions for free. Listing is not guaranteed.',
      subject:'Quest board listing inquiry',
      fields:['Campaign name','Official URL','Entry requirements','Eligible countries or regions','Residency requirements','Deadline date, time and time zone','Prizes','How you deliver the prizes'],
    },
  };
  const files = readdirSync('dist',{recursive:true}).filter(file => file.endsWith('.html'));
  const withDraft = files.filter(file => read(file).includes('mailto:' + email + '?'));
  assert.deepEqual(withDraft.sort(),['en/quests/index.html','ja/quests/index.html']);
  for (const [lang, text] of Object.entries(expected)) {
    const html = read(lang + '/quests/index.html');
    const footer = html.match(/<footer>[\s\S]*?<\/footer>/)[0];
    const drafts = [...footer.matchAll(/<a href="(mailto:[^"]+\?[^"]+)">([^<]+)<\/a>/g)];
    assert.equal(drafts.length,1);
    const [, href, label] = drafts[0];
    const draft = new URL(href.replaceAll('&amp;','&'));
    assert.equal(label,text.link);
    assert.ok(footer.includes(text.note));
    assert.equal(draft.protocol,'mailto:');
    assert.equal(draft.pathname,'support@freebietrail.com');
    assert.deepEqual([...draft.searchParams.keys()],['subject','body']);
    assert.equal(draft.searchParams.get('subject'),text.subject);
    assert.deepEqual(draft.searchParams.get('body').split('\r\n'),text.fields.map(field => field + ': '));
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

test('listing controls expose residence outside of advanced options and a collapsed Safari tip', () => {
  for (const lang of ['ja','en']) for (const path of ['opportunities','sweepstakes','rewards']) {
    const page = read(`${lang}/${path}/index.html`);
    assert.equal((page.match(/<select[^>]*name="country"/g) || []).length, 1);
    const search = page.match(/<div class="search-row[^"]*">([\s\S]*?)<\/div>/)[1];
    assert.deepEqual(Array.from(search.matchAll(/name="([^"]+)"/g),m=>m[1]),
      path === 'sweepstakes' ? ['q','sort'] : ['q','country','sort']);
    if (path !== 'sweepstakes') {
      assert.match(search, /<select name="country"><option value="">/);
      assert.doesNotMatch(page, /<select class="masthead-residence"/);
    }
    if (path === 'sweepstakes') {
      const masthead = page.match(/<header class="masthead">([\s\S]*?)<\/header>/)[1];
      const country = masthead.match(/<select class="masthead-residence" name="country" form="filters" aria-label="([^"]+)" disabled>([\s\S]*?)<\/select>/);
      assert.equal(country[1],copy[lang].sweepstakesGuide.residence);
      assert.ok(country[2].startsWith(`<option value="">${lang === 'ja' ? '居住国' : 'Residence'}</option>`));
      assert.match(masthead, /class="language"[^>]*>[^<]+<\/a><select class="masthead-residence"/);
      assert.doesNotMatch(search,/name="country"/);
      const verified = new Set(rows.filter(row=>row.category === 'sweepstakes' && row.eligibility_verified &&
        Array.isArray(row.eligible_countries)).flatMap(row=>row.eligible_countries));
      assert.deepEqual(new Set(Array.from(country[2].matchAll(/<option value="([^"]+)">/g),m=>m[1])),verified);
      assert.match(page, /<header class="intro"><h1>[^<]+<\/h1>\s*<\/header><form class="filter"/);
      assert.ok(page.indexOf('id="listing-results"') < page.indexOf('id="no-sns-giveaways"'));
      assert.match(page, /id="no-sns-giveaways"[^>]*data-unfiltered-guide/);
      assert.match(page, /<h2 id="no-sns-heading">[^<]+<\/h2><\/div>/);
    }
    assert.doesNotMatch(page.match(/<details class="filter-options">[\s\S]*?<\/details>/)[0], /name="country"/);
    assert.match(page, /<\/form>\s*<details class="home-screen-help"><summary>[^<]+<\/summary><p>Safari|<\/form>\s*<details class="home-screen-help"><summary>[^<]+<\/summary><p>In Safari/);
  }
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

test('paid surveys and user testing follow their own categories while keeping the rewards', () => {
  const google = rows.find(row => row.id === 'google-opinion-android');
  const testing = rows.find(row => row.id === 'usertesting');
  const prolific = rows.find(row => row.id === 'prolific');
  assert.equal(google.reward_type,'gift-card');
  assert.equal(google.participation_method,'app');
  assert.equal(matches(google,{category:'survey',reward_type:'gift-card'},'en',now),true);
  assert.equal(matches(google,{category:'gift'},'en',now),false);
  assert.equal(matches(testing,{category:'user-test',participation_method:'user-test'},'en',now),true);
  assert.equal(matches(testing,{category:'research'},'en',now),false);
  assert.equal(matches(prolific,{category:'research',participation_method:'study'},'en',now),true);
  for (const [lang, survey, testLabel] of [
    ['ja','有償アンケート','ユーザーテスト'], ['en','Paid surveys','User testing'],
  ]) {
    for (const page of ['opportunities','rewards']) {
      const listing = read(`${lang}/${page}/index.html`);
      assert.ok(listing.includes(`<option value="survey">${survey}</option>`));
      assert.ok(listing.includes(`<option value="user-test">${testLabel}</option>`));
      const card = id => listing.match(new RegExp(`<article[^>]*data-record="${id}"[^>]*>[\\s\\S]*?<\/article>`))[0];
      assert.ok(card(google.id).includes(`<div class="labels"><span>${survey}</span>`));
      assert.ok(card(testing.id).includes(`<div class="labels"><span>${testLabel}</span>`));
    }
    assert.match(read(`${lang}/opportunities/${google.id}/index.html`),/Google Play/);
    assert.ok(read(`${lang}/opportunities/${testing.id}/index.html`).includes(`<div class="labels"><span>${testLabel}</span>`));
  }
});

test('detail links include the closest listed peer and omit the section without a peer', () => {
  for (const lang of ['ja','en']) {
    const google = read(`${lang}/opportunities/google-opinion-android/index.html`);
    const related = google.match(/<section[^>]+aria-labelledby="related-listings">([\s\S]+?)<\/section>/)[1];
    const peerIds = [...related.matchAll(/href="\/[^/]+\/opportunities\/([^/]+)\/"/g)].map(([,id]) => id);
    assert.ok(peerIds.length);
    assert.ok(peerIds.every(id => rows.find(row => row.id === id)?.category === 'survey'));
    const prolific = read(`${lang}/opportunities/prolific/index.html`);
    assert.doesNotMatch(prolific, /href="[^"]*\/usertesting\//);
    assert.doesNotMatch(read(`${lang}/opportunities/freecash/index.html`), /aria-labelledby="related-listings"/);
    const html = read(`${lang}/sweepstakes/index.html`);
    const guide = html.slice(html.indexOf('id="no-sns-giveaways"'),html.indexOf('rewards-cross-link'));
    for (const id of ['club-sunstar-november-2026','obu-city-quiz-november-2026','penguin-white-company-calendar-2026','stanley-review-november-2026']) {
      assert.ok(guide.includes(`href="/${lang}/opportunities/${id}/"`), id);
    }
    for (const id of ['ja-wakayama-rice-2026-11','calbee-jagabee-2026','rakuten-app-draw']) {
      assert.ok(!guide.includes(`href="/${lang}/opportunities/${id}/"`), id);
    }
  }
});

test('Japan guide requires explicit, current residence eligibility and open free web entry', () => {
  const checked = Date.parse('2026-11-08T12:00:00Z');
  const valid = rows.find(row => row.id === 'club-sunstar-november-2026');
  assert.equal(verifiedJapanGiveaway(valid, checked), true);
  for (const changed of [
    {eligible_countries:'worldwide'},
    {eligible_countries:['GB'], shipping_countries:['JP']},
    {eligibility_verified:false},
    {availability:'ended'},
    {deadline:'2026-11-08T11:59:59Z', deadline_date_only:false},
    {deadline:null, availability:'unknown'},
    {last_checked_at:'2026-10-09T12:00:00Z'},
    {last_checked_at:'2026-11-08T12:00:01Z'},
    {application:{...valid.application, sns_required:true}},
    {application:{...valid.application, web_only:false}},
    {required_expense:{kind:'purchase'}},
  ]) assert.equal(verifiedJapanGiveaway({...valid,...changed}, checked), false, JSON.stringify(changed));
  assert.equal(verifiedJapanGiveaway({...valid,eligible_countries:['JP','US']}, checked),true);
  assert.equal(verifiedJapanGiveaway({...valid,deadline:null,availability:'ongoing'}, checked),true);
  for (const lang of ['ja','en']) {
    const page = read(`${lang}/sweepstakes/index.html`);
    const japan = page.match(/<section aria-labelledby="japan-giveaways">.*?<\/section>/s)[0];
    const other = page.match(/<section aria-labelledby="other-giveaways">.*?<\/section>/s)[0];
    assert.match(japan,/club-sunstar/);
    assert.doesNotMatch(japan,/penguin|stanley|obu-city/);
    assert.match(other,/obu-city/);
    assert.match(other,/penguin/);
    assert.doesNotMatch(other,/club-sunstar/);
    assert.ok(japan.includes(copy[lang].checked));
    assert.ok(japan.includes(copy[lang].registration));
    const escapedSource = valid.source_url.replaceAll('&','&amp;');
    const detailPath = `/${lang}/opportunities/${valid.id}/`;
    if (valid.source_url === valid.official_url) {
      assert.ok(japan.includes(`href="${detailPath}#official-sources"`));
      assert.ok(!japan.includes(`href="${escapedSource}"`));
      assert.match(read(detailPath.slice(1) + 'index.html'), /id="official-sources"/);
    } else {
      assert.ok(japan.includes(`href="${escapedSource}"`));
    }
    assert.doesNotMatch(japan,/data-event="application_click"/);
  }
});

test('cached Japan guide hides stale items and restores its empty message before deadline', async () => {
  const {updateDates} = await import('../site/status.mjs');
  const date = '2026-11-05T06:00:00Z';
  const item = {
    hidden: false, dataset: {expireWhenStale:date, expiring:'2026-12-10T15:00:00Z'},
    hasAttribute: key => key === 'data-expire-when-stale',
  };
  const empty = {hidden:true};
  const list = {
    hidden:false, parentElement:{querySelector:()=>empty},
    querySelector:()=>item.hidden ? null : item,
  };
  const root = {
    querySelector:()=>null,
    querySelectorAll:selector=>selector === '[data-expiry-list]' ? [list]
      : selector === '[data-record], [data-expiring]' ? [item] : [],
  };
  updateDates(root, Date.parse('2026-12-05T05:59:59Z'),'ja');
  assert.deepEqual([item.hidden,list.hidden,empty.hidden],[false,false,true]);
  updateDates(root, Date.parse('2026-12-05T06:00:00Z'),'ja');
  assert.deepEqual([item.hidden,list.hidden,empty.hidden],[true,true,false]);
});

test('currency, null and timezone behavior', () => {
  assert.equal(money(1000,'JPY','ja','unknown'),'1,000円');
  assert.match(money(1000,'JPY','en','unknown'), /JPY\s+1,000/);
  assert.match(money(7.5,'USD','en','unknown'), /USD.*7\.50/);
  assert.equal(money(null,'JPY','ja','unknown'),'unknown');
  assert.match(date('2026-11-05T18:00:00Z','ja',true), /6日.*03:00.*JST/);
  assert.match(date('2026-11-05T18:00:00Z','en',true), /5 Nov.*18:00.*UTC/);
});

test('expiration, stale ranking, and unknown winning odds', () => {
  assert.equal(expired({...draw,deadline:'2026-11-05T18:00:00Z'},now),true);
  assert.equal(stale({...jp,last_checked_at:'2026-10-05T18:00:00Z'},now),true);
  const old = {...jp,id:'older',last_checked_at:'2026-10-05T18:00:00Z'};
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
    sample.affiliate_expires_at = '2026-11-09T12:00:00Z';
    // Fixture for the renderer only. Python rejects links lacking an approval record.
    const fixture = JSON.stringify(dataset);
    execFileSync(process.execPath,['-e','require("node:fs").writeFileSync("var/published.json",process.argv[1])',fixture]);
    execFileSync(process.execPath,['site/build.mjs'], {env:{...process.env,SITE_ORIGIN:origin,QA_NOW:'2026-11-08T12:00:00Z'}});
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
    assert.equal(/data-record="freecash"/.test(read(`${lang}/opportunities/index.html`)),Boolean(freecash));
    assert.equal(existsSync('dist/' + path), Boolean(freecash));
    if (!freecash) continue;
    assert.doesNotMatch(affiliates, /data-record="freecash"/);
    assert.match(read(`${lang}/rewards/index.html`), /class="card sponsored-card task-card" data-record="freecash"/);
    const html = read(path);
    assert.ok(html.includes(copy[lang].affiliateDisclosure));
    assert.ok(html.includes(`href="${freecash.official_url}" target="_blank" rel="noopener noreferrer"`));
    assert.ok(html.includes(`href="${freecash.affiliate_url}" target="_blank" rel="sponsored nofollow noopener noreferrer"`));
    assert.match(html, /itemtype="https:\/\/schema.org\/BreadcrumbList"/);
    assert.equal(freecash.promotion_countries.length,15);
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


test('Rewards adds a neutral Japan comparison and keeps the existing ad and giveaway paths distinct', () => {
  for (const lang of ['ja','en']) {
    const path = `/${lang}/rewards/`;
    const html = read(path.slice(1) + 'index.html');
    const comparison = html.match(/<section[^>]+id="rewards-comparison".*?<\/section>/s)?.[0];
    assert.ok(comparison);
    assert.ok(comparison.includes(copy[lang].rewardsGuide.costs));
    assert.ok(comparison.includes(copy[lang].expenses.free));
    assert.ok(comparison.includes(copy[lang].registrations.organizer));
    assert.match(comparison, /data-expire-when-stale=/);
    for (const id of ['research-panel','prolific']) {
      assert.ok(comparison.includes(`href="/${lang}/opportunities/${id}/"`));
      assert.ok(comparison.includes(`href="/${lang}/opportunities/${id}/#official-sources"`));
    }
    assert.doesNotMatch(comparison, /freecash|usertesting|affiliate_click|application_click|sponsored-card/i);
    const rewardAd = html.match(/data-record="freecash"/g) ?? [];
    assert.equal(rewardAd.length, rows.some(row => row.id === 'freecash') ? 1 : 0);
    const sponsor = html.match(/<aside class="rewards-sponsored-link[^>]*>.*?<\/aside>/s)?.[0];
    if (rewardAd.length) {
      assert.ok(sponsor);
      assert.ok(sponsor.includes(copy[lang].sponsoredLabel));
      assert.ok(sponsor.includes(`href="/${lang}/opportunities/freecash/"`));
      assert.match(sponsor, /data-affiliate-expires="[^"]+"/);
      assert.match(sponsor, /data-expire-when-stale="[^"]+"/);
      assert.doesNotMatch(sponsor, /https?:|affiliate_click|research-panel|prolific/);
      assert.ok(html.indexOf(sponsor) > html.indexOf(comparison) + comparison.length - 1);
      assert.ok(html.indexOf(sponsor) < html.indexOf('id="filters"'));
    } else {
      assert.equal(sponsor, undefined);
    }
    assert.ok(html.includes(`rel="canonical" href="${origin}${path}"`));
    assert.match(html, /<meta name="robots" content="index, follow">/);
    const anchor = `href="${path}#rewards-comparison"`;
    assert.ok(read(`${lang}/index.html`).includes(anchor));
    const draws = read(`${lang}/sweepstakes/index.html`);
    assert.ok(draws.includes(anchor));
    assert.ok(draws.indexOf(anchor) > draws.indexOf('id="listing-results"'));
    assert.doesNotMatch(draws, /data-record="freecash"|affiliate_click/);
  }
});

test('Rewards shortcut is omitted after approval expiry or stale verification', () => {
  const original = readFileSync('var/published.json','utf8');
  const data = JSON.parse(original);
  const freecash = data.records.find(row => row.id === 'freecash');
  if (!freecash) return;
  const buildLater = () => execFileSync(process.execPath,['site/build.mjs'], {
    env:{...process.env,SITE_ORIGIN:origin,QA_NOW:'2026-12-08T00:00:00Z'}
  });
  try {
    buildLater();
    assert.doesNotMatch(read('ja/rewards/index.html'), /rewards-sponsored-link|data-record="freecash"/);
    freecash.affiliate_expires_at = '2026-12-15T00:00:00Z';
    execFileSync(process.execPath,['-e','require("node:fs").writeFileSync("var/published.json",process.argv[1])',JSON.stringify(data)]);
    buildLater();
    const rewards = read('ja/rewards/index.html');
    assert.match(rewards, /data-record="freecash"/);
    assert.doesNotMatch(rewards, /rewards-sponsored-link/);
  } finally { build(); }
});

test('invalid generated data never replaces the previous built site', () => {
  const original = readFileSync('var/published.json','utf8');
  const previous = read('ja/index.html');
  try {
    const bad = JSON.parse(original);
    bad.records[0].last_checked_at = '2026-02-30T00:00:00Z';
    execFileSync(process.execPath,['-e','require("node:fs").writeFileSync("var/published.json",process.argv[1])',JSON.stringify(bad)]);
    assert.throws(()=>execFileSync(process.execPath,['site/build.mjs'],{stdio:'pipe',env:{...process.env,QA_NOW:'2026-11-08T12:00:00Z'}}),/verification dates/);
    assert.equal(read('ja/index.html'),previous);
  } finally {build();}
});


test('render failure retains the complete previous build', () => {
  const original = readFileSync('var/published.json','utf8');
  const previous = read('ja/index.html');
  try {
    const bad = JSON.parse(original);
    bad.records.find(row=>row.deadline).deadline_timezone = 'Invalid/Timezone';
    execFileSync(process.execPath,['-e','require("node:fs").writeFileSync("var/published.json",process.argv[1])',JSON.stringify(bad)]);
    assert.throws(()=>execFileSync(process.execPath,['site/build.mjs'],{stdio:'pipe',env:{...process.env,QA_NOW:'2026-11-08T12:00:00Z'}}),/time zone/i);
    assert.equal(read('ja/index.html'),previous);
  } finally {build();}
});
