<p align="center">
  <img src="docs/images/hero.png" alt="pi-pompom" width="720">
</p>

<h1 align="center">pi-pompom</h1>
<p align="center"><strong>A 3D raymarched virtual pet that lives in your terminal.</strong></p>
<p align="center">
  <!-- BADGES:START -->
  <a href="https://www.npmjs.com/package/@codexstar/pi-pompom"><img src="https://img.shields.io/npm/v/@codexstar/pi-pompom.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@codexstar/pi-pompom"><img src="https://img.shields.io/npm/dm/@codexstar/pi-pompom.svg" alt="npm downloads"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/TypeScript-5.x-blue.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg" alt="Platform">
  <!-- BADGES:END -->
</p>
<p align="center">
  <a href="#install">Install</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#keyboard-shortcuts">Shortcuts</a> ·
  <a href="#features">Features</a>
</p>

---

Pompom is an interactive companion for [Pi CLI](https://github.com/mariozechner/pi-coding-agent). It renders a real-time 3D raymarched creature above your editor using Unicode half-block characters with 4x4 supersampled anti-aliasing. Pompom walks, sleeps, chases fireflies, plays fetch, dances, and reacts to your commands.

## Install

```bash
pi install @codexstar/pi-pompom
```

## Quick Start

Pompom appears automatically when you start Pi. Toggle it with:

```
/pompom on
/pompom off
```

## Commands

| Command | What it does |
|---------|-------------|
| `/pompom` | Toggle companion on/off |
| `/pompom help` | Show all commands and shortcuts |
| `/pompom status` | Check mood, hunger, energy, theme |
| `/pompom pet` | Pet Pompom |
| `/pompom feed` | Drop food |
| `/pompom treat` | Special treat (extra hunger boost) |
| `/pompom hug` | Give a hug (restores energy) |
| `/pompom ball` | Throw a ball |
| `/pompom dance` | Dance with sparkle particles |
| `/pompom music` | Sing a song |
| `/pompom theme` | Cycle color theme |
| `/pompom sleep` | Nap on a pillow |
| `/pompom wake` | Wake up |
| `/pompom flip` | Do a backflip |
| `/pompom hide` | Wander offscreen |

## Keyboard Shortcuts

Pompom responds to Alt/Option + key while the companion is active.

| macOS | Windows/Linux | Action |
|-------|--------------|--------|
| `⌥p` | `Alt+p` | Pet |
| `⌥f` | `Alt+f` | Feed |
| `⌥t` | `Alt+t` | Treat |
| `⌥h` | `Alt+h` | Hug |
| `⌥b` | `Alt+b` | Ball |
| `⌥x` | `Alt+x` | Dance |
| `⌥m` | `Alt+m` | Music |
| `⌥c` | `Alt+c` | Theme |
| `⌥s` | `Alt+s` | Sleep |
| `⌥w` | `Alt+w` | Wake |
| `⌥d` | `Alt+d` | Flip |
| `⌥o` | `Alt+o` | Hide |

Shortcuts work across macOS (Option key), Windows (Alt key), and Linux (Alt key). Four input methods are supported: Ghostty keybinds, ESC prefix, macOS Unicode, and Kitty keyboard protocol.

## Features

- 3D raymarched body with real-time lighting, shadows, and floor reflections
- 4x4 supersampled anti-aliasing (16 samples per pixel)
- Natural blinking, breathing, ear wiggling, and tail wagging
- Day/night sky cycle based on system clock
- Particle effects: sparkles, music notes, rain, crumbs, sleep Zs
- Speech bubbles with random idle chatter (12 phrases)
- Firefly companion that Pompom chases
- Hunger and energy needs system with visual status bars
- Ball physics with bouncing and fetch behavior
- 4 color themes: Cloud, Cotton Candy, Mint Drop, Sunset Gold
- Dark body outline for visibility against any background
- Compact status bar with live state messages
- Crash-isolated rendering: errors never take down the host TUI
- Namespaced widget ID to prevent conflicts with other extensions

## How It Works

The renderer is a software raymarcher running in your terminal. Each frame:

1. Physics simulation updates position, particles, and state machines (60fps sub-stepping)
2. Scene objects (body, ears, paws, tail, antenna, ball, food) are built with rotation and oscillation
3. For each character cell, 16 rays are cast (4x4 grid) and the colors averaged for anti-aliasing
4. Object hits are shaded with diffuse + wrap lighting, ambient occlusion, specular highlights, and firefly point light
5. The shaded pixels are encoded as ANSI true-color escape sequences using `▀` half-block characters
6. Speech bubbles and particle overlays are composited on top

The widget re-renders at ~7 FPS via a 150ms `setInterval`.

## Configuration

Set `POMPOM_NO_KITTY=1` to force half-block rendering on terminals that report Kitty support but don't handle it well.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

MIT. See [LICENSE](LICENSE).
