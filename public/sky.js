'use strict';

// The sky behind the window. Sitting still it's a field of stars that breathe;
// while a command runs it's the view out of the front of something going much
// too fast.
//
// One star array serves both. Each star has a position in a unit cube and a
// depth z, drawn in perspective: x/z, y/z. Standing still, z never changes and
// you get a fixed sky that twinkles. Under way, z falls, every star sweeps
// outward from the middle and smears into a streak. The jump between the two
// is an eased speed, which is what gives you the lurch into hyperspace rather
// than a switch being flipped.

(function () {
  const T = window.WEBTERM_THEME;

  const canvas = document.getElementById('sky');
  const g = canvas.getContext('2d', { alpha: false });

  const WARP = 0.02; // z per frame at full tilt
  const EASE = 0.035; // how quickly we get there, and back
  const TRAIL = 3.2; // streak length as a multiple of one frame's travel
  const DRIFT = 0.05; // how quickly the vanishing point moves to a new window

  let w = 0;
  let h = 0;
  let cx = 0;
  let cy = 0;
  let spanX = 0;
  let spanY = 0;
  let stars = [];
  let speed = 0;
  let target = 0;
  // Asked every frame rather than pushed, so that moving or resizing a window
  // while its command runs drags the vanishing point along with it.
  let originOf = () => null;
  let raf = null;
  let last = 0;
  let running = false;

  const rand = (a, b) => a + Math.random() * (b - a);

  // z: 1 is the far wall, 0 is your face. Spawning across the whole range on
  // first fill gives depth immediately; respawns go to the back.
  //
  // Position is chosen on the screen first and multiplied back into model
  // space, rather than picked in the cube and projected. Do it the other way
  // round and the perspective divide throws all but the most distant stars off
  // the edges, leaving a nearly empty sky — the field has to be a frustum, not
  // a box. Working back from a screen point also means a spawn lands where it
  // should whatever the vanishing point currently is.
  function star(z) {
    const zz = z === undefined ? rand(0.12, 1) : 1;
    const px = rand(-0.05 * w, 1.05 * w);
    const py = rand(-0.05 * h, 1.05 * h);
    return {
      x: ((px - cx) / spanX) * zz,
      y: ((py - cy) / spanY) * zz,
      z: zz,
      tw: rand(0.4, 1.7), // twinkle rate
      phase: rand(0, Math.PI * 2),
      col: T.stars.colors[(Math.random() * T.stars.colors.length) | 0],
    };
  }

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = w / 2;
    cy = h / 2;
    // Slightly past the edges, so stars keep arriving from beyond the corners
    // instead of popping in along a visible rectangle.
    spanX = (w / 2) * 1.12;
    spanY = (h / 2) * 1.12;
  }

  function frame(now) {
    // Normalised to a 60Hz step, and clamped so that coming back to a
    // backgrounded tab doesn't teleport every star through the camera.
    const dt = Math.min(64, now - last) / 16.667;
    last = now;
    speed += (target - speed) * EASE;

    // Slide the vanishing point toward whatever is running, and carry every
    // star with it. Without the second part the whole sky would slide sideways
    // as the origin moved; with it, the stars stay where they are and only the
    // direction they stream changes — which is the point.
    const aim = originOf() || { x: w / 2, y: h / 2 };
    const wasX = cx;
    const wasY = cy;
    cx += (aim.x - cx) * DRIFT;
    cy += (aim.y - cy) * DRIFT;
    const shiftX = wasX - cx;
    const shiftY = wasY - cy;
    if (shiftX || shiftY) {
      for (const s of stars) {
        s.x += (shiftX * s.z) / spanX;
        s.y += (shiftY * s.z) / spanY;
      }
    }

    g.fillStyle = T.chrome.space;
    g.fillRect(0, 0, w, h);

    const moving = speed > 0.0006;
    // Twinkling fades out as we pick up speed: at warp you're seeing motion,
    // not scintillation, and the two together just look noisy.
    const stillness = 1 - Math.min(1, speed / (WARP * 0.2));

    for (const s of stars) {
      s.z -= speed * dt;
      if (s.z <= 0.04) {
        Object.assign(s, star(1));
        continue;
      }

      const k = 1 / s.z;
      const x = cx + s.x * k * spanX;
      const y = cy + s.y * k * spanY;
      // Off the edge: put it back rather than leaving a hole. Once the origin
      // is off-centre, one side of the sky empties out otherwise.
      if (x < -60 || x > w + 60 || y < -60 || y > h + 60) {
        Object.assign(s, star(1));
        continue;
      }

      const near = 1 - s.z; // 0 at the back wall, ~1 in your lap
      let alpha = 0.38 + near * 0.62;
      if (stillness > 0) {
        const tw = 0.55 + 0.45 * Math.sin(now * 0.0016 * s.tw + s.phase);
        alpha *= 1 - stillness * (1 - tw);
      }

      g.globalAlpha = Math.max(0, Math.min(1, alpha));

      if (moving) {
        // Where this star was a few frames ago, which is nearer the middle.
        const pk = 1 / (s.z + speed * dt * TRAIL);
        g.strokeStyle = s.col;
        g.lineWidth = 0.7 + near * 1.8;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(cx + s.x * pk * spanX, cy + s.y * pk * spanY);
        g.lineTo(x, y);
        g.stroke();
      } else {
        const r = 0.7 + near * 1.3;
        g.fillStyle = s.col;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }

    g.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => {
    if (running) resize();
  });

  window.WEBTERM_SKY = {
    // A function returning {x, y} in page pixels, or null for the middle of
    // the screen. Called once per frame.
    trackOrigin(fn) {
      originOf = fn;
    },

    // Only painted in windowed mode — in full screen the terminal covers every
    // pixel of it, and burning a GPU on an invisible canvas is just rude.
    setActive(on) {
      if (on === running) return;
      running = on;
      if (!on) {
        cancelAnimationFrame(raf);
        raf = null;
        return;
      }
      resize();
      if (!stars.length) stars = Array.from({ length: T.stars.count }, () => star());
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
  };

  // A star's colour is chosen when it spawns, so a new palette has to be dealt
  // out to the ones already up there. The background is read every frame and
  // needs no help.
  window.WEBTERM_THEMES.on(() => {
    for (const s of stars) s.col = T.stars.colors[(Math.random() * T.stars.colors.length) | 0];
  });

  // Two separate questions: is something running, and are you willing to watch
  // the sky move about it. Both are remembered, so toggling either recomputes
  // rather than overwriting the other's answer — turning the flying back on
  // mid-command starts flying, instead of waiting for the next one.
  let wantWarp = false;
  let warpAllowed = true;

  function aim() {
    target = wantWarp && warpAllowed ? WARP : 0;
  }

  // Driven by whether *anything* is running rather than by one container's
  // events, so a build in a terminal you aren't looking at still moves the sky.
  window.WEBTERM_SKY.setWarp = (on) => {
    wantWarp = on;
    aim();
  };

  window.WEBTERM_SKY.allowWarp = (on) => {
    warpAllowed = on;
    aim();
  };
})();
