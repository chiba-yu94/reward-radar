import {freshness} from './domain.mjs';

const folded = value => value.normalize('NFKC').toLocaleLowerCase();

export function questBoard(root) {
  if (!root) return null;
  const form = root.querySelector('form');
  const open = root.querySelector('[data-quest-open]');
  const ended = root.querySelector('[data-quest-ended]');
  const currentList = root.querySelector('[data-quest-open-list]');
  const endedList = root.querySelector('[data-quest-ended-list]');
  const cards = Array.from(root.querySelectorAll('[data-quest-card]'), card => ({
    card, text:folded(card.textContent), end:Date.parse(card.dataset.boardDeadline),
  }));
  const count = root.querySelector('[data-quest-count]');
  const openEmpty = root.querySelector('[data-quest-open-empty]');
  const noMatch = root.querySelector('[data-quest-no-match]');
  const state = form.elements.namedItem('status');
  const restore = () => {
    const url = new URL(location.href);
    for (const control of form.elements) {
      if (!control.name) continue;
      const value = url.searchParams.get(control.name);
      if (control.type === 'checkbox') control.checked = value === 'yes';
      else {
        control.value = (value ?? control.defaultValue ?? '').slice(0,100);
        if (control.type === 'select-one' && control.selectedIndex < 0) {
          control.value = control.name === 'status' ? 'open' : '';
        } else if (control.name === 'status' && !url.searchParams.has('status')) control.value = 'open';
      }
    }
  };
  function render(now) {
    const query = new FormData(form);
    const words = folded(query.get('q')).trim().split(/\s+/).filter(Boolean);
    let openCount = 0;
    let endedCount = 0;
    for (const {card,text,end} of cards) {
      const closed = end <= now;
      const data = card.dataset;
      const group = closed ? endedList : currentList;
      if (card.parentElement !== group) group.append(card);
      const available = closed || freshness({last_checked_at:data.boardChecked},now).state === 'fresh';
      const matches = available && words.every(word => text.includes(word)) &&
        (!query.get('genre') || query.get('genre') === data.type) &&
        (!query.get('free') || data.free === 'yes') &&
        (!query.get('sns') || query.get('sns') === data.sns) &&
        (!query.get('ai') || query.get('ai') === data.ai ||
          (query.get('ai') === 'allowed' && data.ai === 'required')) &&
        (!query.get('by') || data.deadlineDay <= query.get('by'));
      card.hidden = !matches;
      if (matches) { if (closed) endedCount++; else openCount++; }
    }
    open.hidden = state.value === 'ended';
    ended.hidden = !endedCount || state.value === 'open';
    const visible = (open.hidden ? 0 : openCount) + (ended.hidden ? 0 : endedCount);
    count.querySelector('span').textContent = visible;
    const filtered = words.length || ['genre','free','sns','ai','by'].some(key => query.get(key));
    openEmpty.hidden = !!(openCount || filtered || state.value !== 'open');
    noMatch.hidden = visible > 0 || !openEmpty.hidden;
  }
  function change() {
    const url = new URL(location.href);
    const values = new FormData(form);
    for (const [key,value] of values) {
      if (key === 'status' ? value !== 'open' : value) url.searchParams.set(key,value);
      else url.searchParams.delete(key);
    }
    if (!values.has('free')) url.searchParams.delete('free');
    history.replaceState(null,'',url);
    ended.open = state.value !== 'open';
    render(Date.now());
  }
  form.addEventListener('submit',event => event.preventDefault());
  form.addEventListener('input',change);
  form.addEventListener('reset',() => requestAnimationFrame(() => { change(); form.elements.q.focus(); }));
  window.addEventListener('popstate',() => { restore(); ended.open = state.value !== 'open'; render(Date.now()); });
  restore();
  ended.open = state.value !== 'open';
  form.hidden = count.hidden = false;
  return render;
}
