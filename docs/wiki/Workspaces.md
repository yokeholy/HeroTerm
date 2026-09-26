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

The offer lives in the page, not on the server. **Reload inside those twenty
seconds and it is gone** — the shells are still reaped on the same timetable,
there is just nothing left to ask for them back. And until they are reaped they
are still sessions, so they still count against the server's ceiling (below):
close a big workspace and open another straight away, and the new one may find
a few fewer terminals to spare for half a minute.

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

## Keeping one

A workspace is live: close it and it is gone, and HeroTerm never restarts
with more than you left it with. To keep one — the four windows you always
open for a project, in the four folders they belong in — write it down.

- **Save this workspace…** at the foot of the panel names the one you are in
  and keeps it: how many windows, what each was called, where it sat, which
  directory its shell was standing in — and what each window has run so far.
- Kept ones are listed under **Saved**, each with how many windows it has and
  the folders they were in, so two for the same project are still telling
  apart. Click one and it opens as **a workspace of its own**, beside the ones
  you have — nothing you have is closed to make room. A name you save under
  becomes that workspace's name.
- **×** forgets one. Saving under a name you already used replaces it.

Opening one starts fresh shells — running processes can't be kept — and a
window that was minimized comes back minimized, in the tray.

### Its history keeps itself

A workspace you save, or open from **Saved**, stays linked to it: its row in
the panel has a small green bookmark. From then on, every command that
finishes in one of its windows is written into that window's history in the
profile, as it happens. Nothing to save; close the workspace, the tab, or
HeroTerm itself and nothing is lost.

Open the profile again and each window comes back with its history:

- **on the deck** — its last dozen commands stacked behind it, each with how it
  went, how long it took, and the end of what it printed, to walk back through
  with ⌘[ the way you would on the day;
- **on ↑** in its shell — its last fifty commands, newest first, before the
  rest of your history. They're read into that shell only: your history file
  isn't touched, and the stats page counts each command once, when it ran.

The **layout** is another matter: it changes only when you say. Move windows
around, open an extra one for something quick, and the profile still has the
shape you saved — until you press **Save** on the workspace's row (it appears
on hover, beside the ×), which puts the windows as they are now back into it.
Each window keeps its history through a Save; one you've added starts with
whatever is on its deck.

A few details:

- A workspace you made from scratch isn't linked, so nothing is kept until you
  save it. Saving it then keeps what its windows have already run.
- A window added to a linked workspace and not yet saved into it isn't
  recorded: the profile has no place for it.
- Open the same profile twice and both workspaces add to its history.
- Commands run over `ssh` are kept for the deck but not for ↑ — they belong to
  another machine's history.
- It survives a reload, a restart of HeroTerm, and a shell that ended while
  you were away (a laptop asleep past the grace period): a window whose shell
  has gone gets a new one, started with its history again.
- Only zsh gets the ↑ part; the deck works with any shell that reports its
  commands.

Each window keeps its last fifty commands, and the output of the last twelve,
trimmed to the end of each — about a screenful. Browser storage for a site is
around 5 MB in all, so that's the budget; if a profile ever outgrew it, its
outputs are dropped before its commands are.

### Where the folder comes from

The shell reports it with OSC 7 — `ESC ] 7 ; file://<host><path> BEL` — the
same sequence iTerm2, VS Code and GNOME Terminal read. HeroTerm's shell
integration sends it at every prompt (see `shell/zdotdir/.zshrc`), and a good
many people's own prompts already do. It is also how **＋** knows to open a new
terminal in the folder you're in.

Two cases give no folder, and those windows simply open at home:

- a shell that never says, because it isn't zsh or the integration isn't in it;
- anything inside an `ssh`. The directory a remote shell reports is a
  directory on another machine, so it is ignored rather than acted on here.

A saved folder that no longer exists is not an error either: the window opens
at home instead. A layout saved months ago is still worth most of what it
knows.

Kept workspaces live in this browser, under `heroterm.screens` — the name is
from before they moved into this panel, and kept so nothing saved then was
lost. Nothing is sent anywhere; clearing the browser's site data for HeroTerm
forgets them. That includes their history, output and all: see
[Security](Security.md#what-stays-in-the-browser).

## Limits

Six workspaces, and eight windows in any one of them. Those two are the page's
(`MAX_WORKSPACES` in `public/workspaces.js`, `MAX_CONTAINERS` in
`public/app.js`).

Across all of them, the ceiling is the server's: every window in every
workspace is a live shell, whether you are looking at it or not, and the server
runs at most twenty-four. Set `HEROTERM_MAX_SESSIONS` (1–64) before starting
it for more or fewer; the page asks the server and holds itself to the same
number, so ＋ greys out rather than opening a window that could never connect.
