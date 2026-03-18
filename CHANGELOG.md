# Changelog

All notable changes to this project will be documented in this file.

## [7.8.16] - 2026-03-18

### Features

- native floating window via glimpseui integration — Pompom renders in a
  frameless pixel-art canvas window alongside the terminal widget
- `/pompom window` command and settings panel toggle for the native window
- demo farewell line d26: "See you on the terminal super soon!"

### Bug Fixes

- ambient pre-generation now respects WAV-only backends (aplay/PowerShell) —
  `hasCustomAudio()` no longer treats non-WAV custom files as valid on those
  platforms, so `/pompom:ambient pregenerate` correctly generates fallback WAV
- custom audio folder help text now notes that Linux aplay and Windows
  PowerShell only support .wav files
- `session_switch` now closes and reopens the native window
- `loadGlimpse()` race condition fixed — concurrent callers share a single
  import promise instead of getting stale null

## [7.8.10] - 2026-03-18

### Patch Changes

- ESM-safe demo audio path resolution in `extensions/pompom-voice.ts` so
  Node ESM hosts no longer depend on `__dirname` during module load
- explicit side-chat teardown plus tracked onboarding hint timers in
  `extensions/pompom-extension.ts` so session switch and shutdown clean up the
  chat overlay, editor interception, and delayed hint notifications instead of
  letting them bleed into the next session
- Windows-safe display path handling in `extensions/pompom-extension.ts`,
  `extensions/pompom-footer.ts`, and `extensions/pompom-settings.ts` so
  terminal directory summaries and settings labels stop assuming Unix path
  separators or `HOME`

## [7.8.8] - 2026-03-18

### Patch Changes

- broken README hero reference removed from `README.md` and
  `README.zh-CN.md` so the published package no longer points at a missing
  `docs/images/hero.png` asset

## [7.8.7] - 2026-03-18

### Patch Changes

- accessory-save follow-up in `extensions/pompom-extension.ts` so back-to-back
  give/save requests cannot lose the final persistence write when a second save
  lands while the previous atomic write is finishing

## [7.8.6] - 2026-03-18

### Patch Changes

- helper-command cancellation and stale-session guards in
  `extensions/pompom-extension.ts` so `/pompom:ask`,
  `/pompom:recap`, and `/pompom:analyze` abort on session teardown instead of
  leaking old requests into the next session
- tool-result-aware recent-session context in
  `extensions/pompom-extension.ts` so helper prompts keep recent tool outcomes
  while scanning backward only until the newest 12 relevant messages are found
- truthful accessory persistence in `extensions/pompom-extension.ts` so give
  commands wait for the save, roll back on failure, and only play equip SFX
  after persistence succeeds
- hidden/off mood-SFX suppression plus PowerShell software-gain playback in
  `extensions/pompom-ambient.ts` so hungry/tired one-shots stop while muted and
  Windows ambient/SFX honor runtime volume and ducking
- software gain for PowerShell-backed TTS and gain-aware cached demo playback
  in `extensions/pompom-voice.ts` so Windows voice volume and `aplay`/PowerShell
  demo narration match normal spoken audio
- Node engine floor in `package.json` raised to `>=18.17` so the published
  runtime contract matches the `AbortSignal.any()` requirement already used by
  the voice backends

## [7.8.5] - 2026-03-18

### Patch Changes

- abort-backed AI chatter timeout in `extensions/pompom-extension.ts` so slow
  dynamic commentary requests now stop the upstream model call instead of
  leaking work past the local 6 second timeout

## [7.8.4] - 2026-03-18

### Patch Changes

- decoupled world projection scale from the taller widget height in
  `extensions/pompom.ts` so wider terminals get more headroom without making
  Pompom itself larger
- stronger whole-scene weather rendering in `extensions/pompom.ts`, including
  darker rain and storm skies, brighter snow ground and hills, heavier cloud
  decks, and weather-aware sun and moon visibility so transitions read clearly
  even before particles cross the frame
- lower umbrella and hat placement plus the correct hat material in
  `extensions/pompom.ts` so top accessories stop crowding the upper sky band
  and the hat no longer renders like sunglasses

## [7.8.3] - 2026-03-18

### Patch Changes

- taller widget framing, lower umbrella and hat placement, and cleaner head
  layering in `extensions/pompom.ts` so top accessories stay visible instead of
  clipping into the upper scene band
