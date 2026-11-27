import {matches, ordered, allowedFilters, expiration, expired, timestamp} from './domain.mjs';
import {enableHomeScreenGestures} from './gestures.mjs';
import {updateDates} from './status.mjs';

const lang = document.documentElement.lang;
const cards = Array.from(document.querySelectorAll('[data-record]'));
const archive = document.querySelector('[data-archive]');
const archiveList = archive?.querySelector('[data-archive-list]');
const editorialCards = Array.from(document.querySelectorAll('[data-editorial]'));
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

const historyControls = document.querySelector('[data-history-controls]');
if (historyControls && (navigator.standalone === true || matchMedia('(display-mode: standalone)').matches)) {
  const [back, forward] = historyControls.querySelectorAll('button');
  const navigation = window.navigation;
  const updateHistoryControls = () => {
    back.disabled = !(navigation?.canGoBack ?? (history.length > 1));
    forward.disabled = !(navigation?.canGoForward ?? (history.length > 1));
  };
  back.addEventListener('click', () => history.back());
  forward.addEventListener('click', () => history.forward());
  navigation?.addEventListener('currententrychange', updateHistoryControls);
  window.addEventListener('pageshow', updateHistoryControls);
  window.addEventListener('popstate', updateHistoryControls);
  updateHistoryControls();
  historyControls.hidden = false;
  document.body.classList.add('has-history-controls');
  const pullRefresh = document.querySelector('[data-pull-refresh]');
  if (pullRefresh) enableHomeScreenGestures(back, forward, pullRefresh);
}

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
    for (const card of editorialCards) {
      const row = JSON.parse(card.dataset.editorial);
      byId.set(row.id,card);
      records.set(row.id,row);
    }
    const parent = document.querySelector('.cards');
    const active = form.querySelector('.active-filters');
    const unfilteredGuide = document.querySelector('[data-unfiltered-guide]');
    const genreLinks = document.querySelectorAll('[data-genre-field]');
    const reset = form.querySelector('[type=reset]');
    const mastheadResidence = document.querySelector('.masthead-residence[form=filters]');
    const values = Object.fromEntries(Array.from(form.elements).filter(input => input.name).map(input => [input.name,
      input instanceof HTMLSelectElement ? Array.from(input.options).map(option => option.value) : input.type === 'checkbox' ? ['yes'] : []]));
    function restore() {
      const params = new URLSearchParams(location.search);
      if (archive) {
        // Bookmarked filters from the former listing use these two names.
        if (!params.has('category') && params.has('genre')) params.set('category',params.get('genre'));
        if (!params.has('freeEntry') && params.has('free')) params.set('freeEntry',params.get('free'));
      }
      const query = allowedFilters(params,values);
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
      const sorted = ordered([...byId.keys()].map(id => records.get(id)).filter(Boolean),now);
      if (query.sort === 'deadline') sorted.sort((a,b) => expiration(a) - expiration(b));
      if (query.sort === 'newest') sorted.sort((a,b) => b.first_seen_at.localeCompare(a.first_seen_at));
      const order = sorted.map(row => (row.editorial && expired(row,now) ? '!' : '') + row.id).join(' ');
      let visible = 0;
      let matchingArchive = 0;
      for (const row of sorted) {
        const card = byId.get(row.id);
        const ended = row.editorial && expired(row,now);
        const matchesFilters = !affiliateExpired(card,now) && matches(row,query,lang,now);
        if (row.editorial) card.querySelector('[data-editorial-ended]').hidden = !ended;
        // Keep the archive browsable while the default result count covers open listings.
        const display = ended && query.status === 'open'
          ? matches(row,{...query,status:'ended'},lang,now) : matchesFilters;
        card.hidden = !display;
        if (ended && display) matchingArchive++;
        if (matchesFilters) visible++;
        if (order !== currentOrder) (ended ? archiveList : parent).append(card);
      }
      currentOrder = order;
      if (archive) {
        archive.hidden = matchingArchive === 0;
        if (updateURL || archive.dataset.status !== query.status) {
          archive.open = query.status !== 'open';
          archive.dataset.status = query.status;
        }
      }
      const selected = Object.entries(query).filter(([key,value]) => value.trim() && !(key === 'status' && value === 'open'));
      active.querySelector('ul').replaceChildren(...selected.map(([key,value]) => {
        const input = form.elements.namedItem(key);
        const item = document.createElement('li');
        item.textContent = input instanceof HTMLSelectElement ? input.selectedOptions[0].text : input.type === 'checkbox' ? input.labels[0].textContent.trim() : value;
        return item;
      }));
      active.hidden = !selected.length;
      if (unfilteredGuide) unfilteredGuide.hidden = selected.length !== 0;
      for (const link of genreLinks) {
        if (query[link.dataset.genreField] === link.dataset.genreValue) link.setAttribute('aria-current','true');
        else link.removeAttribute('aria-current');
      }
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
    mastheadResidence?.addEventListener('change',() => filter());
    form.addEventListener('submit',event => event.preventDefault());
    form.addEventListener('reset',() => window.requestAnimationFrame(() => { form.elements.q.focus(); filter(); }));
    window.addEventListener('popstate',() => { restore(); filter(false); });
    form.querySelector('[data-show-results]').addEventListener('click',() => {
      form.querySelector('details').open = false;
      document.querySelector('#listing-results').focus();
    });
    form.querySelector('fieldset').disabled = false;
    if (mastheadResidence) mastheadResidence.disabled = false;
    form.setAttribute('aria-busy','false');
    form.hidden = false;
    filter(false);
  } catch {
    form.setAttribute('aria-busy','false');
    document.querySelector('[data-filter-error]').hidden = false;
  }
}
