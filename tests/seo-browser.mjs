import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const [origin = 'http://127.0.0.1:8787', canonical = 'https://freebietrail.com'] = process.argv.slice(2);
const browser = await chromium.launch({channel:'chrome'});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const sitemap = await (await context.request.get(origin + '/sitemap.xml')).text();
  const robot = await (await context.request.get(origin + '/robots.txt')).text();
  assert.match(robot,/Allow: \/\n/);
  assert.ok(robot.includes('Sitemap: ' + canonical + '/sitemap.xml'));
  const entries = await page.evaluate(sitemap => Array.from(new DOMParser().parseFromString(sitemap,'application/xml').querySelectorAll('url'))
    .map(entry => ({url:entry.querySelector('loc').textContent,
      alternates:Array.from(entry.children).slice(1).map(x => [x.getAttribute('hreflang'),x.getAttribute('href')])})),sitemap);
  assert.ok(entries.length > 2);
  const paths = new Set(entries.map(({url}) => new URL(url).pathname));
  assert.equal(paths.size,entries.length);
  const titles = new Set();
  const links = new Set();
  const outbound = new Set();
  const schema = {site:0, breadcrumbs:0};
  for (const entry of entries) {
    const path = new URL(entry.url).pathname;
    assert.equal(new URL(entry.url).origin,canonical);
    assert.equal((await page.goto(origin + path)).status(),200,path);
    const info = await page.evaluate(() => ({
      h1:document.querySelectorAll('h1').length,
      canonical:document.querySelector('link[rel=canonical]').href,
      robots:document.querySelector('meta[name=robots]')?.content || '',
      description:document.querySelector('meta[name=description]').content,
      og:document.querySelector('meta[property="og:description"]').content,
      title:document.title, language:document.documentElement.lang,
      alternates:Array.from(document.querySelectorAll('link[rel=alternate][hreflang]')).map(x=>[x.hreflang,x.href]),
      local:Array.from(document.links).filter(a=>a.origin===location.origin).map(a=>a.pathname),
      outbound:Array.from(document.querySelectorAll('main a[href^="https://"]')).filter(a=>a.origin!==location.origin).map(a=>a.href),
      website:!!document.querySelector('[itemtype="https://schema.org/WebSite"] [itemprop="name"]'),
      breadcrumbs:Array.from(document.querySelectorAll('[itemtype="https://schema.org/BreadcrumbList"] [itemprop="itemListElement"]')).map(x =>
        ({name:x.querySelector('[itemprop=name]').textContent, position:x.querySelector('[itemprop=position]').content, url:x.querySelector('[itemprop=item]')?.href})),
    }));
    assert.equal(info.h1,1);
    assert.equal(info.language,path.startsWith('/ja/')?'ja':'en');
    assert.equal(info.canonical,entry.url);
    assert.doesNotMatch(info.robots,/noindex/);
    assert.equal(info.description,info.og);
    assert.ok(info.description.trim() && info.title.trim());
    assert.ok(!titles.has(info.title),info.title);
    titles.add(info.title);
    assert.deepEqual(info.alternates,entry.alternates);
    for (const [,alt] of info.alternates) {
      const alternate = entries.find(x => x.url === alt);
      assert.ok(alternate,alt);
      assert.deepEqual(alternate.alternates,info.alternates);
    }
    if (info.website) schema.site++;
    if (info.breadcrumbs.length) {
      assert.deepEqual(info.breadcrumbs.map(x=>x.position),['1','2']);
      assert.ok(info.breadcrumbs.every(x=>x.name));
      assert.ok(info.breadcrumbs.every(x=>paths.has(new URL(x.url).pathname)));
      schema.breadcrumbs++;
    }
    for (const link of info.local) links.add(link);
    for (const link of info.outbound) outbound.add(link);
  }
  for (const path of links) assert.equal((await context.request.get(origin + path)).status(),200,path);
  for (const lang of ['ja','en']) {
    for (const retired of ['rakuten-app-draw','does-not-exist'])
      assert.equal((await context.request.get(origin + '/' + lang + '/opportunities/' + retired + '/')).status(),404);
    const query = await context.request.get(origin + '/' + lang + '/opportunities/?q=example');
    assert.match(await query.text(),new RegExp('rel="canonical" href="' + canonical + '/' + lang + '/opportunities/"'));
  }
  const fs = await import('node:fs/promises');
  await fs.writeFile('var/ux-rework/outbound-urls.txt',[...outbound].join('\n')+'\n');
  console.log({sitemap:entries.length,uniqueTitles:titles.size,internalTargets:links.size,outboundTargets:outbound.size,schema});
} finally { await browser.close(); }
