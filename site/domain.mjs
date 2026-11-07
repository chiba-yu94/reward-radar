const DAY = 86_400_000;
export const expiration = row => row.deadline ? Date.parse(row.deadline) : Infinity;
export const expired = (row, now) => expiration(row) <= now;
export const stale = (row, now) => Date.parse(row.stale_at) <= now;

export function eligible(row, country) {
  return row.eligibility_verified && (row.eligible_countries === 'worldwide' ||
    (Array.isArray(row.eligible_countries) && row.eligible_countries.includes(country)));
}

export function matches(row, query, lang, now) {
  if (expired(row, now)) return false;
  if (query.explicitJapan && !(Array.isArray(row.eligible_countries) && eligible(row, 'JP'))) return false;
  if (query.country === 'unknown' ? row.eligibility_verified : query.country && !eligible(row, query.country)) return false;
  for (const field of ['category', 'prize_category', 'language', 'reward_type', 'participation_method', 'certainty']) {
    if (query[field] && (row[field] ?? 'unknown') !== query[field]) return false;
  }
  const currencies = row.reward_currencies?.length ? row.reward_currencies : [row.reward_currency ?? 'unknown'];
  if (query.reward_currency && !currencies.includes(query.reward_currency)) return false;
  if (query.noSns && row.application?.sns_required !== false) return false;
  if (query.webOnly && row.application?.web_only !== true) return false;
  if (query.easyApply && row.application?.difficulty !== 'easy') return false;
  if (query.organizer && !row.organizer_verified) return false;
  if (query.registration && row.entry?.registration !== query.registration) return false;
  if (query.emailOnly && (row.entry?.registration !== 'none' ||
      row.entry.application?.length !== 1 || row.entry.application[0] !== 'email')) return false;
  if (query.expense && row.required_expense.kind !== query.expense) return false;
  if (query.effort && (row.estimated_effort_minutes === null || row.estimated_effort_minutes > Number(query.effort))) return false;
  if (query.deadline && (!row.deadline || (query.deadline !== 'any' && expiration(row) > now + Number(query.deadline) * DAY))) return false;
  if (query.freeEntry && row.required_expense.kind !== 'free') return false;
  if (query.closingSoon && (!row.deadline || expiration(row) > now + 7 * DAY)) return false;
  const q = normalize(query.q || '');
  if (/sns不要|no social (?:media|account)/.test(q) && row.application?.sns_required !== false) return false;
  const text = searchText(row);
  return q.split(/\s+/).every(raw => {
    // A standalone 米 means rice, not the 米 in 米国 or 米ドル.
    const word = raw === '米' ? 'お米' : raw;
    if (/^[a-z0-9]+$/.test(word)) return new RegExp('(^|[^a-z0-9])' + word + (word.length < 3 ? '($|[^a-z0-9])' : '')).test(text);
    return text.includes(word);
  });
}

const normalize = text => text.normalize('NFKC').toLowerCase().trim();
const concepts = {
  sweepstakes:'懸賞 抽選 プレゼント sweepstakes giveaway prize draw',
  survey:'アンケート 調査 survey surveys', research:'調査 research study studies',
  points:'ポイ活 ポイント rewards points', gift:'特典 ギフト rewards gifts',
  guaranteed:'条件達成 特典 rewards', cashback:'還元 cashback', registration:'登録特典 signup rewards',
  affiliate:'affiliate アフィリエイト',
};
export function searchText(row) {
  const parts = [row.provider, row.title_ja, row.title_en, row.description_ja, row.description_en,
    row.reward_conditions.ja, row.reward_conditions.en, concepts[row.category], row.reward_type,
    ({collectibles:'カード フィギュア cards collectibles', food:'食品 飲料 food drinks', 'cash-gift':'現金 ギフトカード cash gift card', household:'日用品 household', electronics:'家電 ゲーム electronics games', digital:'デジタル digital'})[row.prize_category]];
  if (row.category === 'affiliate' && !row.commission) parts.push('ポイ活 タスク報酬 タスク型報酬 rewards tasks');
  if (row.application?.sns_required === false) parts.push('SNS不要 no social media no social account required');
  if (row.required_expense.kind === 'free') parts.push('無料応募 free entry no purchase');
  if (row.eligibility_verified && Array.isArray(row.eligible_countries)) {
    for (const locale of ['ja','en']) {
      const names = new Intl.DisplayNames(locale, {type:'region'});
      parts.push(...row.eligible_countries.map(code => names.of(code)), ...row.eligible_countries);
      const aliases = {JP:'日本 Japan',US:'米国 アメリカ United States USA',GB:'英国 イギリス United Kingdom UK'};
      parts.push(...row.eligible_countries.map(code => aliases[code]));
    }
  }
  let text = normalize(parts.filter(Boolean).join(' '));
  if (/\brice\b|きぬむすめ|お米/.test(text)) text += ' 米 お米 rice';
  if (/gift.card|ギフトカード|ギフト券/.test(text)) text += ' ギフト券 ギフトカード gift card';
  return text;
}

