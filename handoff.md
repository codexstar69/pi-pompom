# Handoff

## Current Status

- Implemented opt-in Pompom TTS voice support.
- Added `extensions/pompom-voice.ts` with:
  persisted `~/.pi/pompom/voice-config.json`,
  Kokoro local synthesis,
  Deepgram cloud synthesis,
  native WAV playback through `afplay` / `paplay` / `aplay` /
  `powershell`,
  bounded speech queue,
  and synthetic mouth envelope output.
- Extended `extensions/pompom.ts` with typed speech events,
  `pompomOnSpeech`,
  `pompomSetTalkAudioLevel`,
  and backward-compatible `pompomSay(...)`.
- Updated `extensions/pompom.ts` speech lines to ASCII-only text and
  stopped clearing the bubble when talking starts so TTS lines stay
  visible during playback.
- Wired `extensions/pompom-extension.ts` to initialize voice on session
  start/switch, enqueue speech events, share mouth animation between
  `pi-listen` recording and TTS playback, show a one-time hint, and add
  `/pompom:voice on|off|kokoro|deepgram|test`.
- Updated `.gitignore` to ignore `tmp/`.
- Bumped `package.json` to `2.1.0` and added optional dependency
  `kokoro-js`.
- Added `CHANGELOG.md` entry for `2.1.0`.
- Added ExecPlan `docs/plans/2026-03-15-pompom-tts-voice.md`.

## Validation

- Ran `pnpm typecheck`
- Result: passed
- Ran `bunx tsc -p tsconfig.json --noEmit`
- Result: passed
- Ran `timeout 10 pi --no-input -m "/pompom on" -m "/pompom pet"`
- Result: no new crash; session rendered and handled commands, then the
  timeout wrapper exited after 10 seconds
- Ran export verification with `rg -n "export function ..."` on
  `extensions/`
- Result: all requested new exports found

## Notes

- The smoke run still prints the older accessories warning when
  `~/.pi/pompom/accessories.json` does not exist. That is noisy but did
  not crash Pi.
- `kokoro-js` is optional. If it is not installed, Kokoro voice falls
  back to Deepgram when available, or silently skips playback if no
  engine is available.
- Playback temp WAV files now go to local `./tmp`, not `/tmp`, and are
  removed on player close.

## Last Prompts

- "Then implement the full Pompom Intelligent Coding Companion..."
- "You are reviewing an implementation plan for adding TTS
  (text-to-speech) voice to pi-pompom..."
- "You are implementing TTS voice for pi-pompom. Read ALL files first..."

## Next Checks

- In a real interactive Pi session, run `/pompom:voice on` and then
  `/pompom:voice test` to confirm actual audio playback on this machine.
- If Kokoro is preferred locally, install `kokoro-js` in the packaged
  runtime environment used by Pi.
- Consider softening the missing accessories log in
  `loadAccessories()` so a first run does not print a full ENOENT stack.
