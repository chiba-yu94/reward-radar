import {readFile, mkdir, writeFile, copyFile, rm, cp, readdir, mkdtemp} from 'node:fs/promises';
import {resolve, relative} from 'node:path';
import {copy, email, languages, verifyLocales} from './locales.mjs';
import {date, expiration, expired, money, ordered, stale, freshness, verifiedJapanGiveaway} from './domain.mjs';

import {dateCopy} from './status.mjs';
import {validatePublic} from './quality.mjs';
import {publicEditorial} from './editorial.mjs';
import {calendarEvent} from './calendar.mjs';
import {feedPath, feedType, publicationDates, renderFeed} from './feed.mjs';

verifyLocales();
const configured = process.env.SITE_ORIGIN;
const origin = new URL(configured || 'http://localhost:8787');
const productionOrigin = 'https://freebietrail.com';
const legacyOrigin = 'https://reward-radar.rewardradar42.workers.dev';
if (configured && ![productionOrigin, legacyOrigin].includes(configured)) throw new Error('Unrecognized SITE_ORIGIN');
const publisher = process.env.ADSENSE_VERIFICATION_ID || '';
if (publisher && !/^ca-pub-\d{16}$/.test(publisher)) throw new Error('Invalid AdSense verification ID');
const adsenseMeta = publisher && configured === productionOrigin
  ? `<meta name="google-adsense-account" content="${publisher}">` : '';
const impactVerification = process.env.IMPACT_VERIFICATION_ID || '';
if (impactVerification && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(impactVerification)) {
  throw new Error('Invalid Impact verification ID');
}
const impactMeta = impactVerification && configured === productionOrigin
  ? `<meta name="impact-site-verification" value="${impactVerification}">` : '';
const measurementId = process.env.GA4_MEASUREMENT_ID || '';
if (measurementId && !/^G-[A-Z0-9]{4,20}$/.test(measurementId)) throw new Error('Invalid GA4 measurement ID');
const analytics = measurementId && process.env.GA4_PRIVACY_READY === 'true' ? measurementId : '';
if (measurementId && !analytics) console.warn('GA4 is disabled pending the property privacy setup');
const hapitasDeadline = '2026-11-30T15:00:00Z';
const hapitasUrl = process.env.HAPITAS_REFERRAL_APPROVED === 'true' && process.env.HAPITAS_REFERRAL_URL
  ? process.env.HAPITAS_REFERRAL_URL : '';
if (hapitasUrl && !/^https:\/\/(?:sp\.)?hapitas\.jp\/register\?i=[A-Za-z0-9_-]{1,128}(?:&route=[A-Za-z0-9_-]{1,40})?$/.test(hapitasUrl)) {
  throw new Error('Invalid Hapitas referral URL');
}
const dataset = JSON.parse(await readFile('var/published.json', 'utf8'));
const now = process.env.QA_NOW ? Date.parse(process.env.QA_NOW) : Date.now();
if (!Number.isFinite(now)) throw new Error('Invalid QA_NOW');
validatePublic(dataset,JSON.parse(await readFile('data/taxonomy.json','utf8')),now);
const rssDates = publicationDates(JSON.parse(await readFile('data/rss-publications.json','utf8')));
const wasPublished = id => languages.some(lang => rssDates.get(lang + '/quests/' + id) <= now);
const editorial = publicEditorial(JSON.parse(await readFile('data/editorial.json','utf8')),now,wasPublished);
const guideLocales = languages.filter(lang => editorial.guides.some(entry => entry.locales.includes(lang)));
const editorialEntries = [...editorial.quests,...editorial.endedQuests,...editorial.staleQuests];
const redirects = [];
function redirectPage(from, to) {
  redirects.push(from + ' ' + to + ' 301',from.slice(0,-1) + ' ' + to + ' 301');
}
const taskService = row => row.category === 'affiliate' && !row.commission;
const sponsoredLink = row => row.affiliate_approval_status === 'approved' && row.affiliate_url &&
  Date.parse(row.affiliate_expires_at) > now;
const rows = ordered(dataset.records.filter(row => !expired(row, now) &&
  (!(taskService(row) || row.affiliate_url) || sponsoredLink(row))), now);
const regularIds = new Set(dataset.records.map(row => row.id));
for (const entry of editorialEntries) {
  if (regularIds.has(entry.id)) throw new Error('Duplicate opportunity detail: ' + entry.id);
}
const destination = resolve('dist');
await mkdir('var', {recursive:true});
const dist = await mkdtemp(resolve('var/site-build-'));
await mkdir(dist + '/assets', {recursive:true});
const write = (file, data) => writeFile(dist + '/' + file, data);
const iconVersion = '5cf2e8207d44';
const versionedIcon = path => path.replace(/\.([^.]+)$/, `-${iconVersion}.$1`);
const iconAssets = ['favicon.ico', 'apple-touch-icon.png', 'assets/mark.svg'];

for (const asset of ['style.css', 'client.mjs', 'domain.mjs', 'status.mjs', 'mark.svg', 'social.png', 'chevron.svg']) {
  await copyFile('site/' + asset, dist + '/assets/' + asset);
}
for (const asset of ['favicon.ico', 'apple-touch-icon.png']) {
  await copyFile('site/' + asset, dist + '/' + asset);
}
for (const icon of iconAssets) await copyFile(dist + '/' + icon, dist + '/' + versionedIcon(icon));
if (analytics) await copyFile('site/analytics.mjs', dist + '/assets/analytics.mjs');
const headers = await readFile('site/_headers', 'utf8');
const collection = 'https://www.google-analytics.com https://region1.google-analytics.com https://analytics.google.com';
const imageOrigins = new Set(rows.filter(row=>row.affiliate_banner).map(row=>new URL(row.affiliate_banner.src).origin));
if (imageOrigins.has('https://hbb.afl.rakuten.co.jp')) imageOrigins.add('https://ba.afl.rakuten.co.jp');
if (analytics) imageOrigins.add(collection);
const withImages = headers.replace("img-src 'self';", `img-src 'self'${imageOrigins.size ? ' ' + [...imageOrigins].join(' ') : ''};`);
await write('_headers', analytics ? withImages
  .replace("script-src 'self';", "script-src 'self' https://www.googletagmanager.com/gtag/;")
  .replace("connect-src 'self';", `connect-src 'self' ${collection} https://www.googletagmanager.com;`) : withImages);
await write('opportunities.json', JSON.stringify({...dataset, records:rows}));

export const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
}[char]));
const e = escape;
const url = (lang, page = '') => '/' + lang + '/' + (page ? page + '/' : '');
for (const lang of languages) redirectPage(url(lang,'quests'),url(lang,'opportunities'));
const alternates = (page, locales = languages) => locales.length < 2 ? [] : [
  ...locales.map(lang => [lang, url(lang,page)]), ['x-default', page ? url('en',page) : '/'],
];
const detail = (lang, row) => url(lang, 'opportunities/' + row.id);
function eligibilityTranslation(lang,key) {
  const other = lang === 'ja' ? 'en' : 'ja';
  return `<a href="${url(other,key)}" hreflang="${other}">${e(copy[lang].eligibilityTranslation)}</a>`;
}
const time = (value, lang, full = false, zone) => `<time datetime="${e(value)}">${e(date(value, lang, full, zone))}</time>`;
const address = `<a href="mailto:${email}">${email}</a>`;
const iconLinks = `<link rel="icon" href="${versionedIcon('/favicon.ico')}"><link rel="icon" type="image/svg+xml" href="${versionedIcon('/assets/mark.svg')}"><link rel="apple-touch-icon" sizes="180x180" href="${versionedIcon('/apple-touch-icon.png')}">`;
const brand = name => `<img src="${versionedIcon('/assets/mark.svg')}" alt="" width="32" height="32"><span>${e(name)}</span>`;
const primary = ['opportunities', 'recent', 'sweepstakes', 'rewards', 'international'];
const secondary = ['guaranteed', 'affiliates', 'ranking', 'about', 'contact', 'privacy', 'disclosure'];
const maps = [];
const localeFor = lang => lang === 'ja' ? 'ja-JP' : 'en';
const name = (lang, country) => new Intl.DisplayNames(localeFor(lang), {type:'region'}).of(country);
const format = (value, currency, lang) => money(value, currency, lang, copy[lang].varies);
const countryText = (row, lang) => {
  const t = copy[lang];
  if (!row.eligibility_verified) return t.unknown;
  if (row.eligible_countries === 'worldwide') return t.worldwide;
  return row.eligible_countries.map(country => name(lang, country)).join(lang === 'ja' ? '、' : ', ');
};
const amount = (row, lang) => {
  const value = format(row.reward_amount, row.reward_currency, lang);
  return row.reward_amount !== null && row.reward_type === 'points' && !row.reward_currency
    ? value + ' ' + copy[lang].rewards.points : value;
};
const fields = pairs => '<dl class="facts">' + pairs.map(([label, value]) =>
  `<div><dt>${e(label)}</dt><dd>${value}</dd></div>`).join('') + '</dl>';

