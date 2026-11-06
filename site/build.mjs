import {readFile, mkdir, writeFile, copyFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {copy, email, languages, verifyLocales} from './locales.mjs';
import {date, expired, money, ordered, stale} from './domain.mjs';

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
const rows = ordered(dataset.records.filter(row => !expired(row, now)), now);
const dist = resolve('dist');
await rm(dist, {recursive:true, force:true});
await mkdir(dist + '/assets', {recursive:true});
const write = (file, data) => writeFile(dist + '/' + file, data);
for (const asset of ['style.css', 'client.mjs', 'domain.mjs', 'mark.svg']) {
  await copyFile('site/' + asset, dist + '/assets/' + asset);
}
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
const time = (value, lang, full = false) => `<time datetime="${e(value)}">${e(date(value, lang, full))}</time>`;
const address = `<a href="mailto:${email}">${email}</a>`;
const brand = name => `<img src="/assets/mark.svg" alt="" width="32" height="32"><span>${e(name)}</span>`;
const primary = ['opportunities', 'sweepstakes', 'guaranteed', 'international'];
const secondary = ['affiliates', 'ranking', 'about', 'contact', 'privacy', 'disclosure'];
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

function external(destination, label, event = null) {
  const sponsored = event === 'affiliate_click';
  const parsed = new URL(destination);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Unsafe destination');
  return `<a class="button ${sponsored ? 'secondary' : ''}" href="${e(destination)}" rel="${sponsored ? 'sponsored nofollow ' : ''}noopener noreferrer"${event && analytics ? ` data-analytics-click="${event}"` : ''}>${e(label)}</a>`;
}

function consentControls(t, lang) {
  const c = t.analytics;
  const settings = `<button type="button" data-analytics-settings>${c.settings}</button>`;
  const choices = `<button type="button" data-analytics-choice="accept">${c.accept}</button>
<button type="button" data-analytics-choice="reject">${c.reject}</button>`;
  return {
    settings,
    panel: `<section class="analytics-notice wrap" data-analytics-id="${analytics}" aria-labelledby="analytics-title" hidden>
<h2 id="analytics-title">${c.title}</h2><p>${c.summary} <a href="${url(lang,'privacy')}">${t.pages.privacy[0]}</a></p>
<div class="actions">${choices}${settings}</div></section>
<dialog id="analytics-dialog" aria-labelledby="analytics-settings-title">
<h2 id="analytics-settings-title">${c.settings}</h2><p>${c.details}</p>
<p data-analytics-status="accept" hidden>${c.allowed}</p><p data-analytics-status="reject" hidden>${c.denied}</p>
<p data-analytics-status="unset" hidden>${c.undecided}</p>
<div class="actions">${choices}<button type="button" data-analytics-close>${c.close}</button></div></dialog>`,
  };
}

function layout(lang, page, title, description, content, indexable = true) {
  const t = copy[lang];
  const other = lang === 'ja' ? 'en' : 'ja';
  const current = url(lang, page);
  const consent = analytics ? consentControls(t,lang) : null;
  const switcher = `<a class="language" href="${url(other, page)}" lang="${other}" hreflang="${other}">${t.otherLanguage}</a>`;
  const links = keys => keys.map(key => `<a href="${url(lang, key)}"${key === page ? ' aria-current="page"' : ''}>${e(t.pages[key][0])}</a>`).join('');
  const name = e(t.copyright);
  const fullTitle = e(page ? title + ' | ' + t.copyright : t.copyright + ' · ' + title);
  if (indexable) maps.push({path:current, page});
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title><meta name="description" content="${e(description)}">
${adsenseMeta}
<meta name="author" content="${name}"><meta name="contact" content="${email}">
<meta name="robots" content="${configured && indexable ? 'index, follow' : 'noindex, follow'}">
<link rel="canonical" href="${origin.origin}${current}">
${languages.map(locale => `<link rel="alternate" hreflang="${locale}" href="${origin.origin}${url(locale, page)}">`).join('\n')}
<link rel="alternate" hreflang="x-default" href="${origin.origin}${page ? url('en', page) : '/'}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${name}">
<meta property="og:title" content="${fullTitle}"><meta property="og:description" content="${e(description)}">
<meta property="og:locale" content="${lang === 'ja' ? 'ja_JP' : 'en_US'}"><meta property="og:locale:alternate" content="${other === 'ja' ? 'ja_JP' : 'en_US'}">
<meta property="og:url" content="${origin.origin}${current}">
<link rel="icon" type="image/svg+xml" href="/assets/mark.svg"><link rel="stylesheet" href="/assets/style.css">
<script type="module" src="/assets/client.mjs"></script>
${consent ? '<script type="module" src="/assets/analytics.mjs"></script>' : ''}</head>
<body><a class="skip" href="#main">${t.skip}</a><header class="masthead"><div class="wrap header-inner">
<a href="${url(lang)}" class="brand">${brand(t.copyright)}</a>${switcher}
<nav aria-label="${e(t.navigation)}">${links(primary)}</nav></div></header>
${consent?.panel || ''}
<main id="main" class="wrap"${page === '' ? ' itemscope itemtype="https://schema.org/WebSite"' : ''}>
${page === '' ? `<meta itemprop="name" content="${name}"><meta itemprop="url" content="${origin.origin}${current}"><meta itemprop="inLanguage" content="${lang}">` : ''}
${content}</main>
<footer><div class="wrap foot-inner"><div><a href="${url(lang)}" class="brand">${brand(t.copyright)}</a>
<p class="muted">${t.legalContact} · ${address}</p></div>
<nav aria-label="${e(t.footerNavigation)}">${links(secondary)}${switcher}</nav>
${consent?.settings || ''}<p class="muted">© ${t.copyright}</p></div></footer></body></html>`;
}

function card(row, lang) {
  const t = copy[lang];
  return `<article class="card" data-record="${e(row.id)}" data-deadline="${e(row.deadline || '')}">
<div class="labels"><span>${e(row.prize_category ? t.prizes[row.prize_category] : t.categories[row.category])}</span><span>${e(t.expenses[row.required_expense.kind])}</span></div>
<h3><a href="${detail(lang,row)}">${e(row['title_' + lang])}</a></h3>
<p class="provider">${e(row.provider)}</p><p>${e(row['description_' + lang])}</p>
<p class="card-region">${e(row.eligibility_verified && Array.isArray(row.eligible_countries) && row.eligible_countries.length > 5
  ? row['eligibility_' + lang] : t.country + ' · ' + countryText(row,lang))}</p>
${row.deadline ? `<p class="small">${t.deadline} · ${time(row.deadline,lang,!row.deadline_date_only)}</p>` : ''}
<p class="stamp">${t.checked} · ${time(row.last_checked_at,lang)}</p>
<p class="notice" data-stale="${e(row.stale_at)}"${stale(row,now) ? '' : ' hidden'}>${t.stale}</p></article>`;
}

function filters(lang, available) {
  const t = copy[lang];
  const countries = [...new Set(available.flatMap(row =>
    Array.isArray(row.eligible_countries) ? row.eligible_countries : []))];
  countries.sort((a,b) => name(lang,a).localeCompare(name(lang,b),lang));
  const currencies = [...new Set(available.flatMap(row => [row.reward_currency, ...row.reward_currencies]).filter(Boolean))].sort();
  const options = (id, label, values) => `<label>${e(label)}<select name="${id}">
<option value="">${t.all}</option>${Object.entries(values).map(([value, text]) =>
    `<option value="${e(value)}">${e(text)}</option>`).join('')}</select></label>`;
  return `<form class="filter" id="filters" hidden><h2>${t.filters}</h2>
<label class="search">${t.search}<input type="search" name="q" placeholder="${e(t.placeholder)}" maxlength="150"></label>
<div class="filter-grid">
${options('country', t.country, {...Object.fromEntries(countries.map(c => [c,name(lang,c)])),unknown:t.unknown})}
${options('language',t.sourceLanguage,t.languages)}
${options('category',t.category,t.categories)}
${options('prize_category',t.prizeCategory,t.prizes)}
${options('registration',t.registration,t.registrations)}
${options('reward_type',t.reward,t.rewards)}
${options('reward_currency',t.currency,{...Object.fromEntries(currencies.map(c => [c,c])),unknown:t.unknown})}
${options('expense',t.expense,t.expenses)}
${options('participation_method',t.method,t.methods)}
${options('deadline',t.deadline,{any:t.hasDeadline,7:t.within7,30:t.within30})}
${options('certainty',t.certainty,t.certainties)}
${options('effort',t.maxEffort,Object.fromEntries([5,15,30,60].map(n => [n,n + t.minutes + t.within])))}
</div><div class="filter-actions"><label class="checkbox"><input type="checkbox" name="explicitJapan" value="yes">${t.japan}</label>
<label class="checkbox"><input type="checkbox" name="emailOnly" value="yes">${t.emailOnly}</label>
<label class="checkbox"><input type="checkbox" name="organizer" value="yes">${t.organizerFilter}</label>
${['noSns','webOnly','easyApply'].map(key => `<label class="checkbox"><input type="checkbox" name="${key}" value="yes">${t.application[key]}</label>`).join('')}
<button type="reset">${t.reset}</button></div></form>
<noscript><p class="notice">${t.javascript}</p></noscript>
<p class="notice" data-filter-error hidden>${t.failure}</p>`;
}

function directory(lang, available) {
  const t = copy[lang];
  const filtered = available.length ? filters(lang,available) : '';
  return `${filtered}<p class="stamp" role="status"><span id="result-count">${available.length}</span>${t.count}</p>
<p class="notice" data-empty ${available.length ? 'hidden' : ''}>${t.empty}</p>
<section class="cards" aria-label="${e(t.pages.opportunities[0])}"><h2 class="sr-only">${e(t.pages.opportunities[0])}</h2>${available.map(row => card(row,lang)).join('')}</section>`;
}

function details(lang, row) {
  const t = copy[lang];
  const expense = row.required_expense;
  const personal = values => e(values === null ? t.unknown : values.length
    ? values.map(value => t.personal[value]).join(lang === 'ja' ? '、' : ', ') : t.noPersonal);
  const base = [
    [t.provider,e(row.provider) + (row.organizer_verified ? ' · ' + e(t.organizerVerified) : '')],
    [t.category,e(t.categories[row.category])], [t.prizeCategory,e(t.prizes[row.prize_category] || t.unknown)],
    [t.registration,e(t.registrations[row.entry.registration])],
    [t.applicationData,personal(row.entry.application)],
    ...(row.certainty === 'chance' ? [[t.winnerData,personal(row.entry.winner)]] : []),
    [t.listed,e(countryText(row,lang))], [t.sourceLanguage,e(t.languages[row.language])],
    [t.reward,e(t.rewards[row.reward_type])], [t.amount,e(amount(row,lang))],
    [t.currency,e(row.reward_currency || row.reward_currencies.join(' / ') || t.unknown)],
    [t.expense,e(t.expenses[expense.kind]) + (expense.amount > 0 ? ' · ' + e(format(expense.amount,expense.currency,lang)) : '')],
    [t.method,e(t.methods[row.participation_method])], [t.certainty,e(t.certainties[row.certainty])],
    [t.effort,row.estimated_effort_minutes === null ? t.unknown : e(row.estimated_effort_minutes + t.minutes)],
    [t.deadline,row.deadline ? time(row.deadline,lang,!row.deadline_date_only) : t.noDeadline],
  ];
  const app = row.application;
  if (app?.source_url) {
    const a = t.application;
    const yesNo = value => value === null ? t.unknown : value ? a.yes : a.no;
    const socialNames = {x:'X', instagram:'Instagram', line:'LINE', facebook:'Facebook', tiktok:'TikTok', youtube:'YouTube'};
    base.push(
      [a.web, e(app.web_only === null ? t.unknown : app.web_only ? a.webYes : a.webNo)],
      [a.sns, e([yesNo(app.sns_required), ...app.platforms.map(item => socialNames[item])].join(' · '))],
      [a.registration, e(yesNo(app.free_registration))],
      [a.operations, e(app.operations.map(item => a.names[item]).join(' → ') || t.unknown)],
      [a.count, e(app.step_count ?? t.unknown)],
      [a.difficulty, e(a[app.difficulty] || t.unknown)],
      [a.evidence, `<a href="${e(app.source_url)}" rel="noopener noreferrer">${t.source}</a> · ${time(app.checked_at,lang)}`],
    );
  }
  const flags = row.risk_flags.map(flag => `<li>${e(t.risks[flag])}</li>`).join('');
  const c = row.commission;
  const terms = c ? `<h2>${t.commission}</h2>${fields([
    [t.rate,c.percent === null ? t.unknown : e(c.percent + '%')],
    [t.structure,e(t.structures[c.structure])], [t.duration,e(c.months ?? t.unknown)],
    [t.threshold,e(format(c.threshold,c.threshold_currency,lang))],
  ])}` : '';
  return `<article class="article"${analytics ? ` data-analytics-opportunity="${e(row.id)}" data-analytics-category="${e(row.category)}"` : ''}><a href="${url(lang,c ? 'affiliates' : 'opportunities')}">← ${c ? t.affiliateBack : t.back}</a>
<div class="eyebrow">${e(t.categories[row.category])}</div><h1>${e(row['title_' + lang])}</h1>
<p class="lead">${e(row['description_' + lang])}</p>
<p class="stamp">${t.checked} · ${time(row.last_checked_at,lang)}</p>
<p class="notice" data-stale="${e(row.stale_at)}"${stale(row,now) ? '' : ' hidden'}>${t.stale}</p>
<p class="notice" data-ended hidden>${t.expired}</p>
${fields(base)}<h2>${t.eligibility}</h2><p>${e(row['eligibility_' + lang])}</p>
<h2>${t.conditions}</h2><p>${e(row.reward_conditions[lang])}</p>
${row.entry.steps ? `<h2>${t.steps}</h2><p>${e(row.entry.steps[lang])}</p>` : ''}
${row.category === 'sweepstakes' ? `<p class="notice">${t.odds}</p>` : ''}${terms}
${flags ? `<h2>${t.flags}</h2><ul>${flags}</ul>` : ''}
<p class="notice">${t.safer}</p>
<div class="actions" data-expiring="${e(row.deadline || '')}">${external(row.official_url,t.official,c ? null : 'application_click')}
${row.affiliate_url ? `<span data-affiliate-expires="${e(row.affiliate_expires_at || '')}">${external(row.affiliate_url,t.sponsored,'affiliate_click')}</span>` : ''}</div>
<p><a href="${e(new URL(row.source_url).href)}" rel="noopener noreferrer">${t.source}</a></p>
${row.supporting_urls.map((link,index) => `<p><a href="${e(new URL(link).href)}" rel="noopener noreferrer">${t.moreSources} ${index + 1}</a></p>`).join('')}
<template id="adsense-slot"></template></article>`;
}

async function page(lang, key, title, description, content, indexable = true) {
  const folder = url(lang,key).slice(1);
  await mkdir(dist + '/' + folder, {recursive:true});
  await write(folder + 'index.html', layout(lang,key,title,description,content,indexable));
}

const consumer = rows.filter(row => row.category !== 'affiliate');
for (const lang of languages) {
  const t = copy[lang];
  const hapitasAd = hapitasUrl && now < Date.parse(hapitasDeadline)
    ? `<aside class="notice" data-affiliate-expires="${hapitasDeadline}" data-analytics-affiliate="hapitas-referral">
<p class="tag">${t.hapitas.label}</p><h2>${t.hapitas.title}</h2><p>${t.hapitas.body}</p>
${external(hapitasUrl,t.hapitas.cta,'affiliate_click')}
<p><a href="https://hapitas.jp/special/referral202611" rel="noopener noreferrer">${t.hapitas.terms}</a> · ${t.hapitas.deadline} ${time('2026-11-30T14:59:00Z',lang,true)}</p></aside>` : '';
  const featured = consumer.filter(row => row.category === 'sweepstakes').slice(0,3);
  const comparison = ['macromill','research-panel','prolific'].map(id => consumer.find(row => row.id === id)).filter(Boolean);
  const table = `<section class="section"><h2>${t.compare}</h2><p>${t.compareLead}</p>
<div class="comparison">${comparison.map(row => `<article><h3><a href="${detail(lang,row)}">${e(row['title_' + lang])}</a></h3>
<p>${e(row['eligibility_' + lang])}</p><p>${e(row.reward_conditions[lang])}</p></article>`).join('')}</div></section>`;
  await page(lang,'',t.tagline,t.lead,`<section class="hero"><div class="hero-copy">
<p class="eyebrow">${t.cap}</p><h1>${t.tagline}</h1><p class="lead">${t.lead}</p>
<div class="actions"><a class="button" href="${url(lang,'opportunities')}">${t.browse}</a>
<a class="button secondary" href="${url(lang,'ranking')}">${t.checkMethod}</a></div>
</div><div class="radar-art" aria-hidden="true"><img src="/assets/mark.svg" alt="" width="180" height="180"></div></section>
<p class="notice">${t.regionNotice}</p><section class="section"><h2>${t.explore}</h2>
<div class="tiles">${primary.slice(1).map(key => `<a href="${url(lang,key)}"><strong>${e(t.pages[key][0])}</strong><span aria-hidden="true">↗</span></a>`).join('')}</div></section>
<section class="section"><h2>${t.featured}</h2><p>${t.featuredLead}</p>
<div class="cards">${featured.length ? featured.map(row => card(row,lang)).join('') : `<p>${t.empty}</p>`}</div></section>${hapitasAd}${table}`);
  const pages = {
    opportunities: consumer,
    sweepstakes: consumer.filter(row => row.category === 'sweepstakes'),
    guaranteed: consumer.filter(row => row.certainty === 'guaranteed'),
    international: consumer.filter(row => row.category === 'international' || row.eligible_countries === 'worldwide' ||
      (Array.isArray(row.eligible_countries) && row.eligible_countries.length > 1)),
    affiliates: rows.filter(row => row.category === 'affiliate'),
  };
  for (const [key, available] of Object.entries(pages)) {
    const [title, description] = t.pages[key];
    await page(lang,key,title,description,`<header class="intro"><h1>${e(title)}</h1><p class="lead">${e(description)}</p>
<p class="notice">${t.regionNotice}</p></header>${directory(lang,available)}`,available.length > 0);
  }
  for (const key of secondary.filter(key => key !== 'affiliates')) {
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
<title>Freebie Trail / 懸賞さんぽ</title>${adsenseMeta}${impactMeta}
<meta name="description" content="Find giveaways you can enter without a purchase.">
<meta property="og:title" content="Freebie Trail / 懸賞さんぽ"><meta property="og:url" content="${origin.origin}/"><link rel="canonical" href="${origin.origin}/">
${languages.map(lang => `<link rel="alternate" hreflang="${lang}" href="${origin.origin}${url(lang)}">`).join('')}
<link rel="alternate" hreflang="x-default" href="${origin.origin}/">
${configured ? '' : '<meta name="robots" content="noindex">'}
<link rel="stylesheet" href="/assets/style.css"></head><body><main class="wrap intro">
<div class="brand">${brand("Freebie Trail / 懸賞さんぽ")}</div><h1>Choose a language</h1><p lang="ja">表示言語を選んでください。</p>
<div class="actions"><a class="button" href="/ja/" lang="ja" hreflang="ja">日本語</a>
<a class="button secondary" href="/en/" hreflang="en">English</a></div></main></body></html>`);
await write('404.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="robots" content="noindex"><link rel="stylesheet" href="/assets/style.css"><title>404 | Freebie Trail / 懸賞さんぽ</title></head>
<body><main class="wrap intro"><h1>Page unavailable</h1><p lang="ja">ページを表示できません。</p>
<div class="actions"><a href="/ja/" lang="ja">日本語ホーム</a><a href="/en/">English home</a></div></main></body></html>`);
await write('robots.txt', configured ? `User-agent: *\nAllow: /\nSitemap: ${origin.origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n');
await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${maps.map(({path,page:key}) => `<url><loc>${origin.origin}${path}</loc>${languages.map(lang =>
  `<xhtml:link rel="alternate" hreflang="${lang}" href="${origin.origin}${url(lang,key)}"/>`).join('')}<xhtml:link rel="alternate" hreflang="x-default" href="${origin.origin}${key ? url('en',key) : '/'}"/></url>`).join('\n')}
</urlset>\n`);
console.log(`Built ${maps.length} localized pages with ${rows.length} listings.`);
