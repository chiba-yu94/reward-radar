import {matches, ordered} from './domain.mjs';

const lang = document.documentElement.lang;
const cards = Array.from(document.querySelectorAll('[data-record]'));
const deadline = element => Date.parse(element.dataset.deadline || element.dataset.expiring);
const form = document.querySelector('#filters');
const ended = document.querySelector('[data-ended]');
let filter = null;

function checkDates() {
  const now = Date.now();
  for (const element of document.querySelectorAll('[data-stale]')) {
    element.hidden = Date.parse(element.dataset.stale) > now;
  }
  for (const element of document.querySelectorAll('[data-affiliate-expires]')) {
    if (Date.parse(element.dataset.affiliateExpires) <= now) element.hidden = true;
  }
  for (const card of cards) {
    if (deadline(card) <= now) card.hidden = true;
  }
  for (const element of document.querySelectorAll('[data-expiring]')) {
    if (deadline(element) <= now) {
      element.hidden = true;
      ended.hidden = false;
    }
  }
  if (filter) filter();
  else if (document.querySelector('#result-count')) {
    const count = cards.filter(card => !card.hidden).length;
    document.querySelector('#result-count').textContent = count;
    document.querySelector('[data-empty]').hidden = count !== 0;
  }
}
checkDates();
window.addEventListener('pageshow',checkDates);
window.setInterval(checkDates,60_000);

if (form) {
  try {
    const response = await fetch('/opportunities.json', {credentials:'omit'});
    if (!response.ok) throw new Error('Dataset unavailable');
    const payload = await response.json();
    const records = new Map(payload.records.map(row => [row.id,row]));
    if (cards.some(card => !records.has(card.dataset.record) && !(deadline(card) <= Date.now()))) {
      throw new Error('Dataset does not match the page');
    }
    const byId = new Map(cards.map(card => [card.dataset.record,card]));
    const parent = cards[0].parentNode;
    filter = () => {
      const query = Object.fromEntries(new FormData(form));
      const now = Date.now();
      let visible = 0;
      for (const row of ordered(cards.map(card => records.get(card.dataset.record)).filter(Boolean), now)) {
        const card = byId.get(row.id);
        card.hidden = !matches(row,query,lang,now);
        if (!card.hidden) visible++;
        parent.append(card);
      }
      document.querySelector('#result-count').textContent = visible;
      document.querySelector('[data-empty]').hidden = visible !== 0;
    };
    form.addEventListener('input',filter);
    form.addEventListener('submit',event => event.preventDefault());
    form.addEventListener('reset',() => window.requestAnimationFrame(filter));
    form.hidden = false;
    filter();
  } catch {
    document.querySelector('[data-filter-error]').hidden = false;
  }
}
