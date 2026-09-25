'use strict';

// Workspaces: several sets of windows, each with its shells still running.
// Switching hides one set and shows another, and nothing restarts — a build
// left running in the workspace you walked away from is still running when
// you come back.
//
// This file owns the sets. The page (app.js) owns the windows themselves and
// everything done to them — dragging, snapping, arranging, the tray — and it
// does all of that to `containers`, which is always the workspace in front.
// So the contract between the two is small: this swaps what `containers`
// holds, and asks the page (the `host`) to focus, save and repaint.
//
// The panel down the left edge is spaces.js; it reads the list from here.

(function () {
  const MAX_WORKSPACES = 6;

  // Closing one is the most destructive thing on the page — several shells at
  // once, and the × is a few pixels from the row that merely switches. So it
  // doesn't kill them: it lets go, and the server keeps the sessions for a
  // moment, the same way it does across a refresh. Undo inside that moment and
  // the whole workspace comes back with its shells still running. Ignore it
  // and they are reaped, only a little later than they would have been.
  //
  // The offer lives in this page only. Reload inside it and it is gone, and
  // the shells are reaped on the same timetable as if you had ignored it.
  const UNDO = 20; // seconds the offer stands

  function create(host) {
    const blank = (extra = {}) => ({
      id: host.newId(),
      name: '',
      windows: [],
      focused: null,
      arrangement: null,
      ...extra,
    });

    let spaces = [blank({ id: 's1' })];
    let at = 0; // which one is in front
    let undone = null; // { index, name, windows: [...] } — one at a time
    let undoTimer = null;

    const limits = {
      workspaces: MAX_WORKSPACES,
      // Every window in every workspace is a live shell on the server, so the
      // real ceiling is the server's. app.js sets this from /config; until the
      // answer arrives, it is the server's default.
      shells: 24,
      windows: host.maxWindows,
    };

    // The windows of workspace i: the live array when it is in front, its own
    // list otherwise.
    const windowsOf = (i) => (i === at ? host.containers : spaces[i].windows);

    const total = () => spaces.reduce((n, _s, i) => n + windowsOf(i).length, 0);

    /* ---------- the one path in and out ---------- */

    // Write back what the one in front holds, and put its windows away.
    function leave() {
      host.closeOverview();
      const s = spaces[at];
      if (s) {
        s.windows = [...host.containers];
        s.focused = host.focused;
        s.arrangement = host.arrangement;
      }
      for (const c of host.containers) c.el.toggleAttribute('data-away', true);
    }

    // Make workspace i the one in front: its windows into `containers`, on
    // screen, and refitted — their boxes may have been set while they were out
    // of sight, where a terminal has no size to fit itself to.
    function swapIn(i) {
      at = i;
      const s = spaces[at];
      host.containers.length = 0;
      host.containers.push(...s.windows);
      host.arrangement = s.arrangement || null;
      host.focused = null;
      for (const c of host.containers) {
        c.el.removeAttribute('data-away');
        c.applyBox();
        c.relayout();
      }
      return s;
    }

    // Give the keys to the window it had them last, and tell the page.
    function settle(s) {
      const want =
        (s && s.focused && host.containers.includes(s.focused) && s.focused) || host.visible().slice(-1)[0];
      if (want) host.focus(want);
      else host.unfocused();
      host.changed();
    }

    /* ---------- what the panel and the keys ask for ---------- */

    const api = {
      limits,
      total,

      get at() {
        return at;
      },

      // One row per workspace: what to call it, what is in it, and where each
      // of those windows sits — the panel draws a small picture of it from
      // this, which is a faster way to recognise one than reading three names.
      // Rects are in page coordinates; `area` is what to scale them against.
      list() {
        const area = host.workArea();
        return spaces.map((s, i) => {
          const here = i === at;
          const windows = windowsOf(i);
          const its = here ? host.focused : s.focused;
          return {
            id: s.id,
            name: s.name,
            here,
            area,
            busy: windows.some((c) => c.session.running),
            names: windows.map((c) => c.name),
            windows: windows.map((c) => ({
              name: c.name,
              rect: c.visibleRect(),
              run: c.el.dataset.run || 'idle',
              min: c.minimized,
              focused: c === its,
            })),
          };
        });
      },

      go(i) {
        if (i === at || !spaces[i]) return;
        leave();
        settle(swapIn(i));
      },

      // Left and right of the one you are in, for the keys.
      step(by) {
        if (spaces.length < 2) return;
        api.go((at + by + spaces.length) % spaces.length);
      },

      // A new one, with a window in it — a workspace with nothing in it is
      // not a workspace — whose shell starts in `cwd` when there is one.
      add(cwd = host.hereCwd()) {
        if (spaces.length >= limits.workspaces || total() >= limits.shells) return null;
        leave();
        spaces.push(blank());
        swapIn(spaces.length - 1);
        const c = host.spawn(null, host.defaultBox(0), undefined, cwd);
        host.focus(c);
        host.changed();
        return c;
      },

      // A saved layout, opened into a workspace of its own rather than over
      // the one you are in: the windows it had, where they were, each shell
      // started in the folder it was saved in.
      openSaved(windows, name) {
        if (!Array.isArray(windows) || !windows.length) return false;
        if (spaces.length >= limits.workspaces) return false;
        const fits = windows.slice(0, Math.min(limits.windows, limits.shells - total()));
        if (!fits.length) return false;
        leave();
        spaces.push(blank({ name: name || '' }));
        swapIn(spaces.length - 1);
        for (const w of fits) {
          const c = host.spawn(null, host.fitToScreen({ x: w.x, y: w.y, w: w.w, h: w.h }), w.name, w.cwd);
          if (w.min) c.setMinimized(true);
        }
        settle(null);
        return true;
      },

      rename(i, name) {
        if (!spaces[i]) return;
        spaces[i].name = String(name || '').trim().slice(0, 24);
        host.changed();
      },

      // How many windows in a workspace have something running, which is what
      // a question about closing it should say out loud.
      busyOn(i) {
        return spaces[i] ? windowsOf(i).filter((c) => c.session.running).length : 0;
      },

      pending() {
        if (!undone) return null;
        return { index: undone.index, name: undone.name, names: undone.windows.map((w) => w.name) };
      },

      // Closing takes the windows off the page and lets go of their shells —
      // see UNDO. The last workspace standing stays: there is always somewhere
      // to be.
      close(i) {
        if (spaces.length < 2 || !spaces[i]) return;
        const going = [...windowsOf(i)];
        // Everything needed to build it again, while the windows are still
        // here to be asked.
        undone = {
          index: i,
          name: spaces[i].name,
          windows: going.map((c) => ({
            id: c.id,
            name: c.name,
            box: { ...c.box },
            zoom: c.zoom || undefined,
            min: c.minimized,
            cwd: c.cwd || undefined,
          })),
        };
        clearTimeout(undoTimer);
        undoTimer = setTimeout(() => {
          undone = null;
          api.paint();
        }, UNDO * 1000);

        const wasHere = i === at;
        spaces.splice(i, 1);
        if (wasHere) {
          host.closeOverview();
          settle(swapIn(Math.min(i, spaces.length - 1)));
        } else {
          if (i < at) at -= 1;
          host.changed();
        }
        // A little longer than the offer stands, so the last second of it is
        // not a race with the server.
        for (const c of going) c.detach(UNDO + 5);
      },

      // The offer taken up: the workspace goes back where it was, its windows
      // asking for the same session ids, which the server still has — so they
      // come back mid-command with their scrollback behind them.
      undo() {
        if (!undone) return;
        const back = undone;
        undone = null;
        clearTimeout(undoTimer);
        leave();
        const index = Math.max(0, Math.min(spaces.length, back.index));
        spaces.splice(index, 0, blank({ name: back.name }));
        swapIn(index);
        for (const spec of back.windows) {
          const c = host.spawn(spec.id, { ...spec.box, zoom: spec.zoom }, spec.name, spec.cwd);
          if (spec.min) c.setMinimized(true);
        }
        settle(null);
      },

      /* ---------- written down, and read back ---------- */

      // What the layout store keeps: every workspace, not just the one in
      // front. `boxOf` is the page's idea of a window written down.
      serialize(boxOf) {
        return {
          at,
          workspaces: spaces.map((s, i) => {
            const windows = windowsOf(i);
            const its = i === at ? host.focused : s.focused;
            return {
              id: s.id,
              name: s.name || undefined,
              focused: its && windows.includes(its) ? its.id : null,
              arrangement: i === at ? host.arrangement : s.arrangement,
              containers: windows.map(boxOf),
            };
          }),
        };
      },

      // Build them all again from what was stored. Every workspace's shells
      // start now, not when you first look at one: a workspace you switch to
      // should be where you left it, not still connecting.
      //
      // Three shapes: workspaces; the same under `screens`, which the builds
      // before the rename wrote; and, from before there were workspaces at
      // all, one set of windows at the top level. A layout from before windows
      // were the only kind has boxes that were never real boxes.
      load(saved) {
        const legacy = saved && saved.windowed === false;
        const stored = saved
          ? saved.workspaces ||
            saved.screens ||
            [{ id: 's1', focused: saved.focused, arrangement: saved.arrangement, containers: saved.containers }]
          : [{ id: 's1', containers: [host.defaultBox(0)] }];
        const list = stored.slice(0, limits.workspaces);

        spaces = list.map((s, i) => blank({ id: s.id || `s${i + 1}`, name: s.name || '', arrangement: s.arrangement || null }));
        at = Math.max(0, Math.min(spaces.length - 1, saved ? saved.at || 0 : 0));

        let budget = limits.shells;
        list.forEach((s, i) => {
          const boxes = (s.containers || []).slice(0, Math.min(limits.windows, budget));
          budget -= boxes.length;
          const made = boxes.map((box, n) => {
            const usable = !legacy && box.w > 200 && box.h > 150;
            const c = host.spawn(box.id, usable ? host.fitToScreen(box) : host.defaultBox(n), box.name, undefined, i !== at);
            if (box.min) c.setMinimized(true);
            return c;
          });
          const its = made.find((c) => c.id === s.focused) || made.find((c) => !c.minimized) || made[0];
          if (i === at) {
            host.arrangement = s.arrangement || null;
            if (its) host.focus(its);
          } else {
            spaces[i].windows = made;
            spaces[i].focused = its || null;
          }
        });

        if (!host.containers.length) {
          const c = host.spawn(null, host.defaultBox(0)); // nothing usable was stored
          host.focus(c);
        }
      },

      // spaces.js fills this in; it is called whenever the list changed.
      paint() {},
    };

    return api;
  }

  window.HEROTERM_WORKSPACES = { create, MAX_WORKSPACES, UNDO };
})();
