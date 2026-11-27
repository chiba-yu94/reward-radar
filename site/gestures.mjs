const directionThreshold = 8;
const historyThreshold = 72;
const refreshThreshold = 80;
const directionRatio = 1.25;
const controls = 'button, input, select, textarea, summary, [contenteditable]:not([contenteditable="false"])';

function hasScrollableAncestor(element, axis) {
  for (let parent = element; parent && parent !== document.body; parent = parent.parentElement) {
    const horizontal = axis === 'x';
    const overflow = horizontal ? parent.scrollWidth > parent.clientWidth : parent.scrollHeight > parent.clientHeight;
    if (overflow && /^(auto|scroll)$/.test(getComputedStyle(parent)[horizontal ? 'overflowX' : 'overflowY'])) return true;
  }
  return false;
}

export function enableHomeScreenGestures(back, forward, indicator) {
  document.documentElement.classList.add('has-home-screen-gestures');
  let gesture;

  const reset = () => {
    gesture = undefined;
    indicator.hidden = true;
    indicator.removeAttribute('data-ready');
  };

  document.addEventListener('touchstart', event => {
    reset();
    if (event.touches.length !== 1 || (window.visualViewport?.scale ?? 1) > 1 ||
        !(event.target instanceof Element) || event.target.closest(controls) ||
        window.getSelection()?.isCollapsed === false) return;
    const touch = event.touches[0];
    gesture = {id:touch.identifier, x:touch.clientX, y:touch.clientY, target:event.target,
      atTop:Math.abs(window.scrollY) <= 1, axis:null};
  }, {passive:true});

  document.addEventListener('touchmove', event => {
    if (!gesture) return;
    const touch = event.touches[0];
    if (event.touches.length !== 1 || touch.identifier !== gesture.id || !event.cancelable) {
      reset();
      return;
    }
    const x = Math.abs(touch.clientX - gesture.x);
    const y = touch.clientY - gesture.y;
    if (!gesture.axis) {
      if (Math.max(x, Math.abs(y)) < directionThreshold) return;
      const axis = x >= Math.abs(y) * directionRatio ? 'x' : 'y';
      if ((axis === 'y' && (!gesture.atTop || y < x * directionRatio || y <= 0)) ||
          hasScrollableAncestor(gesture.target, axis)) {
        reset();
        return;
      }
      gesture.axis = axis;
    }
    event.preventDefault();
    if (gesture.axis === 'y') {
      const ready = y >= refreshThreshold && y >= x * directionRatio;
      indicator.hidden = y <= 0;
      indicator.toggleAttribute('data-ready', ready);
      const message = ready ? indicator.dataset.release : indicator.dataset.pull;
      if (indicator.textContent !== message) indicator.textContent = message;
    }
  }, {passive:false});

  document.addEventListener('touchend', event => {
    const touch = event.changedTouches[0];
    const completed = gesture;
    reset();
    if (!completed?.axis || touch?.identifier !== completed.id || event.touches.length) return;
    const x = touch.clientX - completed.x;
    const y = touch.clientY - completed.y;
    if (completed.axis === 'x' && Math.abs(x) >= Math.max(historyThreshold, Math.abs(y) * directionRatio)) {
      if (event.cancelable) event.preventDefault();
      (x > 0 ? back : forward).click();
    } else if (completed.axis === 'y' && y >= Math.max(refreshThreshold, Math.abs(x) * directionRatio)) {
      if (event.cancelable) event.preventDefault();
      location.reload();
    }
  }, {passive:false});

  document.addEventListener('touchcancel', reset);
  window.addEventListener('pagehide', reset);
}
