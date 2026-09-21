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
  const CFG = T.stars;

  const canvas = document.getElementById('sky');
  const g = canvas.getContext('2d', { alpha: false });

  const WARP = 0.02; // z per frame at full tilt
  const EASE = 0.035; // how quickly we get there, and back
  const TRAIL = 3.2; // streak length as a multiple of one frame's travel

  let w = 0;
  let h = 0;
  let cx = 0;
  let cy = 0;
  let spanX = 0;
  let spanY = 0;
  let stars = [];
  let speed = 0;
  let target = 0;
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
  // a box.
  function star(z) {
    const zz = z === undefined ? rand(0.12, 1) : 1;
    const ax = rand(-1, 1);
    const ay = rand(-1, 1);
    return {
      x: ax * zz,
      y: ay * zz,
      z: zz,
      tw: rand(0.4, 1.7), // twinkle rate
      phase: rand(0, Math.PI * 2),
      col: CFG.colors[(Math.random() * CFG.colors.length) | 0],
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
      if (x < -60 || x > w + 60 || y < -60 || y > h + 60) continue;

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
      if (!stars.length) stars = Array.from({ length: CFG.count }, () => star());
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
  };

  // Driven by whether *anything* is running rather than by one container's
  // events, so a build in a terminal you aren't looking at still moves the sky.
  window.WEBTERM_SKY.setWarp = (on) => {
    target = on ? WARP : 0;
  };
})();
