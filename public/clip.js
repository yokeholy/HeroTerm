'use strict';

// Select-to-copy, the way iTerm does it: let go of a drag and what you
// highlighted is already on the clipboard. ⌘C still works — this only saves
// the keystroke, and the setting turns it off for anyone who would rather
// their clipboard stayed where they put it.
//
// The copy happens when the gesture ends, not as the selection changes. xterm
// reports every cell you cross while dragging, and writing the clipboard forty
// times on the way to the end of a line would be both wasteful and pointless:
// only the last one is what you meant to copy.

(function () {
  const SETTING = 'copySelect';

  // Settings own the switch, but this runs whether or not that sheet has been
  // built yet, so an unanswerable question counts as yes.
  const wanted = () => {
    const settings = window.HEROTERM_SETTINGS;
    return !settings || Boolean(settings.get(SETTING));
  };

  function copy(term) {
    if (!wanted() || !term.hasSelection()) return;
    const text = term.getSelection();
    if (!text.trim()) return; // a stray drag across blank cells isn't a copy
    try {
      navigator.clipboard?.writeText(text).catch(() => {
        /* denied, or the page lost focus mid-gesture; ⌘C is still there */
      });
    } catch {
      /* no clipboard API at all, which is the same story */
    }
  }

  // Which terminal the drag began in. One document-level listener rather than
  // one per terminal: cards come and go, and a listener per card would outlive
  // the terminal it closed over.
  let dragging = null;

  document.addEventListener('mouseup', () => {
    const term = dragging;
    dragging = null;
    // After xterm's own mouseup handler, which is what sets the selection for
    // a double or triple click.
    if (term) setTimeout(() => copy(term), 0);
  });

  window.HEROTERM_CLIP = {
    // Once per Terminal, live or replayed, after open() has given it an element.
    watch(term) {
      const el = term.element;
      if (!el) return;
      el.addEventListener('mousedown', (e) => {
        if (e.button === 0) dragging = term;
      });
    },
  };
})();
