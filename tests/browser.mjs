import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
(async () => {
  const browser = await chromium.launch({channel:'chrome',executablePath:process.env.CHROME_BIN || undefined,headless:true});
  try {
    const base = process.env.TEST_ORIGIN || 'http://127.0.0.1:8787';
    for (const width of [375,1280]) for (const lang of ['ja','en']) {
      const page = await browser.newPage({viewport:{width,height:850},isMobile:width<400,deviceScaleFactor:1,hasTouch:width<400});
      const errors = [];
      page.on('pageerror',e=>errors.push(e.message));
      for (const path of ['','opportunities/','opportunities/prolific/','affiliates/','contact/']) {
        const response = await page.goto(`${base}/${lang}/${path}`);
        assert.equal(response.status(),200);
        assert.equal(await page.locator('html').getAttribute('lang'),lang);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth), `overflow: ${width} ${lang} ${path}`);
      }
      await page.goto(`${base}/${lang}/opportunities/`);
      await page.locator('[name=explicitJapan]').check();
      await page.locator('[name=q]').fill('Prolific');
      assert.deepEqual(await page.locator('[data-record]:visible').evaluateAll(items=>items.map(x=>x.dataset.record)),['prolific']);
      await page.locator('[data-record="prolific"] h3 a').click();
      await page.locator('header .language').click();
      assert.match(page.url(),lang==='ja'?/\/en\/opportunities\/prolific\/$/:/\/ja\/opportunities\/prolific\/$/);
      await page.goto(`${base}/${lang}/sweepstakes/`);
      const snsFree = page.locator('[name=noSns]');
      if (await snsFree.count()) {
        const data = await (await page.request.get(base + '/opportunities.json')).json();
        const records = data.records.filter(row => row.category === 'sweepstakes' &&
          (!row.deadline || Date.parse(row.deadline) > Date.now()) && row.application?.sns_required === false);
        const visibleIds = () => page.locator('[data-record]:visible')
          .evaluateAll(items => items.map(item => item.dataset.record).sort());
        await snsFree.check();
        assert.deepEqual(await visibleIds(),records.map(row => row.id).sort());
        await page.locator('[name=webOnly]').check();
        await page.locator('[name=easyApply]').check();
        assert.deepEqual(await visibleIds(),records.filter(row => row.application.web_only === true &&
          row.application.difficulty === 'easy').map(row => row.id).sort());
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      assert.deepEqual(errors,[]);
      console.log(`${lang} at ${width}px: home, directory, details, affiliates, contact, filter and language switch passed`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
