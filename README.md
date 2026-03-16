<p align="center">
  <b>English</b> | <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="docs/images/hero.png" alt="pi-pompom" width="720">
</p>

<h1 align="center">pi-pompom</h1>
<p align="center"><strong>A 3D raymarched virtual pet with voice, ambient sounds, AI side chat, and agent intelligence — for Pi CLI.</strong></p>
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
  <a href="#side-chat">Side Chat</a> ·
  <a href="#agent-intelligence">Agent Intelligence</a> ·
  <a href="#settings-panel">Settings</a>
</p>

---

Pompom is an interactive coding companion for [Pi CLI](https://github.com/mariozechner/pi-coding-agent). It renders a real-time 3D raymarched creature above your editor, speaks with natural TTS voices, plays ambient weather soundscapes, tracks your coding agent's mood, offers an AI side chat, and reacts emotionally to hunger, tiredness, and your interactions.

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

Open the interactive settings panel with `/pompom-settings` — 9 tabs covering every feature, no commands to memorize.

## Commands

### Pet Actions

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
| `/pompom hide` | Wander offscreen (stays 20-30% visible) |
| `/pompom toggle` | Hide/show animation (voice + tracking stay active) |
| `/pompom give <item>` | Give an accessory (umbrella, scarf, sunglasses, hat) |
| `/pompom inventory` | See Pompom's bag |

### Voice & Audio

| Command | What it does |
|---------|-------------|
| `/pompom:voice` | Voice status — engine, voice, personality, volume |
| `/pompom:voice on\|off` | Enable/disable text-to-speech |
| `/pompom:voice setup` | Interactive voice configuration |
| `/pompom:voice test` | Play test phrase |
| `/pompom:voice kokoro\|deepgram\|elevenlabs` | Switch TTS engine |
| `/pompom:voice voices` | List available voices for current engine |
| `/pompom:voice set <id>` | Set voice by ID |
| `/pompom:voice volume <0-100>` | Adjust voice volume |
| `/pompom:voice quiet\|normal\|chatty\|professional\|mentor\|zen` | Set personality |
| `/pompom:ambient` | Ambient sound status |
| `/pompom:ambient on\|off` | Enable/disable weather ambient sounds |
| `/pompom:ambient volume <0-100>` | Adjust ambient volume |
| `/pompom:ambient pregenerate` | Generate all 5 weather sounds now |
| `/pompom:ambient reset` | Delete generated sounds, regenerate fresh |
| `/pompom:ambient folder` | Show custom audio folder path |

### AI & Agent Intelligence

| Command | What it does |
|---------|-------------|
| `/pompom:chat` | Open Pompom side chat (parallel AI assistant) |
| `/pompom:ask <question>` | Ask Pompom about the session |
| `/pompom:recap` | Get a concise session summary |
| `/pompom:agents` | Agent activity dashboard |
| `/pompom:stuck` | Check if agent is stuck in error loop |
| `/pompom:analyze` | Deep AI-powered session analysis |
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
| `⌥/` | `Alt+/` | Pompom Side Chat |

> **Note:** Alt+f, Alt+b, Alt+d, Alt+h, Alt+w are used by Pi's built-in editor.
> Pompom uses safe alternatives that don't conflict.

Four input methods supported: Ghostty keybinds, ESC prefix, macOS Unicode, Kitty keyboard protocol.

## Features

### 3D Rendering
- Raymarched body with real-time lighting, shadows, and floor reflections
- Hybrid renderer: Unicode quadrant blocks at edges (2x detail), half-blocks in smooth areas
- Kawaii face: white sclera eyes, brown iris, layered pupil/highlights, bright face plate
- 4 color themes: Cloud, Cotton Candy, Mint Drop, Sunset Gold
- Natural animations: blinking, breathing, ear wiggling, tail wagging
- Widget re-renders at ~7 FPS via 150ms interval

### Scene & Weather
- Smooth sky color transitions (dawn to dusk via keyframe interpolation)
- Sun disk with halo, crescent moon with glow, twinkling stars
- Rolling hills, swaying grass, drifting cloud wisps
- 5 weather types: clear, cloudy, rain, storm, snow
- Weather transitions naturally every 30 min to 2 hours
- Rain streaks, storm lightning, gentle snowfall with wind drift

### Text-to-Speech (3 Engines)

| Engine | Type | Voices | Special Features |
|--------|------|--------|-----------------|
| **ElevenLabs** | Cloud (best quality) | 19 voices | v3 audio tags: `[laughs]`, `[sighs]`, `[excited]`, `[whispers]`, `[crying]` |
| **Deepgram** | Cloud | 5 Aura-2 voices | Natural prosody from punctuation |
| **Kokoro** | Local (free, no API) | 8 voices | Markdown pronunciation `[word](/IPA/)`, stress control |

Audio tags are engine-aware — ElevenLabs keeps `[laughs]`, Kokoro and Deepgram get them stripped automatically. No engine loses features because of another.

### 6 Voice Personalities

| Mode | Behavior |
|------|----------|
| **Quiet** | User actions + errors only |
| **Normal** | Moderate, casual (default) |
| **Chatty** | Frequent commentary |
| **Professional** | Errors, milestones, direct actions |
| **Mentor** | Guides on errors and completions |
| **Zen** | Near-silent, speaks only when addressed |

### Emotional Reactions
Pompom expresses natural emotions based on her needs using ElevenLabs v3 audio tags:

- **Hungry** (<30%): `[sad] My tummy is rumbling...`, `[crying] Feed me!`
- **Starving** (<15%): `[wheezing] Everything looks like food...`
- **Tired** (<15%): `[whispers] Just five more minutes...`, `[sighs] I'm so sleepy...`
- **Happy** (>80%): `[laughs] Life is good!`, `[sings] La la la, happy me!`
- **Playful** (>60%): `[excited] Let's play a game!`, `[mischievously] Wanna throw the ball?`
- **Fed while starving**: `[excited] FINALLY! Food! Oh that's SO good!`
- **Treat while desperate**: `[crying] Oh my gosh... a TREAT! Thank you so much!`

Rate-limited to one emotional line every 45 seconds.

### Ambient Weather Sounds
Background audio that matches the current weather, with layered one-shot sound effects.

**Ambient loops** (continuous, looping):
- Custom audio from Envato Elements or any source — drop files in `~/.pi/pompom/ambient/custom/`
- Falls back to ElevenLabs Sound Effects API generation (cached locally)
- Auto-ducks to 20% during voice playback

**23 layered sound effects** (one-shot, contextual):

| Category | Effects |
|----------|---------|
| **Weather** | thunder, bird_chirp, bee_buzz, wind_gust, rain_drip |
| **Actions** | pet_purr, eat_crunch, ball_bounce, hug_squeeze, sleep_snore, wake_yawn, dance_sparkle, flip_whoosh |
| **Events** | star_chime, game_start, game_end, hide_tiptoe, peek_surprise, firefly_twinkle, color_switch, weather_transition, accessory_equip, footstep_soft |

SFX play at 15% of ambient volume — subtle accents, never distracting.

### Weather Accessories
- Pompom asks for accessories when weather changes
- `/pompom give umbrella` — appears during rain/storm
- `/pompom give scarf` — appears during snow
- `/pompom give sunglasses` — appears in clear weather
- `/pompom give hat` — a cute collectible
- Accessories persist across sessions

### Mini-Game: Star Catcher
- `/pompom game` starts a 20-second challenge
- Golden stars fall from the sky with sparkle effects
- Star chime plays on each catch
- Score announced with game-end jingle

## Side Chat

Press `Alt+/` or run `/pompom:chat` to open a floating AI chat panel alongside the main agent.

- Pompom has her own AI instance running in parallel — doesn't interrupt your main agent
- Read-only `peek_main` tool lets Pompom see what the agent is working on
- Type `help` for built-in shortcuts: `analyze`, `stuck`, `recap`, `status`
- Anchored at the bottom of the viewport, 50% max height
- Press Esc to close, `Alt+/` to toggle focus

## Agent Intelligence

Pompom watches your coding agent and reacts in real time.

### 7 Mood States
idle → curious → focused → busy → concerned → celebrating → sleepy

Mood is determined by tool call patterns, error rates, and activity timing. Weather reflects agent state — storm on errors, snow on celebrations.

### Commentary System
10 event buckets with probability-based speech: agent start/end, tool calls, tool errors, messages. Commentary gap: 30s minimum between lines, 60s for same bucket.

### Stuck Detection
Monitors 4 signals: error streaks, stalled progress (>5 min), high error rate (>50%), and repetitive tool calls. Pompom alerts with a speech bubble when confidence is high.

### AI Analysis Commands
- `/pompom:ask <question>` — ask anything about the current session
- `/pompom:recap` — concise session summary
- `/pompom:analyze` — deep AI-powered analysis with recommendations
- `/pompom:agents` — real-time dashboard: active tools, success rate, mood, timing

## Settings Panel

Run `/pompom-settings` to open the interactive 9-tab settings panel.

| Tab | What you can do |
|-----|----------------|
| **Pompom** | Pet, feed, play — 12 action buttons with mood/hunger/energy bars |
| **Voice** | Pick engine, select voice, adjust volume, toggle on/off, test |
| **Ambient** | Toggle weather sounds, adjust volume, pregenerate all 5 weather tracks |
| **Personality** | Choose from 6 speech modes with descriptions |
| **Theme** | Pick from 4 color palettes |
| **Accessories** | Give items with descriptions of when they appear |
| **Model** | Select AI model for chat/ask/analyze |
| **Shortcuts** | Full keyboard reference card with platform-correct symbols |
| **About** | Dashboard: mood, hunger, energy, weather, voice, ambient, agent stats |

Navigate with arrow keys, Enter to select, Esc to close. Non-technical users can do everything from the Pompom tab without knowing a single shortcut.

## How It Works

The renderer is a software raymarcher running in your terminal. Each frame:

1. Physics simulation updates position, particles, and state machines (60fps sub-stepping)
2. Scene objects (body, ears, paws, tail, antenna, ball, food, accessories) are built with rotation and oscillation
3. For each cell, 4 quadrant samples are taken. Edge cells use quadrant characters for 2x horizontal detail. Smooth cells use half-blocks.
4. Object hits are shaded with diffuse + wrap lighting, ambient occlusion, specular highlights, and firefly point light
5. The shaded pixels are encoded as ANSI true-color escape sequences
6. Speech bubbles and particle overlays are composited on top

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

MIT. See [LICENSE](LICENSE).

---

<p align="center">
  <strong>Made by <a href="https://abhishektiwari.co">Abhishek Tiwari</a></strong>
</p>
<p align="center">
  <a href="https://abhishektiwari.co">Website</a> ·
  <a href="https://x.com/baanditeagle">𝕏 Twitter</a> ·
  <a href="https://github.com/codexstar69/pi-pompom">GitHub</a> ·
  <a href="https://www.npmjs.com/package/@codexstar/pi-pompom">npm</a> ·
  <a href="https://github.com/codexstar69/pi-pompom/issues">Report a Bug</a> ·
  <a href="https://github.com/mariozechner/pi-coding-agent">Pi CLI</a>
</p>
