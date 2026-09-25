'use strict';

// A newer HeroTerm: noticing one, installing it where you can watch, and
// restarting onto it. The server does the asking and the restarting (see
// update.js and /restart in server.js); this is what you see of it.
//
// Two places show it. The status bar gets a chip, only when there's something
// to do — an update to install, or one installed and waiting on a restart —
// and the chip opens Settings on the System tab, where the Updates section
// says what's going on and has the buttons.
//
// Installing is typed into a window of its own, not run out of sight: you see
// the command before it runs and everything npm says, and a permissions error
// is in front of you rather than in a log. When that command finishes, the
// server is asked again, and it reads the version off the disk — so "did it
// work" is answered by what's installed, not by what npm printed.

(function () {
  const token = new URLSearchParams(location.search).get('token') || '';
  const chip = document.getElementById('updchip');
  const box = document.getElementById('update-state');

  const EVERY = 6 * 60 * 60 * 1000; // the server keeps its answer as long
  const CHANGES = 'https://github.com/yokeholy/HeroTerm/compare';

  let on = true; // the setting; see enabled()
  let info = null; // the server's last answer
  let failed = null; // why asking the server itself failed
  let installer = null; // the window the install was typed into
  let installing = false;
  let asking = false; // the Restart button is asking "are you sure"
  let restarting = false;
  let note = ''; // the one thing that just happened, when there is one
  let noRoom = false; // ...and it was that the Update window had nowhere to go

  const settings = () => window.HEROTERM_SETTINGS;

  async function ask(check) {
    // With the check off, the server is still asked — but for what's on
    // disk only, which is how an install is noticed waiting on a restart.
    const q = `token=${encodeURIComponent(token)}${check ? '&check=1' : ''}${on || check ? '' : '&ask=0'}`;
    const res = await fetch(`/update?${q}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status === 404 ? 'this server is too old to ask — restart it' : `HTTP ${res.status}`);
    return res.json();
  }

  async function refresh(check) {
    try {
      info = await ask(check);
      failed = null;
    } catch (err) {
      failed = err.message;
    }
    paint();
    return info;
  }

  /* ---------- the install ---------- */

  function install() {
    if (!info || !info.command) return;
    note = '';
    noRoom = false;
    const c = window.HEROTERM_WINDOWS && window.HEROTERM_WINDOWS.run('Update', info.command);
    if (!c) {
      noRoom = true;
      note = 'No room for another window. Close one, or run this yourself:';
      paint();
      return;
    }
    installer = c;
    installing = true;
    const from = info.installed;
    // The window's border says when its command is done: busy, then ok or err.
    let started = false;
    const watch = new MutationObserver(async () => {
      const run = c.el.dataset.run;
      if (run === 'busy') started = true;
      if (!started || (run !== 'ok' && run !== 'err')) return;
      watch.disconnect();
      installing = false;
      installer = null;
      await refresh(true);
      if (info && info.restartNeeded) note = '';
      else if (run === 'err') note = "The install didn't finish — the Update window says why.";
      else if (info && info.installed === from) {
        note = "npm finished, but this copy of HeroTerm didn't change — it may have installed a second one somewhere else.";
      }
      paint();
    });
    watch.observe(c.el, { attributes: true, attributeFilter: ['data-run'] });
    paint();
  }

  /* ---------- the restart ---------- */

  // Windows with something running, across every workspace in this tab. The
  // server's count of shells covers other tabs too; this is the part you can
  // see from here, and the part that matters most.
  function busyHere() {
    const S = window.HEROTERM_SPACES;
    if (!S) return 0;
    return S.list().reduce((n, _s, i) => n + S.busyOn(i), 0);
  }

  function confirming(yes) {
    asking = yes;
    paint();
  }

  async function restart() {
    asking = false;
    restarting = true;
    note = '';
    paint();
    let res;
    try {
      res = await fetch(`/restart?token=${encodeURIComponent(token)}`, { method: 'POST' });
    } catch (err) {
      res = { ok: false, json: async () => ({ reason: err.message }) };
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      restarting = false;
      note = body.reason || "It didn't restart.";
      paint();
      return;
    }
    // The server goes, and a new one comes up with the same token. The page
    // is reloaded once it answers with the new version, so the new page comes
    // with it; the windows come back from the layout, their new shells in the
    // folders the old ones were in.
    const want = info && info.installed;
    const deadline = Date.now() + 30000;
    const poll = async () => {
      try {
        const r = await fetch(`/config?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
        if (r.ok) {
          const { version } = await r.json();
          if (!want || version === want) {
            location.reload();
            return;
          }
        }
      } catch {
        /* still down; that's expected for a moment */
      }
      if (Date.now() < deadline) setTimeout(poll, 500);
      else {
        restarting = false;
        note = "It hasn't come back. `heroterm status` in a terminal says whether it's running.";
        paint();
      }
    };
    setTimeout(poll, 800);
  }

  /* ---------- what you see ---------- */

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function button(label, onClick, primary) {
    const b = el('button', primary ? 'upd primary' : 'upd', label);
    b.type = 'button';
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', onClick);
    return b;
  }

  function ago(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }

  const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

  function paintChip() {
    let text = '';
    if (restarting) text = 'Restarting…';
    else if (info && info.restartNeeded) text = `Restart for ${info.installed}`;
    else if (info && info.available && !installing) text = `${info.latest} available`;
    chip.hidden = !text;
    chip.textContent = text;
    chip.dataset.tip = info && info.restartNeeded ? 'Installed — restart HeroTerm to use it' : 'A newer HeroTerm — see Settings';
  }

  function paintBox() {
    const out = [];
    const line = (text, cls) => out.push(el('p', cls || 'upd-line', text));
    const row = (...kids) => {
      const r = el('div', 'upd-row');
      r.append(...kids.filter(Boolean));
      out.push(r);
    };
    const check = () => button('Check now', () => refresh(true));

    if (failed) {
      line(`Couldn't ask the server: ${failed}.`);
    } else if (!info) {
      line('Asking…');
    } else if (restarting) {
      line('Restarting… this page reloads when HeroTerm is back.');
    } else if (info.restartNeeded) {
      line(`HeroTerm ${info.installed} is installed. This is still ${info.running} until it restarts.`);
      if (!info.canRestart) {
        line(
          'This one belongs to the terminal it was started in: stop it there (Ctrl-C) and run heroterm again. ' +
            'Started with heroterm start, it could restart itself from here.',
          'upd-hint'
        );
      } else if (asking) {
        const busy = busyHere();
        const shells = plural(info.shells, 'shell');
        line(
          `Restart HeroTerm? ${shells} will end${busy ? ` — ${busy} still running here` : ''}. ` +
            'Your windows come back, with new shells in the same folders.',
          'upd-warn'
        );
        row(button('Restart', restart, true), button('Cancel', () => confirming(false)));
      } else {
        row(button('Restart HeroTerm…', () => confirming(true), true));
      }
    } else if (info.dev) {
      line(`A development copy (${info.running}): it updates with git, so it isn't checked.`);
    } else if (installing) {
      line('Installing, in the Update window…');
    } else if (info.available) {
      const what = el('p', 'upd-line');
      what.append(`HeroTerm ${info.latest} is out — you have ${info.running}. `);
      const link = el('a', null, "What's new");
      link.href = `${CHANGES}/v${info.running}...v${info.latest}`;
      link.target = '_blank';
      link.rel = 'noopener';
      what.append(link);
      out.push(what);
      if (info.command) {
        row(button('Update', install, true));
        const how = el('p', 'upd-hint', 'Opens a window and runs: ');
        how.append(el('code', null, info.command));
        out.push(how);
      } else {
        line(
          "This copy wasn't installed with npm install -g (npx, or a project's node_modules) — update it the way it was installed.",
          'upd-hint'
        );
      }
    } else if (info.error) {
      line(`Couldn't reach npm: ${info.error}.`);
      row(check());
    } else if (info.latest) {
      line(`Up to date — ${info.running}. Checked ${ago(info.checkedAt)}.`);
      row(check());
    } else {
      line(`HeroTerm ${info.running}. Not checking for updates.`);
      row(check());
    }

    if (note) {
      out.push(el('p', 'upd-warn', note));
      if (noRoom && info && info.command) {
        const how = el('p', 'upd-hint');
        how.append(el('code', null, info.command));
        out.push(how);
      }
    }
    box.replaceChildren(...out);
  }

  function paint() {
    paintChip();
    paintBox();
  }

  chip.addEventListener('mousedown', (e) => e.preventDefault());
  chip.addEventListener('click', () => settings() && settings().open('system'));

  /* ---------- when to ask ---------- */

  let timer = null;

  function schedule() {
    clearInterval(timer);
    timer = on ? setInterval(() => refresh(false), EVERY) : null;
  }

  window.HEROTERM_UPDATES = {
    refresh: (check) => refresh(Boolean(check)),
    // The setting changed (see settings.js).
    enabled(v) {
      if (on === v) return;
      on = v;
      schedule();
      refresh(false);
    },
  };

  on = settings() ? Boolean(settings().get('updateCheck')) : true;
  schedule();
  // Not straight away: the page has windows to connect first, and nothing
  // about an update is urgent.
  setTimeout(() => refresh(false), 3000);
})();
