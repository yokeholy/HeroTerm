'use strict';

// Tooltips. One element, one timer, for every button on the page — the page's
// own controls, a window's three lights, a chip in the tray, the buttons
// inside the sheets.
//
// Nothing has to opt in. What a button does is already written down for
// screen readers, so that is what this shows:
//
//   data-tip    what to say, when a label is too terse to be the whole story
//   title       absorbed into data-tip the first time it is seen, and removed
//   aria-label  otherwise
//
// The title is taken away because the browser shows its own tooltip after
// about a second, in its own place, and two tooltips for one button is worse
// than none. Absorbing on hover rather than at load means the ones the page
// rewrites as it goes — the tray's chips, the full-screen button — are caught
// as well, every time they change.

(function () {
  const DELAY = 1000; // hover this long before it appears
  const GAP = 8; // between the button and its tip
  const MARGIN = 6; // ...and between the tip and the edge of the window

  const tip = document.createElement('div');
  tip.id = 'tip';
  tip.setAttribute('aria-hidden', 'true'); // the label it echoes is already read out
  tip.hidden = true;
  document.body.append(tip);

  let timer = null;
  let watch = null; // while one is up: has the button it belongs to gone?
  let showing = null; // the element whose tip is up
  let armed = null; // ...and the one being waited on

  function textFor(el) {
    const title = el.getAttribute('title');
    if (title) {
      el.dataset.tip = title;
      el.removeAttribute('title');
    }
    const text = el.dataset.tip || el.getAttribute('aria-label') || '';
    return text.trim();
  }

  function place(el) {
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - t.width / 2;
    x = Math.max(MARGIN, Math.min(window.innerWidth - t.width - MARGIN, x));
    // Below, unless below is off the bottom of the window.
    let y = r.bottom + GAP;
    if (y + t.height > window.innerHeight - MARGIN) y = r.top - t.height - GAP;
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(Math.max(MARGIN, y))}px`;
  }

  function show(el) {
    const text = textFor(el);
    if (!text) return;
    tip.textContent = text;
    tip.hidden = false;
    place(el); // after it has its text, so its size is the real one
    showing = el;
    // A window can close, or a chip leave the tray, while its tip is up and
    // the pointer hasn't moved to say so.
    watch = setInterval(() => {
      if (!showing.isConnected || showing.hidden || showing.offsetParent === null) hide();
    }, 500);
  }

  function hide() {
    clearTimeout(timer);
    timer = null;
    armed = null;
    if (!showing) return;
    clearInterval(watch);
    watch = null;
    showing = null;
    tip.hidden = true;
  }

  function arm(el) {
    if (el === armed || el === showing) return;
    hide();
    armed = el;
    timer = setTimeout(() => show(el), DELAY);
  }

  // What, if anything, is under the pointer that has something to say.
  // Resolved by point rather than by event target because a disabled button
  // dispatches no mouse events of its own — and "why can't I press this?" is
  // exactly when a tooltip earns its keep.
  function tipAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const owner = el.closest('[data-tip], [title], button[aria-label], [role="button"][aria-label]');
    if (!owner || !owner.isConnected) return null;
    return textFor(owner) ? owner : null;
  }

  document.addEventListener(
    'mousemove',
    (e) => {
      // Nothing to say while a button is held: that's a drag, or a resize,
      // and asking what's under the pointer on every frame of one is work
      // nobody asked for.
      if (e.buttons) {
        hide();
        return;
      }
      const el = tipAt(e.clientX, e.clientY);
      if (!el) {
        hide();
        return;
      }
      arm(el);
    },
    { passive: true }
  );

  // Anything that means you have moved on, or are busy: a tip is an answer to
  // hesitation, and none of these is hesitating.
  for (const type of ['mousedown', 'wheel']) {
    window.addEventListener(type, hide, { passive: true, capture: true });
  }

  document.addEventListener('keydown', hide, { capture: true });
  document.addEventListener('mouseleave', hide); // the pointer left the page

  // Tabbing to a button should tell you as much as hovering one does. Only
  // for a keyboard focus, though: :focus-visible is exactly that distinction,
  // and a click would otherwise leave a tip hanging over the thing you just
  // pressed.
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest ? e.target.closest('[data-tip], [title], button[aria-label]') : null;
    if (!el) return;
    if (!el.matches(':focus-visible')) return;
    arm(el);
  });

  document.addEventListener('focusout', hide);

  // Whatever it was pointing at is somewhere else now.
  window.addEventListener('resize', hide);
})();
