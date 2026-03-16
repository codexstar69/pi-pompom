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
  <a href="#features">Features</a> ·
  <a href="#settings-panel">Settings</a> ·
  <a href="#how-it-works">How It Works</a>
</p>

---

Pompom is an interactive companion for [Pi CLI](https://github.com/mariozechner/pi-coding-agent). It renders a real-time 3D raymarched creature above your editor using hybrid Unicode quadrant/half-block characters. Pompom walks, sleeps, chases fireflies, plays fetch, dances, catches stars, wears weather accessories, and reacts to your voice.

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
| `/pompom game` | Catch the stars! (20s mini-game) |
| `/pompom theme` | Cycle color theme |
| `/pompom sleep` | Nap on a pillow |
| `/pompom wake` | Wake up |
| `/pompom flip` | Do a backflip |
| `/pompom hide` | Wander offscreen |
| `/pompom give <item>` | Give an accessory (umbrella, scarf, sunglasses, hat) |
| `/pompom inventory` | See Pompom's bag |
| `/pompom toggle` | Hide/show animation (voice + tracking stay active) |
| `/pompom:voice` | Voice settings — on/off/setup/test/volume |
| `/pompom:ambient` | Ambient weather sounds — on/off/volume/pregenerate |
| `/pompom:chat` | Side chat with Pompom |
| `/pompom:ask <q>` | Ask Pompom about the session |
| `/pompom:recap` | Session summary |
| `/pompom:agents` | Agent status dashboard |
| `/pompom:stuck` | Check if agent is stuck |
| `/pompom:analyze` | AI session analysis |
| `/pompom-settings` | Interactive settings panel (9 tabs) |

## Keyboard Shortcuts

| macOS | Windows/Linux | Action |
|-------|--------------|--------|
| `⌥p` | `Alt+p` | Pet |
| `⌥e` | `Alt+e` | Feed |
| `⌥t` | `Alt+t` | Treat |
| `⌥u` | `Alt+u` | Hug |
| `⌥r` | `Alt+r` | Ball |
| `⌥x` | `Alt+x` | Dance |
| `⌥g` | `Alt+g` | Game |
| `⌥m` | `Alt+m` | Music |
| `⌥c` | `Alt+c` | Theme |
| `⌥s` | `Alt+s` | Sleep |
| `⌥a` | `Alt+a` | Wake |
| `⌥z` | `Alt+z` | Flip |
| `⌥o` | `Alt+o` | Hide |
| `⌥v` | `Alt+v` | Toggle view (hide/show) |
| `⌥/` | `Alt+/` | Pompom Chat |

> **Note:** Alt+f, Alt+b, Alt+d, Alt+h, Alt+w are used by Pi's built-in editor.
> Pompom uses safe alternatives that don't conflict.

Four input methods supported: Ghostty keybinds, ESC prefix, macOS Unicode, Kitty keyboard protocol.

## Features

### Rendering
- 3D raymarched body with real-time lighting, shadows, and floor reflections
- Hybrid renderer: Unicode quadrant blocks at edges (2x detail), half-blocks in smooth areas
- Kawaii face design: white sclera eyes with brown iris, layered pupil/highlights, bright face plate
- Dark body outline (skipped on face for contrast)
- 4 color themes: Cloud, Cotton Candy, Mint Drop, Sunset Gold

### Scene
- Smooth sky color transitions via keyframe interpolation (gradual dawn to dusk, no hard jumps)
- Sun disk with halo during daytime, crescent moon with glow at night
- Twinkling colored stars (blue-white, yellow, orange-red)
- Rolling distant hills on the horizon
- Swaying grass blades with small flowers above the ground
- Drifting cloud wisps (subtle even in clear weather)

### Weather System
- 5 weather types: clear, cloudy, rain, storm, snow
- Weather starts clear, transitions naturally every 30 min – 2 hours
- Smooth 7-second color blend between weather states
- Rain streaks and splash particles, storm lightning flashes, gentle snowfall with wind drift
- Speech bubble announcements: "Clouds rolling in...", "It's starting to rain!", "Snowflakes!"

### Weather Accessories
- Pompom asks for accessories when weather changes ("I wish I had an umbrella...")
- `/pompom give umbrella` — red striped umbrella during rain/storm
- `/pompom give scarf` — warm striped scarf during snow
- `/pompom give sunglasses` — dark reflective shades during sunny days
- `/pompom give hat` — hat accessory
- Accessories persist across sessions (saved to `~/.pi/pompom/accessories.json`)
- Only asks once per item type (no nagging)

### Mini-Game
- `/pompom game` starts a 20-second star-catching challenge
- Golden stars fall from the sky
- Pompom auto-chases the nearest star
- Catching a star scores a point with sparkle effect
- Final score announced when timer ends

### Text-to-Speech
- 3 engines: ElevenLabs (cloud, best), Deepgram (cloud), Kokoro (local, free)
- 19 ElevenLabs voices, 5 Deepgram voices, 8 Kokoro voices
- Pompom speaks reactions, commentary, and announcements aloud
- 6 personality modes control speech frequency:
  - **Quiet** — user actions + errors only
  - **Normal** — moderate, casual (default)
  - **Chatty** — frequent commentary
  - **Professional** — errors, milestones, direct actions
  - **Mentor** — guides on errors and completions
  - **Zen** — near-silent, speaks only when addressed
- Voice test: `/pompom:voice test`
- Volume control: `/pompom:voice volume 0-100`

### Voice Input
- Works with [@codexstar/pi-listen](https://www.npmjs.com/package/@codexstar/pi-listen)
- When recording voice, Pompom rushes to center and faces you
- Mouth opens in sync with audio level (louder = wider)
- Ears wiggle with your voice
- Bounces with audio amplitude

### Agent Tracking
- Pompom watches the coding agent and reacts to tool calls, errors, and completions
- Mood changes: idle → curious → focused → busy → concerned → celebrating → sleepy
- Weather reflects agent state (storm on errors, snow on celebrations)
- Proactive stuck detection with speech bubble alerts
- Session dashboard: `/pompom:agents`
- AI-powered analysis: `/pompom:analyze`
- Side chat: `/pompom:chat` or `Alt+/`

### Personality & Behavior
- Natural blinking, breathing, ear wiggling, tail wagging
- Hunger and energy needs with visual status bars
- Firefly companion that Pompom chases
- Ball physics with bouncing and fetch behavior
- Walk, peek, flip, dance, sing animations
- Descriptive state messages in status bar
- Human-readable shortcut labels in status bar

### Ambient Weather Sounds
- Background audio that matches the current weather (rain, wind, birdsong, etc.)
- Generated via ElevenLabs Sound Effects API on first play, cached locally
- Auto-ducks to 20% volume during voice playback, restores after
- Pauses when view is hidden (`Alt+V`), stops on `/pompom off`
- Pregenerate all 5 sounds: `/pompom:ambient pregenerate`
- Default: on at 40% volume

### Settings Panel
- Open with `/pompom-settings`
- 9 tabs: **Pompom** · **Voice** · **Ambient** · **Personality** · **Theme** · **Accessories** · **Model** · **Shortcuts** · **About**
- Arrow keys to navigate, Enter to select, Esc to close
- Pompom tab lets non-technical users pet, feed, and play without knowing shortcuts
- Shortcuts tab shows a full keyboard reference card

### View Toggle
- `Alt+V` or `/pompom toggle` hides the animation but keeps voice, ambient audio, health checks, and agent tracking running
- Press again to bring Pompom back

## How It Works

The renderer is a software raymarcher running in your terminal. Each frame:

1. Physics simulation updates position, particles, and state machines (60fps sub-stepping)
2. Scene objects (body, ears, paws, tail, antenna, ball, food, accessories) are built with rotation and oscillation
3. For each cell, 4 quadrant samples are taken. Edge cells use quadrant characters for 2x horizontal detail. Smooth cells use half-blocks.
4. Object hits are shaded with diffuse + wrap lighting, ambient occlusion, specular highlights, and firefly point light
5. The shaded pixels are encoded as ANSI true-color escape sequences
6. Speech bubbles and particle overlays are composited on top

The widget re-renders at ~7 FPS via a 150ms `setInterval`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

MIT. See [LICENSE](LICENSE).

---

<p align="center">
  <strong>Made by <a href="https://x.com/baanditeagle">@baanditeagle</a></strong>
</p>
<p align="center">
  <a href="https://x.com/baanditeagle">𝕏 Twitter</a> ·
  <a href="https://github.com/codexstar69/pi-pompom">GitHub</a> ·
  <a href="https://www.npmjs.com/package/@codexstar/pi-pompom">npm</a> ·
  <a href="https://github.com/codexstar69/pi-pompom/issues">Report a Bug</a> ·
  <a href="https://github.com/mariozechner/pi-coding-agent">Pi CLI</a>
</p>
