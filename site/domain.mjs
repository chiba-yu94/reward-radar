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
  if (query.organizer && !row.organizer_verified) return false;
  if (query.registration && row.entry?.registration !== query.registration) return false;
  if (query.emailOnly && (row.entry?.registration !== 'none' ||
      row.entry.application?.length !== 1 || row.entry.application[0] !== 'email')) return false;
  if (query.expense && row.required_expense.kind !== query.expense) return false;
  if (query.effort && (row.estimated_effort_minutes === null || row.estimated_effort_minutes > Number(query.effort))) return false;
  if (query.deadline && (!row.deadline || (query.deadline !== 'any' && expiration(row) > now + Number(query.deadline) * DAY))) return false;
  const text = [row.provider, row[`title_${lang}`], row[`description_${lang}`]].join(' ').normalize('NFKC').toLocaleLowerCase(lang);
  return (query.q || '').trim().normalize('NFKC').toLocaleLowerCase(lang).split(/\s+/).every(word => text.includes(word));
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
    if (row.category === 'sweepstakes') return [...prefix, 1, deadline, cost[expense.kind], row.id];
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

export function date(value, lang, includeTime = false) {
  return new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-GB', {
    timeZone: lang === 'ja' ? 'Asia/Tokyo' : 'UTC',
    year: 'numeric', month: 'short', day: 'numeric',
    ...(includeTime ? {hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short'} : {}),
  }).format(new Date(value));
}
