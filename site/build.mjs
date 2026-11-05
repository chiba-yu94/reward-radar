import {readFile, mkdir, writeFile, copyFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {copy, email, languages, verifyLocales} from './locales.mjs';
import {date, expired, money, ordered, stale} from './domain.mjs';

verifyLocales();
const configured = process.env.SITE_ORIGIN;
const origin = new URL(configured || 'http://localhost:8787');
if (configured && (origin.protocol !== 'https:' || !origin.hostname.endsWith('.workers.dev') ||
    configured !== origin.origin)) throw new Error('SITE_ORIGIN must be the HTTPS workers.dev origin');
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
await copyFile('site/_headers', dist + '/_headers');
await write('opportunities.json', JSON.stringify({...dataset, records:rows}));

export const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
}[char]));
const e = escape;
const url = (lang, page = '') => '/' + lang + '/' + (page ? page + '/' : '');
const detail = (lang, row) => url(lang, 'opportunities/' + row.id);
const time = (value, lang, full = false) => `<time datetime="${e(value)}">${e(date(value, lang, full))}</time>`;
const address = `<a href="mailto:${email}">${email}</a>`;
const brand = '<img src="/assets/mark.svg" alt="" width="32" height="32"><span>Reward Radar</span>';
const primary = ['opportunities', 'sweepstakes', 'guaranteed', 'international', 'affiliates'];
const secondary = ['ranking', 'about', 'contact', 'privacy', 'disclosure'];
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

function external(destination, label, sponsored = false) {
  const parsed = new URL(destination);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Unsafe destination');
  return `<a class="button ${sponsored ? 'secondary' : ''}" href="${e(destination)}" rel="${sponsored ? 'sponsored nofollow ' : ''}noopener noreferrer">${e(label)}</a>`;
}

