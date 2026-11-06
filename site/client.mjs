import {matches, ordered} from './domain.mjs';

const lang = document.documentElement.lang;
const cards = Array.from(document.querySelectorAll('[data-record]'));
const deadline = element => Date.parse(element.dataset.deadline || element.dataset.expiring);
const affiliateExpired = (element, now) => Date.parse(element.dataset.affiliateExpires) <= now;
const form = document.querySelector('#filters');
const ended = document.querySelector('[data-ended]');
let filter = null;

function checkDates() {
  const now = Date.now();
  for (const element of document.querySelectorAll('[data-stale]')) {
    element.hidden = Date.parse(element.dataset.stale) > now;
  }
  for (const element of document.querySelectorAll('[data-affiliate-expires]')) {
    if (affiliateExpired(element, now)) element.hidden = true;
  }
  for (const card of cards) {
    if (deadline(card) <= now) card.hidden = true;
  }
  for (const element of document.querySelectorAll('[data-expiring]')) {
    if (deadline(element) <= now) {
      element.hidden = true;
      if (ended) ended.hidden = false;
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
    const missing = cards.filter(card => !records.has(card.dataset.record));
    for (const card of missing) {
      if (card.hasAttribute('data-affiliate-expires') || deadline(card) <= Date.now()) card.hidden = true;
      else throw new Error('Dataset does not match the page');
    }
    const byId = new Map(cards.map(card => [card.dataset.record,card]));
    const parent = cards[0].parentNode;
    const active = form.querySelector('.active-filters');
    const reset = form.querySelector('[type="reset"]');
    let currentOrder = cards.map(card => card.dataset.record).join(' ');
    let currentFilters = '';
    filter = () => {
      const query = Object.fromEntries(new FormData(form));
      const now = Date.now();
      const sorted = ordered(cards.map(card => records.get(card.dataset.record)).filter(Boolean), now);
      const order = sorted.map(row => row.id).join(' ');
      let visible = 0;
      for (const row of sorted) {
        const card = byId.get(row.id);
        card.hidden = affiliateExpired(card,now) || !matches(row,query,lang,now);
        if (!card.hidden) visible++;
        if (order !== currentOrder) parent.append(card);
      }
      currentOrder = order;
      const selected = Object.entries(query).filter(([,value]) => value.trim());
      const signature = JSON.stringify(selected);
      if (signature !== currentFilters) {
        currentFilters = signature;
        active.querySelector('ul').replaceChildren(...selected.map(([key,value]) => {
          const input = form.elements.namedItem(key);
          const label = input.labels[0].firstChild.textContent.trim();
          const item = document.createElement('li');
          item.textContent = input instanceof HTMLSelectElement ? label + ' · ' + input.selectedOptions[0].text
            : input.type === 'checkbox' ? input.labels[0].textContent.trim() : label + ' · ' + value.trim();
          return item;
        }));
        active.hidden = !selected.length;
        reset.disabled = !selected.length;
      }
      document.querySelector('#result-count').textContent = visible;
      document.querySelector('[data-empty]').hidden = visible !== 0;
    };
    form.addEventListener('input',filter);
    form.addEventListener('submit',event => event.preventDefault());
    form.addEventListener('reset',() => window.requestAnimationFrame(() => {
      form.elements.q.focus();
      filter();
    }));
    form.hidden = false;
    filter();
  } catch {
    document.querySelector('[data-filter-error]').hidden = false;
  }
}
