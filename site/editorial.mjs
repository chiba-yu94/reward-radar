import {expiration, freshness, timestamp} from './domain.mjs';
import {languages} from './locales.mjs';

const text = value => typeof value === 'string' && Boolean(value.trim());
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const rewardTypes = {
  interview:['completion'],
  'user-test':['completion'],
  design:['selection','prize'],
  'game-design':['selection','prize'],
  writing:['selection','prize'],
  'visual-art':['selection','prize'],
  'photo-video':['selection','prize'],
  'skill-bounty':['completion','selection','prize'],
};

function https(value) {
  if (!text(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function requireEditorial(valid, message) {
  if (!valid) throw new Error('Invalid editorial data: ' + message);
}

function approved(entries, privateStatuses) {
  requireEditorial(Array.isArray(entries), 'expected a list');
  const ids = new Set();
  return entries.filter(entry => {
    requireEditorial(typeof entry?.id === 'string' && slug.test(entry.id) && !ids.has(entry.id), 'missing or duplicated slug');
    requireEditorial(entry.status === 'approved' || privateStatuses.includes(entry.status), entry.id + ': status');
    ids.add(entry.id);
    return entry.status === 'approved';
  });
}

function translations(entry, fields) {
  const locales = Object.keys(entry.copy || {});
  requireEditorial(locales.length && locales.every(lang => languages.includes(lang) &&
    fields.every(field => text(entry.copy[lang]?.[field]))), entry.id + ': translation');
  return languages.filter(lang => locales.includes(lang));
}

export function publicEditorial(input, now, wasPublished = () => false) {
  requireEditorial(Array.isArray(input.quests), 'expected a list');
  const historic = input.quests.map(quest => {
    if (!quest) return quest;
    const closed = quest.status === 'closed' && wasPublished(quest.id);
    return {...quest, status:closed ? 'approved' : quest.status, closed};
  });
  const reviewedQuests = approved(historic, ['candidate','closed']).filter(quest => {
    const end = expiration(quest);
    const residence = quest.review?.japan_eligible;
    requireEditorial(Object.hasOwn(rewardTypes,quest.type) && rewardTypes[quest.type].includes(quest.reward?.kind) &&
      Number.isFinite(quest.reward.amount) && quest.reward.amount > 0 && /^[A-Z]{3}$/.test(quest.reward.currency) &&
      (quest.reward.maximum === undefined || typeof quest.reward.maximum === 'boolean'),
    quest.id + ': task or reward');
    requireEditorial(Number.isFinite(end) && (quest.deadline_date_only === undefined || typeof quest.deadline_date_only === 'boolean') &&
      Number.isFinite(timestamp(quest.last_checked_at)) &&
      (quest.closed || quest.review?.accepting === true) && (residence === true || residence === 'not-stated') &&
      quest.review?.no_upfront_cost === true && quest.review?.payment_verified === true &&
      https(quest.official_url) && https(quest.review.evidence_url),
    quest.id + ': open period, eligibility, cost, payment or source');
    if (quest.type === 'skill-bounty') {
      const terms = quest.conditions;
      const reviewedAt = timestamp(quest.last_checked_at);
      requireEditorial(residence === true && typeof terms?.sns === 'boolean' &&
        ['allowed','required','prohibited'].includes(terms.ai) &&
        terms.free === true && text(terms.entry_method) &&
        Array.isArray(terms.eligible_countries) && terms.eligible_countries.includes('JP') &&
        terms.eligible_countries.every(code => /^[A-Z]{2}$/.test(code)) &&
        text(terms.payment_method) && Array.isArray(terms.requirements) && terms.requirements.length > 0 &&
        terms.requirements.every(text) && quest.review?.no_upfront_cost === true &&
        quest.review?.safe_non_security === true &&
        ['Asia/Tokyo','UTC'].includes(quest.deadline_timezone) &&
        Number.isFinite(reviewedAt) && reviewedAt < end,
      quest.id + ': skill bounty conditions or editorial review');
    }
    return timestamp(quest.last_checked_at) <= now;
  }).map(quest => ({...quest, locales:translations(quest,
    ['title','description','task','eligibility','expenses','reward_terms','payment','organizer'])}))
    .sort((a,b) => expiration(a) - expiration(b) || a.id.localeCompare(b.id));
  const ended = quest => quest.closed || expiration(quest) <= now;
  const quests = reviewedQuests.filter(quest => !ended(quest) && freshness(quest,now).state === 'fresh');
  const endedQuests = reviewedQuests.filter(ended).reverse();
  const staleQuests = reviewedQuests.filter(quest => !ended(quest) && freshness(quest,now).state === 'stale'
    && wasPublished(quest.id));

  const guides = approved(input.guides, ['draft']).map(guide => {
    const locales = translations(guide,['title','description','source_label']);
    requireEditorial(https(guide.source_url) && Number.isFinite(timestamp(guide.last_checked_at)) &&
      locales.every(lang => {
        const sections = guide.copy[lang].sections;
        return Array.isArray(sections) && sections.length && sections.every(section =>
          Array.isArray(section) && section.length === 2 && section.every(text));
      }), guide.id + ': source, date or sections');
    return {...guide, locales};
  });
  return {quests, endedQuests, staleQuests, guides};
}
