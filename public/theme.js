// Everything visual lives here. Edit, save, reload the tab.
//
// A theme is only colour. Type, spacing and timing are shared, because those
// are decisions about this application rather than about a palette — so
// switching themes can never leave you with a font you didn't ask for.
//
// window.WEBTERM_THEME is mutated in place when you switch, never replaced:
// every module holds a reference to it, and reassigning the global would leave
// them all pointing at the old one. Anything that can't read it live again —
// terminals already built, stars already coloured — listens to `on()`.

(function () {
  const BASE = {
    // The typeface must be installed on this machine. For a Powerlevel10k or
    // Starship prompt you want a Nerd Font, or the glyphs come out as boxes.
    font: '"MesloLGS NF", "JetBrainsMono Nerd Font", "SF Mono", Menlo, monospace',
    fontSize: 14,
    lineHeight: 1.35,
    letterSpacing: 0, // in px, fractional values are allowed
    gutter: '18px',

    // How much of an unfocused window is left. Adjustable under the sliders
    // button; this is the value Reset goes back to.
    dimmed: 0.2,

    // One breath of the focused window's glow, in and out again.
    breath: '3.6s',

    // Keep the star count in the low hundreds: every one is a stroke per frame.
    starCount: 420,
  };

  const THEMES = {
    'deep-field': {
      name: 'Deep Field',
      note: 'Desaturated blue-grey. Nothing shouts but the cursor.',
      chrome: {
        surface: '#12151c',
        hairline: '#252a35',
        label: '#6b7384',
        space: '#05070c',
        backdrop: 'rgba(8, 10, 16, 0.55)',
        veil: 'rgba(5, 7, 12, 0.88)',
        shadow: 'rgba(0, 0, 0, 0.7)',
      },
      xterm: {
        background: '#171b24',
        foreground: '#d6d9e0',
        cursor: '#e9a13b',
        cursorAccent: '#171b24',
        selectionBackground: '#2f3847',
        black: '#2b303b',
        red: '#d4736b',
        green: '#93b07a',
        yellow: '#d9a86c',
        blue: '#7a9cc6',
        magenta: '#b48ead',
        cyan: '#82b8b8',
        white: '#c8ccd4',
        brightBlack: '#4a5263',
        brightRed: '#e08a82',
        brightGreen: '#a8c490',
        brightYellow: '#eec183',
        brightBlue: '#94b3d8',
        brightMagenta: '#c9a4c2',
        brightCyan: '#9acccc',
        brightWhite: '#eceef2',
      },
      stars: ['#eceef2', '#94b3d8', '#eec183'],
    },

    ember: {
      name: 'Ember',
      note: 'Coal and firelight. Warm enough to sit next to at midnight.',
      chrome: {
        surface: '#16120f',
        hairline: '#2e2621',
        label: '#8a7a6d',
        space: '#0a0705',
        backdrop: 'rgba(18, 12, 8, 0.6)',
        veil: 'rgba(10, 7, 5, 0.9)',
        shadow: 'rgba(0, 0, 0, 0.72)',
      },
      xterm: {
        background: '#1b1613',
        foreground: '#e4dbd2',
        cursor: '#ff8f4a',
        cursorAccent: '#1b1613',
        selectionBackground: '#3d3129',
        black: '#302722',
        red: '#e0705f',
        green: '#a8a55e',
        yellow: '#e0a95c',
        blue: '#8e9ab0',
        magenta: '#c98a8a',
        cyan: '#86aca3',
        white: '#d8cec4',
        brightBlack: '#55483f',
        brightRed: '#f08a77',
        brightGreen: '#c2bf74',
        brightYellow: '#f5c377',
        brightBlue: '#a6b2c8',
        brightMagenta: '#e0a3a3',
        brightCyan: '#a0c5bc',
        brightWhite: '#f6efe8',
      },
      stars: ['#f6efe8', '#f5c377', '#e0705f'],
    },

    fathom: {
      name: 'Fathom',
      note: 'Deep water. Cold light a long way down.',
      chrome: {
        surface: '#0d161a',
        hairline: '#1f3038',
        label: '#6a8590',
        space: '#03090c',
        backdrop: 'rgba(6, 16, 20, 0.6)',
        veil: 'rgba(3, 9, 12, 0.9)',
        shadow: 'rgba(0, 0, 0, 0.7)',
      },
      xterm: {
        background: '#101c21',
        foreground: '#cfdde2',
        cursor: '#4fd0c0',
        cursorAccent: '#101c21',
        selectionBackground: '#23414a',
        black: '#1d2e35',
        red: '#d1776f',
        green: '#7fb08a',
        yellow: '#cfae70',
        blue: '#6aa7c9',
        magenta: '#a98cbd',
        cyan: '#5fbfb5',
        white: '#c2d2d7',
        brightBlack: '#365059',
        brightRed: '#e58d84',
        brightGreen: '#96c8a0',
        brightYellow: '#e4c585',
        brightBlue: '#83bfe0',
        brightMagenta: '#c0a4d3',
        brightCyan: '#76d6cb',
        brightWhite: '#e6f1f4',
      },
      stars: ['#e6f1f4', '#76d6cb', '#83bfe0'],
    },

    amethyst: {
      name: 'Amethyst',
      note: 'Violet night. The cursor is the brightest thing in it.',
      chrome: {
        surface: '#16131f',
        hairline: '#2b2540',
        label: '#7d7396',
        space: '#07050d',
        backdrop: 'rgba(14, 10, 24, 0.6)',
        veil: 'rgba(7, 5, 13, 0.9)',
        shadow: 'rgba(0, 0, 0, 0.72)',
      },
      xterm: {
        background: '#1a1626',
        foreground: '#dcd6ea',
        cursor: '#c08cff',
        cursorAccent: '#1a1626',
        selectionBackground: '#352c52',
        black: '#2a2440',
        red: '#d3757f',
        green: '#8fb388',
        yellow: '#d6ac72',
        blue: '#8a9ce0',
        magenta: '#bb8ae0',
        cyan: '#7fb8cc',
        white: '#cac3dd',
        brightBlack: '#4b4269',
        brightRed: '#e88b94',
        brightGreen: '#a5c99d',
        brightYellow: '#ecc287',
        brightBlue: '#a3b4f0',
        brightMagenta: '#d3a5f0',
        brightCyan: '#97d0e2',
        brightWhite: '#f0ecf8',
      },
      stars: ['#f0ecf8', '#d3a5f0', '#a3b4f0'],
    },

    moss: {
      name: 'Moss',
      note: 'Forest floor. Green without being a 1980s monitor.',
      chrome: {
        surface: '#111611',
        hairline: '#232d23',
        label: '#75856f',
        space: '#050805',
        backdrop: 'rgba(8, 14, 8, 0.6)',
        veil: 'rgba(5, 8, 5, 0.9)',
        shadow: 'rgba(0, 0, 0, 0.7)',
      },
      xterm: {
        background: '#141a14',
        foreground: '#d5ddd0',
        cursor: '#b8d46a',
        cursorAccent: '#141a14',
        selectionBackground: '#2c3a2b',
        black: '#232d22',
        red: '#cc7a6e',
        green: '#8fb96f',
        yellow: '#ccb26a',
        blue: '#7fa2b8',
        magenta: '#b08fb0',
        cyan: '#7fb8a8',
        white: '#c6cfc1',
        brightBlack: '#43503f',
        brightRed: '#e0918a',
        brightGreen: '#a7d189',
        brightYellow: '#e2cb87',
        brightBlue: '#9bbcd0',
        brightMagenta: '#c8a8c8',
        brightCyan: '#98d0c0',
        brightWhite: '#eaf0e6',
      },
      stars: ['#eaf0e6', '#a7d189', '#e2cb87'],
    },

    vellum: {
      name: 'Vellum',
      note: 'Paper, for daylight. The stars turn to ink and settle as dust.',
      chrome: {
        surface: '#ece6da',
        hairline: '#d3c9b8',
        label: '#7d7466',
        space: '#f5f0e6',
        backdrop: 'rgba(245, 240, 230, 0.72)',
        veil: 'rgba(240, 234, 222, 0.9)',
        shadow: 'rgba(92, 80, 62, 0.26)',
      },
      xterm: {
        background: '#f4efe4',
        foreground: '#3b3630',
        cursor: '#b5622a',
        cursorAccent: '#f4efe4',
        selectionBackground: '#ded2bc',
        black: '#5c554a',
        red: '#a8433a',
        green: '#55743c',
        yellow: '#8f6a1c',
        blue: '#38658f',
        magenta: '#85497e',
        cyan: '#2f7b73',
        white: '#3b3630',
        brightBlack: '#7d7466',
        brightRed: '#bd5348',
        brightGreen: '#6b8d4d',
        brightYellow: '#a8842b',
        brightBlue: '#4a77a1',
        brightMagenta: '#9a5b92',
        brightCyan: '#3d8e85',
        brightWhite: '#2a2622',
      },
      // Dark "stars" on a pale sky: ink and dust rather than light.
      stars: ['#8a8070', '#b09c80', '#b5622a'],
    },
  };

  const KEY = 'webterm.theme';
  const DEFAULT = 'deep-field';

  const listeners = new Set();
  let active = DEFAULT;

  try {
    const stored = localStorage.getItem(KEY);
    if (stored && THEMES[stored]) active = stored;
  } catch {
    /* storage blocked; the default stands */
  }

  // The flat shape the rest of the app already expects.
  function compose(key) {
    const t = THEMES[key];
    return {
      font: BASE.font,
      fontSize: BASE.fontSize,
      lineHeight: BASE.lineHeight,
      letterSpacing: BASE.letterSpacing,
      chrome: { gutter: BASE.gutter, dimmed: BASE.dimmed, breath: BASE.breath, ...t.chrome },
      xterm: { ...t.xterm },
      stars: { count: BASE.starCount, colors: t.stars.slice() },
    };
  }

  // Mutated, never replaced — see the note at the top.
  window.WEBTERM_THEME = compose(active);

  window.WEBTERM_THEMES = {
    list: Object.keys(THEMES).map((key) => ({
      key,
      name: THEMES[key].name,
      note: THEMES[key].note,
      swatch: [
        THEMES[key].xterm.background,
        THEMES[key].xterm.cursor,
        THEMES[key].xterm.green,
        THEMES[key].xterm.red,
        THEMES[key].xterm.blue,
        THEMES[key].xterm.foreground,
      ],
    })),

    get active() {
      return active;
    },

    apply(key) {
      if (!THEMES[key] || key === active) return;
      active = key;
      Object.assign(window.WEBTERM_THEME, compose(key));
      try {
        localStorage.setItem(KEY, key);
      } catch {
        /* not persisted; it holds for this tab */
      }
      for (const fn of listeners) {
        try {
          fn(window.WEBTERM_THEME);
        } catch (err) {
          console.error('webterm: theme listener failed', err);
        }
      }
    },

    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})();
