import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
(async () => {
  const browser = await chromium.launch({channel:'chrome',executablePath:process.env.CHROME_BIN || undefined,headless:true});
  try {
    const base = process.env.TEST_ORIGIN || 'http://127.0.0.1:8787';
    const data = await (await fetch(base + '/opportunities.json')).json();
    const hasFreecash = data.records.some(row => row.id === 'freecash');
    for (const width of [375,390,768,1440]) for (const lang of ['ja','en']) {
      const page = await browser.newPage({viewport:{width,height:850},isMobile:width<400,deviceScaleFactor:1,hasTouch:width<400});
      const errors = [];
      page.on('pageerror',e=>errors.push(e.message));
      const paths = ['', 'opportunities/', 'opportunities/prolific/', 'affiliates/', 'contact/'];
      if (hasFreecash) paths.push('opportunities/freecash/');
      for (const path of paths) {
        const response = await page.goto(`${base}/${lang}/${path}`);
        assert.equal(response.status(),200);
        assert.equal(await page.locator('html').getAttribute('lang'),lang);
        assert.equal(await page.locator('h1').count(),1);
        if (path === 'opportunities/freecash/') {
          const link = page.locator('a[rel="sponsored nofollow noopener noreferrer"]');
          assert.match(await link.getAttribute('href'),/^https:\/\/freecash\.pxf\.io\//);
          assert.equal(await link.isVisible(),true);
        }
        if (path === 'contact/') assert.equal(await page.locator('main a[href="mailto:support@freebietrail.com"]').count(),1);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth), `overflow: ${width} ${lang} ${path}`);
      }
      await page.goto(`${base}/${lang}/opportunities/`);
      const options = page.locator('.filter-options summary');
      if (await options.count()) {
        await options.focus();
        await page.keyboard.press('Enter');
      }
      await page.locator('[name=explicitJapan]').check();
      await page.locator('[name=q]').fill('Prolific');
      assert.deepEqual(await page.locator('[data-record]:visible').evaluateAll(items=>items.map(x=>x.dataset.record)),['prolific']);
      if (await page.locator('.active-filters').count()) {
        assert.equal(await page.locator('.active-filters li').count(),2);
        await page.locator('[name=q]').fill('this cannot match any listing');
        assert.equal(await page.locator('[data-empty]').isVisible(),true);
        await page.locator('button[type=reset]').click();
        await page.waitForFunction(() => document.activeElement.name === 'q');
        assert.equal(await page.locator('.active-filters').isVisible(),false);
        assert.equal(await page.locator('[data-empty]').isVisible(),false);
        await page.locator('[name=q]').fill('Prolific');
      }
      await page.locator('[data-record="prolific"] h3 a').click();
      await page.locator('header .language').click();
      assert.match(page.url(),lang==='ja'?/\/en\/opportunities\/prolific\/$/:/\/ja\/opportunities\/prolific\/$/);
      await page.goto(`${base}/${lang}/sweepstakes/`);
      const snsFree = page.locator('[name=noSns]');
      if (await snsFree.count()) {
        const records = data.records.filter(row => row.category === 'sweepstakes' &&
          (!row.deadline || Date.parse(row.deadline) > Date.now()) && row.application?.sns_required === false);
        const visibleIds = () => page.locator('[data-record]:visible')
          .evaluateAll(items => items.map(item => item.dataset.record).sort());
        const sweepstakesOptions = page.locator('.filter-options summary');
        if (await sweepstakesOptions.count()) await sweepstakesOptions.click();
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