function external(destination, label, event = null, context = '', banner = null) {
  const sponsored = event === 'affiliate_click';
  // Keep the listing open while GA4 dispatches a consented outbound click.
  const target = ' target="_blank"';
  const parsed = new URL(destination);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Unsafe destination');
  const classes = banner ? 'affiliate-banner' : `button ${sponsored ? 'sponsored-button' : ''}`;
  const content = banner ? `<img src="${e(banner.src)}" width="${banner.width}" height="${banner.height}" alt="${e(label)}" loading="lazy" decoding="async">` : e(label);
  return `<a class="${classes}" href="${e(destination)}"${context ? ` aria-label="${e(label + ' · ' + context)}"` : ''}${target} rel="${sponsored ? 'sponsored nofollow ' : ''}noopener noreferrer"${event && analytics ? ` data-analytics-click="${event}"` : ''}>${content}</a>`;
}

function consentControls(t, lang) {
  const c = t.analytics;
  const settings = `<button type="button" data-analytics-settings>${c.settings}</button>`;
  const choices = `<button type="button" data-analytics-choice="accept">${c.accept}</button>
<button type="button" data-analytics-choice="reject">${c.reject}</button>`;
  return {
    settings,
    panel: `<section class="analytics-notice wrap" data-analytics-id="${analytics}" aria-labelledby="analytics-title" hidden>
<h2 id="analytics-title" class="sr-only">${c.title}</h2><p>${c.summary} <a href="${url(lang,'privacy')}">${t.pages.privacy[0]}</a></p>
<div class="actions">${choices}${settings}</div></section>
<dialog id="analytics-dialog" aria-labelledby="analytics-settings-title">
<h2 id="analytics-settings-title">${c.settings}</h2><p>${c.details}</p>
<p data-analytics-status="accept" hidden>${c.allowed}</p><p data-analytics-status="reject" hidden>${c.denied}</p>
<p data-analytics-status="unset" hidden>${c.undecided}</p>
<div class="actions">${choices}<button type="button" data-analytics-close>${c.close}</button></div></dialog>`,
  };
}

function breadcrumbs(lang, section, title) {
  const t = copy[lang];
  const items = [[t.home, url(lang)], [t.pages[section][0], url(lang, section)]];
  return `<nav class="breadcrumbs" aria-label="${e(t.breadcrumbs)}">
<ol itemscope itemtype="https://schema.org/BreadcrumbList">${items.map(([label, href], index) => {
    const text = `<span itemprop="name">${e(label)}</span>`;
    return `<li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
${href ? `<a itemprop="item" href="${href}">${text}</a>` : `<span aria-current="page">${text}</span>`}
<meta itemprop="position" content="${index + 1}"></li>`;
  }).join('')}</ol></nav>`;
}

