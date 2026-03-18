# Contributing to pi-pompom

Thanks for your interest in contributing.

## Ways to Contribute

- **Report bugs** — open an issue with reproduction steps
- **Suggest features** — new states, animations, interactions
- **Submit PRs** — bug fixes, new themes, rendering improvements
- **Improve docs** — fix typos, add examples

## Development Setup

```bash
git clone https://github.com/codexstar69/pi-pompom.git
cd pi-pompom
bun install
bun run typecheck
```

To test locally in Pi:

```bash
pi install .
pi  # then type /pompom on
```

## Pull Request Guidelines

1. Keep PRs focused. One feature or fix per PR.
2. Run `bun run typecheck` before submitting.
3. Test with `pi --no-input -m "/pompom on"` to verify no crashes.
4. Update CHANGELOG.md with your changes.

## Code Style

- TypeScript with tabs for indentation
- No runtime dependencies (peer deps only)
- All characters written to `screenChars` must be single-width (no emoji)
- Wrap TUI interactions in try/catch to prevent crashes
- Use namespaced widget IDs to avoid conflicts

## Architecture

- `extensions/pompom.ts` — 3D raymarching renderer, physics, shading, weather, game logic
- `extensions/pompom-extension.ts` — Pi extension lifecycle, commands, keyboard input, event routing
- `extensions/pompom-voice.ts` — TTS speech queue, Kokoro/Deepgram/ElevenLabs engines, audio playback
- `extensions/pompom-agent.ts` — Agent activity tracking, mood calculation, stuck detection, commentary
- `extensions/pompom-chat.ts` — Side agent chat overlay with read-only tools and peek_main
- `extensions/pompom-settings.ts` — Interactive TUI settings panel with tab navigation

The renderer is a software raymarcher. Each cell casts 4 rays (quadrant sampling) and outputs half-block Unicode characters with ANSI true-color.
