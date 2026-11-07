import {readFile, mkdir, writeFile, copyFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {copy, email, languages, verifyLocales} from './locales.mjs';
import {date, expiration, expired, money, ordered, stale} from './domain.mjs';

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
const now = Date.now();
const taskService = row => row.category === 'affiliate' && !row.commission;
const sponsoredLink = row => row.affiliate_approval_status === 'approved' && row.affiliate_url &&
  Date.parse(row.affiliate_expires_at) > now;
const rows = ordered(dataset.records.filter(row => !expired(row, now) && (!taskService(row) || sponsoredLink(row))), now);
const dist = resolve('dist');
await rm(dist, {recursive:true, force:true});
await mkdir(dist + '/assets', {recursive:true});
const write = (file, data) => writeFile(dist + '/' + file, data);
for (const asset of ['style.css', 'client.mjs', 'domain.mjs', 'mark.svg', 'social.png', 'chevron.svg']) {
  await copyFile('site/' + asset, dist + '/assets/' + asset);
}
await copyFile('site/favicon.ico', dist + '/favicon.ico');
if (analytics) await copyFile('site/analytics.mjs', dist + '/assets/analytics.mjs');
const headers = await readFile('site/_headers', 'utf8');
const collection = 'https://www.google-analytics.com https://region1.google-analytics.com https://analytics.google.com';
await write('_headers', analytics ? headers
  .replace("script-src 'self';", "script-src 'self' https://www.googletagmanager.com/gtag/;")
  .replace("img-src 'self';", `img-src 'self' ${collection};`)
  .replace("connect-src 'self';", `connect-src 'self' ${collection} https://www.googletagmanager.com;`) : headers);
await write('opportunities.json', JSON.stringify({...dataset, records:rows}));

export const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
}[char]));
const e = escape;
const url = (lang, page = '') => '/' + lang + '/' + (page ? page + '/' : '');
const detail = (lang, row) => url(lang, 'opportunities/' + row.id);
const time = (value, lang, full = false, zone) => `<time datetime="${e(value)}">${e(date(value, lang, full, zone))}</time>`;
const address = `<a href="mailto:${email}">${email}</a>`;
const brand = name => `<img src="/assets/mark.svg" alt="" width="32" height="32"><span>${e(name)}</span>`;
const primary = ['opportunities', 'sweepstakes', 'rewards', 'international'];
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