function layout(lang, page, title, description, content, indexable, mastheadControl, locales) {
  const t = copy[lang];
  const other = lang === 'ja' ? 'en' : 'ja';
  const current = url(lang, page);
  const consent = analytics ? consentControls(t,lang) : null;
  const contact = t.quest.organizerContact;
  const organizerContact = page === 'opportunities'
    ? `<p class="muted"><a href="mailto:${email}?subject=${encodeURIComponent(contact.subject)}&amp;body=${encodeURIComponent(contact.fields.map(field => field + ': ').join('\r\n'))}">${e(contact.link)}</a><br>${e(contact.note)}</p>`
    : '';
  const hasTranslation = locales.includes(other);
  const switcher = `<a class="language" aria-label="${e(hasTranslation ? t.switchLanguage : t.otherHome)}" href="${url(other, hasTranslation ? page : '')}" lang="${other}"${hasTranslation ? ` hreflang="${other}"` : ''}>${t.otherLanguage}</a>`;
  const links = keys => keys.map(key => `<a href="${url(lang, key)}"${key === page ? ' aria-current="page"' : ''}>${e(key === 'opportunities' ? t.allListings : key === 'sweepstakes' && lang === 'en' ? 'Giveaways' : key === 'international' && lang === 'en' ? 'International' : t.pages[key][0])}</a>`).join('');
  const name = e(t.copyright);
  const fullTitle = e(page ? title + ' | ' + t.copyright : t.copyright + ' · ' + title);
  if (indexable) maps.push({path:current, page, locales});
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title><meta name="description" content="${e(description)}">
${adsenseMeta}${impactMeta}
<meta name="author" content="${name}"><meta name="contact" content="${email}">
<meta name="robots" content="${configured && indexable ? 'index, follow' : 'noindex, follow'}">
<link rel="canonical" href="${origin.origin}${current}">
${alternates(page,locales).map(([locale,href]) => `<link rel="alternate" hreflang="${locale}" href="${origin.origin}${href}">`).join('\n')}${page === '' ? `\n<link rel="alternate" type="${feedType}" title="${e(t.rss.title)}" href="${feedPath(lang)}">` : ''}
<meta property="og:type" content="website"><meta property="og:site_name" content="${name}">
<meta property="og:title" content="${fullTitle}"><meta property="og:description" content="${e(description)}">
<meta property="og:locale" content="${lang === 'ja' ? 'ja_JP' : 'en_US'}">${hasTranslation ? `<meta property="og:locale:alternate" content="${other === 'ja' ? 'ja_JP' : 'en_US'}">` : ''}
<meta property="og:url" content="${origin.origin}${current}">
<meta property="og:image" content="${origin.origin}/assets/social.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">
${iconLinks}<link rel="stylesheet" href="/assets/style.css">
<script type="module" src="/assets/client.mjs"></script>
${consent ? '<script type="module" src="/assets/analytics.mjs"></script>' : ''}</head>
<body><a class="skip" href="#main">${t.skip}</a><header class="masthead"><div class="wrap header-inner${mastheadControl ? ' header-inner--residence' : ''}">
<a href="${url(lang)}" class="brand">${brand(t.copyright)}</a>${switcher}${mastheadControl}
<nav class="desktop-nav" aria-label="${e(t.navigation)}">${links(primary)}</nav><details class="site-menu"><summary>${t.menu}</summary><nav aria-label="${e(t.navigation)}">${links(primary)}</nav></details></div></header>
${consent?.panel || ''}
<main id="main" class="wrap"${page === '' ? ' itemscope itemtype="https://schema.org/WebSite"' : ''}>
${page === '' ? `<meta itemprop="name" content="${name}"><meta itemprop="url" content="${origin.origin}${current}"><meta itemprop="inLanguage" content="${lang}">
<div itemprop="publisher" itemscope itemtype="https://schema.org/Organization"><meta itemprop="name" content="${name}"><meta itemprop="email" content="${email}"></div>` : ''}
${content}</main>
<footer><div class="wrap foot-inner"><a href="${url(lang)}" class="brand">${brand(t.copyright)}</a>${organizerContact}
<nav aria-label="${e(t.footerNavigation)}">${links(['contact','privacy','disclosure'])}</nav>
<details class="footer-more"><summary>${e(t.footerMore)}</summary><nav aria-label="${e(t.footerMore)}">${links([...(guideLocales.includes(lang) ? ['guides'] : []),'guaranteed','affiliates','ranking','about'])}${switcher}</nav></details>
${consent?.settings || ''}<p class="muted">© ${t.copyright}</p></div></footer>
<div class="history-controls" data-history-controls hidden><div class="wrap" role="group" aria-label="${e(t.pageHistory.label)}">
<button type="button" aria-label="${e(t.pageHistory.back)}" title="${e(t.pageHistory.back)}">◀</button>
<button type="button" aria-label="${e(t.pageHistory.forward)}" title="${e(t.pageHistory.forward)}">▶</button>
</div></div></body></html>`;
}

const expiryValue = row => Number.isFinite(expiration(row)) ? new Date(expiration(row)).toISOString() : '';
const listingExpiry = row => `data-expiring="${e(expiryValue(row))}"${sponsoredLink(row) ? ` data-affiliate-expires="${e(row.affiliate_expires_at)}"` : ''}`;
const freshnessNotice = (row, lang) => `<p class="notice" data-stale="${e(row.stale_at)}" data-last-checked="${e(row.last_checked_at)}"${stale(row,now) ? '' : ' hidden'}>${stale(row,now) ? copy[lang].stale : ''}</p>`;
const elapsed = (row, lang) => `<span data-age data-last-checked="${e(row.last_checked_at)}">${freshness(row,now).days === null ? '' : dateCopy[lang].age(freshness(row,now).days)}</span>`;
const deadlineText = (row, lang) => row.deadline
  ? time(row.deadline,lang,!row.deadline_date_only, row.deadline_timezone ||
    (row.language === 'ja' ? 'Asia/Tokyo' : undefined)) : row.availability === 'ongoing' ? copy[lang].ongoing : copy[lang].noDeadline;
async function calendarLink(scope,row,lang,title,zone,uidScope = scope) {
  const path = url(lang,scope + '/' + row.id);
  const body = calendarEvent(row,{scope:uidScope,lang,title,zone,detailUrl:origin.origin + path,now});
  if (!body) return '';
  await mkdir(dist + path,{recursive:true});
  await write(path.slice(1) + 'deadline.ics',body);
  const jst = !row.deadline_date_only && zone !== 'Asia/Tokyo'
    ? ` · ${time(row.deadline,lang,true,'Asia/Tokyo')}` : '';
  return `<p class="small" data-expiring="${expiryValue(row)}" data-expire-when-stale="${e(row.last_checked_at)}">${jst ? copy[lang].calendarJst + jst + '<br>' : ''}<a href="${path}deadline.ics" download>${copy[lang].calendarAdd}</a></p>`;
}
const promotionText = (row, lang) => (row.promotion_countries || []).map(code => name(lang,code)).join(lang === 'ja' ? '、' : ', ');
const geoText = (countries, lang) => countries?.length > 4 ? (lang === 'ja' ? countries.length + 'の国・地域（詳細を確認）' : countries.length + ' countries / regions — see details') : countries?.length ? countries.map(code => name(lang,code)).join(lang === 'ja' ? '、' : ', ') : copy[lang].unknown;
const geography = (row, lang) => [[copy[lang].residency,e(compactCountries(row,lang))], ...(row.category === 'sweepstakes' ? [[copy[lang].shipping,e(geoText(row.shipping_countries,lang))]] : [[copy[lang].serviceCountries,e(geoText(row.service_countries,lang))]])];
const compactCountries = (row, lang) => row.eligibility_verified && Array.isArray(row.eligible_countries) && row.eligible_countries.length > 4
  ? (lang === 'ja' ? row.eligible_countries.length + 'の国・地域（詳細を確認）' : row.eligible_countries.length + ' countries / regions — see details') : countryText(row,lang);
const sourceLabel = (link, row, t) => /withdrawal|cash.?out/.test(link) ? t.sourcePayout : /privacy/.test(link) ? t.sourcePrivacy : /partner-advertiser/.test(link) ? t.sourcePolicy : /terms|rules|kiyaku|about-site|iframeView/.test(link) ? t.sourceTerms : link === row.source_url ? row.provider + (row.category === 'sweepstakes' ? ' · ' + t.sourceTerms : '') : t.sourceGuide + ' · ' + new URL(link).hostname;


function sponsoredServiceCard(row, lang) {
  const t = copy[lang];
  const freecash = row.id === 'freecash';
  const title = freecash ? 'Freecash' : row['title_' + lang];
  const summary = freecash ? t.freecashCardSummary : row['description_' + lang];
  const cost = freecash ? t.freecashCardCost : t.expenses[row.required_expense.kind];
  const conditions = freecash ? t.freecashCardConditions : row['eligibility_' + lang];
  const details = freecash ? t.freecashCardDetails : t.details;
  const disclosure = freecash ? t.freecashCardDisclosure : t.affiliateDisclosure;
  const visit = freecash ? t.sponsoredVisit : t.visitOfficial;
  const banner = row.affiliate_banner;
  return `<article class="card sponsored-card task-card" data-record="${e(row.id)}" data-deadline="${e(expiryValue(row))}" data-affiliate-expires="${e(row.affiliate_expires_at)}"${analytics ? ` data-analytics-entry="${e(row.id)}" data-analytics-category="${e(row.category)}"` : ''}>
<div class="labels"><span>${e(taskService(row) ? t.taskRewards : t.categories[row.category])}</span><span class="sponsored-label">${t.sponsoredLabel}</span></div>
<h3>${e(title)}</h3><p class="card-summary">${e(summary)}</p>
<p class="small card-conditions">${e(cost)}<br>${e(conditions)}</p>
${freshnessNotice(row,lang)}
<div class="card-footer"><div class="actions">${external(banner?.href ?? row.affiliate_url,visit,'affiliate_click',title,banner)}<a class="card-details" href="${detail(lang,row)}" aria-label="${e(details + ' · ' + title)}">${e(details)}</a></div>
<p class="stamp">${t.checked} · ${time(row.last_checked_at,lang)} · ${elapsed(row,lang)}</p><p class="small card-disclosure">${e(disclosure)}</p></div></article>`;
}

function card(row, lang, guideSource = '') {
  const affiliate = sponsoredLink(row);
  if (affiliate && !guideSource && !row.commission) return sponsoredServiceCard(row,lang);
  const t = copy[lang];
  const title = row['title_' + lang];
  const sponsored = taskService(row);
  const isDraw = row.category === 'sweepstakes';
  const group = sponsored ? t.taskRewards : row.prize_category ? t.prizes[row.prize_category] : t.categories[row.category];
  const heading = guideSource ? 'h4' : 'h3';
  const summary = guideSource
    ? [row['eligibility_' + lang],row.entry.steps?.[lang]].filter(Boolean).join(' ')
    : row['description_' + lang];
  const directoryRecord = guideSource ? '' : ` data-record="${e(row.id)}" data-deadline="${e(expiryValue(row))}"`;
  const registration = guideSource ? t.registration : lang === 'ja' ? '登録' : 'Account';
  const entryFact = isDraw ? [registration,e(t.registrations[row.entry.registration])]
    : [t.expense,e(sponsored ? t.freecashCost : t.expenses[row.required_expense.kind])];
  return `<article class="card${sponsored ? ' sponsored-card' : ''}"${directoryRecord}${affiliate ? ` data-affiliate-expires="${e(row.affiliate_expires_at)}"` : ''}${analytics ? ` data-analytics-entry="${e(row.id)}" data-analytics-category="${e(row.category)}"` : ''}>
<div class="labels"><span>${e(group)}</span>${affiliate ? `<span class="sponsored-label">${t.sponsoredLabel}</span>` : ''}</div>
<${heading}><a href="${detail(lang,row)}">${e(title)}</a></${heading}>
<p class="provider">${e(row.provider)}</p><p class="card-summary">${e(summary)}</p>
${fields([
  ...geography(row,lang),
  [t.deadline,deadlineText(row,lang)],
  ...(!isDraw || guideSource || row.entry.registration !== 'unknown' ? [entryFact] : []),
])}
${isDraw && row.application?.sns_required === false ? `<p class="small">${t.application.noSns}${row.application.difficulty === 'easy' ? ' · ' + t.application.easyApply : ''}</p>` : ''}
${freshnessNotice(row,lang)}
${affiliate ? `<p class="small">${t.affiliateDisclosure}</p>` : ''}
<div class="card-footer"><p class="stamp">${t.checked} · ${time(row.last_checked_at,lang)} · ${elapsed(row,lang)}${guideSource ? ' · ' + guideSource : ''}</p>
${guideSource ? '' : affiliate ? `<a class="text-link" href="${detail(lang,row)}">${t.details} →</a>` : external(row.official_url,isDraw ? t.officialNewTab : t.visitOfficial,row.commission ? null : 'application_click',title)}</div></article>`;
}

function residenceCountries(lang, available, onlyVerified = false) {
  const countries = new Set(available.flatMap(row => (!onlyVerified || row.eligibility_verified) &&
    Array.isArray(row.eligible_countries) ? row.eligible_countries : []));
  return [...countries].sort((a,b) => name(lang,a).localeCompare(name(lang,b),lang));
}

function mastheadResidence(lang, available) {
  const guide = copy[lang].sweepstakesGuide;
  const countries = residenceCountries(lang,available,true);
  const shortNames = lang === 'ja' ? {GB:'英国',US:'米国'} : {GB:'UK',US:'US'};
  return `<select class="masthead-residence" name="country" form="filters" aria-label="${e(guide.residence)}" disabled><option value="">${e(guide.anyResidence)}</option>${countries.map(code =>
    `<option value="${e(code)}">${e(shortNames[code] ?? name(lang,code))}</option>`).join('')}</select>`;
}

function filters(lang, available, sweepstakes, merged, count) {
  const t = copy[lang];
  const countries = sweepstakes ? [] : residenceCountries(lang,available);
  const options = (id,label,values,empty = true) => `<label>${e(label)}<select name="${id}">${empty ? `<option value="">${e(t.all)}</option>` : ''}${Object.entries(values).map(([value,text]) => `<option value="${e(value)}">${e(text)}</option>`).join('')}</select></label>`;
  const browse = t.quest.browse;
  const keyword = `<label class="search">${t.search}<input type="search" name="q" placeholder="${e(t.placeholder)}" maxlength="150"></label>`;
  const country = sweepstakes ? '' :
    options('country',t.country,{...Object.fromEntries(countries.map(c => [c,name(lang,c)])),unknown:t.unknown});
  const categories = Object.fromEntries([...new Set(available.map(row => row.category))]
    .map(key => [key,key === 'affiliate' && available.some(taskService) ? t.taskRewards : t.categories[key] ?? t.quest.types[key]]));
  return `<form class="filter" id="filters" role="search" aria-labelledby="filter-title" aria-busy="true"><fieldset disabled>
<h2 id="filter-title" class="sr-only">${t.filters}</h2>
<div class="search-row${sweepstakes ? ' search-row--no-residence' : ''}">${keyword}${country}

${options('sort',t.sort,{'':t.recommended,deadline:t.deadlineSort,newest:t.newest},false)}</div>
<div class="quick-filters">${[['noSns',t.application.noSns],['freeEntry',t.freeEntry],['closingSoon',t.closingSoon],['easyApply',t.application.easyApply]].map(([key,label]) => `<label class="filter-chip"><input type="checkbox" name="${key}" value="yes"><span>${label}</span></label>`).join('')}</div>
<div class="filter-toolbar"><p class="result-status" role="status" aria-live="polite" aria-atomic="true"><span id="result-count">${count}</span>${t.count}</p><button type="reset" disabled>${t.reset}</button></div>
<details class="filter-options"><summary>${t.advanced}</summary><div class="advanced-scroll"><div class="filter-grid">
${options('category',t.category,categories)}${options('prize_category',t.prizeCategory,t.prizes)}
${options('registration',t.registration,t.registrations)}${options('language',t.sourceLanguage,t.languages)}
${options('reward_type',t.reward,t.rewards)}${options('expense',t.expense,t.expenses)}
${options('participation_method',t.method,t.methods)}${options('deadline',t.deadline,{any:t.hasDeadline,7:t.within7,30:t.within30})}
</div><div class="filter-checks">
<label class="checkbox"><input type="checkbox" name="explicitJapan" value="yes">${t.japan}</label>
<label class="checkbox"><input type="checkbox" name="emailOnly" value="yes">${t.emailOnly}</label>
<label class="checkbox"><input type="checkbox" name="webOnly" value="yes">${t.application.webOnly}</label>
</div>${merged ? `<div class="filter-grid">
${options('status',browse.status,{open:t.quest.open,ended:t.quest.ended,all:browse.any},false)}
${options('sns',browse.sns,{false:browse.optional,true:browse.required})}
${options('ai',browse.ai,{allowed:browse.allowed,required:browse.required,prohibited:browse.prohibited})}
<label>${e(browse.deadline)}<input type="date" name="by"></label></div>` : ''}</div><button type="button" data-show-results>${t.showResults} <span data-result-count>${count}</span></button></details>
<div class="active-filters sr-only" hidden><span>${t.activeFilters}</span><ul></ul></div></fieldset></form>
<details class="home-screen-help"><summary>${e(t.addToHome)}</summary><p>${e(t.addToHomeSafari)}</p></details>
<noscript><p class="notice">${t.javascript}</p></noscript><p class="notice" data-filter-error hidden>${t.failure}</p>`;
}

function directory(lang, available, sweepstakes, merged = false) {
  const t = copy[lang];
  const entries = merged ? editorial.quests.filter(entry => entry.locales.includes(lang)) : [];
  const archive = merged ? editorial.endedQuests.filter(entry => entry.locales.includes(lang)) : [];
  const all = [...available,...[...entries,...archive].map(entry => editorialRecord(entry,lang))];
  const count = available.length + entries.length;
  const filtered = all.length ? filters(lang,all,sweepstakes,merged,count) : '';
  return `${filtered}${all.length ? '' : `<p class="stamp" role="status"><span id="result-count">0</span>${t.count}</p>`}
<p class="notice" data-empty ${count ? 'hidden' : ''}>${t.empty} <a href="${url(lang,'rewards')}">${t.relatedRewards}</a></p>
<section class="cards" aria-labelledby="listing-results"><h2 class="sr-only" id="listing-results" tabindex="-1">${e(t.results)}</h2>${available.map(row => card(row,lang)).join('')}${entries.map(entry => editorialCard(entry,lang,false)).join('')}</section>
${merged ? `<details data-archive${archive.length ? '' : ' hidden'}><summary>${e(t.quest.ended)}</summary><div class="cards" data-archive-list>${archive.map(entry => editorialCard(entry,lang,true)).join('')}</div></details>` : ''}`;
}

function genreHref(lang, field, value) {
  return `${url(lang, field === 'prize_category' ? 'sweepstakes' : 'opportunities')}?${new URLSearchParams({[field]:value})}`;
}

function genreLinks(lang, available, prizes = false) {
  const t = copy[lang];
  const field = prizes ? 'prize_category' : 'category';
  const title = prizes ? t.prizeGenres : t.listingGenres;
  const labels = prizes ? t.prizes : {...t.categories,...t.quest.types,affiliate:t.taskRewards};
  const present = new Set(available.map(row => row[field]));
  const links = Object.entries(labels).filter(([genre]) => present.has(genre))
    .map(([genre,label]) => `<a href="${e(genreHref(lang,field,genre))}" data-genre-field="${field}" data-genre-value="${e(genre)}">${e(label)}</a>`);
  return links.length ? `<nav class="genre-links" aria-label="${e(title)}"><strong>${e(title)}</strong>${links.join('')}</nav>` : '';
}

function relatedListings(row) {
  return rows.filter(candidate => candidate.id !== row.id && candidate.category === row.category &&
      Boolean(candidate.commission) === Boolean(row.commission))
    .map(candidate => {
      const sameRegion = row.eligibility_verified && candidate.eligibility_verified &&
        (row.eligible_countries === 'worldwide' || candidate.eligible_countries === 'worldwide' ||
          row.eligible_countries.some(country => candidate.eligible_countries.includes(country)));
      if (row.eligibility_verified && candidate.eligibility_verified && !sameRegion) return {candidate, score:0};
      const sameFlag = key => typeof row.application?.[key] === 'boolean' && row.application[key] === candidate.application?.[key];
      const score = 3 * Number(row.participation_method === candidate.participation_method) +
        2 * Number(sameRegion) + Number(sameFlag('sns_required')) + Number(sameFlag('web_only')) +
        Number(row.required_expense.kind !== 'unknown' && row.required_expense.kind === candidate.required_expense.kind);
      return {candidate, score};
    })
    .filter(({score}) => score > 0)
    .sort((a,b) => b.score - a.score).slice(0,3).map(({candidate}) => candidate);
}

function sweepstakesGuide(lang, available) {
  const t = copy[lang];
  const guide = t.sweepstakesGuide;
  const matches = available.filter(row => row.required_expense.kind === 'free' &&
    row.application?.sns_required === false && row.application.web_only === true);
  const source = row => row.source_url === row.official_url
    ? `<a href="${detail(lang,row)}#official-sources">${e(guide.source)}</a>`
    : `<a href="${e(row.source_url)}" rel="noopener noreferrer" target="_blank">${e(guide.source)}</a>`;
  const list = (entries, fresh = false) => `<ul class="cards sweepstakes-guide-cards" data-expiry-list${entries.length ? '' : ' hidden'}>${entries.map(row => `<li ${listingExpiry(row)}${fresh ? ` data-expire-when-stale="${e(row.last_checked_at)}"` : ''}>${card(row,lang,source(row))}</li>`).join('')}</ul>`;
  const japan = matches.filter(row => verifiedJapanGiveaway(row, now));
  const others = matches.filter(row => !japan.includes(row));
  return `<section class="section" id="no-sns-giveaways" aria-labelledby="no-sns-heading" data-unfiltered-guide>
<div class="section-heading"><h2 id="no-sns-heading">${e(guide.title)}</h2><p>${e(guide.excerpt)}</p></div>
<section aria-labelledby="japan-giveaways"><h3 id="japan-giveaways">${e(guide.japan)}</h3>
${list(japan, true)}<p data-expiry-empty${japan.length ? ' hidden' : ''}>${e(guide.japanEmpty)}</p></section>
${others.length ? `<section aria-labelledby="other-giveaways"><h3 id="other-giveaways">${e(guide.other)}</h3>
${list(others)}<p data-expiry-empty hidden>${e(guide.empty)}</p></section>` : ''}
</section>`;
}

function rewardsGuide(lang, available) {
  const t = copy[lang];
  const guide = t.rewardsGuide;
  // This comparison is editorial. Ads and unverified service markets never qualify.
  const organic = available.filter(row => ['survey','research'].includes(row.category) &&
    !taskService(row) && !row.affiliate_url && row.eligibility_verified &&
    Array.isArray(row.eligible_countries) && row.eligible_countries.includes('JP') &&
    row.required_expense.kind === 'free' && freshness(row,now).state === 'fresh');
  // Keep the comparison short and cover both formats when verified listings exist.
  const example = (category, preferredId) => organic.find(row => row.id === preferredId) ??
    organic.find(row => row.category === category);
  const examples = [example('survey','research-panel'), example('research','prolific')].filter(Boolean);
  return `<section class="section" id="rewards-comparison" aria-labelledby="rewards-comparison-heading">
<div class="section-heading"><h2 id="rewards-comparison-heading">${e(guide.title)}</h2><p>${e(guide.entry)}</p></div>
<ul class="giveaway-list rewards-comparison" data-expiry-list${examples.length ? '' : ' hidden'}>${examples.map(row => `<li ${listingExpiry(row)} data-expire-when-stale="${e(row.last_checked_at)}">
<h3><a href="${detail(lang,row)}">${e(row['title_' + lang])}</a></h3>
<p class="small">${e(t.categories[row.category])} · ${e(t.expenses.free)}${row.entry.registration !== 'unknown' ? ` · ${e(t.registrations[row.entry.registration])}` : ''} · ${e(t.checked)} ${time(row.last_checked_at,lang)}</p>
<p>${e(row.reward_conditions[lang])}</p>
<p class="small"><a href="${detail(lang,row)}#official-sources">${e(t.officialSources)}</a></p>
</li>`).join('')}</ul>
<p data-expiry-empty${examples.length ? ' hidden' : ''}>${e(guide.empty)}</p>
<p class="small">${e(guide.costs)}</p></section>`;
}

function rewardsSponsorLink(lang, available) {
  const row = available.find(row => row.id === 'freecash' && sponsoredLink(row) &&
    freshness(row,now).state === 'fresh');
  if (!row) return '';
  const t = copy[lang];
  return `<aside class="rewards-sponsored-link small" ${listingExpiry(row)} data-expire-when-stale="${e(row.last_checked_at)}">
<span class="sponsored-label">${e(t.sponsoredLabel)}</span> <a href="${detail(lang,row)}">${e(t.rewardsGuide.sponsoredLink)}</a></aside>`;
}

function rewardsGuideLink(lang) {
  return `<p class="small rewards-cross-link"><a href="${url(lang,'rewards')}#rewards-comparison">${e(copy[lang].rewardsGuide.link)}</a></p>`;
}

function details(lang, row, calendar) {
  const t = copy[lang];
  const sponsored = taskService(row);
  const section = row.commission ? 'affiliates' : row.category === 'sweepstakes' ? 'sweepstakes' :
    row.certainty === 'guaranteed' ? 'guaranteed' : 'rewards';
  const related = relatedListings(row);
  const affiliate = sponsoredLink(row);
  const banner = row.affiliate_banner;
  const title = row['title_' + lang];
  const personal = values => e(values.length ? values.map(value => t.personal[value]).join(lang === 'ja' ? '、' : ', ') : t.noPersonal);
  const requirements = [
    ...geography(row,lang),
    ...(!row.deadline ? [[t.deadline,deadlineText(row,lang)]] : []),
    ...(row.entry.registration !== 'unknown' ? [[lang === 'ja' ? '登録' : 'Account',e(t.registrations[row.entry.registration])]] : []),
    [t.sourceLanguage,e(t.languages[row.language])],
    ...(row.entry.application !== null ? [[t.applicationData,personal(row.entry.application)]] : []),
    ...(row.certainty === 'chance' && row.entry.winner !== null ? [[t.winnerData,personal(row.entry.winner)]] : []),
    ...(row.estimated_effort_minutes !== null ? [[t.effort,e(row.estimated_effort_minutes + t.minutes)]] : []),
  ];
  const app = row.application;
  if (typeof app?.sns_required === 'boolean') requirements.push([t.application.sns,e(app.sns_required ? t.application.yes : t.application.no)]);
  if (app?.operations.length && !row.entry.steps) requirements.push([t.application.operations,e(app.operations.map(item => t.application.names[item]).join(' → '))]);
  const c = row.commission;
  const terms = c ? `<h2>${t.commission}</h2>${fields([[t.rate,c.percent === null ? t.unknown : e(c.percent + '%')], [t.structure,e(t.structures[c.structure])], [t.duration,e(c.months ?? t.unknown)], [t.threshold,e(format(c.threshold,c.threshold_currency,lang))]])}` : '';
  const links = [...new Set([row.source_url,...row.supporting_urls,app?.source_url].filter(Boolean))];
  return `<article class="article detail"${analytics ? ` data-analytics-opportunity="${e(row.id)}" data-analytics-category="${e(row.category)}"` : ''}>
${breadcrumbs(lang,section,title)}
<header class="detail-heading"><div class="labels"><span>${e(sponsored ? t.taskRewards : t.categories[row.category])}</span>${affiliate ? `<span class="sponsored-label">${t.sponsoredLabel}</span>` : ''}</div>
<h1>${e(title)}</h1><p class="provider">${e(row.provider)}</p><p class="lead">${e(row['description_' + lang])}</p></header>
${freshnessNotice(row,lang)}<p class="notice" data-ended hidden></p>
<section class="detail-overview" aria-label="${t.rewardSummary}">${fields([
    [t.expense,e(sponsored ? t.freecashCost : t.expenses[row.required_expense.kind])],
    [t.eligibility,e(row['eligibility_' + lang])],
    ...(row.deadline ? [[t.deadline,deadlineText(row,lang)]] : []),
    ...(row.reward_amount !== null ? [[t.amount,e(amount(row,lang))]] : []),
])}${calendar}</section>
<div class="entry-action${affiliate ? ' ad-action' : ''}" data-expiring="${e(expiryValue(row))}"${affiliate ? ` data-affiliate-expires="${e(row.affiliate_expires_at)}"` : ''}>
${affiliate ? `<p class="ad-disclosure"><strong>${t.sponsoredLabel}</strong> · ${t.affiliateDisclosure}</p><div class="actions">${external(banner?.href ?? row.affiliate_url,banner ? title : sponsored ? t.sponsoredVisit : t.sponsored,'affiliate_click','',banner)}</div><p class="secondary-official"><a href="${e(row.official_url)}" target="_blank" rel="noopener noreferrer">${t.official}</a></p>` : `<div class="actions">${external(row.official_url,row.category === 'sweepstakes' ? t.officialNewTab : t.visitOfficial,row.commission ? null : 'application_click')}</div>`}
</div>
<div class="detail-body"><section><h2>${t.entryRequirements}</h2>
${row.entry.steps ? `<p>${e(row.entry.steps[lang])}</p>` : ''}${fields(requirements)}
${row.service_countries?.length > 4 ? `<details class="country-details"><summary>${t.serviceCountries}</summary><p>${e(row.service_countries.map(code => name(lang,code)).join(lang === 'ja' ? '、' : ', '))}</p></details>` : ''}
${!sponsored && row.risk_flags.some(flag => !['account','variable'].includes(flag)) ? `<p class="small">${row.risk_flags.filter(flag => !['account','variable'].includes(flag)).map(flag => e(t.risks[flag])).join(lang === 'ja' ? '・' : ' · ')}</p>` : ''}
${row.entry.registration === 'unknown' || (row.certainty === 'chance' && (row.entry.application === null || row.entry.winner === null)) ? `<p class="small">${t.entryUnknown}</p>` : ''}</section>
<section><h2>${t.conditions}</h2><p>${e(row.reward_conditions[lang])}</p>
${sponsored ? `<p>${t.freecashPayout}</p><details class="country-details"><summary>${t.markets}</summary><p>${e(promotionText(row,lang))}</p><p>${t.freecashRestrictions}</p></details>` : Array.isArray(row.eligible_countries) && row.eligible_countries.length > 4 ? `<details class="country-details"><summary>${t.countries}</summary><p>${e(countryText(row,lang))}</p></details>` : ''}
${terms}</section></div>
<section class="sources" id="official-sources"><h2>${t.officialSources}</h2><p class="stamp">${t.checked} · ${time(row.last_checked_at,lang,true)} · ${elapsed(row,lang)}</p>
<ul class="source-links">${links.map(link => `<li><a href="${e(link)}" target="_blank" rel="noopener noreferrer">${e(sourceLabel(link,row,t))}</a></li>`).join('')}</ul></section>
${related.length ? `<section class="sources" aria-labelledby="related-listings"><h2 id="related-listings">${e(t.relatedListings)}</h2>
<ul class="source-links" data-expiry-list>${related.map(candidate => `<li ${listingExpiry(candidate)}><a href="${detail(lang,candidate)}">${e(candidate['title_' + lang])}</a></li>`).join('')}</ul></section>` : ''}
<p><a class="text-link" href="${url(lang,'opportunities')}">${e(t.back)}</a>
${row.category === 'affiliate' && !taskService(row) ? '' : `<a class="text-link genre-return" href="${e(genreHref(lang,row.prize_category ? 'prize_category' : 'category',row.prize_category || row.category))}">${e(t.sameGenre)}</a>`}</p>
<template id="adsense-slot"></template></article>`;
}

async function page(lang, key, title, description, content, indexable = true, mastheadControl = '', locales = languages) {
  const folder = url(lang,key).slice(1);
  await mkdir(dist + '/' + folder, {recursive:true});
  await write(folder + 'index.html', layout(lang,key,title,description,content,indexable,mastheadControl,locales));
}

function editorialRecord(entry, lang) {
  const {title,description,eligibility,task,reward_terms} = entry.copy[lang];
  const published = rssDates.get(lang + '/quests/' + entry.id);
  const countries = entry.type === 'skill-bounty' ? entry.conditions.eligible_countries
    : entry.review.japan_eligible === true ? ['JP'] : [];
  return {
    id:entry.id, category:entry.type, deadline:entry.deadline,
    deadline_date_only:entry.deadline_date_only, deadline_timezone:entry.deadline_timezone || 'Asia/Tokyo',
    last_checked_at:entry.last_checked_at, first_seen_at:Number.isFinite(published) ? new Date(published).toISOString() : '',
    availability:entry.closed ? 'ended' : 'accepting', eligible_countries:countries, eligibility_verified:countries.length > 0,
    required_expense:{kind:entry.conditions?.free === true ? 'free' : 'unknown'},
    application:{sns_required:entry.conditions?.sns}, reward_conditions:{[lang]:reward_terms},
    reward_currency:entry.reward.currency, ['title_' + lang]:title, ['description_' + lang]:description,
    editorial:{ai:entry.conditions?.ai, search:eligibility + ' ' + task + ' ' + copy[lang].quest.types[entry.type]},
  };
}

function editorialReward(entry, lang) {
  const q = copy[lang].quest;
  return e(`${q.rewardTypes[entry.reward.kind]} · ${entry.reward.maximum ? q.upTo + ' ' : ''}${format(entry.reward.amount,entry.reward.currency,lang)}`);
}

function editorialCard(entry, lang, ended) {
  const t = copy[lang];
  const q = t.quest;
  const content = entry.copy[lang];
  const row = editorialRecord(entry,lang);
  const sns = row.application.sns_required;
  return `<article class="card" data-editorial="${e(JSON.stringify(row))}">
<div class="labels"><span>${e(q.types[entry.type])}</span><span data-editorial-ended${ended ? '' : ' hidden'}>${e(q.ended)}</span></div>
<h3><a href="${detail(lang,entry)}">${e(content.title)}</a></h3><p class="card-summary">${e(content.description)}</p>
${fields([[t.residency,e(entry.review.japan_eligible === 'not-stated' ? q.residencyUnconfirmed : content.eligibility)],
    [t.deadline,time(entry.deadline,lang,!entry.deadline_date_only,row.deadline_timezone)], [t.reward,editorialReward(entry,lang)]])}
<p class="small">${[row.required_expense.kind === 'free' ? q.browse.free : q.noUpfront,
    typeof sns === 'boolean' ? q.browse.sns + ' · ' + (sns ? q.browse.required : q.browse.optional) : '',
    row.editorial.ai ? q.browse.ai + ' · ' + q.browse[row.editorial.ai] : ''].filter(Boolean).map(e).join(' · ')}</p>
<div class="card-footer"><p class="stamp">${e(t.checked)} · ${time(entry.last_checked_at,lang,false,row.deadline_timezone)}</p></div></article>`;
}

async function editorialPages(lang) {
  const t = copy[lang];
  const q = t.quest;
  const entries = editorialEntries.filter(entry => entry.locales.includes(lang));
  const open = editorial.quests.filter(entry => entry.locales.includes(lang));
  const guides = editorial.guides.filter(entry => entry.locales.includes(lang));
  const link = (key, label = t.pages[key][0]) => `<a href="${url(lang,key)}">${e(label)}</a>`;
  const expiry = entry => `data-expiring="${expiryValue(entry)}" data-expire-when-stale="${e(entry.last_checked_at)}"`;
  const zone = entry => entry.deadline_timezone || 'Asia/Tokyo';
  const deadline = entry => time(entry.deadline,lang,!entry.deadline_date_only,zone(entry));
  const intro = key => `<header class="intro"><h1>${e(t.pages[key][0])}</h1><p class="lead">${e(t.pages[key][1])}</p></header>`;
  const guideItems = guides.map(entry => `<li><h3>${link('guides/' + entry.id,entry.copy[lang].title)}</h3><p>${e(entry.copy[lang].description)}</p></li>`).join('');
  const guidesLink = guides.length ? link('guides') : '';
  if (guides.length) {
    await page(lang,'guides',...t.pages.guides,`${intro('guides')}<ul class="giveaway-list">${guideItems}</ul><p>${link('opportunities')}</p>`, true, '', guideLocales);
  }

  for (const entry of entries) {
    const content = entry.copy[lang];
    const closed = entry.closed || expiration(entry) <= now;
    const active = open.includes(entry);
    const residencyNotice = entry.review.japan_eligible === 'not-stated' ? e(q.residencyUnconfirmed) : '';
    const key = 'opportunities/' + entry.id;
    const translated = !residencyNotice && entry.locales.length > 1
      ? '<br>' + eligibilityTranslation(lang,key) : '';
    const calendar = active ? await calendarLink('opportunities',entry,lang,content.title,zone(entry),'quests') : '';
    const from = url(lang,'quests/' + entry.id);
    const to = url(lang,key);
    redirectPage(from,to);
    redirects.push(from + 'deadline.ics ' + (calendar ? to + 'deadline.ics' : to) + ' 301');
    const related = open.filter(other => other.id !== entry.id)
      .sort((a,b) => Number(b.type === entry.type) - Number(a.type === entry.type)).slice(0,3);
    await page(lang,key,content.title,content.description,`<article class="article">
${breadcrumbs(lang,'opportunities',content.title)}<h1>${e(content.title)}</h1><p class="lead">${e(content.description)}</p>
<p class="notice"${entry.closed ? '' : ` data-quest-ended-notice="${expiryValue(entry)}"`}${closed ? '' : ' hidden'}>${e(q.ended)}</p>
${fields([
      [t.method,e(q.types[entry.type])], [q.task,e(content.task)],
      [t.eligibility,`${residencyNotice ? residencyNotice + '<br>' : ''}${e(content.eligibility)}${translated}`],
      [t.expense,`${e(q.noUpfront)}<br>${e(content.expenses)}`], [t.reward,`${editorialReward(entry,lang)}<br>${e(content.reward_terms)}`],
      [q.payment,e(content.payment)], [t.deadline,deadline(entry)],
      ...(entry.conditions?.ai ? [[q.browse.ai,e(q.browse[entry.conditions.ai])]] : []),
      [t.checked,time(entry.last_checked_at,lang,false,zone(entry))],
    ])}
${active ? `<div ${expiry(entry)} data-quest-listing><p><a href="${e(entry.official_url)}" rel="noopener noreferrer">${e(content.organizer)}</a></p>${calendar}</div>
<p class="notice" data-quest-closed hidden>${e(q.closed)}</p>` : closed ? '' : `<p class="notice" data-expiring="${expiryValue(entry)}">${e(q.closed)}</p>`}
<p><a href="${e(entry.review.evidence_url)}" rel="noopener noreferrer">${e(q.rules)}</a></p>
${related.length ? `<section data-expiry-section><h2>${e(q.browse.related)}</h2><ul data-expiry-list>${related.map(other => `<li ${expiry(other)}>${link('opportunities/' + other.id,other.copy[lang].title)}</li>`).join('')}</ul></section>` : ''}
<p>${[link('opportunities',q.browse.back),guidesLink].filter(Boolean).join(' · ')}</p></article>`, active, '', entry.locales);
  }
  for (const entry of guides) {
    const content = entry.copy[lang];
    await page(lang,'guides/' + entry.id,content.title,content.description,`<article class="article">
${breadcrumbs(lang,'guides',content.title)}<h1>${e(content.title)}</h1><p class="lead">${e(content.description)}</p>
${content.sections.map(([heading,body]) => `<section><h2>${e(heading)}</h2><p>${e(body)}</p></section>`).join('')}
<p class="stamp">${e(t.checked)} · ${time(entry.last_checked_at,lang,false,'Asia/Tokyo')}</p>
<p><a href="${e(entry.source_url)}" rel="noopener noreferrer">${e(content.source_label)}</a></p>
<p>${link('opportunities')}</p></article>`, true, '', entry.locales);
  }
}

const consumer = rows.filter(row => row.category !== 'affiliate' || taskService(row));
const rewardRows = consumer.filter(row => row.category !== 'sweepstakes');
const recent = consumer.filter(row => Date.parse(row.first_seen_at) >= now - 30 * 86_400_000)
  .sort((a,b) => b.first_seen_at.localeCompare(a.first_seen_at) || a.id.localeCompare(b.id));
for (const lang of languages) {
  const t = copy[lang];
  const hapitasAd = hapitasUrl && now < Date.parse(hapitasDeadline)
    ? `<aside class="notice" data-affiliate-expires="${hapitasDeadline}" data-analytics-affiliate="hapitas-referral">
<p class="tag">${t.hapitas.label}</p><h2>${t.hapitas.title}</h2><p>${t.hapitas.body}</p>
${external(hapitasUrl,t.hapitas.cta,'affiliate_click')}
<p><a href="https://hapitas.jp/special/referral202611" rel="noopener noreferrer">${t.hapitas.terms}</a> · ${t.hapitas.deadline} ${time('2026-11-30T14:59:00Z',lang,true)}</p></aside>` : '';
  const giveaways = consumer.filter(row => row.category === 'sweepstakes');
  const featured = giveaways.filter(row => row.deadline).sort((a,b) => expiration(a) - expiration(b) || a.id.localeCompare(b.id)).slice(0,3);
  const rewardsPreview = `<section class="section"><div class="section-heading"><h2><a href="${url(lang,'rewards')}#rewards-comparison">${t.pages.rewards[0]}</a></h2><p>${t.rewardsLead}</p></div><div class="cards">${['freecash','infoq','rakuten-insight','research-panel','prolific'].map(id => rewardRows.find(row => row.id === id)).filter(Boolean).map(row => card(row,lang)).join('')}</div></section>`;
  await page(lang,'',t.tagline,t.lead,`<section class="hero"><div class="hero-copy"><p class="eyebrow">${t.cap}</p><h1>${t.tagline}</h1><p class="lead">${t.lead}</p>
<form class="home-search" role="search" action="${url(lang,'opportunities')}" method="get"><label class="sr-only" for="home-query">${t.search}</label><input id="home-query" type="search" name="q" maxlength="150" placeholder="${e(t.placeholder)}"><button type="submit">${t.searchSubmit}</button></form>
<div class="home-shortcuts"><a href="${url(lang,'sweepstakes')}#no-sns-giveaways">${e(t.sweepstakesGuide.shortcut)}</a><a href="${url(lang,'sweepstakes')}?easyApply=yes">${t.application.easyApply}</a><a href="${url(lang,'international')}">${t.pages.international[0]}</a><a href="${url(lang,'opportunities')}">${e(t.allListings)}</a><a href="${url(lang,'recent')}">${e(t.pages.recent[0])}</a>${guideLocales.includes(lang) ? `<a href="${url(lang,'guides')}">${e(t.pages.guides[0])}</a>` : ''}</div></div></section>
<section class="section featured"><div class="section-heading"><h2>${t.closing}</h2><a href="${url(lang,'sweepstakes')}">${t.browse} →</a></div>
<div class="cards">${featured.length ? featured.map(row => card(row,lang)).join('') : `<p>${t.empty}</p>`}</div></section>
${genreLinks(lang,consumer)}${rewardsPreview}${hapitasAd}`);
  await page(lang,'recent',...t.pages.recent,`<header class="intro"><h1>${e(t.pages.recent[0])}</h1><p class="lead">${e(t.pages.recent[1])}</p>
<a class="text-link" href="${feedPath(lang)}">${e(t.rss.subscribe)}</a></header>
<ul class="recent-list" data-expiry-list${recent.length ? '' : ' hidden'}>${recent.map(row => `<li ${listingExpiry(row)}><a href="${detail(lang,row)}">${e(row['title_' + lang])}</a>
<span>${e(row.provider)}</span><span>${time(row.first_seen_at,lang)}</span></li>`).join('')}</ul>
<p data-expiry-empty${recent.length ? ' hidden' : ''}>${e(t.recentEmpty)}</p>`,recent.length > 0);
  await write(feedPath(lang).slice(1),renderFeed({lang,origin:origin.origin,now,rows,
    quests:editorial.quests,dates:rssDates,copy:t.rss,deadlineLabel:t.deadline}));
  await editorialPages(lang);
  const pages = {
    opportunities: consumer,
    rewards: rewardRows,
    sweepstakes: consumer.filter(row => row.category === 'sweepstakes'),
    guaranteed: consumer.filter(row => row.certainty === 'guaranteed'),
    international: consumer.filter(row => row.eligibility_verified && (row.eligible_countries === 'worldwide' || (Array.isArray(row.eligible_countries) && row.eligible_countries.some(code => code !== 'JP')))),
    affiliates: rows.filter(row => row.category === 'affiliate' && !taskService(row)),
  };
  for (const [key, available] of Object.entries(pages)) {
    const [title, description] = t.pages[key];
    const sweepstakes = key === 'sweepstakes';
    const genres = key === 'opportunities'
      ? [...available,...editorial.quests.filter(entry => entry.locales.includes(lang)).map(entry => ({category:entry.type}))]
      : available;
    await page(lang,key,title,description,`<header class="intro"><h1>${e(title)}</h1>${sweepstakes ? `<a class="text-link" href="${url(lang,'opportunities')}">${e(t.sweepstakesGuide.allListings)}</a>` : `<p class="lead">${e(description)}</p>`}
${key === 'opportunities' && guideLocales.includes(lang) ? `<a href="${url(lang,'guides')}">${e(t.pages.guides[0])}</a>` : ''}${key === 'affiliates' ? `<a href="${url(lang,'rewards')}">${t.pages.rewards[0]} →</a>` : ''}</header>${sweepstakes || key === 'opportunities' ? genreLinks(lang,genres,sweepstakes) : ''}${key === 'rewards' ? rewardsGuide(lang,available) + rewardsSponsorLink(lang,available) : ''}${directory(lang,available,sweepstakes,key === 'opportunities')}${sweepstakes ? sweepstakesGuide(lang,available) + rewardsGuideLink(lang) : ''}`,key === 'rewards' || available.length > 0 || key === 'opportunities' && editorial.quests.some(entry => entry.locales.includes(lang)),
      sweepstakes && available.length ? mastheadResidence(lang,available) : '');
  }
  for (const key of secondary.filter(key => !['affiliates','guaranteed'].includes(key))) {
    const [title, description] = t.pages[key];
    const sections = t.articles[key].map(([heading, body]) => `<h2>${e(heading)}</h2><p>${e(body)}</p>`).join('');
    await page(lang,key,title,description,`<article class="article"><h1>${e(title)}</h1><p class="lead">${e(description)}</p>
${sections}${key === 'privacy' ? `<p><a href="https://policies.google.com/technologies/partner-sites?hl=${lang}" rel="noopener noreferrer">${t.analytics.googlePolicy}</a></p>` : ''}
${key === 'privacy' && analytics ? `<p><button type="button" data-analytics-settings>${t.analytics.settings}</button></p>` : ''}${['contact','privacy','disclosure'].includes(key) ? `<p>${t.legalContact} · ${address}</p>` : ''}</article>`);
  }
  for (const row of rows) {
    const calendar = row.verification_status === 'verified'
      ? await calendarLink('opportunities',row,lang,row['title_' + lang],row.deadline_timezone) : '';
    await page(lang,'opportunities/' + row.id,row['title_' + lang],row['description_' + lang],details(lang,row,calendar));
  }
}
await write('index.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Freebie Trail / 懸賞さんぽ | Choose a language</title>${adsenseMeta}${impactMeta}
<meta name="description" content="Find giveaways you can enter without a purchase.">
<meta property="og:image" content="${origin.origin}/assets/social.png"><meta name="twitter:card" content="summary_large_image">${iconLinks}<meta property="og:title" content="Freebie Trail / 懸賞さんぽ"><meta property="og:description" content="Find giveaways you can enter without a purchase."><meta property="og:url" content="${origin.origin}/"><link rel="canonical" href="${origin.origin}/">
${languages.map(lang => `<link rel="alternate" hreflang="${lang}" href="${origin.origin}${url(lang)}">`).join('')}
<link rel="alternate" hreflang="x-default" href="${origin.origin}/">
${configured ? '' : '<meta name="robots" content="noindex">'}
<link rel="stylesheet" href="/assets/style.css"></head><body><main class="wrap intro" itemscope itemtype="https://schema.org/WebSite">
<meta itemprop="name" content="Freebie Trail"><meta itemprop="alternateName" content="懸賞さんぽ">
<link itemprop="url" href="${origin.origin}/">
<div class="brand">${brand("Freebie Trail / 懸賞さんぽ")}</div><h1>Free giveaways & rewards</h1><p lang="ja">無料で応募できる懸賞と、アンケート・タスク報酬の情報サイト。</p><p>Compare prizes, entry requirements and deadlines. Eligibility depends on where you live.</p><p lang="ja">日本を中心に、英国・米国向けの募集も掲載。各ページで居住条件を確認できます。</p>
<div class="actions"><a class="button" href="/ja/" lang="ja" hreflang="ja">日本語</a>
<a class="button secondary" href="/en/" hreflang="en">English</a></div><nav class="root-links" aria-label="Browse"><a href="/ja/sweepstakes/" lang="ja">懸賞・プレゼント</a><a href="/en/international/">International opportunities</a><a href="/en/rewards/">Surveys & task rewards</a></nav></main></body></html>`);
await write('404.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="robots" content="noindex"><link rel="stylesheet" href="/assets/style.css"><title>404 | Freebie Trail / 懸賞さんぽ</title></head>
<body><main class="wrap intro"><h1>Page unavailable</h1><p lang="ja">ページを表示できません。</p>
<div class="actions"><a href="/ja/" lang="ja">日本語ホーム</a><a href="/en/">English home</a></div></main></body></html>`);
await write('_redirects', redirects.join('\n') + '\n');
await write('robots.txt', configured ? `User-agent: *\nAllow: /\nSitemap: ${origin.origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n');
await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${[{path:'/',page:''}, ...maps].map(({path,page:key,locales}) => `<url><loc>${origin.origin}${path}</loc>${alternates(key,locales).map(([lang,href]) =>
  `<xhtml:link rel="alternate" hreflang="${lang}" href="${origin.origin}${href}"/>`).join('')}</url>`).join('\n')}
</urlset>\n`);
// Complete rendering before updating output. Preserve directories watched by Wrangler dev.
const generated = new Set(await readdir(dist, {recursive:true}));
await mkdir(destination, {recursive:true});
await cp(dist, destination, {recursive:true});
for (const item of await readdir(destination, {recursive:true, withFileTypes:true})) {
  if (!item.isFile()) continue;
  const file = resolve(item.parentPath, item.name);
  if (!generated.has(relative(destination,file))) await rm(file);
}
await rm(dist, {recursive:true, force:true});
console.log(`Built ${maps.length} localized pages with ${rows.length} listings.`);
