'use strict';

// The screens panel: a strip down the left edge that stays out of the way
// until you put the pointer on it.
//
// A screen is a set of windows with their shells still running — see the
// model in app.js. This file is only the panel: it lists them, switches
// between them, makes new ones and closes old ones. Everything it knows comes
// from HEROTERM_SPACES.
//
// The hot zone is deliberately thin. A panel that opens whenever the pointer
// drifts left is a panel that opens while you are reaching for a window's
// close button, so it takes a few pixels of real edge and a moment's rest
// there before it comes out.

(function () {
  const REST = 180; // hold the edge this long before it opens
  const LINGER = 260; // ...and this long after leaving before it closes again

  const edge = document.getElementById('edge');
  const panel = document.getElementById('spaces');
  const list = document.getElementById('spaces-list');
  const adder = document.getElementById('spaces-add');

  const S = () => window.HEROTERM_SPACES;

  let openTimer = null;
  let shutTimer = null;
  let asking = null; // the screen whose "something is running" question is up

  const open = () => {
    clearTimeout(shutTimer);
    if (!panel.hidden) return;
    panel.hidden = false; // before painting: paint() leaves a hidden panel alone
    paint();
  };

  const shut = () => {
    clearTimeout(openTimer);
    clearTimeout(shutTimer);
    asking = null;
    panel.hidden = true;
  };

  /* ---------- the list ---------- */

  function paint() {
    if (panel.hidden) return;
    const screens = S().list();
    const rows = screens.map((screen, i) => {
      const row = document.createElement('div');
      row.className = 'space';
      if (screen.here) row.dataset.here = '';

      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'go';
      go.setAttribute('aria-current', String(screen.here));

      const dot = document.createElement('span');
      dot.className = 'sdot';
      if (screen.busy) dot.dataset.busy = '';

      const label = document.createElement('span');
      label.className = 'slabel';
      label.textContent = screen.name || `Screen ${i + 1}`;

      const note = document.createElement('span');
      note.className = 'snote';
      // What is on it, since the names are the only way to tell two screens
      // apart at a glance once they both have three windows on them.
      note.textContent = screen.names.slice(0, 3).join(', ') || 'empty';

      const text = document.createElement('span');
      text.className = 'stext';
      text.append(label, note);
      go.append(dot, text);
      go.addEventListener('click', () => {
        S().go(i);
        shut();
      });

      // Double-click the name to call it something of your own, the way a
      // window is renamed.
      label.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        label.contentEditable = 'true';
        label.focus();
        document.execCommand('selectAll', false, null);
      });
      label.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== 'Escape') return;
        e.preventDefault();
        if (e.key === 'Enter') S().rename(i, label.textContent);
        label.contentEditable = 'false';
        paint();
      });
      label.addEventListener('blur', () => {
        if (label.isContentEditable) {
          S().rename(i, label.textContent);
          label.contentEditable = 'false';
        }
      });

      row.append(go);

      if (screens.length > 1) {
        const drop = document.createElement('button');
        drop.type = 'button';
        drop.className = 'drop';
        drop.setAttribute('aria-label', `Close ${screen.name || `screen ${i + 1}`}`);
        drop.dataset.tip = 'Close this screen';
        drop.textContent = '×';
        drop.addEventListener('click', (e) => {
          e.stopPropagation();
          if (S().busyOn(i) > 0) {
            asking = i;
            paint();
            return;
          }
          S().close(i);
        });
        row.append(drop);
      }

      if (asking === i) {
        const ask = document.createElement('div');
        ask.className = 'sask';
        const why = document.createElement('span');
        const busy = S().busyOn(i);
        why.textContent = `${busy} still running.`;
        const yes = document.createElement('button');
        yes.type = 'button';
        yes.textContent = 'Close';
        yes.addEventListener('click', (e) => {
          e.stopPropagation();
          asking = null;
          S().close(i);
        });
        const no = document.createElement('button');
        no.type = 'button';
        no.textContent = 'Keep';
        no.addEventListener('click', (e) => {
          e.stopPropagation();
          asking = null;
          paint();
        });
        ask.append(why, yes, no);
        row.append(ask);
      }

      return row;
    });

    list.replaceChildren(...rows);
    const limits = S().limits;
    adder.disabled = screens.length >= limits.screens;
    adder.dataset.tip = adder.disabled
      ? `${limits.screens} screens is the limit`
      : 'Another screen, with a terminal on it';
  }

  S().paint = paint;

  /* ---------- coming and going ---------- */

  // The strip itself only arms a timer: crossing it on the way somewhere else
  // should not bring the panel out.
  edge.addEventListener('mouseenter', () => {
    if (!panel.hidden) return;
    // Not over a sheet that has the screen: those are modal enough already.
    for (const id of ['settings', 'help', 'stats']) {
      const sheet = document.getElementById(id);
      if (sheet && !sheet.hidden) return;
    }
    clearTimeout(openTimer);
    openTimer = setTimeout(open, REST);
  });

  edge.addEventListener('mouseleave', () => clearTimeout(openTimer));

  panel.addEventListener('mouseenter', () => clearTimeout(shutTimer));
  panel.addEventListener('mouseleave', () => {
    clearTimeout(shutTimer);
    shutTimer = setTimeout(shut, LINGER);
  });

  // A press anywhere else, and anything that takes the screen, puts it away.
  document.addEventListener(
    'mousedown',
    (e) => {
      if (panel.hidden || e.target.closest('#spaces')) return;
      shut();
    },
    true
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (panel.hidden || e.key !== 'Escape') return;
      if (asking !== null) {
        asking = null;
        paint();
      } else {
        shut();
      }
      e.preventDefault();
      e.stopPropagation();
    },
    true
  );

  adder.addEventListener('mousedown', (e) => e.preventDefault());
  adder.addEventListener('click', () => S().add());

  window.HEROTERM_EDGE = { open, close: shut };
})();
