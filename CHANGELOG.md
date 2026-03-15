# Changelog

All notable changes to this project will be documented in this file.

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
