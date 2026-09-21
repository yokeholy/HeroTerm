// Everything visual lives here. Edit, save, reload the tab.
window.WEBTERM_THEME = {
  // The typeface must be installed on this machine. For a Powerlevel10k or
  // Starship prompt you want a Nerd Font, or the glyphs come out as boxes.
  font: '"MesloLGS NF", "JetBrainsMono Nerd Font", "SF Mono", Menlo, monospace',
  fontSize: 14,
  lineHeight: 1.35,
  letterSpacing: 0, // in px, fractional values are allowed

  // Chrome: the frame around the grid.
  chrome: {
    gutter: '18px',
    surface: '#12151c',
    hairline: '#252a35',
    label: '#6b7384',
    space: '#05070c', // behind the window, under the stars
  },

  // The sky you see once the terminal is popped out of full screen. Keep the
  // count in the low hundreds: every one of these is a stroke per frame.
  stars: {
    count: 420,
    colors: ['#eceef2', '#94b3d8', '#eec183'],
  },

  // The grid itself. The ANSI sixteen are deliberately desaturated — git diffs
  // and ls output stay legible without any of them shouting. The cursor is the
  // one saturated thing on screen, so your eye always knows where it is.
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
};