- denser rain, storm, and snow particle bursts plus stronger weather tinting in
  `extensions/pompom.ts` so short demo weather beats are visibly different at
  normal terminal sizes
- longer weather pre-roll and more spacing between snow and scarf narration in
  `extensions/pompom-extension.ts` so the demo no longer rushes through the
  weather section before the visuals can register

## [7.8.2] - 2026-03-18

### Patch Changes

- demo weather sequencing and accessory snapshots in
  `extensions/pompom-extension.ts` so narrated transitions now blend, sleep
  starts before the nap line, and demo accessories restore cleanly afterward
- weather override warmup, clear-weather reaction timers, stronger cloudy and
  scarf visuals, particle-cap enforcement, and sleep-safe talking logic in
  `extensions/pompom.ts` so snow, clear, and nap scenes render reliably in the
  demo instead of collapsing or being stomped by the natural weather loop
- primary ambient ownership, stale mic-state reset, and chat overlay cleanup in
  `extensions/pompom-extension.ts` so hide/disable/session switches do not
  leave weather audio, talking state, or editor interception behind
- ALSA ambient fallback, retry-timer cleanup, generated-track-only crossfades,
  and mood/weather SFX resume handling in `extensions/pompom-ambient.ts` so
  Linux playback recovers correctly without surprise restarts after pause/off
- non-zero playback failure detection, stop-safe spoken-line tracking, cached
  engine availability, single queued queue-restart timer, and real `aplay`
  volume scaling in `extensions/pompom-voice.ts` so voice playback no longer
  reports false success or ignores Linux volume settings
- shared tool-output redaction and wrapped-line caching in
  `extensions/pompom-chat.ts`, plus branch-cost memoization in
  `extensions/pompom-footer.ts`, so the side chat no longer leaks raw tool
  blobs and the overlay/footer render loops stay smoother under load

## [7.8.1] - 2026-03-18

### Patch Changes

- multi-instance liveness and scan smoothing in `extensions/pompom-instance.ts` so sleep/resume no longer drops live peers and repeated primary checks avoid synchronous rescans
- natural weather snapshot restore and session-count reset handling in `extensions/pompom.ts` so overrides return to the prior weather arc and first-session greetings do not repeat after resets
- settings accessory persistence hook in `extensions/pompom-settings.ts` plus extension wiring in `extensions/pompom-extension.ts` so accessory grants from the settings panel survive later restores
- legacy Alt shortcut normalization in `extensions/pompom-extension.ts` so Kitty CSI-u and ESC-prefix terminals both honor public mappings like `Alt+E`, `Alt+R`, `Alt+U`, `Alt+A`, and `Alt+Z`
- demo and ambient reset docs/help alignment in `README.md` and `extensions/pompom-extension.ts` so the surfaced durations and reset behavior match runtime behavior

## [7.4.6] - 2026-03-18

### Major Changes

- **Theme overhaul** (Gemini 3.1 Pro): warm Catppuccin Mocha redesign with custom `warm_surface`, `warm_bubble`, `warm_green_glow`, `warm_red_glow`, `warm_border` color vars. User messages have warm pink-tinted bubbles, tool results glow green/red softly, thinking levels progress cold→warm→pink.
- **Contextual shortcut bar** (Gemini 3.1 Pro): state-aware shortcuts — only 3-4 relevant keys shown based on Pompom's current state. Bold keys with paw icon prefix, peach/lavender highlights for urgent needs, no more fill lines.
- **Wind system**: storms/rain/snow create wind force affecting ears, antenna, body lean, and tail. Random gusts push Pompom asymmetrically during storms.
- **Rain splash particles**: multi-droplet splashes on ground impact with ripple effects.
- **Snow accumulation**: settled snowflakes persist as sparkle particles at ground level.
- **Cloud shadows**: drifting dark patches across the ground during cloudy/rain/storm weather.
- **Enhanced breathing**: dual-frequency sine wave with visible body radius pulse (±1.2%).
- **Better ball physics**: air resistance, spin transfer on bounce, realistic energy loss, clamped spin.
- **Firefly time-of-day**: brighter/larger at night, dimmer/smaller during day, pulsing glow.
- **Demo mode**: `/pompom demo` runs a narrated 95-second autonomous showcase of all features — Pompom introduces each capability with speech bubbles. 5 acts: intro, interactions, weather, games, finale.
- **Pi Voice listen integration**: hold-to-talk with `pi listen` types directly into Pompom's chat editor when the chat overlay is focused, via `ctx.ui.setEditorText` interception.
- **Per-session chat**: side chat conversations are isolated per session — no cross-session history leakage.
- **Fully responsive settings panel**: removed 68-char width cap, scrolling tab bar with `‹ ›` indicators, 2-column action grid for wide terminals, adaptive progress bars and footer hints.

