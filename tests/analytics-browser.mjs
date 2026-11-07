import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:8787';
const configured = process.env.EXPECT_GA4 === '1';
const tag = 'https://www.googletagmanager.com/gtag/js';
const google = /https:\/\/[^/]*(?:googletagmanager|google-analytics|analytics\.google|doubleclick|googlesyndication)\./;
const browser = await chromium.launch({channel:'chrome', executablePath:process.env.CHROME_BIN || undefined});
try {
  for (const lang of ['ja', 'en']) {
    const pageUrl = origin + '/' + lang + '/opportunities/prolific/';
    const calls = [];
    const context = await browser.newContext({viewport:{width:375,height:850}});
    context.on('request', request => {
      if (google.test(request.url())) calls.push(request.url());
    });
    // Keep all test events off real networks, including if a tag is accidentally added.
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith(origin + '/')) return route.continue();
      if (url.startsWith(tag)) return route.fulfill({
        contentType:'application/javascript', body:'window.analyticsTestTagLoaded = true;',
      });
      return route.fulfill({status:200,body:'Test destination'});
    });
    const page = await context.newPage();
    const response = await page.goto(pageUrl);
    assert.equal(response.status(),200);
    const csp = response.headers()['content-security-policy'];
    assert.match(csp,/frame-ancestors 'none'/);
    const banner = page.locator('[data-analytics-id]');
    const dialog = page.locator('#analytics-dialog');
    const settings = page.locator('footer [data-analytics-settings]');
    const privacy = page.locator(`footer a[href="/${lang}/privacy/"]`);
    assert.equal(await privacy.count(),1);

    if (!configured) {
      assert.equal(await banner.count(),0);
      assert.doesNotMatch(csp,/googletagmanager|google-analytics/);
      await privacy.click();
      assert.equal(await page.locator('h1').count(),1);
      assert.deepEqual(calls,[]);
      console.log(lang + ': disabled, no Google requests');
      await context.close();
      continue;
    }

    await banner.waitFor({state:'visible'});
    assert.match(csp,/script-src 'self' https:\/\/www\.googletagmanager\.com\/gtag\//);
    assert.doesNotMatch(csp,/unsafe-inline|doubleclick|googlesyndication/);
    assert.deepEqual(calls,[]);
    await banner.locator('[data-analytics-choice="reject"]').click();
    await page.reload();
    await banner.waitFor({state:'hidden'});
    await settings.click();
    await dialog.locator('[data-analytics-status="reject"]').waitFor({state:'visible'});
    assert.deepEqual(calls,[]);
    await dialog.locator('[data-analytics-close]').click();
    await dialog.waitFor({state:'hidden'});
    const rejectedLink = page.locator('[data-analytics-click="application_click"]');
    await rejectedLink.click();
    assert.deepEqual(calls,[]);

    // Even after opt-in, a page URL with private query or fragment data is not measured.
    await page.goto(pageUrl + '?gtm_debug=1');
    await settings.click();
    await dialog.locator('[data-analytics-choice="accept"]').click();
    assert.deepEqual(calls,[]);
    await page.goto(pageUrl + '?q=private@example.invalid#name');
    assert.deepEqual(calls,[]);

    await page.goto(pageUrl, {referer:'https://www.google.com/search?q=private@example.invalid'});
    await page.waitForFunction(() => window.analyticsTestTagLoaded === true);
    assert.equal(calls.filter(url => url.startsWith(tag)).length,1);
    const queued = () => page.evaluate(() => window.dataLayer.map(args => Array.from(args)));
    const [[set, safeDefaults]] = await queued();
    assert.equal(set, 'set');
    assert.equal(safeDefaults.page_location, pageUrl);
    assert.equal(safeDefaults.page_referrer, origin + '/');
    assert.equal(safeDefaults.send_page_view, false);
    const config = (await queued()).find(args => args[0] === 'config')[2];
    assert.equal(config.send_page_view,false);
    assert.equal(config.allow_google_signals,false);
    const views = (await queued()).filter(args => args[0] === 'event' && args[1] === 'page_view');
    assert.equal(views.length,1);
    assert.equal(views[0][2].site_language,lang);
    assert.equal(views[0][2].traffic_group,'search');
    assert.equal(views[0][2].page_location,pageUrl);
    assert.doesNotMatch(JSON.stringify(await queued()),/private@example|search\?q/);

    const application = page.locator('[data-analytics-click="application_click"]');
    const officialUrl = await application.getAttribute('href');
    const [officialPage] = await Promise.all([context.waitForEvent('page'), application.click()]);
    await officialPage.waitForURL(officialUrl);
    await page.waitForFunction(() => window.dataLayer.some(event => event[1] === 'application_click'));
    const clicks = (await queued()).filter(args => args[0] === 'event' && args[1] === 'application_click');
    assert.equal(clicks.length,1);
    assert.equal(clicks[0][2].opportunity_id,'prolific');
    assert.doesNotMatch(JSON.stringify(clicks),/prolific\.com/);

    await page.goto(origin + '/' + lang + '/opportunities/');
    await page.locator('[name=q]').fill('Prolific');
    await page.evaluate(() => history.replaceState(null,'','?q=private@example.invalid'));
    const cardLink = page.locator('[data-record="prolific"] [data-analytics-click="application_click"]');
    await cardLink.click();
    const cardEvent = (await queued()).find(args => args[0] === 'event' && args[1] === 'application_click');
    assert.equal(cardEvent[2].opportunity_id,'prolific');
    assert.doesNotMatch(JSON.stringify(cardEvent),/prolific\.com|private@example|Prolific/);

    const affiliatePage = origin + '/' + lang + '/opportunities/freecash/';
    if ((await page.goto(affiliatePage)).status() === 200) {
      const sponsored = page.locator('[data-analytics-click="affiliate_click"]');
      const destination = await sponsored.getAttribute('href');
      async function openSponsored() {
        const [opened] = await Promise.all([context.waitForEvent('page'), sponsored.click()]);
        await opened.waitForURL(destination);
        await opened.close();
      }
      await openSponsored();
      const affiliate = (await queued()).filter(args => args[0] === 'event' && args[1] === 'affiliate_click');
      assert.equal(affiliate.length,1);
      assert.deepEqual(Object.keys(affiliate[0][2]).sort(),
        ['opportunity_id','page_group','page_location','page_referrer','send_to','site_language']);
      assert.equal(affiliate[0][2].opportunity_id,'freecash');
      assert.equal(affiliate[0][2].site_language,lang);
      assert.doesNotMatch(JSON.stringify(affiliate),/pxf\.io|freecash\.com|user_id/);

      calls.length = 0;
      await settings.click();
      await Promise.all([page.waitForEvent('domcontentloaded'),dialog.locator('[data-analytics-choice="reject"]').click()]);
      await openSponsored();
      assert.equal(await page.evaluate(() => typeof window.gtag),'undefined');
      assert.deepEqual(calls,[]);
      await page.evaluate(() => localStorage.removeItem('reward-radar-analytics-v1'));
      await page.reload();
      await banner.waitFor({state:'visible'});
      await openSponsored();
      assert.deepEqual(calls,[]);
      await banner.locator('[data-analytics-choice="reject"]').click();
      await openSponsored();
      assert.deepEqual(calls,[]);
      await settings.click();
      await dialog.locator('[data-analytics-choice="accept"]').click();
      console.log(lang + ': Freecash link navigates before consent, after rejection and after withdrawal; consented event has only approved fields');
    }

    await page.goto(origin + '/' + lang + '/');
    const placement = page.locator('[data-analytics-affiliate="hapitas-referral"]');
    if (!await placement.count()) {
      // Exercise a standalone placement even when the referral is disabled.
      await page.evaluate(() => {
        const fixture = document.createElement('aside');
        fixture.dataset.analyticsAffiliate = 'hapitas-referral';
        fixture.innerHTML = '<a href="https://example.invalid/" data-analytics-click="affiliate_click">Test placement</a>';
        document.querySelector('main').prepend(fixture);
      });
    }
    const referral = placement.locator('a[data-analytics-click="affiliate_click"]');
    await referral.evaluate(link => link.target = '_blank');
    await referral.click();
    const referralClicks = (await queued()).filter(args => args[0] === 'event' && args[1] === 'affiliate_click');
    assert.equal(referralClicks.length,1);
    assert.equal(referralClicks[0][2].opportunity_id,'hapitas-referral');
    assert.equal(referralClicks[0][2].site_language,lang);
    assert.doesNotMatch(JSON.stringify(referralClicks),/hapitas\.jp|example\.invalid/);

    calls.length = 0;
    await settings.click();
    await Promise.all([
      page.waitForEvent('domcontentloaded'),
      dialog.locator('[data-analytics-choice="reject"]').click(),
    ]);
    await settings.click();
    await dialog.locator('[data-analytics-status="reject"]').waitFor({state:'visible'});
    assert.deepEqual(calls,[]);
    assert.equal(await page.evaluate(() => typeof window.gtag), 'undefined');
    console.log(lang + ': no requests before consent, on rejection or after withdrawal; one application event and one referral event');
    await context.close();
  }
} finally {
  await browser.close();
}
