<p align="center">
  <img src="https://raw.githubusercontent.com/yokeholy/HeroTerm/main/docs/icon.png" width="128" height="128" alt="HeroTerm icon: three stacked terminal windows, bordered red, yellow and green, with a star for a cursor">
</p>

<h1 align="center">HeroTerm</h1>

<p align="center">
  <strong>Your real shell, in a browser tab — where every command gets its own window.</strong>
</p>

<p align="center">
  <img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-blue">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-zsh-black?logo=apple">
  <img alt="Node 18+" src="https://img.shields.io/badge/node-18%2B-339933?logo=node.js&logoColor=white">
</p>

![Three windows: a tall one on the left showing git log, its border green, with earlier commands stacked behind it; on the right a server still running, its border yellow, and below it a failed git command in red; the star field streaming out from the window that's working](https://raw.githubusercontent.com/yokeholy/HeroTerm/main/docs/hero.png)

## ✨ Why HeroTerm

- 🪟 **A window per command.** Each one opens clean; the last dozen stack up behind it, and you can walk back through them.
- 🚦 **See how it went at a glance.** The border is yellow while it runs, green when it succeeds, red when it fails.
- 🌌 **A star field that flies** from whatever is working, and settles when it's done.
- 🔔 **Sounds you can live with:** a ding, a tick-tock, a chime. Each can be switched off.
- 🔄 **Refresh loses nothing.** Same shell, same folder, same running job — and it reconnects by itself after your laptop sleeps.
- 🧱 **Several terminals.** Snap, split, or arrange them all with one click.
- 🗂 **Workspaces.** Several sets of windows, switched from a panel that hides at the left edge. Shells keep running in the ones you're not looking at — and a layout you use often can be saved and opened again, each window in its own folder.
- 🤖 **Knows when Claude Code is working**, and treats each turn like a command.
- 🛠 **Your shell, untouched.** zsh, your dotfiles, your prompt and aliases, exactly as they are.

## 🚀 Quick start

You need macOS, zsh and [Node 18+](https://nodejs.org). Then:

```bash
npx heroterm
```

It opens in your browser. That's it.

To keep it around, install the `heroterm` command:

```bash
npm install -g heroterm
heroterm
```

To leave it running without a terminal to keep open:

```bash
heroterm start    # background; closing the terminal doesn't stop it
heroterm status   # where it is, and the URL to get back
heroterm stop     # end it
```

> 💡 `heroterm --help` for the rest, like `--port` or `--no-open`. More in [Installation](docs/wiki/Installation.md).

## 🧭 Find your way around

| Button | What it does |
|:---:|---|
| **?** | help |
| **▮▮▮** | the commands you type most |
| **＋** | new terminal, in the folder you're in |
| **▦** | arrange every window to fill the screen; press again to put them back |
| **⊞** | show every window at once — click one to go to it (a buried window's way back) |
| **⛶** | browser full screen |
| **⚙︎** | settings |

**?** and the stats live top left; the rest, top right. Rest the pointer on any
of them for a second and it says what it does. Rest it on the **left edge** of
the page and your [workspaces](#-workspaces) slide out.

**Windows:** 🔴 close · 🟡 minimize to the status bar · 🟢 fill the screen · drag by the title bar · resize from any edge · drag to a screen edge to snap · drop onto another window to split · double-click the name to rename.

<table>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/yokeholy/HeroTerm/main/docs/arrange.png" alt="Four windows tiled across the screen: a git log in green, a server still running in yellow, a failed git command in red, and a line count in green"></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/yokeholy/HeroTerm/main/docs/deck.png" alt="A window showing an earlier command, with the three commands run after it stacked above, and 2 back in the status bar"></td>
  </tr>
  <tr>
    <td align="center">▦ Arrange, and see every result at a glance</td>
    <td align="center">⌘[ Walk back through earlier commands</td>
  </tr>
</table>

## 🗂 Workspaces

Rest the pointer on the left edge and the panel slides out: several sets of
windows, each drawn as it really is, with the running ones lit.

![The workspaces panel open down the left edge: three rows, each with the name
of the workspace, the windows in it, and a small drawing of where those windows
sit — two columns, a wide window over a short one with a dot showing something
still running, and three columns](https://raw.githubusercontent.com/yokeholy/HeroTerm/main/docs/workspaces.png)

- Switching **restarts nothing** — a build left running in another workspace
  keeps going, and its dot lights up in the panel when it lands.
- Closing one can be **undone** for twenty seconds, shells and scrollback intact.
- Double-click a row's top line to name it; until then, the windows in it are
  its name.
- **Save this workspace…** keeps its layout — windows, places, folders — to
  open again later as a workspace of its own.

## ⌨️ Keys

| Keys | Action |
|---|---|
| `⌘D` | new terminal |
| `⌘⌥←` / `⌘⌥→` | the workspace to the left / right |
| `⌘⌥↑` | the workspaces panel — `↑` `↓` to choose, `Enter` to go |
| `⌘[` / `⌘]` | older / newer command |
| `⌘←` / `⌘→` | start / end of the line |
| `⌘⌫` | clear the line |
| `⌘K` | clear |
| `⌘+` / `⌘−` / `⌘0` | this window's text size |
| `⌘C` / `⌘V` | copy / paste — or just select, and it's copied |

## 🎨 Make it yours

![The settings sheet down the right-hand side, full height, with the window it is previewing fitted beside it](https://raw.githubusercontent.com/yokeholy/HeroTerm/main/docs/settings.png)

- 🎨 **6 themes**, from deep-space blue to a paper light theme
- 🔤 **Any installed font**, with terminal and interface sizes set separately
- 👻 **Fade** the windows you're not using
- 🔊 **Sound** on/off, per sound, with a volume slider and three voices each
- ✨ **Flying stars** on/off
- 🤫 **Quiet commands** — a dev server shouldn't ring and fly the stars all day
- 📋 **Copy what you select**, iTerm style — ⌘C still works too
- 🛑 **Confirm before closing** a window: never, while something runs, or always
- ⚙️ **System** tab showing what HeroTerm is running with

Changes preview live on the window beside the panel.

## 🔒 Safe by default

- Listens on loopback only — `127.0.0.1` and `::1` — never the network.
- A random token per launch, so other web pages can't reach your shell.
- Nothing is sent anywhere. Settings stay in your browser.
- Your shells get your environment, not HeroTerm's plumbing — no stray `PORT`
  for a dev server to trip over.

## 📚 Learn more

The details live in the [wiki](docs/wiki/Home.md):
[Installation](docs/wiki/Installation.md) ·
[Windows](docs/wiki/Windows.md) ·
[The deck](docs/wiki/The-deck.md) ·
[Settings](docs/wiki/Settings.md) ·
[Sound & command detection](docs/wiki/Sound-and-command-detection.md) ·
[Sessions & refreshing](docs/wiki/Sessions-and-refreshing.md) ·
[Workspaces](docs/wiki/Workspaces.md) ·
[Command stats](docs/wiki/Command-stats.md) ·
[Customizing](docs/wiki/Customizing.md) ·
[Security](docs/wiki/Security.md) ·
[How it works](docs/wiki/How-it-works.md) ·
[FAQ](docs/wiki/FAQ.md)

## 📄 Licence

MIT. See [LICENSE](LICENSE).
