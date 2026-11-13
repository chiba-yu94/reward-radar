import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import { chromium } from 'playwright-core';
import {expired, expiration} from '../site/domain.mjs';

const [origin = 'http://127.0.0.1:8787', canonical = 'https://freebietrail.com'] = process.argv.slice(2);
const browser = await chromium.launch({channel:'chrome'});
try {
  const context = await browser.newContext({javaScriptEnabled:false});
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage();
  const get = async path => {
    const response = await context.request.get(origin + path, {maxRedirects:0});
    assert.equal(response.status(),200,path);
    return response;
  };
  const sitemap = await (await get('/sitemap.xml')).text();
  const robot = await (await get('/robots.txt')).text();
  assert.equal(robot,`User-agent: *\nAllow: /\nSitemap: ${canonical}/sitemap.xml\n`);
  const {records, generated_at} = await (await get('/opportunities.json')).json();
  const now = Date.parse(generated_at);
  const details = new Map(records.map(row => [row.id,row]));
  const entries = await page.evaluate(sitemap => Array.from(new DOMParser().parseFromString(sitemap,'application/xml').querySelectorAll('url'))
    .map(entry => ({url:entry.querySelector('loc').textContent,
      alternates:Array.from(entry.children).slice(1).map(x => [x.getAttribute('hreflang'),x.getAttribute('href')])})),sitemap);
  assert.ok(entries.length > 2);
  const paths = new Set(entries.map(({url}) => new URL(url).pathname));
  assert.equal(paths.size,entries.length);
  for (const row of records) for (const lang of ['ja','en']) {
    assert.ok(!expired(row,now) && paths.has(`/${lang}/opportunities/${row.id}/`),row.id);
  }
  const unique = {title:new Set(),description:new Set(),h1:new Set()};
  const localizedLinks = new Map();
  const links = new Set();
  const outbound = new Set();
  const schema = {site:0, breadcrumbs:0};
  for (const entry of entries) {
    const path = new URL(entry.url).pathname;
    assert.equal(entry.url,canonical + path);
    const response = await page.goto(origin + path);
    assert.equal(response.status(),200,path);
    assert.doesNotMatch(response.headers()['x-robots-tag'] || '', /noindex/i, path);
    const info = await page.evaluate(() => ({
      h1s:Array.from(document.querySelectorAll('h1'), element => element.textContent),
      canonical:document.querySelector('link[rel=canonical]').href,
      robots:document.querySelector('meta[name=robots]')?.content || '',
      description:document.querySelector('meta[name=description]').content,
      og:document.querySelector('meta[property="og:description"]').content,
      title:document.title, language:document.documentElement.lang,
      alternates:Array.from(document.querySelectorAll('link[rel=alternate][hreflang]')).map(x=>[x.hreflang,x.href]),
      local:Array.from(document.links).filter(a=>a.origin===location.origin).map(a=>[a.pathname,a.search]),
      categories:Array.from(document.querySelectorAll('.detail .breadcrumbs li:nth-child(2) a'), a=>a.pathname),
      directory:Array.from(document.querySelectorAll('.detail > p > a.text-link'), a=>a.pathname),
      related:Array.from(document.querySelectorAll('[aria-labelledby="related-listings"] li'), li=>
        [li.querySelector('a').pathname, li.dataset.expiring, li.dataset.affiliateExpires || '']),
      relatedSection:!!document.querySelector('[aria-labelledby="related-listings"]'),
      guide:Array.from(document.querySelectorAll('#no-sns-giveaways li'), li=>
        [li.querySelector('a').pathname, li.dataset.expiring]),
      guideHeading:document.querySelector('#no-sns-giveaways h2')?.textContent,
      guideShortcut:document.querySelector('.home-shortcuts a')?.getAttribute('href'),
      outbound:Array.from(document.querySelectorAll('main a[href^="https://"]')).filter(a=>a.origin!==location.origin).map(a=>a.href),
      website:!!document.querySelector('[itemtype="https://schema.org/WebSite"] [itemprop="name"]'),
      breadcrumbs:Array.from(document.querySelectorAll('[itemtype="https://schema.org/BreadcrumbList"] [itemprop="itemListElement"]')).map(x =>
        ({name:x.querySelector('[itemprop=name]').textContent, position:x.querySelector('[itemprop=position]').content, url:x.querySelector('[itemprop=item]')?.href})),
    }));
    assert.equal(info.h1s.length,1,path);
    assert.equal(info.language,path.startsWith('/ja/')?'ja':'en');
    assert.equal(info.canonical,entry.url);
    assert.doesNotMatch(info.robots,/noindex/);
    assert.equal(info.description,info.og);
    for (const [key, value] of Object.entries({title:info.title,description:info.description,h1:info.h1s[0]})) {
      assert.ok(value.trim(),`Missing ${key}: ${path}`);
      assert.ok(!unique[key].has(value.trim()),`Duplicate ${key}: ${path} (${value})`);
      unique[key].add(value.trim());
    }
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
    const lang = info.language;
    const id = /^\/(?:ja|en)\/opportunities\/([^/]+)\/$/.exec(path)?.[1];
    if (id) {
      const row = details.get(id);
      assert.ok(row && !expired(row,now),path);
      const category = row.commission ? 'affiliates' : row.category === 'sweepstakes' ? 'sweepstakes' :
        row.certainty === 'guaranteed' ? 'guaranteed' : 'rewards';
      assert.deepEqual(info.categories,[`/${lang}/${category}/`],path);
      assert.deepEqual(info.directory,[`/${lang}/opportunities/`],path);
      assert.equal(info.relatedSection,info.related.length > 0,path);
      assert.ok(info.related.length <= 3,path);
      const seen = new Set([path]);
      for (const [href, end, affiliateEnd] of info.related) {
        assert.ok(href.startsWith(`/${lang}/opportunities/`) && !seen.has(href) && paths.has(href),href);
        seen.add(href);
        const candidate = details.get(href.split('/')[3]);
        assert.equal(candidate.category,row.category,href);
        assert.equal(Boolean(candidate.commission),Boolean(row.commission),href);
        assert.equal(end,Number.isFinite(expiration(candidate)) ? new Date(expiration(candidate)).toISOString() : '',href);
        assert.equal(affiliateEnd,candidate.category === 'affiliate' && !candidate.commission ? candidate.affiliate_expires_at : '',href);
      }
    }
    if (path === `/${lang}/sweepstakes/`) {
      assert.ok(info.guideHeading,path);
      const expected = records.filter(row => row.category === 'sweepstakes' && row.required_expense.kind === 'free' &&
        row.application?.sns_required === false && row.application.web_only === true && !expired(row,now));
      assert.deepEqual(info.guide.map(([href]) => href).sort(),expected.map(row => `/${lang}/opportunities/${row.id}/`).sort());
      for (const [href, end] of info.guide) {
        assert.ok(paths.has(href),href);
        const row = details.get(href.split('/')[3]);
        assert.equal(end,Number.isFinite(expiration(row)) ? new Date(expiration(row)).toISOString() : '',href);
      }
    }
    if (path === `/${lang}/`) assert.equal(info.guideShortcut,`/${lang}/sweepstakes/#no-sns-giveaways`);
    if (path !== '/') localizedLinks.set(path,[...info.related,...info.guide].map(([href]) => href.slice(3)));
    for (const [href, search] of info.local) {
      const linkedId = /^\/(?:ja|en)\/opportunities\/([^/]+)\/$/.exec(href)?.[1];
      if (linkedId) assert.ok(details.has(linkedId) && !expired(details.get(linkedId),now) && paths.has(href),`${path} → ${href}`);
      links.add(href + search);
    }
    for (const link of info.outbound) outbound.add(link);
  }
  for (const [path, targets] of localizedLinks) {
    const other = path.startsWith('/ja/') ? '/en' : '/ja';
    assert.deepEqual(targets,localizedLinks.get(other + path.slice(3)),path);
  }
  for (const path of links) await get(path);
  for (const lang of ['ja','en']) {
    for (const retired of ['rakuten-app-draw','does-not-exist'])
      assert.equal((await context.request.get(origin + '/' + lang + '/opportunities/' + retired + '/')).status(),404);
    for (const [route, queryString] of [['opportunities/','q=example'],['opportunities/prolific/','utm_source=review'],['sweepstakes/','webOnly=yes']]) {
      const path = `/${lang}/${route}`;
      const query = await get(path + '?' + queryString);
      assert.equal(query.headers()['x-robots-tag'],'noindex, follow',path);
      assert.ok((await query.text()).includes(`rel="canonical" href="${canonical}${path}"`),path);
      assert.equal(paths.has(path + '?' + queryString),false);
    }
  }
  await mkdir('var/ux-rework',{recursive:true});
  await writeFile('var/ux-rework/outbound-urls.txt',[...outbound].join('\n')+'\n');
  console.log({sitemap:entries.length,uniqueTitles:unique.title.size,uniqueDescriptions:unique.description.size,
    uniqueH1s:unique.h1.size,internalTargets:links.size,outboundTargets:outbound.size,schema});
} finally { await browser.close(); }
