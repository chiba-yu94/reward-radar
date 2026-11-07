import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base = process.env.TEST_ORIGIN || 'http://127.0.0.1:8787';
const phase = process.env.QA_PHASE || 'after';
const out = process.env.QA_OUTPUT || 'var/ux-rework';
await mkdir(out,{recursive:true});
const browser = await chromium.launch({channel:'chrome'});
const measurements = [];
try {
  for (const width of [375,390,768,1440]) for (const lang of ['ja','en']) {
    const context = await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce',deviceScaleFactor:1});
    const page = await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
    const paths = [['home',''],['directory','opportunities/'],['sweepstakes','sweepstakes/'],['detail','opportunities/club-sunstar-november-2026/'],['freecash','opportunities/freecash/'],['rewards',phase==='before'?'affiliates/':'rewards/'],['contact','contact/'],['about','about/']];
    for (const [name,path] of paths) {
      assert.equal((await page.goto(`${base}/${lang}/${path}`)).status(),200);
      if (name==='home' && await page.locator('.analytics-notice').isVisible()) {
        await page.screenshot({path:`${out}/${phase}-${lang}-${width}-consent.png`});
        if(phase!=='before') assert.ok((await page.locator('.analytics-notice').boundingBox()).height<190,'consent height');
        await page.locator('.analytics-notice [data-analytics-choice=reject]').click();
      }
      if (name==='directory') { await page.locator('#filters').waitFor({state:'visible'}); if(phase!=='before') await page.waitForFunction(()=>document.querySelector('#filters').getAttribute('aria-busy')==='false'); }
      const measure=await page.evaluate(()=>({height:document.documentElement.scrollHeight,overflow:document.documentElement.scrollWidth>innerWidth,header:document.querySelector('.masthead').getBoundingClientRect().height,firstCard:document.querySelector('.card')?.getBoundingClientRect().top,cta:document.querySelector('.entry-action')?.getBoundingClientRect().top,nav:!!document.querySelector('.desktop-nav')&&getComputedStyle(document.querySelector('.desktop-nav')).display!=='none'}));
      measurements.push({lang,width,name,...measure});
      if(phase!=='before') {
        assert.equal(measure.overflow,false,`${lang} ${width} ${name}`);
        assert.ok(measure.header<=80,'compact header');
        if(width===1440) assert.equal(measure.nav,true,'desktop navigation visible');
        if(name==='home') assert.ok(measure.firstCard<600,'real listing in first view');
        if(name==='detail') assert.ok(measure.cta<750,'early application CTA');
        if(name==='freecash') assert.ok(measure.cta<800,'early affiliate CTA');
      }
      await page.screenshot({path:`${out}/${phase}-${lang}-${width}-${name}.png`,fullPage:['detail','freecash','contact','about'].includes(name)});
    }
    if(phase!=='before') {
      await page.goto(`${base}/${lang}/`);
      await page.locator('#home-query').fill('Freecash');
      await page.locator('.home-search button').click();
      await page.locator('#filters').waitFor({state:'visible'}); if(phase!=='before') await page.waitForFunction(()=>document.querySelector('#filters').getAttribute('aria-busy')==='false');
      assert.equal(await page.locator('[name=q]').inputValue(),'Freecash');
      assert.deepEqual(await page.locator('[data-record]:visible').evaluateAll(items=>items.map(x=>x.dataset.record)),['freecash']);
      const cases=lang==='ja'?['懸賞','お米','Freecash','SNS不要','タスク報酬']:['sweepstakes','rice','United States','Freecash','no social media'];
      for(const q of cases) {
        await page.locator('[name=q]').fill(q);
        assert.ok(Number(await page.locator('#result-count').textContent())>0,q);
      }
      await page.locator('[type=reset]').click();
      await page.locator('[name=noSns]').check();
      await page.locator('[name=freeEntry]').check();
      assert.match(page.url(),/noSns=yes/);
      assert.match(page.url(),/freeEntry=yes/);
      const ids=()=>page.locator('[data-record]:visible').evaluateAll(items=>items.map(x=>x.dataset.record));
      const selected=await ids();
      await page.reload();await page.locator('#filters').waitFor({state:'visible'}); if(phase!=='before') await page.waitForFunction(()=>document.querySelector('#filters').getAttribute('aria-busy')==='false');assert.deepEqual(await ids(),selected);
      const response=await page.goto(page.url()+'&invalid=secret&category=doesnotexist');await page.locator('#filters').waitFor({state:'visible'}); if(phase!=='before') await page.waitForFunction(()=>document.querySelector('#filters').getAttribute('aria-busy')==='false');
      assert.equal(response.headers()['x-robots-tag'],'noindex, follow');assert.deepEqual(await ids(),selected);
      await page.locator('.filter-options summary').click();
      await page.locator('[data-show-results]').click();
      assert.equal(await page.locator('.filter-options').getAttribute('open'),null);
      assert.equal(await page.evaluate(()=>document.activeElement.id),'listing-results');
      await page.locator('[type=reset]').click();
      await page.locator('[name=q]').fill('xyzzy-never-matches');assert.equal(await page.locator('[data-empty]').isVisible(),true);
      if(width<1024){await page.locator('.site-menu summary').click();assert.equal(await page.locator('.site-menu nav').isVisible(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('.site-menu nav').isVisible(),false);}
      assert.deepEqual(errors,[],`${lang} ${width}: console/runtime errors`);
    }
    await context.close();
    console.log(`${phase}: ${lang} ${width}px — 8 page types and UX checks passed`);
  }
  if(phase!=='before') {
    const expiryPage = await browser.newPage();
    await expiryPage.clock.install({time:new Date('2026-12-08T00:00:00Z')});
    await expiryPage.goto(base + '/ja/opportunities/freecash/');
    assert.equal(await expiryPage.locator('.entry-action').isVisible(),false,'expired sponsor CTA hidden');
    await expiryPage.goto(base + '/ja/opportunities/');
    await expiryPage.waitForFunction(()=>document.querySelector('#filters').getAttribute('aria-busy')==='false');
    assert.equal(await expiryPage.locator('[data-record=freecash]').isVisible(),false,'expired sponsor card hidden');
    await expiryPage.close();
  }
  await writeFile(`${out}/${phase}-measurements.json`,JSON.stringify(measurements,null,2));
} finally {await browser.close()}
