'use strict';

// Fire along the edges of every window that's working.
//
// While a command runs in a window, its edges burn: flames lick up from all
// four sides and climb, and the window glows with it. When the command ends
// the burning stops being fed and the flames that are already up die down on
// their own, which is the fade-out.
//
// Each burning window has a fire of its own: a canvas just after the window
// in the page, at the window's own stacking level — so it's drawn over its
// window and under any window in front of it, which covers it the way it
// covers that window's text. A sibling and not a child, because a window you
// aren't in is faded, and its fire shouldn't be. The canvas is only as big as
// the window and the room its flames need, and follows it every frame, so a
// window dragged mid-build takes its fire along.
//
// Each flame is a particle: born on the edge, rising, drifting, shrinking and
// cooling from yellow through orange to red, drawn from a few sprites made
// once. Nothing runs while nothing is burning.

(function () {
  let g = null; // the canvas being drawn on: each fire's in turn, in frame()

  const PER_PX = 1.5; // flames born per second, per pixel of edge
  const MAX = 3600; // flames alive at once, whatever the window's size
  const LIFE = [0.4, 0.95]; // seconds a flame lasts
  const RISE = [45, 95]; // px/s upward
  const SIZE = [6, 13]; // px half-width when born; a flame is taller than wide
  const BED = 14; // px: how far the bed of fire along the edge reaches out
  // The bottom is the base of the fire — the window sits on it — so it burns
  // hardest: more flames, born further down, under a deeper bed.
  const BOTTOM_SHARE = 2; // its flames, as a multiple of its length's share
  const BOTTOM_DEPTH = 30; // px below the edge a flame there can be born
  const BOTTOM_BED = 2.2; // its bed, as a multiple of BED
  // How far the fire burns into the window, past its edge: flames are drawn
  // over the window, and then everything further in than this is wiped away
  // again, fading over the band — so they lick over the frame but never reach
  // the middle of the terminal.
  const INTO = 30; // px
  const SEG = 18; // px of edge per flicker of the bed
  const SPARKS = 0.025; // the share of flames that are sparks instead
  const IGNITE = 0.45; // seconds from nothing to full fire

  const rand = (a, b) => a + Math.random() * (b - a);

  let dpr = 1;
  let scale = 1; // Settings → Effects → Fire size, as a multiple
  let allowed = true;
  let raf = null;
  let last = 0;
  let sprites = null;
  // The fires, by the key the page gave each window. A fire outlives being
  // asked for by as long as its last flames take to die.
  const fires = new Map();
  let light = false; // a pale theme: ink-dark flames, drawn normally

  // Respecting "reduce motion": no flames at all, just the glow (styles.css).
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- the sprites ---------- */

  // A soft round flame in each colour it passes through, drawn once. On a
  // dark sky they're added together, which is what makes the heart of a fire
  // burn white; on a pale one that would only bleach, so they're darker and
  // drawn as they are.
  // Each is a tongue of flame rather than a dot: round at the bottom, drawn
  // out to a point at the top, brightest low down where the burning is.
  // Cooling is quick — a flame is yellow only as it's born, and spends most
  // of its life orange and red — or a whole edge of them reads as white.
  function makeSprites() {
    const stops = light
      ? ['#f2902e', '#e86a1f', '#d84f1a', '#c43c18', '#a83216']
      : ['#ffe28a', '#ffad3a', '#ff7a22', '#e84a17', '#9c2310'];
    return stops.map((colour) => {
      const s = document.createElement('canvas');
      s.width = 32;
      s.height = 96;
      const c = s.getContext('2d');
      c.save();
      c.translate(16, 72);
      c.scale(1, 3); // the circle, stretched upward into a tongue
      const grad = c.createRadialGradient(0, 0, 0, 0, 0, 16);
      grad.addColorStop(0, colour);
      grad.addColorStop(0.3, colour);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grad;
      c.beginPath();
      c.arc(0, 0, 16, 0, Math.PI * 2);
      c.fill();
      c.restore();
      return s;
    });
  }

  // A spark: a hot point that flies higher than the flames and winks out.
  function makeSpark() {
    const s = document.createElement('canvas');
    s.width = s.height = 16;
    const c = s.getContext('2d');
    const grad = c.createRadialGradient(8, 8, 0, 8, 8, 8);
    grad.addColorStop(0, light ? '#c4521c' : '#fff0b0');
    grad.addColorStop(0.4, light ? '#a83c15' : '#ffb347');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = grad;
    c.fillRect(0, 0, 16, 16);
    return s;
  }
  let spark = null;

  function readTheme() {
    const T = window.HEROTERM_THEME;
    const bg = (T && T.chrome && T.chrome.space) || '#05070c';
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(bg);
    const lum = m ? (0.2126 * parseInt(m[1], 16) + 0.7152 * parseInt(m[2], 16) + 0.0722 * parseInt(m[3], 16)) / 255 : 0;
    const was = light;
    light = lum > 0.5;
    if (!sprites || was !== light) {
      sprites = makeSprites();
      spark = makeSpark();
    }
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
  }

  // How much room around the window its fire draws in: flames and sparks
  // rise, so most of it is above.
  function room() {
    const k = Math.max(1, scale);
    return { top: Math.round(300 * k), side: Math.round(130 * k), bottom: Math.round(110 * k) };
  }

  function makeFire(el) {
    const canvas = document.createElement('canvas');
    canvas.className = 'fire';
    canvas.setAttribute('aria-hidden', 'true');
    el.after(canvas);
    return { el, canvas, g: canvas.getContext('2d'), target: null, feed: 0, owed: 0, flames: [], box: null };
  }

  // Put the canvas around the window, with room for its flames — sized in
  // steps, so a window being resized doesn't reallocate it every frame — and
  // at the window's stacking level, whatever that is just now.
  function place(f, r) {
    const m = room();
    const step = 64;
    const want = {
      x: Math.floor(r.x - m.side),
      y: Math.floor(r.y - m.top),
      w: Math.ceil((r.w + 2 * m.side) / step) * step,
      h: Math.ceil((r.h + m.top + m.bottom) / step) * step,
    };
    const c = f.canvas;
    if (!f.box || f.box.w !== want.w || f.box.h !== want.h || f.dpr !== dpr) {
      c.width = Math.round(want.w * dpr);
      c.height = Math.round(want.h * dpr);
      c.style.width = `${want.w}px`;
      c.style.height = `${want.h}px`;
      f.dpr = dpr;
    }
    c.style.transform = `translate(${want.x}px, ${want.y}px)`;
    c.style.zIndex = getComputedStyle(f.el).zIndex;
    f.box = want;
  }

  function drop(key, f) {
    f.canvas.remove();
    fires.delete(key);
  }

  /* ---------- the flames ---------- */

  // Born somewhere along the edge, chosen by length so a long side burns as
  // densely as a short one. Every flame rises — this is fire — but each side
  // starts it off differently: the top sends it straight up, the sides lean it
  // outward and up their length, and the bottom — the base of the fire —
  // starts them well below the window, with room to burn before they climb
  // out of sight behind it.
  function spawn(r) {
    const per = r.w * (1 + BOTTOM_SHARE) + 2 * r.h;
    let d = Math.random() * per;
    let x;
    let y;
    let vx;
    // Somewhere from a little inside the edge to just past it: the ones born
    // inside are the fire burning through the window's frame.
    const out = rand(-INTO * 0.6, 3);
    if ((d -= r.w) < 0) {
      x = r.x + Math.random() * r.w;
      y = r.y - out;
      vx = rand(-12, 12);
    } else if ((d -= r.h) < 0) {
      x = r.x + r.w + out;
      y = r.y + Math.random() * r.h;
      vx = rand(18, 48); // flaring out from the side, not stacking up its length
    } else if ((d -= r.w * BOTTOM_SHARE) < 0) {
      x = r.x + Math.random() * r.w;
      y = r.y + r.h + out + Math.random() * BOTTOM_DEPTH * scale;
      vx = rand(-10, 10);
    } else {
      x = r.x - out;
      y = r.y + Math.random() * r.h;
      vx = rand(-48, -18);
    }
    if (Math.random() < SPARKS) {
      return { x, y, vx: vx * 1.5 + rand(-20, 20), vy: -rand(110, 200), age: 0, life: rand(0.6, 1.3), size: rand(1.2, 2.4), seed: Math.random() * 6.28, spark: true };
    }
    const life = rand(LIFE[0], LIFE[1]);
    return { x, y, vx, vy: -rand(RISE[0], RISE[1]) * scale, age: 0, life, size: rand(SIZE[0], SIZE[1]) * scale, seed: Math.random() * 6.28 };
  }

  // The bed of the fire: a band of glow hugging the edge, so the edge itself
  // is alight and the flames rise out of something rather than out of
  // nothing. Its outer outline rises and falls along the edge — each point
  // flickering to its own height, joined by smooth curves — so it's never a
  // steady stripe, and never a row of blocks either.
  function bed(r, now, feed) {
    const flicker = (i) =>
      0.55 + 0.25 * Math.sin(now / 90 + i * 1.7) + 0.2 * Math.sin(now / 37 + i * 4.3);
    const hot = light ? 'rgba(214, 96, 34,' : 'rgba(255, 128, 36,';

    // One side: from `a` to `b` along the edge, reaching out along `out`
    // (a unit vector) by `reach` times the flicker at each point.
    const side = (ax, ay, bx, by, ox, oy, reach, seed) => {
      const len = Math.hypot(bx - ax, by - ay);
      const n = Math.max(2, Math.round(len / SEG));
      const pts = [];
      const TAPER = 26; // px at each end over which it narrows to nothing,
      // so where two sides meet the corner is round, as the window's is
      for (let k = 0; k <= n; k += 1) {
        const t = k / n;
        const end = Math.min(t * len, (1 - t) * len) / TAPER;
        const taper = end >= 1 ? 1 : Math.sin((end * Math.PI) / 2);
        const d = reach * (0.6 + flicker(seed + k)) * taper;
        pts.push([ax + (bx - ax) * t + ox * d, ay + (by - ay) * t + oy * d]);
      }
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length; k += 1) {
        const [px, py] = pts[k - 1];
        const [qx, qy] = pts[k];
        g.quadraticCurveTo(px, py, (px + qx) / 2, (py + qy) / 2);
      }
      g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      g.lineTo(bx, by);
      g.closePath();
      // Faded out by about the shortest the outline gets, so its wave reads as
      // a flicker in the glow, never as a hard edge — the bottom has no flames
      // rising past it to soften it, as the top does.
      const far = reach * 1.05;
      const grad = g.createLinearGradient(ax, ay, ax + ox * far, ay + oy * far);
      grad.addColorStop(0, `${hot}${0.7 * feed})`);
      grad.addColorStop(0.45, `${hot}${0.32 * feed})`);
      grad.addColorStop(1, `${hot}0)`);
      g.fillStyle = grad;
      g.fill();
    };

    const bed = BED * scale;
    side(r.x, r.y, r.x + r.w, r.y, 0, -1, bed, 0); // top: up
    side(r.x, r.y + r.h, r.x + r.w, r.y + r.h, 0, 1, bed * BOTTOM_BED, 50); // bottom: the base
    side(r.x, r.y, r.x, r.y + r.h, -1, 0, bed, 100); // left: outward
    side(r.x + r.w, r.y, r.x + r.w, r.y + r.h, 1, 0, bed, 200); // right: outward
    // ...and a shallower one inward, the edge burning into the window.
    side(r.x, r.y, r.x + r.w, r.y, 0, 1, INTO * 0.45, 300);
    side(r.x, r.y + r.h, r.x + r.w, r.y + r.h, 0, -1, INTO * 0.6, 350);
    side(r.x, r.y, r.x, r.y + r.h, 1, 0, INTO * 0.4, 400);
    side(r.x + r.w, r.y, r.x + r.w, r.y + r.h, -1, 0, INTO * 0.4, 450);
  }

  // Wipe away whatever was drawn deeper into the window than INTO, fading in
  // over the band, so the fire burns over the frame and no further. Gradient
  // strips rather than a blurred shape, so it works in every browser.
  function burnInto(r) {
    g.globalCompositeOperation = 'destination-out';
    g.globalAlpha = 1;
    const ix = r.x + INTO;
    const iy = r.y + INTO;
    const iw = Math.max(0, r.w - 2 * INTO);
    const ih = Math.max(0, r.h - 2 * INTO);
    g.fillStyle = '#000';
    g.fillRect(ix, iy, iw, ih);
    const strip = (x, y, sw, sh, x0, y0, x1, y1) => {
      const grad = g.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,1)');
      g.fillStyle = grad;
      g.fillRect(x, y, sw, sh);
    };
    strip(ix, r.y, iw, INTO, 0, r.y, 0, iy); // top band
    strip(ix, iy + ih, iw, INTO, 0, r.y + r.h, 0, iy + ih); // bottom band
    strip(r.x, iy, INTO, ih, r.x, 0, ix, 0); // left band
    strip(ix + iw, iy, INTO, ih, r.x + r.w, 0, ix + iw, 0); // right band
    // The corners, which no strip reaches: faded from the inner corner out.
    for (const [cx, cy, qx, qy] of [
      [ix, iy, r.x, r.y],
      [ix + iw, iy, ix + iw, r.y],
      [ix, iy + ih, r.x, iy + ih],
      [ix + iw, iy + ih, ix + iw, iy + ih],
    ]) {
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, INTO);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(qx, qy, INTO, INTO);
    }
    g.globalCompositeOperation = light ? 'source-over' : 'lighter';
  }

  // One fire's frame: feed it, move and draw its flames, burn into its
  // window. Returns whether it still has anything to show.
  function burnOne(f, now, dt) {
    // Closed, in another workspace, or minimized to the tray: out at once,
    // rather than embers hanging where the window was.
    const away = !f.el.isConnected || f.el.hasAttribute('data-away') || f.el.hidden;
    if (away) return false;
    const r = allowed && !still.matches && f.target ? f.target() : null;
    const want = r ? 1 : 0;
    f.feed += (want - f.feed) * Math.min(1, (dt / IGNITE) * 2.2);
    if (f.feed < 0.002 && !want) f.feed = 0;

    // Fed in proportion to the edge, and to how far the fire has caught.
    if (r && f.feed > 0.01) {
      // Bigger flames cover more each, so fewer are born: the fire grows
      // taller and wider without piling up into a white-hot smear.
      f.owed += ((r.w * (1 + BOTTOM_SHARE) + 2 * r.h) * PER_PX * f.feed * dt) / Math.max(1, scale) ** 1.2;
      while (f.owed >= 1 && f.flames.length < MAX) {
        f.flames.push(spawn(r));
        f.owed -= 1;
      }
      f.owed = Math.min(f.owed, 1);
    }
    if (!f.flames.length && !want && !f.feed) return false;

    if (r) place(f, r);
    else if (f.box) f.canvas.style.zIndex = getComputedStyle(f.el).zIndex;
    if (!f.box) return true; // nothing placed yet; next frame
    g = f.g;
    g.setTransform(dpr, 0, 0, dpr, -f.box.x * dpr, -f.box.y * dpr);
    g.clearRect(f.box.x, f.box.y, f.box.w, f.box.h);
    g.globalCompositeOperation = light ? 'source-over' : 'lighter';
    if (r && f.feed > 0.01) bed(r, now, f.feed);

    const live = [];
    for (const p of f.flames) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const t = p.age / p.life;
      // A lick of sideways flutter, so the flames dance rather than rise in
      // straight lines, and a little acceleration upward, as hot air does.
      p.vx += Math.sin(now / 140 + p.seed) * 40 * dt;
      p.vy -= 30 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      if (p.spark) {
        g.globalAlpha = fade * (light ? 0.8 : 0.95);
        const sz = p.size * 2.4;
        g.drawImage(spark, p.x - sz, p.y - sz, sz * 2, sz * 2);
      } else {
        // Thinner as it rises and cools, and pulled taller: a tongue that
        // narrows to nothing rather than a puff that shrinks.
        const half = p.size * (1 - t * 0.6);
        const tall = half * (3.2 + t * 1.8);
        const sprite = sprites[Math.min(sprites.length - 1, Math.floor(t * t * sprites.length * 1.6))];
        g.globalAlpha = (fade * (light ? 0.34 : 0.36)) / Math.sqrt(Math.max(1, scale));
        g.drawImage(sprite, p.x - half, p.y - tall * 0.75, half * 2, tall);
      }
      live.push(p);
    }
    f.flames = live;
    g.globalAlpha = 1;
    if (r) burnInto(r);
    // While Settings shows it off, the window sits over the sheet's veil, and
    // its fire with it — and so over the sheet, where it has no business.
    if (document.body.hasAttribute('data-effects-preview')) {
      const sheet = document.querySelector('#settings .sheet');
      if (sheet) {
        const q = sheet.getBoundingClientRect();
        g.clearRect(q.x, q.y, q.width, q.height);
      }
    }
    return true;
  }

  function frame(now) {
    raf = null;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    for (const [key, f] of fires) if (!burnOne(f, now, dt)) drop(key, f);
    if (fires.size) raf = requestAnimationFrame(frame);
    else last = 0;
  }

  function wake() {
    if (raf === null) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }

  /* ---------- asked for by the page ---------- */

  window.HEROTERM_FIRE = {
    // What to burn: every window that should be on fire now, as
    // { key, el, rect } — the window's element, and a function giving its
    // rectangle on screen, asked every frame. A window left out stops being
    // fed, and its fire dies down.
    burn(list) {
      readTheme();
      const keep = new Set();
      for (const w of list || []) {
        keep.add(w.key);
        let f = fires.get(w.key);
        if (f && f.el !== w.el) {
          drop(w.key, f);
          f = null;
        }
        if (!f) {
          f = makeFire(w.el);
          fires.set(w.key, f);
        }
        f.target = w.rect;
      }
      for (const [key, f] of fires) if (!keep.has(key)) f.target = null;
      document.body.toggleAttribute('data-fire', keep.size > 0 && allowed);
      wake();
    },

    // The setting (Settings → Effects).
    allow(on) {
      allowed = Boolean(on);
      if (!allowed) document.body.removeAttribute('data-fire');
      wake();
    },

    retheme() {
      readTheme();
    },

    // How big the fire is, in percent of the usual; 100 is as designed. The
    // band burnt into the window stays the same, so a bigger fire is taller,
    // not deeper into the terminal.
    setSize(pct) {
      scale = Math.max(0.1, Math.min(1.5, (Number(pct) || 100) / 100)); // 10–150%
    },
  };

  resize();
  readTheme();
  window.addEventListener('resize', resize);
})();
