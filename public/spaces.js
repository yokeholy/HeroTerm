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

  // The drawing, in pixels — .sthumb and .sfield in index.html. Only used to
  // work out whether a window's box is big enough to hold its name.
  const FIELD_W = 86;
  const FIELD_H = 50;
  const NAME_W = 26; // narrower than this and a name is a smear
  const NAME_H = 13;

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

      // A small picture of the screen, drawn from where its windows actually
      // are: one box per window, in the same colour its border is wearing.
      // Three names in a row take reading; a shape is recognised.
      const thumb = document.createElement('span');
      thumb.className = 'sthumb';
      // The windows are drawn inside this rather than against the frame, so
      // the picture has air around it; see .sfield for how much.
      const field = document.createElement('span');
      field.className = 'sfield';
      thumb.append(field);
      const a = screen.area;
      for (const w of screen.windows) {
        const box = document.createElement('i');
        const pct = (v) => `${Math.max(0, Math.min(100, v * 100))}%`;
        box.style.left = pct((w.rect.x - a.x) / a.w);
        box.style.top = pct((w.rect.y - a.y) / a.h);
        // A hairline's worth at least: a window can be smaller than a pixel
        // of this drawing, and a screen that looks empty is a lie.
        box.style.width = `max(3px, ${pct(w.rect.w / a.w)})`;
        box.style.height = `max(3px, ${pct(w.rect.h / a.h)})`;
        box.dataset.run = w.run;
        if (w.focused) box.dataset.focused = '';
        if (w.min) box.dataset.min = '';
        box.title = w.name;
        // The name, in the middle of the window it belongs to — but only
        // where there is room for it. A box a few pixels across holds no
        // word, and half a word is worse than the shape on its own; hovering
        // still says which is which.
        if ((w.rect.w / a.w) * FIELD_W >= NAME_W && (w.rect.h / a.h) * FIELD_H >= NAME_H) {
          const tag = document.createElement('b');
          tag.textContent = w.name;
          box.append(tag);
        }
        field.append(box);
      }
      if (!screen.windows.length) thumb.dataset.empty = '';

      const label = document.createElement('span');
      label.className = 'slabel';
      label.textContent = screen.name || `Screen ${i + 1}`;

      const note = document.createElement('span');
      note.className = 'snote';
      // What is on it, since the names are the only way to tell two screens
      // apart at a glance once they both have three windows on them.
      const shown = screen.windows.filter((w) => !w.min).length;
      const away = screen.windows.length - shown;
      note.textContent =
        (screen.names.slice(0, 2).join(', ') || 'empty') +
        (screen.names.length > 2 ? ` +${screen.names.length - 2}` : '') +
        (away ? ` · ${away} in the tray` : '');

      const text = document.createElement('span');
      text.className = 'stext';
      text.append(label, note);
      go.append(dot, thumb, text);
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
