# Windows

`?` in the top-left corner opens a short help pop-up — the buttons, the keys,
and the two things that surprise people. Escape or a click outside closes it.
Its text lives in the markup in `public/index.html`, so editing it is editing
the page.

Six buttons, top-right corner of the page. They belong to the page rather
than to any window, so they stay put whatever the deck is doing:

| | |
|---|---|
| plus | another terminal, in a container of its own |
| grid | arrange every window to fill the screen, all about the same size |
| bars | what you actually type — see below |
| sliders | settings |
| expand | the browser's own full screen — the whole display, tab strip gone |
| square | pop the deck out of the tab into a floating window, and back |

The window you're working in breathes: its glow swells and settles on a slow
cycle, in whatever colour its last command left behind — grey when nothing has
run, yellow while something is, green or red once it's done. The others fade to
a fifth of their opacity and the star field shows through them, so there is
never a question which one your keys are going to. How faded is in Settings →
Appearance, as a slider and a number box that drive each other; while you're
adjusting it, the window beside the sheet shows itself faded that much. Reset
puts it back to the default. It's kept in this browser, not on the server, and
`public/theme.js` holds the defaults: `dimmed` for the fade and `breath` for
the length of one breath. The breathing stops under `prefers-reduced-motion`.

The browser tab is titled after the window you're in — `npm test | HeroTerm` —
following whichever card it's showing, so walking back through the deck
changes it too. A window that hasn't run anything yet leaves just `HeroTerm`.

Each window is named when it's made — stars, given what's behind them — and the
name sits in the middle of its title bar. Double-click it to rename; Enter or
clicking away keeps it, Escape puts it back. Names are remembered with the rest
of the layout. The list is `NAMES` in `public/app.js`, and once it runs out the
windows are numbered.

The `+` gives you another container: its own shell, its own deck, its own
position, up to eight of them. Click one to bring it forward — that's the one
keys go to — and close it with the `×` in its title bar, or by exiting its
shell; close the last one and a fresh one takes its place. More than one only
makes sense floating, so adding a second switches to windowed and the fill-the-
tab button greys out until you're back to one.

Each container's shell is independent, and each is reattached separately after
a refresh, so three terminals in three directories come back as three terminals
in three directories.

The windows themselves are the cards in the deck. Drag the front one by its
title bar and the whole stack comes with it; the ones behind take no pointer
events at all, which is what makes the top one the only one you can pick up.
Resize from any edge or corner — dragging the top or left edge moves that edge
and leaves the opposite one where it is, and the minimum size stops the edge
you're holding rather than walking the window across the screen.

Drop a window against the inside edge of another one and they split its space
between them, the way iTerm divides a pane: whichever of that window's edges
you are nearest decides who takes which half. The middle of a window means
nothing, so you can drag across one without disturbing it, and a split that
would leave either window under the minimum size is refused rather than
attempted. Two outlines show it before you let go — solid for the window you're
holding, dashed for where the other one ends up — and they draw over the
windows rather than under them, since the one you are aiming at is usually the
one underneath. The window in your hand goes above all of it for as long as you
hold it: above the other windows, above the outlines, and above the status bar
and the controls. The whole stacking order is written down in one place, at the
top of `public/app.js`, because the numbers only make sense together.

Drag a window against a *screen* edge and it snaps instead: a side for a half,
a corner for a quarter, the top to fill. The screen wins over a split, so the
outer 26px of the display is always a deliberate aim even when a window happens
to be flush against it. An outline shows where it will land before you
let go, and dragging it back off an edge hands its old size back rather than
leaving you towing a half-screen slab. On a free drag the edges are magnetic —
they line up with the screen's sides and middle and with every other window,
within a few pixels.

Snapping works in the coordinates of the window you can see, not the deck box
that holds it: a deck is taller than its window by the band the older commands
cascade into, so a window snapped to the top of the screen puts its title bar
there rather than 36px of empty air.

Where you put it is remembered, including which mode you were in. The two size buttons are independent, so a floating
deck on a full-screen star field is available if you want it.

The status line along the bottom — connection, deck position, grid size — is
page furniture too.

Full screen is driven by the `fullscreenchange` event rather than the promise
`requestFullscreen()` returns, because pressing Esc to leave only produces the
event — and because there are embedded browsers that accept the call and then
never settle the promise at all. If the browser won't do it, the button retires
itself rather than sitting there looking live.

Behind it is a sky. Sitting still it's a field of stars that breathe; while a
command runs it's the view out of the front of something going much too fast.
One star array serves both — each star has a depth, drawn in perspective, and
the only difference is whether that depth is falling. The speed is eased rather
than switched, which is what gives you the lurch into hyperspace instead of an
abrupt cut.

It flies from whatever is working: the centre of the window running a command,
or the mean of their centres when several are. Start a second command and the
vanishing point slides to sit between them; let one finish and it slides to the
one still going. Moving or resizing a busy window takes the sky with it, since
the origin is asked for once a frame rather than set when a command starts.

Moving the vanishing point would drag the whole sky sideways with it, so every
star is shifted back by the same amount as the origin moves — they stay where
they are, and only the direction they stream changes. Stars that leave the
screen are respawned rather than merely skipped, because once the origin is off
to one side the far edge would otherwise empty out.

Every window carries its own verdict in its border, so a glance down the deck
tells you which of the last dozen commands went wrong:

| | |
|---|---|
| yellow | a command is running |
| green | it finished cleanly |
| red | it exited non-zero |

The front window gets the glow as well. The verdict stays with its window
forever, so you can look over long after the fact and still see how it went.

None of this is painted in full screen, where the terminal covers every pixel
of it — the animation loop stops rather than running behind an opaque window.
The one exception is turning Flying stars on in settings, which borrows the sky
for two seconds so you can see what you turned on. Star count and colours are
in `public/theme.js`.

## Arranging

The grid button tiles every window across the screen, below the strip the
page's own buttons live in, at about the same size. The grid isn't fixed: for
each possible number of rows the windows are dealt out as evenly as the rows
allow, and it keeps the layout whose windows are closest to a comfortable
terminal shape and closest to one another in size — four become two by two,
five become three over two, and nothing is left empty. Windows keep their
reading order, so each moves as little as it can, with 8px between them and
along the edges, and like a snap each remembers the size it had, for dragging
back out. Full-tab mode already is one window filling everything, so the
button is off there.

Pressing it again puts every window back where it was — as long as nothing
has changed in between. The button stays lit while that's true; move or
resize a window, open or close one, and it goes dark and the next press
arranges afresh instead. The undo survives a reload.