function external(destination, label, event = null, context = '') {
  const sponsored = event === 'affiliate_click';
  // Keep the listing open while GA4 dispatches a consented outbound click.
  const target = ' target="_blank"';
  const parsed = new URL(destination);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Unsafe destination');
  return `<a class="button ${sponsored ? 'sponsored-button' : ''}" href="${e(destination)}"${context ? ` aria-label="${e(label + ' · ' + context)}"` : ''}${target} rel="${sponsored ? 'sponsored nofollow ' : ''}noopener noreferrer"${event && analytics ? ` data-analytics-click="${event}"` : ''}>${e(label)}</a>`;
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

function layout(lang, page, title, description, content, indexable = true) {
  const t = copy[lang];
  const other = lang === 'ja' ? 'en' : 'ja';
  const current = url(lang, page);
  const consent = analytics ? consentControls(t,lang) : null;
  const switcher = `<a class="language" aria-label="${other === 'ja' ? '日本語に切り替える' : 'Switch to English'}" href="${url(other, page)}" lang="${other}" hreflang="${other}">${t.otherLanguage}</a>`;
  const links = keys => keys.map(key => `<a href="${url(lang, key)}"${key === page ? ' aria-current="page"' : ''}>${e(key === 'opportunities' && lang === 'en' ? 'All listings' : key === 'sweepstakes' && lang === 'en' ? 'Giveaways' : key === 'international' && lang === 'en' ? 'International' : t.pages[key][0])}</a>`).join('');
  const name = e(t.copyright);
  const fullTitle = e(page ? title + ' | ' + t.copyright : t.copyright + ' · ' + title);
  if (indexable) maps.push({path:current, page});
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title><meta name="description" content="${e(description)}">
${adsenseMeta}${impactMeta}
<meta name="author" content="${name}"><meta name="contact" content="${email}">
<meta name="robots" content="${configured && indexable ? 'index, follow' : 'noindex, follow'}">
<link rel="canonical" href="${origin.origin}${current}">
${languages.map(locale => `<link rel="alternate" hreflang="${locale}" href="${origin.origin}${url(locale, page)}">`).join('\n')}
<link rel="alternate" hreflang="x-default" href="${origin.origin}${page ? url('en', page) : '/'}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${name}">
<meta property="og:title" content="${fullTitle}"><meta property="og:description" content="${e(description)}">
<meta property="og:locale" content="${lang === 'ja' ? 'ja_JP' : 'en_US'}"><meta property="og:locale:alternate" content="${other === 'ja' ? 'ja_JP' : 'en_US'}">
<meta property="og:url" content="${origin.origin}${current}">
<meta property="og:image" content="${origin.origin}/assets/social.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="/assets/mark.svg"><link rel="stylesheet" href="/assets/style.css">
<script type="module" src="/assets/client.mjs"></script>
${consent ? '<script type="module" src="/assets/analytics.mjs"></script>' : ''}</head>
<body><a class="skip" href="#main">${t.skip}</a><header class="masthead"><div class="wrap header-inner">
<a href="${url(lang)}" class="brand">${brand(t.copyright)}</a>${switcher}
<nav class="desktop-nav" aria-label="${e(t.navigation)}">${links(primary)}</nav><details class="site-menu"><summary>${t.menu}</summary><nav aria-label="${e(t.navigation)}">${links(primary)}</nav></details></div></header>
${consent?.panel || ''}
<main id="main" class="wrap"${page === '' ? ' itemscope itemtype="https://schema.org/WebSite"' : ''}>
${page === '' ? `<meta itemprop="name" content="${name}"><meta itemprop="url" content="${origin.origin}${current}"><meta itemprop="inLanguage" content="${lang}">
<div itemprop="publisher" itemscope itemtype="https://schema.org/Organization"><meta itemprop="name" content="${name}"><meta itemprop="email" content="${email}"></div>` : ''}
${content}</main>
<footer><div class="wrap foot-inner"><div><a href="${url(lang)}" class="brand">${brand(t.copyright)}</a>
<p class="muted">${e(t.pages.about[1])}</p><p class="muted">${t.legalContact} · ${address}</p></div>
<nav aria-label="${e(t.footerNavigation)}">${links(secondary)}${switcher}</nav>
${consent?.settings || ''}<p class="muted">© ${t.copyright}</p></div></footer></body></html>`;
}

const deadlineText = (row, lang) => row.deadline
  ? time(row.deadline,lang,!row.deadline_date_only, row.deadline_timezone ||
    (row.language === 'ja' ? 'Asia/Tokyo' : undefined)) : copy[lang].noDeadline;
const compactCountries = (row, lang) => row.eligibility_verified && Array.isArray(row.eligible_countries) && row.eligible_countries.length > 4
  ? (lang === 'ja' ? row.eligible_countries.length + 'の国・地域（詳細を確認）' : row.eligible_countries.length + ' countries / regions — see details') : countryText(row,lang);
const sourceLabel = (link, row, t) => /withdrawal|cash.?out/.test(link) ? t.sourcePayout : /privacy/.test(link) ? t.sourcePrivacy : /partner-advertiser/.test(link) ? t.sourcePolicy : /terms|rules|kiyaku|about-site|iframeView/.test(link) ? t.sourceTerms : link === row.source_url ? row.provider + (row.category === 'sweepstakes' ? ' · ' + t.sourceTerms : '') : t.sourceGuide + ' · ' + new URL(link).hostname;


function freecashCard(row, lang) {
  const t = copy[lang];
  return `<article class="card sponsored-card task-card" data-record="${e(row.id)}" data-deadline="${e(row.deadline || '')}" data-affiliate-expires="${e(row.affiliate_expires_at)}"${analytics ? ` data-analytics-entry="${e(row.id)}" data-analytics-category="${e(row.category)}"` : ''}>
<div class="labels"><span>${t.taskRewards}</span><span class="sponsored-label">${t.sponsoredLabel}</span></div>
<h3>Freecash</h3><p class="card-summary">${t.freecashCardSummary}</p>
<p class="small card-conditions">${t.freecashCardCost}<br>${t.freecashCardConditions}</p>
<p class="notice" data-stale="${e(row.stale_at)}"${stale(row,now) ? '' : ' hidden'}>${t.stale}</p>
<div class="card-footer"><div class="actions">${external(row.affiliate_url,t.sponsoredVisit,'affiliate_click','Freecash')}<a class="card-details" href="${detail(lang,row)}" aria-label="${e(t.freecashCardDetails + ' · Freecash')}">${t.freecashCardDetails}</a></div>
<p class="small card-disclosure">${t.freecashCardDisclosure}</p></div></article>`;
}

function card(row, lang) {
  if (row.id === 'freecash' && sponsoredLink(row)) return freecashCard(row,lang);
  const t = copy[lang];
  const title = row['title_' + lang];
  const sponsored = taskService(row);
  const isDraw = row.category === 'sweepstakes';
  const group = sponsored ? t.taskRewards : row.prize_category ? t.prizes[row.prize_category] : t.categories[row.category];
  return `<article class="card${sponsored ? ' sponsored-card' : ''}" data-record="${e(row.id)}" data-deadline="${e(row.deadline || '')}"${sponsored ? ` data-affiliate-expires="${e(row.affiliate_expires_at)}"` : ''}${analytics ? ` data-analytics-entry="${e(row.id)}" data-analytics-category="${e(row.category)}"` : ''}>
<div class="labels"><span>${e(group)}</span>${sponsored ? `<span class="sponsored-label">${t.sponsoredLabel}</span>` : ''}</div>
<h3><a href="${detail(lang,row)}">${e(title)}</a></h3>
<p class="provider">${e(row.provider)}</p><p class="card-summary">${e(row['description_' + lang])}</p>
${fields([
  [sponsored ? t.promotionalMarkets : lang === 'ja' ? '対象地域' : 'Location',e(compactCountries(row,lang))],
  ...(row.deadline ? [[t.deadline,deadlineText(row,lang)]] : []),
  ...(isDraw ? row.entry.registration !== 'unknown' ? [[lang === 'ja' ? '登録' : 'Account',e(t.registrations[row.entry.registration])]] : [] : [[t.expense,e(sponsored ? t.freecashCost : t.expenses[row.required_expense.kind])]]),
])}
${isDraw && row.application?.sns_required === false ? `<p class="small">${t.application.noSns}${row.application.difficulty === 'easy' ? ' · ' + t.application.easyApply : ''}</p>` : ''}
<p class="notice" data-stale="${e(row.stale_at)}"${stale(row,now) ? '' : ' hidden'}>${t.stale}</p>
${sponsored ? `<p class="small">${t.affiliateDisclosure}</p>` : ''}
<div class="card-footer"><p class="stamp">${t.checked} · ${time(row.last_checked_at,lang)}</p>
${sponsored ? `<a class="text-link" href="${detail(lang,row)}">${t.details} →</a>` : external(row.official_url,isDraw ? t.officialNewTab : t.visitOfficial,row.commission ? null : 'application_click',title)}</div></article>`;
}

function filters(lang, available) {
  const t = copy[lang];
  const countries = [...new Set(available.flatMap(row => Array.isArray(row.eligible_countries) ? row.eligible_countries : []))];
  countries.sort((a,b) => name(lang,a).localeCompare(name(lang,b),lang));
  const options = (id,label,values,empty = true) => `<label>${e(label)}<select name="${id}">${empty ? `<option value="">${t.all}</option>` : ''}${Object.entries(values).map(([value,text]) => `<option value="${e(value)}">${e(text)}</option>`).join('')}</select></label>`;
  return `<form class="filter" id="filters" role="search" aria-labelledby="filter-title" aria-busy="true"><fieldset disabled>
<h2 id="filter-title" class="sr-only">${t.filters}</h2>
<div class="search-row"><label class="search">${t.search}<input type="search" name="q" placeholder="${e(t.placeholder)}" maxlength="150"></label>
${options('sort',t.sort,{'':t.recommended,deadline:t.deadlineSort,newest:t.newest},false)}</div>
<div class="quick-filters">${[['noSns',t.application.noSns],['freeEntry',t.freeEntry],['closingSoon',t.closingSoon],['easyApply',t.application.easyApply]].map(([key,label]) => `<label class="filter-chip"><input type="checkbox" name="${key}" value="yes"><span>${label}</span></label>`).join('')}</div>
<div class="filter-toolbar"><p class="result-status" role="status" aria-live="polite" aria-atomic="true"><span id="result-count">${available.length}</span>${t.count}</p><button type="reset" disabled>${t.reset}</button></div>
<details class="filter-options"><summary>${t.advanced}</summary><div class="advanced-scroll"><div class="filter-grid">
${options('country',t.country,{...Object.fromEntries(countries.map(c => [c,name(lang,c)])),unknown:t.unknown})}
${options('category',t.category,Object.fromEntries([...new Set(available.map(row => row.category))].map(key => [key,key === 'affiliate' && available.some(taskService) ? t.taskRewards : t.categories[key]])))}${options('prize_category',t.prizeCategory,t.prizes)}
${options('registration',t.registration,t.registrations)}${options('language',t.sourceLanguage,t.languages)}
${options('reward_type',t.reward,t.rewards)}${options('expense',t.expense,t.expenses)}
${options('participation_method',t.method,t.methods)}${options('deadline',t.deadline,{any:t.hasDeadline,7:t.within7,30:t.within30})}
</div><div class="filter-checks">
<label class="checkbox"><input type="checkbox" name="explicitJapan" value="yes">${t.japan}</label>
<label class="checkbox"><input type="checkbox" name="emailOnly" value="yes">${t.emailOnly}</label>
<label class="checkbox"><input type="checkbox" name="webOnly" value="yes">${t.application.webOnly}</label>
</div></div><button type="button" data-show-results>${t.showResults} <span data-result-count>${available.length}</span></button></details>
<div class="active-filters sr-only" hidden><span>${t.activeFilters}</span><ul></ul></div></fieldset></form>
<noscript><p class="notice">${t.javascript}</p></noscript><p class="notice" data-filter-error hidden>${t.failure}</p>`;
}

function directory(lang, available) {
  const t = copy[lang];
  const filtered = available.length ? filters(lang,available) : '';
  return `${filtered}${available.length ? '' : `<p class="stamp" role="status"><span id="result-count">0</span>${t.count}</p>`}
<p class="notice" data-empty ${available.length ? 'hidden' : ''}>${t.empty} <a href="${url(lang,'rewards')}">${t.relatedRewards}</a></p>
<section class="cards" aria-labelledby="listing-results"><h2 class="sr-only" id="listing-results" tabindex="-1">${e(t.results)}</h2>${available.map(row => card(row,lang)).join('')}</section>`;
}

function details(lang, row) {
  const t = copy[lang];
  const sponsored = taskService(row);
  const section = sponsored ? 'rewards' : row.commission ? 'affiliates' : 'opportunities';
  const title = row['title_' + lang];
  const personal = values => e(values.length ? values.map(value => t.personal[value]).join(lang === 'ja' ? '、' : ', ') : t.noPersonal);
  const requirements = [
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
<header class="detail-heading"><div class="labels"><span>${e(sponsored ? t.taskRewards : t.categories[row.category])}</span>${sponsored ? `<span class="sponsored-label">${t.sponsoredLabel}</span>` : ''}</div>
<h1>${e(title)}</h1><p class="provider">${e(row.provider)}</p><p class="lead">${e(row['description_' + lang])}</p></header>
<p class="notice" data-stale="${e(row.stale_at)}"${stale(row,now) ? '' : ' hidden'}>${t.stale}</p><p class="notice" data-ended hidden>${t.expired}</p>
<section class="detail-overview" aria-label="${t.rewardSummary}">${fields([
    [t.expense,e(sponsored ? t.freecashCost : t.expenses[row.required_expense.kind])],
    [t.eligibility,e(row['eligibility_' + lang])],
    ...(row.deadline ? [[t.deadline,deadlineText(row,lang)]] : []),
    ...(row.reward_amount !== null ? [[t.amount,e(amount(row,lang))]] : []),
])}</section>
<div class="entry-action${sponsored ? ' ad-action' : ''}" data-expiring="${e(row.deadline || '')}"${sponsored ? ` data-affiliate-expires="${e(row.affiliate_expires_at)}"` : ''}>
${sponsoredLink(row) ? `<p class="ad-disclosure"><strong>${t.sponsoredLabel}</strong> · ${t.affiliateDisclosure}</p><div class="actions">${external(row.affiliate_url,sponsored ? t.sponsoredVisit : t.sponsored,'affiliate_click')}</div><p class="secondary-official"><a href="${e(row.official_url)}" target="_blank" rel="noopener noreferrer">${t.official}</a></p>` : `<div class="actions">${external(row.official_url,row.category === 'sweepstakes' ? t.officialNewTab : t.visitOfficial,row.commission ? null : 'application_click')}</div>`}
</div>
<div class="detail-body"><section><h2>${t.entryRequirements}</h2>
${row.entry.steps ? `<p>${e(row.entry.steps[lang])}</p>` : ''}${fields(requirements)}
${!sponsored && row.risk_flags.some(flag => !['account','variable'].includes(flag)) ? `<p class="small">${row.risk_flags.filter(flag => !['account','variable'].includes(flag)).map(flag => e(t.risks[flag])).join(lang === 'ja' ? '・' : ' · ')}</p>` : ''}
${row.entry.registration === 'unknown' || (row.certainty === 'chance' && (row.entry.application === null || row.entry.winner === null)) ? `<p class="small">${t.entryUnknown}</p>` : ''}</section>
<section><h2>${t.conditions}</h2><p>${e(row.reward_conditions[lang])}</p>
${sponsored ? `<p>${t.freecashPayout}</p><details class="country-details"><summary>${t.markets}</summary><p>${e(countryText(row,lang))}</p><p>${t.freecashRestrictions}</p></details>` : Array.isArray(row.eligible_countries) && row.eligible_countries.length > 4 ? `<details class="country-details"><summary>${t.countries}</summary><p>${e(countryText(row,lang))}</p></details>` : ''}
${terms}</section></div>
<section class="sources"><h2>${t.officialSources}</h2><p class="stamp">${t.checked} · ${time(row.last_checked_at,lang,true)}</p>
<ul class="source-links">${links.map(link => `<li><a href="${e(link)}" target="_blank" rel="noopener noreferrer">${e(sourceLabel(link,row,t))}</a></li>`).join('')}</ul></section>
<template id="adsense-slot"></template></article>`;
}

async function page(lang, key, title, description, content, indexable = true) {
  const folder = url(lang,key).slice(1);
  await mkdir(dist + '/' + folder, {recursive:true});
  await write(folder + 'index.html', layout(lang,key,title,description,content,indexable));
}

const consumer = rows.filter(row => row.category !== 'affiliate' || taskService(row));
const rewardRows = consumer.filter(row => row.category !== 'sweepstakes');
for (const lang of languages) {
  const t = copy[lang];
  const hapitasAd = hapitasUrl && now < Date.parse(hapitasDeadline)
    ? `<aside class="notice" data-affiliate-expires="${hapitasDeadline}" data-analytics-affiliate="hapitas-referral">
<p class="tag">${t.hapitas.label}</p><h2>${t.hapitas.title}</h2><p>${t.hapitas.body}</p>
${external(hapitasUrl,t.hapitas.cta,'affiliate_click')}
<p><a href="https://hapitas.jp/special/referral202611" rel="noopener noreferrer">${t.hapitas.terms}</a> · ${t.hapitas.deadline} ${time('2026-11-30T14:59:00Z',lang,true)}</p></aside>` : '';
  const giveaways = consumer.filter(row => row.category === 'sweepstakes');
  const featured = giveaways.filter(row => row.deadline).sort((a,b) => expiration(a) - expiration(b) || a.id.localeCompare(b.id)).slice(0,3);
  const recent = [...consumer].sort((a,b) => b.first_seen_at.localeCompare(a.first_seen_at)).slice(0,4);
  const recentList = `<section class="section"><div class="section-heading"><h2>${t.recent}</h2></div>
<ul class="recent-list">${recent.map(row => `<li data-expiring="${e(row.deadline || '')}"><a href="${detail(lang,row)}">${e(row['title_' + lang])}</a>
<span>${e(row.provider)}</span><span>${time(row.first_seen_at,lang)}</span></li>`).join('')}</ul></section>`;
  const rewardsPreview = `<section class="section"><div class="section-heading"><h2><a href="${url(lang,'rewards')}">${t.pages.rewards[0]}</a></h2><p>${t.rewardsLead}</p></div><div class="cards">${['freecash','research-panel','prolific'].map(id => rewardRows.find(row => row.id === id)).filter(Boolean).map(row => card(row,lang)).join('')}</div></section>`;
  await page(lang,'',t.tagline,t.lead,`<section class="hero"><div class="hero-copy"><p class="eyebrow">${t.cap}</p><h1>${t.tagline}</h1><p class="lead">${t.lead}</p>
<form class="home-search" role="search" action="${url(lang,'opportunities')}" method="get"><label class="sr-only" for="home-query">${t.search}</label><input id="home-query" type="search" name="q" maxlength="150" placeholder="${e(t.placeholder)}"><button type="submit">${t.searchSubmit}</button></form>
<div class="home-shortcuts"><a href="${url(lang,'sweepstakes')}?noSns=yes">${t.application.noSns}</a><a href="${url(lang,'sweepstakes')}?easyApply=yes">${t.application.easyApply}</a><a href="${url(lang,'international')}">${t.pages.international[0]}</a></div></div></section>
<section class="section featured"><div class="section-heading"><h2>${t.closing}</h2><a href="${url(lang,'sweepstakes')}">${t.browse} →</a></div>
<div class="cards">${featured.length ? featured.map(row => card(row,lang)).join('') : `<p>${t.empty}</p>`}</div></section>
${rewardsPreview}${recentList}${hapitasAd}`);
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
    await page(lang,key,title,description,`<header class="intro"><h1>${e(title)}</h1><p class="lead">${e(description)}</p>
${key === 'sweepstakes' && lang === 'en' ? '<p class="region-note">Most listings are for Japan residents. Filter by your country before entering.</p>' : ''}${key === 'affiliates' ? `<a href="${url(lang,'rewards')}">${t.pages.rewards[0]} →</a>` : ''}</header>${directory(lang,available)}`,available.length > 0);
  }
  for (const key of secondary.filter(key => !['affiliates','guaranteed'].includes(key))) {
    const [title, description] = t.pages[key];
    const sections = t.articles[key].map(([heading, body]) => `<h2>${e(heading)}</h2><p>${e(body)}</p>`).join('');
    await page(lang,key,title,description,`<article class="article"><h1>${e(title)}</h1><p class="lead">${e(description)}</p>
${sections}${key === 'privacy' ? `<p><a href="https://policies.google.com/technologies/partner-sites?hl=${lang}" rel="noopener noreferrer">${t.analytics.googlePolicy}</a></p>` : ''}
${key === 'privacy' && analytics ? `<p><button type="button" data-analytics-settings>${t.analytics.settings}</button></p>` : ''}${['contact','privacy','disclosure'].includes(key) ? `<p>${t.legalContact} · ${address}</p>` : ''}</article>`);
  }
  for (const row of rows) {
    await page(lang,'opportunities/' + row.id,row['title_' + lang],row['description_' + lang],details(lang,row));
  }
}
await write('index.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Freebie Trail / 懸賞さんぽ | Choose a language</title>${adsenseMeta}${impactMeta}
<meta name="description" content="Find giveaways you can enter without a purchase.">
<meta property="og:image" content="${origin.origin}/assets/social.png"><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/favicon.ico"><meta property="og:title" content="Freebie Trail / 懸賞さんぽ"><meta property="og:description" content="Find giveaways you can enter without a purchase."><meta property="og:url" content="${origin.origin}/"><link rel="canonical" href="${origin.origin}/">
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
await write('robots.txt', configured ? `User-agent: *\nAllow: /\nSitemap: ${origin.origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n');
await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${[{path:'/',page:''}, ...maps].map(({path,page:key}) => `<url><loc>${origin.origin}${path}</loc>${languages.map(lang =>
  `<xhtml:link rel="alternate" hreflang="${lang}" href="${origin.origin}${url(lang,key)}"/>`).join('')}<xhtml:link rel="alternate" hreflang="x-default" href="${origin.origin}${key ? url('en',key) : '/'}"/></url>`).join('\n')}
</urlset>\n`);
console.log(`Built ${maps.length} localized pages with ${rows.length} listings.`);
