import {matches, ordered, allowedFilters, expiration, timestamp} from './domain.mjs';
import {updateDates} from './status.mjs';

const lang = document.documentElement.lang;
const cards = Array.from(document.querySelectorAll('[data-record]'));
const deadline = element => expiration({deadline:element.dataset.deadline || element.dataset.expiring});
const affiliateExpired = (element, now) => timestamp(element.dataset.affiliateExpires) <= now;
const form = document.querySelector('#filters');
let filter = null;
const menu = document.querySelector('.site-menu');
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu?.open) { menu.open = false; menu.querySelector('summary').focus(); }
});
document.addEventListener('click', event => {
  if (menu?.open && !menu.contains(event.target)) menu.open = false;
});
function checkDates() {
  const now = Date.now();
  updateDates(document, now, lang);
  if (filter) filter(false);
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
    for (const card of cards.filter(card => !records.has(card.dataset.record))) {
      if (!card.hasAttribute('data-affiliate-expires') && deadline(card) > Date.now()) {
        throw new Error('Dataset does not match the page');
      }
      card.dataset.unavailable = '';
      card.hidden = true;
    }
    const byId = new Map(cards.map(card => [card.dataset.record,card]));
    const parent = document.querySelector('.cards');
    const active = form.querySelector('.active-filters');
    const reset = form.querySelector('[type=reset]');
    const values = Object.fromEntries(Array.from(form.elements).filter(input => input.name).map(input => [input.name,
      input instanceof HTMLSelectElement ? Array.from(input.options).map(option => option.value) : input.type === 'checkbox' ? ['yes'] : []]));
    function restore() {
      const query = allowedFilters(new URLSearchParams(location.search),values);
      form.reset();
      for (const [key,value] of Object.entries(query)) {
        const input = form.elements.namedItem(key);
        if (input.type === 'checkbox') input.checked = true; else input.value = value;
      }
    }
    restore();
    let currentOrder = '';
    filter = (updateURL = true) => {
      const query = allowedFilters(new URLSearchParams(new FormData(form)),values);
      const now = Date.now();
      const sorted = ordered(cards.map(card => records.get(card.dataset.record)).filter(Boolean),now);
      if (query.sort === 'deadline') sorted.sort((a,b) => expiration(a) - expiration(b));
      if (query.sort === 'newest') sorted.sort((a,b) => b.first_seen_at.localeCompare(a.first_seen_at));
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
      active.querySelector('ul').replaceChildren(...selected.map(([key,value]) => {
        const input = form.elements.namedItem(key);
        const item = document.createElement('li');
        item.textContent = input instanceof HTMLSelectElement ? input.selectedOptions[0].text : input.type === 'checkbox' ? input.labels[0].textContent.trim() : value;
        return item;
      }));
      active.hidden = !selected.length;
      reset.disabled = !selected.length;
      document.querySelector('#result-count').textContent = visible;
      for (const counter of document.querySelectorAll('[data-result-count]')) counter.textContent = visible;
      document.querySelector('[data-empty]').hidden = visible !== 0;
      if (updateURL) {
        const params = new URLSearchParams(selected);
        const destination = location.pathname + (params.size ? '?' + params : '');
        history.replaceState(null,'',destination);
      }
    };
    form.addEventListener('input',() => filter());
    form.addEventListener('submit',event => event.preventDefault());
    form.addEventListener('reset',() => window.requestAnimationFrame(() => { form.elements.q.focus(); filter(); }));
    window.addEventListener('popstate',() => { restore(); filter(false); });
    form.querySelector('[data-show-results]').addEventListener('click',() => {
      form.querySelector('details').open = false;
      document.querySelector('#listing-results').focus();
    });
    form.querySelector('fieldset').disabled = false;
    form.setAttribute('aria-busy','false');
    form.hidden = false;
    filter(false);
  } catch {
    form.setAttribute('aria-busy','false');
    document.querySelector('[data-filter-error]').hidden = false;
  }
}
