# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-03-14

### Added
- Dance state with sparkle particles (`/pompom dance`, Alt+x)
- Treat command with extra hunger boost (`/pompom treat`, Alt+t)
- Hug command with energy restore (`/pompom hug`, Alt+h)
- `/pompom help` with full command reference and platform-aware shortcut labels
- `/pompom status` showing mood, hunger/energy bars, active theme
- Random idle speech (12 phrases) for personality
- Kitty keyboard protocol support (Ghostty, Kitty, WezTerm)
- Ghostty keybind configuration for reliable macOS shortcuts
- Cross-platform status bar labels (Option on macOS, Alt on Windows/Linux)
- Crash isolation: all rendering and input handling wrapped in try/catch
- Namespaced widget ID (`codexstar-pompom-companion`) to prevent conflicts
- Dark body outline for better visibility against backgrounds
- Larger eyes, nose, mouth for clarity at low resolution

### Changed
- Upgraded anti-aliasing from 2x2 to 4x4 supersampling (16 samples per pixel)
- Compact single-line status bar (was 4-line box)
- Descriptive state messages ("Pompom is starving! Drop a treat with ⌥f")
- Moved creature closer to ground (posY 0 → 0.15)
- Camera offset (VIEW_OFFSET_Y 0.1 → 0.18) for better framing
- Replaced emoji particle characters with ASCII to prevent TUI width overflow
- Speech bubble strips multi-width characters before rendering to grid

### Fixed
- "Rendered line exceeds terminal width" crash from emoji in particles/speech
- Extension dropped on other package installs (now published to npm)

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
