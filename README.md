<h1 align="center">HeroTerm</h1>

<p align="center">
  <strong>Your real shell, in a browser tab — where every command gets its own window.</strong>
</p>

<p align="center">
  <img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-blue">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-zsh-black?logo=apple">
  <img alt="Node 18+" src="https://img.shields.io/badge/node-18%2B-339933?logo=node.js&logoColor=white">
</p>

![A ping running in its own window, its border yellow, three finished commands stacked behind it, and the star field streaking away from the one that's working](https://raw.githubusercontent.com/yokeholy/heroterm/main/docs/hero.png)

## ✨ Why HeroTerm

- 🪟 **A window per command.** Each one opens clean; the last dozen stack up behind it, and you can walk back through them.
- 🚦 **See how it went at a glance.** The border is yellow while it runs, green when it succeeds, red when it fails.
- 🌌 **A star field that flies** from whatever is working, and settles when it's done.
- 🔔 **Sounds you can live with:** a ding, a tick-tock, a chime. Each can be switched off.
- 🔄 **Refresh loses nothing.** Same shell, same folder, same running job — and it reconnects by itself after your laptop sleeps.
- 🧱 **Several terminals.** Snap, split, or arrange them all with one click.
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

> 💡 `heroterm --help` for options, like `--port` or `--no-open`. More in [Installation](docs/wiki/Installation.md).

## 🧭 Find your way around

| Button | What it does |
|:---:|---|
| **?** | help |
| **＋** | new terminal |
| **▦** | arrange every window to fill the screen; press again to put them back |
| **▮▮▮** | the commands you type most |
| **⛶** | browser full screen |
| **▢** | float the terminal over the star field |
| **⚙︎** | settings |

**Windows:** 🔴 close · 🟡 minimize to the status bar · 🟢 fill the screen · drag by the title bar · resize from any edge · drag to a screen edge to snap · drop onto another window to split · double-click the name to rename.

<table>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/yokeholy/heroterm/main/docs/arrange.png" alt="Four windows arranged across the screen: one running ping, one git log, one ls, one failed cat"></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/yokeholy/heroterm/main/docs/deck.png" alt="A window with the previous commands stacked behind it"></td>
  </tr>
  <tr>
    <td align="center">▦ Arrange, and see every result at a glance</td>
    <td align="center">⌘[ Walk back through earlier commands</td>
  </tr>
</table>

## ⌨️ Keys

| Keys | Action |
|---|---|
| `⌘D` | new terminal |
| `⌘[` / `⌘]` | older / newer command |
| `⌘←` / `⌘→` | start / end of the line |
| `⌘⌫` | clear the line |
| `⌘K` | clear |
| `⌘+` / `⌘−` / `⌘0` | this window's text size |
| `⌘C` / `⌘V` | copy / paste |

## 🎨 Make it yours

![Settings beside the window they apply to](https://raw.githubusercontent.com/yokeholy/heroterm/main/docs/settings.png)

- 🎨 **6 themes**, from deep-space blue to a paper light theme
- 🔤 **Any installed font**, with terminal and interface sizes set separately
- 👻 **Fade** the windows you're not using
- 🔊 **Sound** on/off, per sound, with a volume slider and three voices each
- ✨ **Flying stars** on/off
- 🤫 **Quiet commands** — a dev server shouldn't ring and fly the stars all day
- 🛑 **Confirm before closing** a window: never, while something runs, or always
- ⚙️ **System** tab showing what HeroTerm is running with

Changes preview live on the window beside the panel.

## 🔒 Safe by default

- Listens on `127.0.0.1` only, never the network.
- A random token per launch, so other web pages can't reach your shell.
- Nothing is sent anywhere. Settings stay in your browser.

## 📚 Learn more

The details live in the [wiki](docs/wiki/Home.md):
[Installation](docs/wiki/Installation.md) ·
[Windows](docs/wiki/Windows.md) ·
[The deck](docs/wiki/The-deck.md) ·
[Settings](docs/wiki/Settings.md) ·
[Sound & command detection](docs/wiki/Sound-and-command-detection.md) ·
[Sessions & refreshing](docs/wiki/Sessions-and-refreshing.md) ·
[Command stats](docs/wiki/Command-stats.md) ·
[Customizing](docs/wiki/Customizing.md) ·
[Security](docs/wiki/Security.md) ·
[How it works](docs/wiki/How-it-works.md) ·
[FAQ](docs/wiki/FAQ.md)

## 📄 Licence

MIT. See [LICENSE](LICENSE).
