const panel = document.querySelector('[data-analytics-id]');
const dialog = document.querySelector('#analytics-dialog');
const key = 'reward-radar-analytics-v1';
const id = panel.dataset.analyticsId;
const disableKey = 'ga-disable-' + id;
const canonical = new URL(document.querySelector('link[rel="canonical"]').href);
const page = document.querySelector('[data-analytics-opportunity]');
const locale = document.documentElement.lang;
let running = false;
let choice = readChoice();

function readChoice() {
  try {
    const value = localStorage.getItem(key);
    return value === 'accept' || value === 'reject' ? value : null;
  } catch {
    return null;
  }
}

function referrerGroup(referrer) {
  if (!referrer) return 'direct_or_unknown';
  try {
    const source = new URL(referrer);
    if (source.origin === location.origin) return 'internal';
    if (['www.google.com','www.google.co.jp','www.bing.com','duckduckgo.com',
      'search.yahoo.com','search.yahoo.co.jp'].includes(source.hostname)) return 'search';
    if (['x.com','t.co','twitter.com','www.facebook.com','l.facebook.com','www.instagram.com',
      'l.instagram.com','www.threads.com','www.reddit.com','bsky.app','www.linkedin.com',
      'lnkd.in','www.youtube.com'].includes(source.hostname)) return 'social';
    return 'other_referral';
  } catch {
    return 'direct_or_unknown';
  }
}

function start() {
  // The tag may read browser URLs itself. Skip URLs with arbitrary query or fragment values.
  if (running || choice !== 'accept' || canonical.pathname !== location.pathname ||
      location.search || (location.hash && location.hash !== '#main')) return;
  running = true;
  window[disableKey] = false;
  const common = {
    page_location: location.origin + canonical.pathname,
    // A nonempty, site-owned value prevents a fallback to the raw referrer.
    page_referrer: location.origin + '/',
    site_language: locale,
    page_group: page?.dataset.analyticsCategory || 'site',
    ...(page ? {opportunity_id: page.dataset.analyticsOpportunity} : {}),
  };
  window.dataLayer = [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  const consent = {ad_storage:'denied', ad_user_data:'denied', ad_personalization:'denied'};
  // The tag can emit a default page view during startup. Set safe URLs first.
  gtag('set', {...common, send_page_view:false});
  gtag('consent', 'default', {...consent, analytics_storage:'denied'});
  gtag('consent', 'update', {...consent, analytics_storage:'granted'});
  gtag('js', new Date());
  gtag('config', id, {
    send_page_view:false,
    allow_google_signals:false,
    allow_ad_personalization_signals:false,
    cookie_domain:location.hostname,
    cookie_flags: 'SameSite=Lax;Secure',
    cookie_expires: 60 * 60 * 24 * 90,
    cookie_update:false,
    ignore_referrer:true,
  });
  gtag('event', 'page_view', {...common, traffic_group:referrerGroup(document.referrer), send_to:id});

  // A primary or keyboard click fires click. A middle click fires auxclick.
  function outbound(event) {
    if (!running || !event.isTrusted || event.defaultPrevented ||
        (event.type === 'auxclick' ? event.button !== 1 : event.button !== 0)) return;
    const link = event.target.closest?.('a[data-analytics-click]');
    if (!link || link.closest('[hidden]')) return;
    const name = link.dataset.analyticsClick;
    const placement = link.closest('[data-analytics-affiliate]')?.dataset.analyticsAffiliate;
    if (name === 'affiliate_click' && placement) {
      gtag('event', name, {...common, page_group:'affiliate-placement', opportunity_id:placement, send_to:id});
    } else if (page && (name === 'application_click' || name === 'affiliate_click')) {
      gtag('event', name, {...common, send_to:id});
    }
  }
  document.addEventListener('click', outbound);
  document.addEventListener('auxclick', outbound);
  const script = document.createElement('script');
  script.async = true;
  script.referrerPolicy = 'no-referrer';
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
  document.head.append(script);
}

function disable(reload) {
  window[disableKey] = true;
  if (!running) return;
  running = false;
  const names = ['_ga', '_ga_' + id.slice(2)];
  for (const name of names) {
    for (const domain of ['', '; Domain=' + location.hostname]) {
      document.cookie = name + '=; Max-Age=0; Path=/; SameSite=Lax; Secure' + domain;
    }
  }
  // A reload removes the executed third-party script and all of its listeners.
  if (reload) location.reload();
}

function showChoice() {
  panel.hidden = choice !== null;
  for (const status of dialog.querySelectorAll('[data-analytics-status]')) {
    status.hidden = status.dataset.analyticsStatus !== (choice || 'unset');
  }
}

function setChoice(value) {
  choice = value;
  let saved = false;
  try {
    localStorage.setItem(key, value);
    saved = true;
  } catch {
    // If storage cannot be written, acceptance stays disabled on this page.
  }
  showChoice();
  dialog.close();
  if (value === 'reject') disable(saved);
  else if (saved) start();
}

for (const button of document.querySelectorAll('[data-analytics-choice]')) {
  button.addEventListener('click', () => setChoice(button.dataset.analyticsChoice));
}
for (const button of document.querySelectorAll('[data-analytics-settings]')) {
  button.addEventListener('click', () => dialog.showModal());
}
dialog.querySelector('[data-analytics-close]').addEventListener('click', () => dialog.close());
window.addEventListener('storage', event => {
  if ((event.key === key || event.key === null) && readChoice() !== 'accept') {
    choice = readChoice();
    showChoice();
    disable(true);
  }
});
window.addEventListener('pageshow', event => {
  if (event.persisted && readChoice() !== 'accept') {
    choice = readChoice();
    showChoice();
    disable(true);
  }
});
showChoice();
if (choice === 'accept') start();
else disable(false);
