# Settings

The sliders button opens a sheet for the things that are taste rather than
correctness: the theme, the font, the terminal and interface text sizes, how far
unfocused windows fade, whether the stars fly, and whether any of it makes a
sound. Beside the window it's previewing, it shares that window's top and
bottom edges (never shorter than 420px — a shorter window is shown taller to
match, and gets its real size back on close); with no room for a preview it
runs the full height of the screen. It has five tabs — **Appearance**,
**Sound**, **Effects**, **Behavior** and **System** — and opens on whichever
you used last.

Behavior holds **Copy what I select**, on by default: let go of a selection and
it is on the clipboard, the way iTerm's "copy to pasteboard on selection"
works. ⌘C still copies either way, and it works in the replayed cards behind
the front one as well as in the live terminal, so you can drag across the
output of a command you ran ten commands ago. A click that selects nothing
leaves the clipboard alone. Turn it off if you would rather your clipboard
only changed when you asked.

Behavior also holds **Quiet commands**: a list, one pattern a line, of commands to
neither hear nor watch. A command whose text contains one of them makes no
sound and doesn't fly the sky — a dev server, a log you're tailing, anything
that runs all day and means nothing while it does. It still gets its own
window, its clock and its border, so you can see it running and how it ended.
Matching is case-insensitive and by substring, so `npm run dev` catches
`npm run dev -- --host`.

It works because the shell sends the command text just *before* it says a
command started; a shell that was already open when you updated sends it just
after, so the first ding of the first such command still gets through until you
open a new window.

Behavior also holds **Keep shells after a tab closes** — how long a disconnected
shell waits to be reattached, which is what makes a laptop waking from sleep
find its session again; see
[Sessions and refreshing](Sessions-and-refreshing.md). And **Confirm before
closing a window**: *Never* (the default),
*While running*, or *Always*. When it asks, the question sits over the window
itself — "Close Vega? `npm test` is still running." — with Close focused, so
Enter confirms and Escape keeps the window. "Running" means the command in that
window hasn't finished, which includes an ssh session or Claude Code sitting at
its prompt. Only the red button asks: a shell that exits by itself has already
made up its mind.
Theme and font each open a page of their own from Appearance, with a back
arrow in place of the tabs; Escape steps back one level at a time.

System is read-only: the limits HeroTerm is running with — shell, grace
period, commands and bytes kept per window and across a refresh, scrollback,
flow control, which history file the stats read — each with where it's set.
The server's come from `/config` (token-gated like the rest), so they're the
values after any environment overrides; the page's are read from the modules
that own them, not copied. When the server predates `/config`, the tab says so
and lists only the page's own values.

The two text sizes are separate on purpose. **Terminal text size** (px) is the
grid in every window, replayed cards included; ⌘+ and ⌘− still size one window
for a while, and ⌘0 returns to the setting rather than to 14. **Interface text
size** is five steps — 80, 90, 100, 115 and 135% — each button labelled with a
sample at the size it gives you. It covers everything else with words on it:
every UI font size in `public/index.html` is written as a multiple of
`--ui-scale`, so they move together while spacing and window geometry stay put.

While the sheet is open, the window you were working in moves to its left,
above the dimmed background, so every change lands on something you can see.
It keeps its size where that fits and shrinks only where it doesn't. Closing
settings puts it back exactly where it was — its real position is never
touched in between, so a refresh with the sheet open loses nothing either.
While you're adjusting the unfocused-window opacity, the dimming lifts and that
window wears the opacity you're choosing, since a focused window is otherwise
always solid; letting go of the slider puts both back.

Six themes ship — **Deep Field** (blue-grey), **Ember** (coal and firelight),
**Fathom** (deep water), **Amethyst** (violet), **Moss** (forest), and
**Vellum**, a paper light theme where the stars become ink and settle as dust.
Switching takes effect immediately, across the terminals, the replayed cards
behind them, the window chrome and the sky.

A theme is *only colour*. Type, spacing and the timings are shared, so
switching can never hand you a font you didn't ask for — and adding one is a
palette in `public/theme.js`, with the picker building itself from the
registry.

The font page lists what's installed on this machine, each name set in its
own face. A page can't enumerate installed fonts by itself, and even the
permission-gated API Chromium offers won't say which are monospaced — the one
thing a terminal cares about — so the server reads the font files directly
(`fonts.js`): the name table for the family, and the metrics for the spacing.
Monospaced fonts are listed by default; proportional ones are a checkbox away,
for the adventurous. The one you pick goes in *front* of the default stack
rather than replacing it, so glyphs it lacks — the icons in a Nerd Font prompt,
say — still come from the default.

A font being installed doesn't mean the browser will draw it, so the page
checks each one itself and lists only the ones it can reach, with a line saying
how many it left out. Brave is the usual culprit: its fingerprinting protection
hides every font it didn't ship with. Allowing fingerprinting for `localhost`
in Shields brings them back.

Two things make live switching work. `window.HEROTERM_THEME` is mutated in place
rather than replaced, because every module holds a reference to it and
reassigning the global would leave them all pointing at the old one. And
anything that can't simply read it again — terminals already built, stars
already coloured — subscribes to `HEROTERM_THEMES.on()` and is told.

The terminal text size and the window fade each have a slider and a number box
wired to the same value, each updating the other, since neither is the right
control on its own: one is for finding a number by eye, the other for saying
exactly which number you meant.

Whichever you are using is left alone while you use it. Writing a clamped value
back into the box you are typing in moves the caret out from under you, and
makes `10` impossible to type on the way to `100`.

Defaults live in `public/theme.js` and settings only record where you have
moved away from them, so `Reset` is a delete rather than a second copy of the
default. Sound is the exception: `public/audio.js` owns whether it is muted,
and which sounds are on, and the switches drive that rather than keeping a
second copy — two stores for one fact is how they come to disagree.

Turning the flying stars off leaves the sky where it is, still breathing.
Turning them on flies them for two seconds — the dimming behind the sheet
lifts, and in full-tab mode the sky is borrowed for the moment — so you see
what you've just turned on.
Whether something is running and whether you want to watch the sky move about
it are separate questions, both remembered, so switching the flying back on
part way through a command starts it flying rather than waiting for the next
one.