### Bug Fixes

- **Critical**: `getStringWidth()` now strips ANSI escapes before measuring — shortcut bar width calculation was always wrong.
- **High**: `aiCommandInProgress` deadlock fixed — all 3 AI commands wrap `getApiKey()` in try/catch so the flag always clears on failure.
- **High**: mic activation now cancels in-flight TTS synthesis (aborts `currentAbortController`), not just active playback.
- **High**: speech queue allows priority 3+ events during active playback instead of dropping everything.
- **Medium**: `session_switch` preserves original `startedAt` — no more terminal seniority jumps.
- **Medium**: settings ambient toggle now restarts weather sync via `onAmbientToggle` callback.
- **Medium**: sunglasses prompt moved outside active-weather gate — now reachable during clear daytime.
- **Medium**: session count incremented at session_start, not import time.
- **Medium**: macOS `⌥` glyph replaced with "Alt+" in `sanitizeSpeechText` before stripping.
- **Medium**: agent state persistence uses file (`~/.pi/pompom/agent-state.json`) instead of `pi.appendEntry` — eliminates O(n) history scan and unbounded entry growth.
- **Medium**: side chat `/write` mode removed — strictly read-only for safety.
- **Medium**: side chat `peek_main` tool redacts long tokens/base64 in tool output.
- **Medium**: ALSA/Linux ambient+SFX now generate WAV (PCM + header) instead of .mp3 when `aplay` is detected.
- **Low**: atomic file writes for generated audio (tmp+rename pattern).
- **Low**: snowpile particle decay rewritten to explicit if/else (was fragile ternary).
- **Low**: `ballSpin` clamped to ±50 to prevent unbounded accumulation.
- **Low**: weather blend transition snapshots old frame colors before applying new tint.
- **Low**: removed 5 stale `patch*.cjs` files targeting non-existent `lumo.ts`.
- **Low**: removed unused imports (`InstanceInfo`, `hasRecentGreeting`, `createCodingTools`, `fs`/`os`/`path` from chat).
- **Low**: theme conflict resolved — no longer copies `pompom.json` to `~/.pi/agent/themes/`.
- **Low**: SKILL.md frontmatter added with `name` and `description` fields.
- **Low**: `persistAgentState()` removed from 5 high-frequency event handlers (agent_start, tool_start, tool_end, message_end). Now only on agent_end + session shutdown.

## [7.2.10] - 2026-03-18

### Patch Changes

- hidden widget ambient guard in `extensions/pompom-extension.ts` so `Alt+V` no longer lets the 5-second weather sync restart ambient while the companion stays hidden
- greeting claim lock in `extensions/pompom-instance.ts` so multi-terminal greeting dedup no longer relies on a check-then-write race
- crossfade process cleanup in `extensions/pompom-ambient.ts` so pause/off paths also stop the overlapping old ambient process instead of letting it linger

## [7.2.9] - 2026-03-18

### Patch Changes

- live session speech gate in `extensions/pompom-extension.ts` so `/pompom off` stops commentary and forwarded TTS events without overwriting saved voice preferences
- widget remount path in `extensions/pompom-extension.ts` so hide/show restores the companion view even when behavioral timers stay active
- ALSA ambient blocked-state handling in `extensions/pompom-ambient.ts` so unsupported `.mp3` playback stops the 5-second retry loop instead of logging forever

## [2.3.1] - 2026-03-15

### Patch Changes

- frictionless voice onboarding in `extensions/pompom-extension.ts` so `/pompom:voice on` auto-picks the best usable engine, `/pompom:voice setup` offers a guided picker, and the session hint only shows before voice is configured once
- engine priority and persisted onboarding state in `extensions/pompom-voice.ts` so ElevenLabs becomes the default preference, previous manual choices are kept when still usable, and fallback selection stays consistent

## [2.1.1] - 2026-03-15

