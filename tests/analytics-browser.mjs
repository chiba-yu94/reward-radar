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
    const landing = pageUrl + '?utm_source=review&utm_campaign=private%40example.invalid&email=private%40example.invalid#main';
    if (configured) {
      const fresh = await browser.newContext();
      const requests = [];
      await fresh.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(origin + '/')) return route.continue();
        requests.push(url);
        return route.fulfill({contentType:'application/javascript',body:'window.analyticsTestTagLoaded = true;'});
      });
      const first = await fresh.newPage();
      await first.goto(landing);
      await first.locator('[data-analytics-id]').waitFor({state:'visible'});
      assert.deepEqual(requests,[]);
      await first.locator('[data-analytics-id] [data-analytics-choice="accept"]').click();
      await first.waitForFunction(() => window.analyticsTestTagLoaded === true);
      assert.equal(requests.length,1);
      assert.ok(requests[0].startsWith(tag + '?id='));
      assert.equal(await first.evaluate(() => window.dataLayer.filter(args => args[1] === 'page_view').length),1);
      await fresh.close();
    }
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
    const response = await page.goto(pageUrl + '?utm_source=first-visit');
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

    const {records} = await (await context.request.get(origin + '/opportunities.json')).json();

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

    await page.goto(landing, {referer:'https://www.google.com/search?q=private@example.invalid'});
    await settings.click();
    await dialog.locator('[data-analytics-choice="accept"]').click();
    await page.waitForFunction(() => window.analyticsTestTagLoaded === true);
    assert.equal(calls.filter(url => url.startsWith(tag)).length,1);
    assert.equal(page.url(),landing);
    const queued = () => page.evaluate(() => window.dataLayer.map(args => Array.from(args)));
    const [[set, safeDefaults]] = await queued();
    assert.equal(set, 'set');
    assert.equal(safeDefaults.page_location, pageUrl);
    assert.equal(safeDefaults.page_referrer, origin + '/');
    assert.equal(safeDefaults.send_page_view, false);
    const config = (await queued()).find(args => args[0] === 'config')[2];
    assert.equal(config.page_location,pageUrl);
    assert.equal(config.page_referrer,origin + '/');
    assert.equal(config.ignore_referrer,true);
    assert.equal(config.send_page_view,false);
    assert.equal(config.allow_google_signals,false);
    const views = (await queued()).filter(args => args[0] === 'event' && args[1] === 'page_view');
    assert.equal(views.length,1);
    assert.equal(views[0][2].site_language,lang);
    assert.equal(views[0][2].page_group,'research');
    assert.equal(views[0][2].traffic_group,'search');
    assert.equal(views[0][2].page_location,pageUrl);
    assert.doesNotMatch(JSON.stringify([await queued(), calls]),/private(?:@|%40)example|utm_|search\?q|#main/);

    const application = page.locator('[data-analytics-click="application_click"]');
    const officialUrl = await application.getAttribute('href');
    assert.equal(officialUrl,records.find(row => row.id === 'prolific').official_url);
    const [officialPage] = await Promise.all([context.waitForEvent('page'), application.click()]);
    await officialPage.waitForURL(officialUrl);
    await page.waitForFunction(() => window.dataLayer.some(event => event[1] === 'application_click'));
    const clicks = (await queued()).filter(args => args[0] === 'event' && args[1] === 'application_click');
    assert.equal(clicks.length,1);
    assert.equal(clicks[0][2].opportunity_id,'prolific');
    assert.equal(clicks[0][2].page_group,'research');
    assert.equal(clicks[0][2].site_language,lang);
    assert.doesNotMatch(JSON.stringify(clicks),/prolific\.com|private@example|utm_/);

    await page.reload();
    await page.waitForFunction(() => window.analyticsTestTagLoaded === true);
    assert.equal((await queued()).filter(args => args[1] === 'page_view').length,1);
    calls.length = 0;
    await page.goto(pageUrl + '?q=private@example.invalid#private-fragment');
    assert.deepEqual(calls,[]);
    assert.equal(await page.evaluate(() => typeof window.gtag),'undefined');

    const directory = origin + '/' + lang + '/opportunities/';
    await page.goto(directory + '?q=Prolific&utm_medium=review');
    await page.locator('#filters').waitFor({state:'visible'});
    assert.equal(await page.locator('[name=q]').inputValue(),'Prolific');
    assert.equal((await queued()).find(args => args[1] === 'page_view')[2].page_location,directory);
    await page.locator('[name=q]').fill('Prolific');
    await page.evaluate(() => history.replaceState(null,'','?q=private@example.invalid'));
    const cardLink = page.locator('[data-record="prolific"] [data-analytics-click="application_click"]');
    await cardLink.click();
    const cardEvent = (await queued()).find(args => args[0] === 'event' && args[1] === 'application_click');
    assert.equal(cardEvent[2].opportunity_id,'prolific');
    assert.doesNotMatch(JSON.stringify(cardEvent),/prolific\.com|private@example|Prolific/);

    const guide = origin + '/' + lang + '/sweepstakes/';
    await page.goto(guide + '?utm_source=review#no-sns-giveaways');
    await page.waitForFunction(() => window.analyticsTestTagLoaded === true);
    assert.equal((await queued()).find(args => args[1] === 'page_view')[2].page_location,guide);

    const affiliatePage = origin + '/' + lang + '/opportunities/freecash/';
    if ((await page.goto(affiliatePage + '?utm_source=review')).status() === 200) {
      const sponsored = page.locator('[data-analytics-click="affiliate_click"]');
      const destination = await sponsored.getAttribute('href');
      assert.equal(destination,records.find(row => row.id === 'freecash').affiliate_url);
      assert.equal(await sponsored.getAttribute('target'),'_blank');
      assert.equal(await sponsored.getAttribute('rel'),'sponsored nofollow noopener noreferrer');
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
      assert.equal(affiliate[0][2].page_group,'affiliate');
      assert.equal(affiliate[0][2].site_language,lang);
      assert.doesNotMatch(JSON.stringify(affiliate),/pxf\.io|freecash\.com|user_id|utm_/);

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
      // The same approved link appears on consumer cards without requiring a detail-page visit.
      for (const path of ['', 'rewards/', 'opportunities/']) {
        await page.goto(origin + '/' + lang + '/' + path);
        const card = page.locator('[data-record="freecash"]');
        const cardLink = card.locator('[data-analytics-click="affiliate_click"]');
        assert.equal(await cardLink.getAttribute('href'),destination);
        assert.equal(await cardLink.getAttribute('target'),'_blank');
        assert.equal(await cardLink.getAttribute('rel'),'sponsored nofollow noopener noreferrer');
        async function openCard() {
          const [opened] = await Promise.all([context.waitForEvent('page'),cardLink.click()]);
          await opened.waitForURL(destination);
          await opened.close();
        }
        const running = await page.evaluate(() => typeof window.gtag === 'function');
        await settings.click();
        if (running) await Promise.all([page.waitForEvent('domcontentloaded'),dialog.locator('[data-analytics-choice="reject"]').click()]);
        else await dialog.locator('[data-analytics-choice="reject"]').click();
        calls.length = 0;
        await openCard();
        assert.deepEqual(calls,[]);
        await page.evaluate(() => localStorage.removeItem('reward-radar-analytics-v1'));
        await page.reload();
        await banner.waitFor({state:'visible'});
        await openCard();
        assert.deepEqual(calls,[]);
        await banner.locator('[data-analytics-choice="accept"]').click();
        await openCard();
        const event = (await queued()).filter(args => args[0] === 'event' && args[1] === 'affiliate_click');
        assert.equal(event.length,1);
        assert.equal(event[0][2].opportunity_id,'freecash');
        assert.equal(event[0][2].page_group,'affiliate');
        assert.equal(event[0][2].site_language,lang);
        assert.doesNotMatch(JSON.stringify(event),/pxf\.io|freecash\.com|private@example/);
        await settings.click();
        await Promise.all([page.waitForEvent('domcontentloaded'),dialog.locator('[data-analytics-choice="reject"]').click()]);
        calls.length = 0;
        await openCard();
        assert.deepEqual(calls,[]);
        console.log(lang + ': ' + (path || 'home') + ' card: correct attribution after consent; no measurement before consent, after rejection or withdrawal');
      }
      await settings.click();
      await dialog.locator('[data-analytics-choice="accept"]').click();

    }

    await page.goto(origin + '/' + lang + '/');
    const placement = page.locator('[data-analytics-affiliate="hapitas-referral"]');
    if (!await placement.count()) {
      // Exercise a standalone placement even when the referral is disabled.
      await page.evaluate(() => {
        const fixture = document.createElement('aside');
        fixture.dataset.analyticsAffiliate = 'hapitas-referral';
        fixture.innerHTML = '<a href="https://example.invalid/" target="_blank" data-analytics-click="affiliate_click">Test placement</a>';
        document.querySelector('main').prepend(fixture);
      });
    }
    const referral = placement.locator('a[data-analytics-click="affiliate_click"]');
    if (process.env.HAPITAS_REFERRAL_URL) {
      assert.equal(await referral.getAttribute('href'),process.env.HAPITAS_REFERRAL_URL);
      assert.equal(await referral.getAttribute('target'),'_blank');
      assert.equal(await referral.getAttribute('rel'),'sponsored nofollow noopener noreferrer');
    }
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
    console.log(lang + ': query landing, consent, rejection, withdrawal, application event and referral event passed');
    await context.close();
  }
} finally {
  await browser.close();
}
