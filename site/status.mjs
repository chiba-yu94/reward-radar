import {expiration, freshness, timestamp} from './domain.mjs';

export const dateCopy = {
  ja:{stale:'確認から30日以上経過しました。参加前に公式情報を確認してください。', ended:'掲載期間は終了しました。', age:days => `${days}日経過`},
  en:{stale:'Last checked 30 or more days ago. Confirm the current terms with the provider.', ended:'This listing has ended.', age:days => `${days} days elapsed`},
};

// The initial HTML and cached pages use the same state and elapsed-time rules.
export function updateDates(root, now, lang) {
  const t = dateCopy[lang] || dateCopy.en;
  for (const element of root.querySelectorAll('[data-last-checked]')) {
    const status = freshness({last_checked_at:element.dataset.lastChecked}, now);
    if (element.hasAttribute('data-age')) element.textContent = status.days === null ? '' : t.age(status.days);
    else {
      element.hidden = status.state !== 'stale';
      element.textContent = element.hidden ? '' : t.stale;
    }
  }
  for (const element of root.querySelectorAll('[data-affiliate-expires]')) {
    element.hidden = timestamp(element.dataset.affiliateExpires) <= now;
  }
  for (const element of root.querySelectorAll('[data-record], [data-expiring]')) {
    const end = expiration({deadline:element.dataset.deadline || element.dataset.expiring});
    element.hidden = element.hasAttribute('data-unavailable') || end <= now || timestamp(element.dataset.affiliateExpires) <= now;
  }
  for (const list of root.querySelectorAll('[data-expiry-list]')) {
    list.hidden = !list.querySelector('li:not([hidden])');
    const empty = list.parentElement.querySelector('[data-expiry-empty]');
    if (empty) empty.hidden = !list.hidden;
    else list.parentElement.hidden = list.hidden;
  }
  const ended = root.querySelector('[data-ended]');
  if (ended) {
    const action = root.querySelector('.entry-action[data-expiring]');
    const isEnded = action && expiration({deadline:action.dataset.expiring}) <= now;
    ended.hidden = !isEnded;
    ended.textContent = isEnded ? t.ended : '';
  }
}
