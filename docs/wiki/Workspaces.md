# Workspaces

A workspace is a set of windows and the shells inside them. Rest the pointer on
the left edge of the page and a panel slides out with one row per workspace; click
one to go there. `⌘⌥←` and `⌘⌥→` step between them without the panel, and `⌘⌥↑` opens it from the
keyboard: it starts on the workspace you're in, `↑` and `↓` move, `Enter` goes
there, and `Esc` puts it away and hands the keys straight back to the terminal
you were typing in.

Switching hides one set of windows and shows another. **Nothing restarts.** A
build left running on the workspace you walked away from is still running when you
come back, standing where you left it, with its scrollback intact — the window
was hidden, not closed.

- **＋ New workspace** makes one, with a terminal on it.
- **Double-click a row's top line** to call that workspace something of your own.
  Until you do, the windows on it are its title — "git, files" says more than
  "Workspace 2" ever did. A name you give it sits on the left, with the windows
  alongside.
- **×** closes a workspace and the windows in it, and always asks first — it says
  how many windows go with it, and how many of them are still running. The last
  workspace can't be closed; there is always somewhere to be.

## Closing one, and taking it back

Closing doesn't kill the shells. It lets go of them, and the server keeps the
sessions for a few seconds the same way it does across a refresh — so the panel
offers the workspace back where it stood:

> Closed build · **Undo**

Take it and the whole thing returns: same windows in the same places, same
names, shells still running, scrollback and all. A `sleep` that was half way
through is still half way through.

Ignore it and the offer lapses after twenty seconds, and the shells are reaped
then. Only one closure is held at a time: close another workspace and the first
one is gone for good.

What the shells' end looks like, when it comes: the shell, whatever it was
running, and its background jobs all go. Something started with `nohup` — or
`disown`, or `setsid` — survives, which is what those are for. If you want a
long build to outlive its window, that is still how.

Each row is the workspace's name and what's in it, with a picture of it
under that, the full width of the panel: one box per window, where the window
actually is, with its name in the middle of it, in the colour its border is wearing — grey
idle, yellow while something runs, green or red for how the last command went.
The window keys would go to has a light ring; one that's minimized to the tray
is dashed. A window too small to hold its name is drawn without one rather than
with a smear of letters — hovering it still says which it is. Two windows side by
side, or one wide one over a short one, is a shape you recognise long before
you have read three window names.

The picture is drawn from the live layout every time the panel opens, and
again whenever a window moves, is renamed, or a command starts or finishes —
so a workspace you aren't looking at is how you find out its build has gone
green.

## What belongs to a workspace

Its windows, where they sit, which one had focus, and what the arrange button
would undo. Switching back puts all of that back.

What doesn't: the theme, the sounds, the star field, text sizes — those are the
page's, and they're the same wherever you are. The star field flies from the
window that's working **in the workspace you're looking at**; a command finishing
elsewhere still makes its noise, and its dot in the panel goes out.

## The edge, and why it waits

The strip is 10px wide and wants the pointer to rest there for a moment before
it opens. A panel that slid out whenever the pointer drifted left would slide
out while you were reaching for a window's close button. Moving off it closes
it again, as does Escape, or switching screens.

While a sheet is open — settings, help, stats — the edge does nothing: those
have the screen already.

## Limits

Six workspaces, eight windows in any one of them, and twenty-four terminals across
all of them. The last number is the real one: every window in every workspace is a
live shell on the server, whether you are looking at it or not. `MAX_WORKSPACES`
and `MAX_SHELLS` are in `public/app.js`, `MAX_SESSIONS` in `server.js`; they are
meant to agree.

## Workspaces and saved screens

Different things with a shared word, and worth keeping straight:

| | |
|---|---|
| **Workspaces** (this page) | live. Switching between them keeps every shell running. |
| **Saved screens** (the card button, top right) | a layout written down: how many windows, where, and the folder each shell stood in. Opening one *replaces* the windows you have with fresh shells. |

Saving a screen saves the windows of the workspace you are looking at.