function layout(lang, page, title, description, content, indexable = true) {
  const t = copy[lang];
  const other = lang === 'ja' ? 'en' : 'ja';
  const current = url(lang, page);
  const switcher = `<a class="language" href="${url(other, page)}" lang="${other}" hreflang="${other}">${t.otherLanguage}</a>`;
  const links = keys => keys.map(key => `<a href="${url(lang, key)}"${key === page ? ' aria-current="page"' : ''}>${e(t.pages[key][0])}</a>`).join('');
  const fullTitle = e(page ? title + ' | Reward Radar' : 'Reward Radar · ' + title);
  if (indexable) maps.push({path:current, page});
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title><meta name="description" content="${e(description)}">
<meta name="author" content="Reward Radar"><meta name="contact" content="${email}">
<meta name="robots" content="${configured && indexable ? 'index, follow' : 'noindex, follow'}">
<link rel="canonical" href="${origin.origin}${current}">
${languages.map(locale => `<link rel="alternate" hreflang="${locale}" href="${origin.origin}${url(locale, page)}">`).join('\n')}
<link rel="alternate" hreflang="x-default" href="${origin.origin}${page ? url('en', page) : '/'}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Reward Radar">
<meta property="og:title" content="${fullTitle}"><meta property="og:description" content="${e(description)}">
<meta property="og:locale" content="${lang === 'ja' ? 'ja_JP' : 'en_US'}"><meta property="og:locale:alternate" content="${other === 'ja' ? 'ja_JP' : 'en_US'}">
<meta property="og:url" content="${origin.origin}${current}">
<link rel="icon" type="image/svg+xml" href="/assets/mark.svg"><link rel="stylesheet" href="/assets/style.css">
<script type="module" src="/assets/client.mjs"></script></head>
<body><a class="skip" href="#main">${t.skip}</a><header class="masthead"><div class="wrap header-inner">
<a href="${url(lang)}" class="brand">${brand}</a>${switcher}
<nav aria-label="${e(t.navigation)}">${links(primary)}</nav></div></header>
<main id="main" class="wrap">${content}</main>
<footer><div class="wrap foot-inner"><div><a href="${url(lang)}" class="brand">${brand}</a>
<p class="muted">${t.legalContact} · ${address}</p></div>
<nav aria-label="${e(t.footerNavigation)}">${links(secondary)}${switcher}</nav>
<p class="muted">© ${t.copyright}</p></div></footer></body></html>`;
}

function card(row, lang) {
  const t = copy[lang];
  return `<article class="card" data-record="${e(row.id)}" data-deadline="${e(row.deadline || '')}">
<div class="labels"><span>${e(t.categories[row.category])}</span><span>${e(t.expenses[row.required_expense.kind])}</span></div>
<h3><a href="${detail(lang,row)}">${e(row['title_' + lang])}</a></h3>
<p class="provider">${e(row.provider)}</p><p>${e(row['description_' + lang])}</p>
<p class="card-region">${e(row.eligibility_verified && Array.isArray(row.eligible_countries) && row.eligible_countries.length > 5
  ? row['eligibility_' + lang] : t.country + ' · ' + countryText(row,lang))}</p>
${row.deadline ? `<p class="small">${t.deadline} · ${time(row.deadline,lang,true)}</p>` : ''}
<p class="stamp">${t.checked} · ${time(row.last_checked_at,lang)}</p>
<p class="notice" data-stale="${e(row.stale_at)}"${stale(row,now) ? '' : ' hidden'}>${t.stale}</p></article>`;
}

function filters(lang, available) {
  const t = copy[lang];
  const countries = [...new Set(available.flatMap(row =>
    Array.isArray(row.eligible_countries) ? row.eligible_countries : []))];
  countries.sort((a,b) => name(lang,a).localeCompare(name(lang,b),lang));
  const currencies = [...new Set(available.map(row => row.reward_currency).filter(Boolean))].sort();
  const options = (id, label, values) => `<label>${e(label)}<select name="${id}">
<option value="">${t.all}</option>${Object.entries(values).map(([value, text]) =>
    `<option value="${e(value)}">${e(text)}</option>`).join('')}</select></label>`;
  return `<form class="filter" id="filters" hidden><h2>${t.filters}</h2>
<label class="search">${t.search}<input type="search" name="q" placeholder="${e(t.placeholder)}" maxlength="150"></label>
<div class="filter-grid">
${options('country', t.country, {...Object.fromEntries(countries.map(c => [c,name(lang,c)])),unknown:t.unknown})}
${options('language',t.sourceLanguage,t.languages)}
${options('category',t.category,t.categories)}
${options('reward_type',t.reward,t.rewards)}
${options('reward_currency',t.currency,{...Object.fromEntries(currencies.map(c => [c,c])),unknown:t.unknown})}
${options('expense',t.expense,t.expenses)}
${options('participation_method',t.method,t.methods)}
${options('deadline',t.deadline,{any:t.hasDeadline,7:t.within7,30:t.within30})}
${options('certainty',t.certainty,t.certainties)}
${options('effort',t.maxEffort,Object.fromEntries([5,15,30,60].map(n => [n,n + t.minutes + t.within])))}
</div><div class="filter-actions"><label class="checkbox"><input type="checkbox" name="explicitJapan" value="yes">${t.japan}</label>
<button type="reset">${t.reset}</button></div></form>
<noscript><p class="notice">${t.javascript}</p></noscript>
<p class="notice" data-filter-error hidden>${t.failure}</p>`;
}

function directory(lang, available) {
  const t = copy[lang];
  const filtered = available.length ? filters(lang,available) : '';
  return `${filtered}<p class="stamp" role="status"><span id="result-count">${available.length}</span>${t.count}</p>
<p class="notice" data-empty ${available.length ? 'hidden' : ''}>${t.empty}</p>
<section class="cards" aria-label="${e(t.pages.opportunities[0])}">${available.map(row => card(row,lang)).join('')}</section>`;
}

function details(lang, row) {
  const t = copy[lang];
  const expense = row.required_expense;
  const base = [
    [t.provider,e(row.provider)], [t.category,e(t.categories[row.category])],
    [t.listed,e(countryText(row,lang))], [t.sourceLanguage,e(t.languages[row.language])],
    [t.reward,e(t.rewards[row.reward_type])], [t.amount,e(amount(row,lang))],
    [t.expense,e(t.expenses[expense.kind]) + (expense.amount > 0 ? ' · ' + e(format(expense.amount,expense.currency,lang)) : '')],
    [t.method,e(t.methods[row.participation_method])], [t.certainty,e(t.certainties[row.certainty])],
    [t.effort,row.estimated_effort_minutes === null ? t.unknown : e(row.estimated_effort_minutes + t.minutes)],
    [t.deadline,row.deadline ? time(row.deadline,lang,true) : t.noDeadline],
  ];
  const flags = row.risk_flags.map(flag => `<li>${e(t.risks[flag])}</li>`).join('');
  const c = row.commission;
  const terms = c ? `<h2>${t.commission}</h2>${fields([
    [t.rate,c.percent === null ? t.unknown : e(c.percent + '%')],
    [t.structure,e(t.structures[c.structure])], [t.duration,e(c.months ?? t.unknown)],
    [t.threshold,e(format(c.threshold,c.threshold_currency,lang))],
  ])}` : '';
  return `<article class="article"><a href="${url(lang,c ? 'affiliates' : 'opportunities')}">← ${c ? t.affiliateBack : t.back}</a>
<div class="eyebrow">${e(t.categories[row.category])}</div><h1>${e(row['title_' + lang])}</h1>
<p class="lead">${e(row['description_' + lang])}</p>
<p class="stamp">${t.checked} · ${time(row.last_checked_at,lang)}</p>
<p class="notice" data-stale="${e(row.stale_at)}"${stale(row,now) ? '' : ' hidden'}>${t.stale}</p>
<p class="notice" data-ended hidden>${t.expired}</p>
${fields(base)}<h2>${t.eligibility}</h2><p>${e(row['eligibility_' + lang])}</p>
<h2>${t.conditions}</h2><p>${e(row.reward_conditions[lang])}</p>
${row.category === 'sweepstakes' ? `<p class="notice">${t.odds}</p>` : ''}${terms}
${flags ? `<h2>${t.flags}</h2><ul>${flags}</ul>` : ''}
<p class="notice">${t.safer}</p>
<div class="actions" data-expiring="${e(row.deadline || '')}">${external(row.official_url,t.official)}
${row.affiliate_url ? `<span data-affiliate-expires="${e(row.affiliate_expires_at || '')}">${external(row.affiliate_url,t.sponsored,true)}</span>` : ''}</div>
<p><a href="${e(new URL(row.source_url).href)}" rel="noopener noreferrer">${t.source}</a></p></article>`;
}

async function page(lang, key, title, description, content, indexable = true) {
  const folder = url(lang,key).slice(1);
  await mkdir(dist + '/' + folder, {recursive:true});
  await write(folder + 'index.html', layout(lang,key,title,description,content,indexable));
}

const consumer = rows.filter(row => row.category !== 'affiliate');
for (const lang of languages) {
  const t = copy[lang];
  const featured = consumer.filter(row => row.required_expense.kind === 'free').slice(0,3);
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
<div class="cards">${featured.map(row => card(row,lang)).join('')}</div></section>${table}`);
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
  for (const key of secondary) {
    const [title, description] = t.pages[key];
    const sections = t.articles[key].map(([heading, body]) => `<h2>${e(heading)}</h2><p>${e(body)}</p>`).join('');
    await page(lang,key,title,description,`<article class="article"><h1>${e(title)}</h1><p class="lead">${e(description)}</p>
${sections}${['contact','privacy','disclosure'].includes(key) ? `<p>${t.legalContact} · ${address}</p>` : ''}</article>`);
  }
  for (const row of rows) {
    await page(lang,'opportunities/' + row.id,row['title_' + lang],row['description_' + lang],details(lang,row));
  }
}
await write('index.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Reward Radar</title><link rel="canonical" href="${origin.origin}/">
${languages.map(lang => `<link rel="alternate" hreflang="${lang}" href="${origin.origin}${url(lang)}">`).join('')}
<link rel="alternate" hreflang="x-default" href="${origin.origin}/">
${configured ? '' : '<meta name="robots" content="noindex">'}
<link rel="stylesheet" href="/assets/style.css"></head><body><main class="wrap intro">
<div class="brand">${brand}</div><h1>Choose a language</h1><p lang="ja">表示言語を選んでください。</p>
<div class="actions"><a class="button" href="/ja/" lang="ja" hreflang="ja">日本語</a>
<a class="button secondary" href="/en/" hreflang="en">English</a></div></main></body></html>`);
await write('404.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="robots" content="noindex"><link rel="stylesheet" href="/assets/style.css"><title>404 | Reward Radar</title></head>
<body><main class="wrap intro"><h1>Page unavailable</h1><p lang="ja">ページを表示できません。</p>
<div class="actions"><a href="/ja/" lang="ja">日本語ホーム</a><a href="/en/">English home</a></div></main></body></html>`);
await write('robots.txt', configured ? `User-agent: *\nAllow: /\nSitemap: ${origin.origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n');
await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${maps.map(({path,page:key}) => `<url><loc>${origin.origin}${path}</loc>${languages.map(lang =>
  `<xhtml:link rel="alternate" hreflang="${lang}" href="${origin.origin}${url(lang,key)}"/>`).join('')}</url>`).join('\n')}
</urlset>\n`);
console.log(`Built ${maps.length} localized pages with ${rows.length} listings.`);