### Patch Changes

- split weather announcement state from render-time weather blending in `extensions/pompom.ts` so agent weather override no longer suppresses random weather progression or trigger the wrong speech bubble
- keep the star-catch game stable while talking or after reset in `extensions/pompom.ts` by preserving `currentState === "game"` during TTS and clearing game fields in `resetPompom()`
- harden Pi event handling in `extensions/pompom-extension.ts` and `extensions/pompom-agent.ts` so missing tool event fields do not throw and tool completion can still clear tracked active calls

## [2.1.0] - 2026-03-15

### Minor Changes

- opt-in TTS voice queue in `extensions/pompom-voice.ts` with Kokoro local synthesis, Deepgram cloud synthesis, native WAV playback, and persisted voice config
- typed speech events in `extensions/pompom.ts` so weather, commentary, assistant replies, and user-triggered reactions can drive voice without making `say()` async
- `/pompom:voice on|off|kokoro|deepgram|test` plus shared mouth animation for `pi-listen` recording and active TTS playback in `extensions/pompom-extension.ts`

## [2.0.2] - 2026-03-15

### Patch Changes

- intelligent coding companion state in `extensions/pompom-agent.ts` with commentary pools, session stats, mood-to-weather mapping, and serialized restore support
- additive agent overlay controls in `extensions/pompom.ts` for speech, look direction, antenna glow, ear boost, and weather override without replacing the pet state machine
- Pi lifecycle wiring plus `/pompom:ask` and `/pompom:recap` commands in `extensions/pompom-extension.ts` using `@mariozechner/pi-ai`

## [2.0.0] - 2026-03-14

### Added
- **Voice integration**: Pompom rushes to center when user records voice (pi-listen). Mouth syncs to audio level, ears wiggle, bounces with amplitude.
- **Weather accessories**: Umbrella (rain/storm), scarf (snow), sunglasses (sunny day), hat. Pompom asks for them when weather changes. Persist across sessions in `~/.pi/pompom/accessories.json`.
- `/pompom give <item>` command to give accessories
- `/pompom inventory` to see Pompom's bag
- **Catch the Stars mini-game**: `/pompom game` or Alt+g. 20-second star-catching challenge with score.
- **Weather progression**: Starts clear, transitions naturally every 45-90s with speech announcements.
- **Smooth sky transitions**: Keyframe interpolation between 8 time-of-day color stops. No hard color jumps.
- **Weather color blending**: 7-second smooth fade between weather states.
- **Sun and moon**: Warm sun disk with halo (daytime), crescent moon with glow (nighttime).
- **Grass and flowers**: Swaying grass blades with pink/yellow flowers above the ground line.
- **Distant hills**: Rolling silhouettes on the horizon, day/night colored.
- **Cloud wisps**: Subtle drifting clouds even in clear weather.
- **Kawaii face redesign**: White sclera eyes with brown iris, bright face plate, body outline skipped on face.
- **Hybrid quadrant rendering**: Unicode quadrant blocks at edges for 2x horizontal detail.
- Rain particles, storm lightning, snowfall with wind drift.
- Twinkling colored stars at night.
- 12 random idle speech lines.
- Descriptive weather-aware status messages.

### Changed
- Rendering: quadrant blocks at edges + half-blocks in smooth areas (was half-blocks everywhere)
- Eyes: layered sclera/iris/pupil/highlight design with brown iris (was flat dark circle)
- Body outline: skipped on face area for feature contrast
- Status bar: single compact line with platform-aware labels
- effectDim: H*4 for bigger character (was H*2.8)

## [1.0.0] - 2026-03-14

### Added
- 3D raymarched virtual pet with physics simulation
- 10 interactive states: idle, walk, flip, sleep, excited, chasing, fetching, singing, offscreen, peek
- Keyboard shortcuts via macOS Option key and Windows/Linux Alt key
- `/pompom` command with on/off/pet/feed/ball/music/color/sleep/wake/flip/hide
- Day/night sky cycle based on system clock
- Particle effects: sparkles, music notes, rain, crumbs, sleep Zs
- Speech bubbles with contextual messages
- Firefly companion, ball fetch physics, food dropping
- Hunger and energy needs system
- 4 color themes: Cloud, Cotton Candy, Mint Drop, Sunset Gold
- Floor with wood grain pattern and character reflections
