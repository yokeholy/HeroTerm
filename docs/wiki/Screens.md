# Screens

A screen is a set of windows and the shells inside them. Rest the pointer on
the left edge of the page and a panel slides out with one row per screen; click
one to go there. `⌘⌥←` and `⌘⌥→` step between them without the panel.

Switching hides one set of windows and shows another. **Nothing restarts.** A
build left running on the screen you walked away from is still running when you
come back, standing where you left it, with its scrollback intact — the window
was hidden, not closed.

- **＋ New screen** makes one, with a terminal on it.
- **Double-click a name** to call it something of your own. Otherwise they're
  Screen 1, Screen 2, …
- **×** closes a screen and the windows on it. One with something still running
  asks first. The last screen can't be closed — there is always somewhere to be.

Each row draws that screen: one box per window, where the window actually is,
in the colour its border is wearing — grey idle, yellow while something runs,
green or red for how the last command went. The window keys would go to has a
light ring; one that's minimized to the tray is dashed. Two windows side by
side, or one wide one over a short one, is a shape you recognise long before
you have read three window names.

The picture is drawn from the live layout every time the panel opens, and
again whenever a window moves, is renamed, or a command starts or finishes —
so a screen you aren't looking at is how you find out its build has gone
green.

## What belongs to a screen

Its windows, where they sit, which one had focus, and what the arrange button
would undo. Switching back puts all of that back.

What doesn't: the theme, the sounds, the star field, text sizes — those are the
page's, and they're the same wherever you are. The star field flies from the
window that's working **on the screen you're looking at**; a command finishing
elsewhere still makes its noise, and its dot in the panel goes out.

## The edge, and why it waits

The strip is 10px wide and wants the pointer to rest there for a moment before
it opens. A panel that slid out whenever the pointer drifted left would slide
out while you were reaching for a window's close button. Moving off it closes
it again, as does Escape, or switching screens.

While a sheet is open — settings, help, stats — the edge does nothing: those
have the screen already.

## Limits

Six screens, eight windows on any one of them, and twenty-four terminals across
all of them. The last number is the real one: every window on every screen is a
live shell on the server, whether you are looking at it or not. `MAX_SCREENS`
and `MAX_SHELLS` are in `public/app.js`, `MAX_SESSIONS` in `server.js`; they are
meant to agree.

## Screens and saved screens

Different things with a shared word, and worth keeping straight:

| | |
|---|---|
| **Screens** (this page) | live. Switching between them keeps every shell running. |
| **Saved screens** (the card button, top right) | a layout written down: how many windows, where, and the folder each shell stood in. Opening one *replaces* the windows you have with fresh shells. |

Saving a screen saves the one you are looking at.
