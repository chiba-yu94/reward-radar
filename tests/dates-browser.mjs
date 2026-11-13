import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {copy} from '../site/locales.mjs';

const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:8787';
const now = new Date('2026-11-08T12:00:00Z');
const browser = await chromium.launch({channel:'chrome'});
let checks = 0;
try {
  const context = await browser.newContext();
  await context.route(/google-analytics|googletagmanager/, route=>route.abort());
  const data = await (await context.request.get(origin+'/opportunities.json')).json();
  for(const lang of ['ja','en']) {
    const page = await context.newPage();
    await page.clock.install({time:now});
    for(const id of ['freecash','ja-wakayama-rice-2026-11','stanley-review-november-2026','takaratomy-conan-card-2026','tombow-mono-2026']) {
      await page.clock.setFixedTime(now);
      const response=await page.goto(`${origin}/${lang}/opportunities/${id}/`);
      assert.equal(response.status(),200);
      assert.equal(await page.locator('[data-stale]').isVisible(),false);
      assert.equal(await page.locator('[data-ended]').isVisible(),false);
      assert.equal(await page.locator('[data-stale]').textContent(),'');
      assert.equal(await page.locator('[data-ended]').textContent(),'');
      assert.equal(await page.locator('.entry-action').isVisible(),true);
      assert.ok(!await page.locator('body').innerText().then(text=>text.includes(copy[lang].expired)));
      const raw=await response.text();
      assert.ok(!raw.includes(copy[lang].stale));
      assert.ok(!raw.includes(copy[lang].expired));
      checks++;
      if(id==='ja-wakayama-rice-2026-11') {
        for(const [time,ended] of [['2026-11-30T14:59:59.999Z',false],['2026-11-30T15:00:00Z',true],['2026-11-30T14:59:58Z',false]]) {
          await page.clock.setFixedTime(new Date(time));
          await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
          assert.equal(await page.locator('[data-ended]').isVisible(),ended);
          assert.equal(await page.locator('.entry-action').isVisible(),!ended);
          checks++;
        }
      }
      if(id==='freecash') {
        await page.clock.setFixedTime(new Date('2026-12-08T12:00:00Z'));
        await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
        assert.equal(await page.locator('[data-stale]').isVisible(),true);
        assert.equal(await page.locator('[data-ended]').isVisible(),false);
        checks++;
        await page.evaluate(async () => {
          const {updateDates}=await import('/assets/status.mjs');
          document.querySelector('[data-stale]').dataset.lastChecked='not-a-date';
          updateDates(document,Date.now(),document.documentElement.lang);
        });
        assert.equal(await page.locator('[data-stale]').isVisible(),false);
        checks++;
      }
    }
    await page.clock.setFixedTime(now);
    await page.goto(`${origin}/${lang}/opportunities/calbee-jagabee-2026/`);
    const related = page.locator('[aria-labelledby="related-listings"]');
    assert.equal(await related.isVisible(),true);
    await page.clock.setFixedTime(new Date('2026-12-01T05:00:00Z'));
    await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
    assert.equal(await related.isVisible(),false);
    checks++;

    await page.clock.setFixedTime(now);
    await page.goto(`${origin}/${lang}/sweepstakes/`);
    const guide = page.locator('#no-sns-giveaways');
    assert.equal(await guide.locator('li:visible').count(),4);
    await page.clock.setFixedTime(new Date('2026-11-15T15:00:00Z'));
    await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
    assert.equal(await guide.locator('li:visible').count(),3);
    await page.clock.setFixedTime(new Date('2026-12-01T05:00:00Z'));
    await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
    assert.equal(await guide.locator('ul').isVisible(),false);
    assert.equal(await guide.locator('[data-expiry-empty]').isVisible(),true);
    checks += 3;

    await page.clock.setFixedTime(now);
    await page.goto(`${origin}/${lang}/opportunities/`);
    await page.waitForFunction(()=>document.querySelector('#filters').hidden===false);
    const listFacts = {};
    for (const directory of ['opportunities','affiliates']) {
      await page.goto(`${origin}/${lang}/${directory}/`);
      Object.assign(listFacts,await page.locator('[data-record]').evaluateAll(cards=>Object.fromEntries(cards.map(card=>[
        card.dataset.record,Array.from(card.querySelectorAll('dl.facts > div')).map(div=>[div.querySelector('dt').textContent,div.querySelector('dd').textContent])
      ]))));
    }
    // Every public card and detail use exactly the same geographic facts.
    for (const row of data.records.filter(row=>row.id!=='freecash')) {
      await page.goto(`${origin}/${lang}/opportunities/${row.id}/`);
      const facts=await page.locator('.detail .facts > div').evaluateAll(divs=>Object.fromEntries(divs.map(div=>[div.querySelector('dt').textContent,div.querySelector('dd').textContent])));
      for(const key of [copy[lang].residency,row.category==='sweepstakes'?copy[lang].shipping:copy[lang].serviceCountries]) {
        assert.equal(new Map(listFacts[row.id]).get(key),facts[key],`${lang} ${row.id} ${key}`);
      }
      assert.equal(await page.locator('.sources time').getAttribute('datetime'),row.last_checked_at);
      checks++;
    }
    // A cached card must remain hidden if a newer dataset has withdrawn its approval.
    await page.route('**/opportunities.json', route => route.fulfill({
      json:{...data, records:data.records.filter(row=>row.id!=='freecash')},
    }));
    await page.goto(`${origin}/${lang}/opportunities/`);
    await page.waitForFunction(()=>document.querySelector('#filters').hidden===false);
    const withdrawn = page.locator('[data-record="freecash"]');
    assert.equal(await withdrawn.count(),1);
    assert.equal(await withdrawn.isVisible(),false);
    await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
    assert.equal(await withdrawn.isVisible(),false);
    checks++;
    await page.close();
  }
  console.log(`Date, cached-page and geographic consistency checks: ${checks} passed, 0 failed`);
} finally {await browser.close();}
