import {timestamp} from './domain.mjs';

export function validatePublic(dataset, taxonomy, now) {
  const fail = message => {throw new Error(`Invalid public dataset: ${message}`);};
  if (!Number.isFinite(timestamp(dataset.generated_at)) || !Array.isArray(dataset.records) || !dataset.records.length) fail('generation or records');
  const ids = new Set();
  for (const row of dataset.records) {
    if (typeof row.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id) || ids.has(row.id)) fail('duplicate or unsafe ID');
    ids.add(row.id);
    if (!taxonomy.categories.includes(row.category) || (row.prize_category != null && !taxonomy.prizes.includes(row.prize_category))) fail(`${row.id}: classification`);
    const checked = timestamp(row.last_checked_at);
    if (!Number.isFinite(checked) || checked > now + 300000 || timestamp(row.stale_at) !== checked + 30 * 86400000) fail(`${row.id}: verification dates`);
    if (row.deadline != null && !Number.isFinite(timestamp(row.deadline))) fail(`${row.id}: deadline`);
    if (row.availability === 'ongoing' && row.deadline != null) fail(`${row.id}: ongoing deadline`);
    for (const key of ['eligible_countries','shipping_countries','service_countries','promotion_countries']) {
      const countries = row[key];
      if (countries == null || key === 'eligible_countries' && countries === 'worldwide') continue;
      if (!Array.isArray(countries) || !countries.length || countries.some(code=>!taxonomy.countries.includes(code)) || new Set(countries).size !== countries.length) fail(`${row.id}: ${key}`);
    }
    if (row.eligibility_verified !== (row.eligible_countries != null)) fail(`${row.id}: eligibility`);
    for (const key of ['official_url','source_url','affiliate_url']) {
      if (key === 'affiliate_url' && row[key] == null) continue;
      let url;
      try {url = new URL(row[key]);} catch {fail(`${row.id}: ${key}`);}
      if (url.protocol !== 'https:' || url.username || url.password) fail(`${row.id}: ${key}`);
    }
    for (const lang of ['ja','en']) for (const key of ['title','description','eligibility']) {
      if (typeof row[`${key}_${lang}`] !== 'string' || !row[`${key}_${lang}`].trim()) fail(`${row.id}: ${key}_${lang}`);
    }
    if (row.affiliate_url && (!Number.isFinite(timestamp(row.affiliate_expires_at)) || row.affiliate_approval_status !== 'approved')) fail(`${row.id}: affiliate approval`);
  }
}
