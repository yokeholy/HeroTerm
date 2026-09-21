'use strict';

// What you actually type, drawn from the shell history file rather than from
// this session — so it knows about every terminal you have ever had open, not
// just this tab. The reading and counting happen on the server; what arrives
// here is already just numbers. See history.js.

(function () {
  const panel = document.getElementById('stats');
  const openBtn = document.getElementById('statsbtn');
  const closeBtn = document.getElementById('stats-close');
  const bodyEl = document.getElementById('stats-body');

  let loaded = false;
  let returnFocus = null;

  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

  const num = (n) => n.toLocaleString();

  function day(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function bars(rows, total) {
    if (!rows.length) return '<p class="muted">Nothing in here yet.</p>';
    const max = rows[0].count;
    return `<ol class="bars">${rows
      .map((r) => {
        const share = ((r.count / total) * 100).toFixed(1);
        return `<li>
            <span class="k" title="${esc(r.name)}">${esc(r.name)}</span>
            <span class="track"><span class="fill" style="width:${(r.count / max) * 100}%"></span></span>
            <span class="n" title="${share}% of all commands">${num(r.count)}</span>
          </li>`;
      })
      .join('')}</ol>`;
  }

  function clock(hours) {
    const max = Math.max(...hours, 1);
    return `<div class="hours">${hours
      .map(
        (n, h) =>
          `<span class="hour" title="${String(h).padStart(2, '0')}:00 — ${num(n)}">
             <span class="col" style="height:${Math.max(n ? 3 : 0, (n / max) * 100)}%"></span>
             <span class="hl">${h % 6 === 0 ? String(h).padStart(2, '0') : ''}</span>
           </span>`
      )
      .join('')}</div>`;
  }

  function render(d) {
    if (!d.ok) {
      bodyEl.innerHTML = `<p class="muted">${esc(d.reason)}</p>`;
      return;
    }

    const undated = d.total - d.dated;

    bodyEl.innerHTML = `
      <div class="summary">
        <div><b>${num(d.total)}</b><span>commands</span></div>
        <div><b>${num(d.uniquePrograms)}</b><span>programs</span></div>
        <div><b>${num(d.uniqueLines)}</b><span>distinct lines</span></div>
        <div><b>${day(d.first)}</b><span>oldest entry</span></div>
      </div>

      <div class="cols">
        <section>
          <h2>Most used programs</h2>
          ${bars(d.programs, d.total)}
        </section>
        <section>
          <h2>Most repeated lines</h2>
          ${
            d.lines.length
              ? bars(d.lines, d.total)
              : '<p class="muted">Nothing has been run twice yet.</p>'
          }
        </section>
      </div>

      <section>
        <h2>By hour of day${undated ? ` <span class="muted">— ${num(undated)} entries have no timestamp</span>` : ''}</h2>
        ${clock(d.hours)}
      </section>

      <p class="src">Read from <code>${esc(d.file)}</code></p>
    `;
  }

  async function load() {
    bodyEl.innerHTML = '<p class="muted">Reading your shell history…</p>';
    try {
      const token = new URLSearchParams(location.search).get('token') || '';
      const res = await fetch(`/stats?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`the server answered ${res.status}`);
      render(await res.json());
      loaded = true;
    } catch (err) {
      bodyEl.innerHTML = `<p class="muted">Couldn't read the history — ${esc(err.message)}.</p>`;
    }
  }

  function open() {
    returnFocus = document.activeElement;
    panel.hidden = false;
    openBtn.setAttribute('aria-expanded', 'true');
    closeBtn.focus(); // so that typing doesn't quietly go to the shell behind
    if (!loaded) load();
  }

  function close() {
    panel.hidden = true;
    openBtn.setAttribute('aria-expanded', 'false');
    if (returnFocus && returnFocus.focus) returnFocus.focus();
  }

  openBtn.addEventListener('mousedown', (e) => e.preventDefault());
  openBtn.addEventListener('click', () => (panel.hidden ? open() : close()));
  closeBtn.addEventListener('click', close);

  // Click the backdrop, but not the sheet itself.
  panel.addEventListener('mousedown', (e) => {
    if (e.target === panel) close();
  });

  // Capture, so Escape closes the panel instead of reaching the shell.
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

  window.WEBTERM_STATS = { open, close, reload: load };
})();
