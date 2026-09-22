# Customizing

The defaults for everything visual are in `public/theme.js`: the typeface, size,
line height, the sixteen ANSI colors, the cursor, the star field. Everything
audible is in `public/audio.js`. Edit and reload. Settings changes the theme,
font, text sizes and the rest on top of those, for this browser.

Any installed font can be picked from settings. For a Powerlevel10k or
Starship prompt you need a Nerd Font **installed on the machine**, not just
named in the theme — the browser can only use what the system has:

```bash
brew install --cask font-meslo-lg-nerd-font
```

Then run `p10k configure` once while inside HeroTerm so the prompt is measured
against this renderer.

Anything in `public/index.html` is yours too. The grid is one element, so you
can put whatever you want around it — a git status rail, a clock, a second
terminal, an ambient background behind a translucent grid.
