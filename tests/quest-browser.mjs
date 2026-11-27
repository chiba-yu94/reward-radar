import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {fixtureBounty, fixturePublication} from './fixtures/bounty-approval.mjs';

const folder = await mkdtemp(join(tmpdir(),'freebietrail-bounty-'));
const now = '2026-11-25T06:40:00Z';
const cutoff = Date.parse(fixtureBounty.deadline);
const served = root => createServer(async (req,res) => {
  try {
    const path = new URL(req.url,'http://localhost').pathname;
    const body = await readFile(join(root,path.endsWith('/') ? path + 'index.html' : path));
    const type = path.endsWith('/') ? 'text/html' : path.endsWith('.mjs') ? 'text/javascript' :
      path.endsWith('.css') ? 'text/css' : path.endsWith('.xml') ? 'application/xml' : 'application/octet-stream';
    res.writeHead(200,{'content-type':type}).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
const server = served(join(folder,'dist'));
let browser;
try {
  await mkdir(join(folder,'data'));
  await mkdir(join(folder,'var'));
  await symlink(resolve('site'),join(folder,'site'));
  await copyFile('data/taxonomy.json',join(folder,'data/taxonomy.json'));
  const editorial = JSON.parse(await readFile('data/editorial.json','utf8'));
  editorial.quests.push(fixtureBounty, {id:'unapproved-skill-fixture',status:'candidate'});
  const dates = JSON.parse(await readFile('data/rss-publications.json','utf8'));
  await writeFile(join(folder,'data/editorial.json'),JSON.stringify(editorial));
  await writeFile(join(folder,'data/rss-publications.json'),JSON.stringify([...dates,fixturePublication]));
  execFileSync('python3',['-c',`
from pathlib import Path
from sys import argv
from radar.pipeline import inputs, publish, stamp
rows, sources = inputs(Path('tests/fixtures/reviewed'))
folder = Path(argv[1]) / 'var'
publish(rows, sources, {}, folder / 'published.json', folder / 'operations.sqlite', stamp('2026-11-25T06:40:00Z'))
`,folder]);
  const build = clock => execFileSync(process.execPath,[resolve('site/build.mjs')],{
    cwd:folder,env:{...process.env,SITE_ORIGIN:'https://freebietrail.com',QA_NOW:new Date(clock).toISOString()},
  });
  build(now);
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const local = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({channel:'chrome',headless:true});
  const href = lang => '/' + lang + '/opportunities/' + fixtureBounty.id + '/';
  const feedItem = lang => 'https://freebietrail.com' + href(lang);
  const rssIdentities = new Map();
  const identity = async lang => {
    const feed = await (await fetch(local + '/' + lang + '/feed.xml')).text();
    const entries = feed.split('<item>').filter(item => item.includes(feedItem(lang)));
    assert.equal(entries.length,1);
    return [entries[0].match(/<guid[^>]*>([^<]+)/)[1], entries[0].match(/<pubDate>([^<]+)/)[1]];
  };
  for (const lang of ['ja','en']) rssIdentities.set(lang, await identity(lang));
  // A factual text edit leaves publication identity intact.
  fixtureBounty.copy.en.task += ' Updated fixture copy.';
  await writeFile(join(folder,'data/editorial.json'),JSON.stringify(editorial));
  build(now);
  for (const lang of ['ja','en']) assert.deepEqual(await identity(lang),rssIdentities.get(lang));
  for (const width of [375,1280]) for (const lang of ['ja','en']) {
    const page = await browser.newPage({viewport:{width,height:850}});
    await page.route('**/*',route => route.request().url().startsWith(local + '/') ? route.continue() : route.abort());
    const errors = [];
    page.on('pageerror',error => errors.push(error.message));
    await page.clock.install({time:new Date(now)});
    await page.goto(local + '/' + lang + '/');
    await page.locator('.home-shortcuts a[href="/' + lang + '/opportunities/"]').click();
    const form = page.locator('#filters[aria-busy=false]');
    await form.waitFor({state:'visible'});
    const card = page.locator('[data-editorial]').filter({has:page.locator('a[href="' + href(lang) + '"]')});
    assert.ok(await card.isVisible());
    assert.match(await card.textContent(), lang === 'ja' ? /入賞者のみ賞金/ : /Prize for winners only/);
    await form.locator('[name=q]').fill('absent-result-1024');
    assert.ok(await page.locator('[data-empty]').isVisible());
    assert.equal(await page.locator('#result-count').textContent(),'0');
    await form.locator('[type=reset]').click();
    await form.locator('summary').click();
    await form.locator('[name=category]').selectOption('skill-bounty');
    await form.locator('[name=freeEntry]').check();
    await form.locator('[name=sns]').selectOption('false');
    await form.locator('[name=ai]').selectOption('allowed');
    await form.locator('[name=by]').fill('2026-11-26');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.locator('#result-count').textContent(),'1');
    await card.getByRole('link').click();
    assert.equal(new URL(page.url()).pathname,href(lang));
    assert.ok(await page.locator('link[rel=canonical]').getAttribute('href') === 'https://freebietrail.com' + href(lang));
    assert.ok(await page.locator('link[hreflang="' + (lang === 'ja' ? 'en' : 'ja') + '"]').count());
    assert.ok(await page.locator('section[data-expiry-section] li:not([hidden])').count());
    assert.ok(await page.getByRole('link',{name:lang === 'ja' ? '案件一覧へ戻る' : 'Back to opportunities'}).count());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.locator('a[href$="deadline.ics"]').isVisible());
    await page.clock.setSystemTime(cutoff);
    await page.evaluate(() => dispatchEvent(new Event('pageshow')));
    assert.ok(await page.locator('[data-quest-ended-notice]').isVisible());
    assert.equal(await page.locator('a[href$="deadline.ics"]').isVisible(),false);
    assert.ok(await page.locator('main a[href="' + fixtureBounty.official_url + '"]').last().isVisible());
    await page.goBack();
    await form.waitFor({state:'visible'});
    const advanced = form.locator('details');
    if (!await form.locator('[name=status]').isVisible()) {
      await advanced.locator('summary').click();
    }
    await form.locator('[name=status]').selectOption('ended');
    assert.ok(await card.isVisible());
    assert.deepEqual(errors,[]);
    await page.close();
    console.log(`opportunity directory: ${lang}, ${width}px, search, open and ended details, filters and no overflow`);
  }
  build(cutoff);
  const sitemap = await (await fetch(local + '/sitemap.xml')).text();
  for (const lang of ['ja','en']) {
    const archived = await (await fetch(local + href(lang))).text();
    assert.match(archived,/data-quest-ended-notice[^>]+>(募集終了|Entries closed)/);
    assert.doesNotMatch(archived,/data-quest-listing|deadline\.ics/);
    assert.ok(archived.includes(fixtureBounty.official_url));
    const feed = await (await fetch(local + '/' + lang + '/feed.xml')).text();
    assert.ok(!feed.includes(feedItem(lang)) && !feed.includes('unapproved-skill-fixture'));
    assert.ok(!sitemap.includes(feedItem(lang)));
  }
} finally {
  await browser?.close();
  server.close();
  await rm(folder,{recursive:true,force:true});
}
