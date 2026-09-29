'use strict';

// Feedback, as a GitHub issue.
//
// HeroTerm has no server of its own out on the internet, and the one promise
// about the network is that nothing about you goes anywhere. So this sends
// nothing: it fills in a new-issue page on GitHub and opens it, and the person
// reads it there and sends it from their own account — or doesn't.
//
// What's filled in is what they wrote, and, if they leave the box ticked, a
// few lines about the system it's running on — shown right under the box, so
// there's nothing in the issue they haven't seen. No paths, no commands, no
// output, no token.

(function () {
  const REPO = 'https://github.com/yokeholy/HeroTerm';
  // A URL much longer than this is refused by GitHub, or cut off by the
  // browser before it gets there.
  const MAX_URL = 7000;

  const panel = document.getElementById('feedback');
  const form = panel.querySelector('form');
  const closeBtn = document.getElementById('fb-close');
  const cancelBtn = document.getElementById('fb-cancel');
  const kinds = [...panel.querySelectorAll('#fb-kind button')];
  const label = document.getElementById('fb-label');
  const text = document.getElementById('fb-text');
  const withSystem = document.getElementById('fb-sys');
  const details = document.getElementById('fb-details');
  const send = document.getElementById('fb-send');

  const KINDS = {
    bug: {
      title: 'Bug',
      labels: 'bug',
      ask: 'What happened?',
      hint: 'What you did, what you expected, and what happened instead.',
    },
    idea: {
      title: 'Idea',
      labels: 'enhancement',
      ask: 'What would you like?',
      hint: 'What you would like HeroTerm to do, and what it would help with.',
    },
  };

  let kind = 'bug';
  let returnFocus = null;
  let system = null; // the lines, once /config has answered

  /* ---------- what it's running on ---------- */

  // The browser's own name and version. Chromium's client hints say which
  // Chromium it is (Brave, Edge, Arc...); everything else, the user agent.
  function browserName() {
    const hints = navigator.userAgentData;
    if (hints && Array.isArray(hints.brands)) {
      const real = hints.brands.filter((b) => !/not.?a.?brand/i.test(b.brand));
      const own = real.find((b) => b.brand !== 'Chromium') || real[0];
      if (own) return `${own.brand === 'Google Chrome' ? 'Chrome' : own.brand} ${own.version}`;
    }
    const ua = navigator.userAgent;
    const known = [
      ['Edge', /Edg\/(\d+)/],
      ['Firefox', /Firefox\/(\d+)/],
      ['Chrome', /Chrome\/(\d+)/],
      ['Safari', /Version\/([\d.]+).*Safari/],
    ];
    for (const [name, re] of known) {
      const m = re.exec(ua);
      if (m) return `${name} ${m[1]}`;
    }
    return 'an unknown browser';
  }

  async function loadSystem() {
    let cfg = {};
    try {
      const token = new URLSearchParams(location.search).get('token') || '';
      const res = await fetch(`/config?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (res.ok) cfg = await res.json();
    } catch {
      /* what the page knows on its own will do */
    }
    const shell = cfg.shell ? cfg.shell.split('/').pop() : null;
    system = [
      `HeroTerm ${cfg.version || 'unknown'}${cfg.dev ? ' (development copy)' : ''}`,
      cfg.os || null,
      browserName(),
      cfg.node ? `Node ${cfg.node}` : null,
      shell ? `Shell: ${shell}` : null,
    ].filter(Boolean);
    paint();
  }

  /* ---------- the issue ---------- */

  function issueUrl() {
    const k = KINDS[kind];
    const said = text.value.trim();
    const first = said.split('\n')[0].trim();
    const title = `${k.title}: ${first.length > 72 ? `${first.slice(0, 71)}…` : first}`;
    const tail = withSystem.checked && system ? `\n\n---\n\n**System**\n\n${system.map((l) => `- ${l}`).join('\n')}\n` : '\n';
    const url = (body) => `${REPO}/issues/new?${new URLSearchParams({ title, labels: k.labels, body })}`;

    // Too long for a link: cut what they wrote, and say so where they'll see
    // it, so the rest can be pasted in on GitHub.
    let body = said + tail;
    if (url(body).length > MAX_URL) {
      const note = '\n\n*(Cut short to fit in a link — the rest is to paste in here.)*';
      let keep = said.length;
      while (keep > 0 && url(said.slice(0, keep) + note + tail).length > MAX_URL) keep -= 200;
      body = said.slice(0, Math.max(0, keep)) + note + tail;
    }
    return url(body);
  }

  function paint() {
    const k = KINDS[kind];
    for (const b of kinds) b.setAttribute('aria-pressed', String(b.dataset.v === kind));
    label.textContent = k.ask;
    text.placeholder = k.hint;
    details.textContent = system ? system.join('\n') : '…';
    details.hidden = !withSystem.checked;
    send.disabled = !text.value.trim();
  }

  /* ---------- opening and closing ---------- */

  function open() {
    if (window.HEROTERM_HELP) window.HEROTERM_HELP.close();
    returnFocus = document.activeElement;
    panel.hidden = false;
    loadSystem();
    paint();
    text.focus();
  }

  function close() {
    panel.hidden = true;
    if (returnFocus && returnFocus.isConnected && returnFocus.focus) returnFocus.focus();
  }

  for (const b of kinds) {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      kind = b.dataset.v;
      paint();
    });
  }
  text.addEventListener('input', paint);
  withSystem.addEventListener('change', paint);
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!text.value.trim()) return;
    window.open(issueUrl(), '_blank', 'noopener');
    // Sent on its way; what's left to do happens on GitHub. What they wrote
    // is kept only until then — a Cancel keeps it, in case it was a slip.
    text.value = '';
    close();
  });

  // ⌘↩ sends, as in most places you write something and send it.
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // Click the backdrop, but not the form itself.
  panel.addEventListener('mousedown', (e) => {
    if (e.target === panel) close();
  });

  // Capture, so Escape closes this instead of reaching the shell.
  document.addEventListener(
    'keydown',
    (e) => {
      if (panel.hidden || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    },
    true
  );

  document.getElementById('help-feedback').addEventListener('click', open);

  window.HEROTERM_FEEDBACK = { open, close, issueUrl };
})();