// Only public controls can be restored/shared; never reflect arbitrary URL keys into HTML.
export function allowedFilters(params, formValues) {
  const query = {};
  for (const [key, values] of Object.entries(formValues)) {
    const value = params.get(key);
    if (key === 'q' && value) query.q = value.slice(0,150);
    else if (value && values.includes(value)) query[key] = value;
  }
  return query;
}

export function ordered(rows, now) {
  const cost = {free: 0, unknown: 1, purchase: 2};
  const friction = {low: 0, medium: 1, high: 2};
  const number = value => value ?? Infinity;
  const scalar = (a, b) => a === b ? 0 : a < b ? -1 : 1;
  const key = row => {
    const prefix = [Number(stale(row, now))];
    const deadline = expiration(row);
    const expense = row.required_expense;
    if (row.category === 'affiliate') {
      const terms = row.commission;
      if (!terms) return [...prefix, 4, row.id];
      return [...prefix, 3, terms.structure, -(terms.percent ?? -1), -(terms.months ?? -1),
        Number(!row.eligibility_verified), row.id];
    }
    if (row.certainty === 'guaranteed') {
      const comparable = row.reward_currency && row.reward_amount !== null &&
        (expense.kind === 'free' || expense.currency === row.reward_currency);
      return [...prefix, 0, Number(!comparable), comparable ? row.reward_currency : '',
        comparable ? expense.amount - row.reward_amount : 0, cost[expense.kind],
        number(row.estimated_effort_minutes), number(friction[row.redemption_difficulty]),
        Number(!row.eligibility_verified), deadline, row.id];
    }
    if (row.category === 'sweepstakes') {
      const app = row.application;
      const web = app?.web_only === true && app.sns_required === false && expense.kind === 'free';
      const level = {easy: 0, standard: 1, unknown: 2, hard: 3};
      return [...prefix, 1, Number(!web), Number(app?.sns_required !== false),
        level[app?.difficulty] ?? level.unknown, number(app?.step_count), deadline, row.id];
    }
    return [...prefix, 2, cost[expense.kind], deadline, Number(!row.eligibility_verified), row.id];
  };
  return rows.map(row => [row, key(row)]).sort(([, a], [, b]) => {
    for (let index = 0; index < a.length; index++) {
      const result = scalar(a[index], b[index]);
      if (result) return result;
    }
    return 0;
  }).map(([row]) => row);
}

export function money(amount, currency, lang, unknown) {
  if (amount === null) return unknown;
  if (!currency) return new Intl.NumberFormat(lang).format(amount);
  return new Intl.NumberFormat(lang === 'ja' ? 'ja-JP' : 'en', {
    style: 'currency', currency, currencyDisplay: 'code',
  }).format(amount);
}

export function date(value, lang, includeTime = false, zone = lang === 'ja' ? 'Asia/Tokyo' : 'UTC') {
  return new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-GB', {
    timeZone: zone,
    year: 'numeric', month: 'short', day: 'numeric',
    ...(includeTime ? {hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short'} : {}),
  }).format(new Date(value));
}
