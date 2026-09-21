'use strict';

// The help pop-up. Its content is plain markup in index.html — there is nothing
// to fetch or build, so this is only the opening and closing.

(function () {
  const panel = document.getElementById('help');
  const openBtn = document.getElementById('helpbtn');
  const closeBtn = document.getElementById('help-close');

  let returnFocus = null;

  function open() {
    returnFocus = document.activeElement;
    panel.hidden = false;
    openBtn.setAttribute('aria-expanded', 'true');
    closeBtn.focus(); // so that typing doesn't quietly go to the shell behind
  }

  function close() {
    panel.hidden = true;
    openBtn.setAttribute('aria-expanded', 'false');
    if (returnFocus && returnFocus.focus) returnFocus.focus();
  }

  openBtn.addEventListener('mousedown', (e) => e.preventDefault());
  openBtn.addEventListener('click', () => (panel.hidden ? open() : close()));
  closeBtn.addEventListener('click', close);

  // Click the backdrop, but not the pop-up itself.
  panel.addEventListener('mousedown', (e) => {
    if (e.target === panel) close();
  });

  // Capture, so Escape closes this instead of reaching the shell.
  document.addEventListener(
    'keydown',
    (e) => {
      if (panel.hidden) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    },
    true
  );

  window.WEBTERM_HELP = { open, close };
})();
