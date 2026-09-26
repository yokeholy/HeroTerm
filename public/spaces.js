'use strict';

// The workspaces panel: a strip down the left edge that stays out of the way
// until you put the pointer on it.
//
// A workspace is a set of windows with their shells still running — see the
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
  const FIELD_W = 234; // the drawing inside the frame; see .sfield
  const FIELD_H = 132;
  const NAME_W = 26; // narrower than this and a name is a smear
  const NAME_H = 13;

  const edge = document.getElementById('edge');
  const panel = document.getElementById('spaces');
  const list = document.getElementById('spaces-list');
  const adder = document.getElementById('spaces-add');
  const saver = document.getElementById('spaces-save');
  const nameForm = document.getElementById('spaces-name');
  const nameField = nameForm.querySelector('input');
  const savedBox = document.getElementById('spaces-saved');
  const savedList = document.getElementById('spaces-saved-list');

  const S = () => window.HEROTERM_SPACES;
  const P = () => window.HEROTERM_PROFILES;

  let openTimer = null;
  let shutTimer = null;
  let asking = null; // the workspace whose "something is running" question is up
  let returnTo = null; // what had the keyboard before the panel took it
  let justSaved = null; // the row whose Save just worked, to say so for a moment
  let savedTimer = null;

  // From the edge, the panel just appears: the pointer is the thing in use.
  // From the keyboard it takes the keys as well, starting on the workspace
  // you are in, and gives them back when it closes.
  const open = ({ keyboard = false } = {}) => {
    clearTimeout(shutTimer);
    if (panel.hidden) {
      panel.hidden = false; // before painting: paint() leaves a hidden panel alone
      paint();
    }
    if (keyboard) {
      if (!panel.contains(document.activeElement)) returnTo = document.activeElement;
      const here = panel.querySelector('.space[data-here] .go') || panel.querySelector('.go');
      if (here) here.focus();
    }
  };

  const shut = () => {
    clearTimeout(openTimer);
    clearTimeout(shutTimer);
    asking = null;
    if (!nameForm.hidden) stopSaving({ refocus: false });
    const hadKeys = panel.contains(document.activeElement);
    panel.hidden = true;
    // Straight back to the terminal it came from, so typing goes on where it
    // stopped — unless a switch has put a different one in front, which will
    // have taken the keyboard itself.
    if (hadKeys && returnTo && returnTo.isConnected) returnTo.focus();
    returnTo = null;
  };

  const toggle = (opts) => (panel.hidden ? open(opts) : shut());

  /* ---------- the list ---------- */

  function paint() {
    if (panel.hidden) return;
    const list_ = S().list();
    const rows = list_.map((space, i) => {
      const row = document.createElement('div');
      row.className = 'space';
      if (space.here) row.dataset.here = '';

      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'go';
      go.setAttribute('aria-current', String(space.here));

      const dot = document.createElement('span');
      dot.className = 'sdot';
      if (space.busy) dot.dataset.busy = '';

      // A small picture of the workspace, drawn from where its windows
      // actually are: one box per window, in the colour its border wears.
      // Three names in a row take reading; a shape is recognised.
      const thumb = document.createElement('span');
      thumb.className = 'sthumb';
      // The shape of the work area itself, so a window drawn in it has the
      // proportions it really has.
      thumb.style.aspectRatio = `${space.area.w} / ${space.area.h}`;
      // The windows are drawn inside this rather than against the frame, so
      // the picture has air around it; see .sfield for how much.
      const field = document.createElement('span');
      field.className = 'sfield';
      thumb.append(field);
      const a = space.area;
      for (const w of space.windows) {
        const box = document.createElement('i');
        const pct = (v) => `${Math.max(0, Math.min(100, v * 100))}%`;
        box.style.left = pct((w.rect.x - a.x) / a.w);
        box.style.top = pct((w.rect.y - a.y) / a.h);
        // A hairline's worth at least: a window can be smaller than a pixel
        // of this drawing, and a workspace that looks empty is a lie.
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
      if (!space.windows.length) thumb.dataset.empty = '';

      // Only a name you gave it. "Workspace 2" says nothing the position in
      // the list doesn't already say; what is in it does.
      const label = document.createElement('span');
      label.className = 'slabel';
      label.textContent = space.name || '';

      const note = document.createElement('span');
      note.className = 'snote';
      // What is in it, since the names are the only way to tell two
      // workspaces apart once they both hold three windows.
      const shown = space.windows.filter((w) => !w.min).length;
      const away = space.windows.length - shown;
      note.textContent =
        (space.names.slice(0, 2).join(', ') || 'empty') +
        (space.names.length > 2 ? ` +${space.names.length - 2}` : '') +
        (away ? ` · ${away} in the tray` : '');

      // Name and windows on a line of their own, the picture under it with
      // the full width of the panel to draw in.
      const head = document.createElement('span');
      head.className = 'shead';
      if (!space.name) head.dataset.unnamed = ''; // then the windows are the title
      head.append(dot);
      // Opened from a kept profile, or saved as one: its history is being
      // written down as it goes. A bookmark, the colour of a command that
      // went well, says so.
      if (space.profile) {
        row.dataset.kept = '';
        const mark = document.createElement('span');
        mark.className = 'slink';
        mark.innerHTML =
          '<svg viewBox="0 0 10 12" width="8" height="10" aria-hidden="true"><path d="M1 1h8v10L5 8 1 11z" fill="currentColor"/></svg>';
        mark.dataset.tip = `Kept as “${space.profile}” — its history saves itself`;
        mark.setAttribute('aria-label', `Kept as ${space.profile}`);
        head.append(mark);
      }
      head.append(label, note);
      go.append(head, thumb);
      go.addEventListener('click', () => {
        // The one you are already in: not a switch, and not worth closing the
        // panel over either. Double-clicking its line to rename it still is.
        if (space.here) return;
        returnTo = null; // the workspace we are going to has its own terminal
        S().go(i);
        shut();
      });

      // Double-click the line to call the workspace something of your own,
      // the way a window is renamed. The line rather than the name itself: a
      // workspace you have not named has no name to aim at.
      head.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        head.removeAttribute('data-unnamed');
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

      // The layout of a kept workspace changes only when you say: this puts
      // the windows as they are now back into the profile. (Its history needs
      // no button; that is written as each command finishes.)
      if (space.profile) {
        const keep = document.createElement('button');
        keep.type = 'button';
        keep.className = 'ssave';
        const done = justSaved === space.id;
        if (done) keep.dataset.done = '';
        keep.textContent = done ? 'Saved' : 'Save';
        keep.dataset.tip = `Save this layout into “${space.profile}”`;
        keep.setAttribute('aria-label', `Save this layout into ${space.profile}`);
        keep.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!S().keep(i, space.profile)) return;
          justSaved = space.id;
          clearTimeout(savedTimer);
          savedTimer = setTimeout(() => {
            justSaved = null;
            paint();
          }, 1400);
          paint();
        });
        row.append(keep);
      }

      if (list_.length > 1) {
        const drop = document.createElement('button');
        drop.type = 'button';
        drop.className = 'drop';
        drop.setAttribute('aria-label', `Close the workspace with ${space.names.join(', ') || 'nothing'} in it`);
        drop.dataset.tip = 'Close this workspace';
        drop.textContent = '×';
        drop.addEventListener('click', (e) => {
          e.stopPropagation();
          // Always ask. A workspace is several windows and their shells;
          // there is no undo for that, and the × is a small target next to
          // the one that switches workspaces.
          asking = i;
          paint();
        });
        row.append(drop);
      }

      if (asking === i) {
        const ask = document.createElement('div');
        ask.className = 'sask';
        const why = document.createElement('span');
        const busy = S().busyOn(i);
        const n = space.windows.length;
        // What goes with it, and the part worth hesitating over.
        if (busy) ask.dataset.busy = '';
        why.textContent =
          `Close ${n} window${n === 1 ? '' : 's'}` + (busy ? `, ${busy} still running?` : '?');
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

    // One that was just closed, offered back where it stood.
    const back = S().pending();
    if (back) {
      const row = document.createElement('div');
      row.className = 'space gone';
      const said = document.createElement('span');
      said.className = 'gsaid';
      said.textContent = `Closed ${back.name || back.names.join(', ') || 'a workspace'}`;
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'gundo';
      again.textContent = 'Undo';
      again.dataset.tip = 'Bring it back, shells and all';
      again.addEventListener('click', (e) => {
        e.stopPropagation();
        S().undo();
      });
      row.append(said, again);
      rows.splice(Math.max(0, Math.min(rows.length, back.index)), 0, row);
    }

    list.replaceChildren(...rows);
    const limits = S().limits;
    adder.disabled = list_.length >= limits.workspaces;
    adder.dataset.tip = adder.disabled
      ? `${limits.workspaces} workspaces is the limit`
      : 'Another workspace, with a terminal on it';
    paintKept(list_.length >= limits.workspaces);
  }

  /* ---------- kept ---------- */

  // Profiles: workspaces written down — see profiles.js. Opening one makes a
  // workspace of its own for it, with fresh shells started in the folders it
  // kept and each window's earlier commands behind it; saving one links the
  // workspace to it, so its history keeps itself from then on.

  // "3 windows · heroterm, docs" — the folders are the useful part, and the
  // last segment of each is enough to tell them apart.
  function describe(entry) {
    const n = entry.windows.length;
    const where = entry.windows
      .map((w) => {
        if (!w.cwd) return null;
        if (entry.home && w.cwd === entry.home) return '~';
        return w.cwd.replace(/\/$/, '').split('/').pop() || '/';
      })
      .filter(Boolean);
    return [`${n} window${n === 1 ? '' : 's'}`, [...new Set(where)].slice(0, 3).join(', ')].filter(Boolean).join(' · ');
  }

  function paintKept(full) {
    const kept = P().list();
    const names = Object.keys(kept).sort((a, b) => a.localeCompare(b));
    savedBox.hidden = !names.length;
    savedList.replaceChildren(
      ...names.map((name) => {
        const entry = kept[name];
        const row = document.createElement('div');
        row.className = 'kept';

        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'open';
        open.disabled = full;
        open.dataset.tip = full ? 'Close a workspace to make room for it' : 'Open it as a workspace of its own';
        const title = document.createElement('span');
        title.className = 'kname';
        title.textContent = name;
        const note = document.createElement('span');
        note.className = 'knote';
        note.textContent = describe(entry);
        open.append(title, note);
        open.addEventListener('click', () => {
          returnTo = null; // the new workspace has its own terminal
          if (S().openSaved(entry.windows, name)) shut();
        });

        const drop = document.createElement('button');
        drop.type = 'button';
        drop.className = 'drop';
        drop.textContent = '×';
        drop.setAttribute('aria-label', `Forget ${name}`);
        drop.dataset.tip = 'Forget this one';
        drop.addEventListener('click', (e) => {
          e.stopPropagation();
          P().forget(name);
          paint();
        });

        row.append(open, drop);
        return row;
      })
    );
  }

  // Saving: the button becomes a name field in place, offered the workspace's
  // own name, or what is in it. Enter keeps it; Escape changes nothing.
  function startSaving() {
    const here = S().list().find((w) => w.here);
    nameField.value = (here && (here.profile || here.name || here.names.join(', '))) || '';
    saver.hidden = true;
    nameForm.hidden = false;
    nameField.focus();
    nameField.select();
  }

  function stopSaving({ refocus = true } = {}) {
    nameForm.hidden = true;
    saver.hidden = false;
    if (refocus && !panel.hidden) saver.focus();
  }

  saver.addEventListener('mousedown', (e) => e.preventDefault());
  saver.addEventListener('click', startSaving);

  nameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameField.value.trim().slice(0, P().MAX_NAME);
    if (!name) return;
    S().keep(S().at, name);
    stopSaving();
    paint();
  });

  // Escape in the field is about the field, not the whole panel.
  nameField.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    stopSaving();
  });

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
      if (panel.hidden) return;
      // Typing a name: Escape puts the field away rather than the panel, and
      // the arrows move the caret, not between rows.
      if (e.target === nameField) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          stopSaving();
        }
        return;
      }
      if (e.key === 'Escape') {
        if (asking !== null) {
          asking = null;
          paint();
        } else {
          shut();
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Up and down between the rows, and on to ＋ at the bottom. Only while
      // the panel has the keys: arrows otherwise belong to the terminal.
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && panel.contains(document.activeElement)) {
        const stops = [...panel.querySelectorAll('.go'), adder, saver, ...panel.querySelectorAll('.kept .open')].filter(
          (b) => !b.disabled && !b.hidden
        );
        const at = stops.indexOf(document.activeElement);
        const next = stops[(at + (e.key === 'ArrowDown' ? 1 : -1) + stops.length) % stops.length];
        if (next) next.focus();
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  adder.addEventListener('mousedown', (e) => e.preventDefault());
  adder.addEventListener('click', () => S().add());

  window.HEROTERM_EDGE = { open, close: shut, toggle };
})();
