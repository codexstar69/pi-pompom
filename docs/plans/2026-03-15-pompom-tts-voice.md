# Pompom TTS Voice

This ExecPlan is a living document. The sections `Progress`,
`Surprises & Discoveries`, `Decision Log`, and `Outcomes &
Retrospective` must be kept up to date as work proceeds.

This document follows [../PLANS.md](/Users/codex/Downloads/Code Files/PLANS.md)
from the repository root context at `../PLANS.md`.

## Purpose / Big Picture

After this change, Pompom can optionally speak the same short lines that
already appear in the speech bubble. Users can turn voice on with
`/pompom:voice on`, pick a local Kokoro engine or cloud Deepgram engine,
and hear queued, rate-limited playback without breaking the existing
pet, commentary, or `pi-listen` mouth animation.

The user-visible proof is simple. With the extension loaded in Pi, run
`/pompom:voice on`, then trigger a high-priority action such as
`/pompom pet` or `/pompom:voice test`. Pompom should still render, the
speech bubble should stay visible, and the mouth animation should move
while playback is active.

## Progress

- [x] 2026-03-15 21:36 IST Read the required repository files, the
      existing ExecPlan, the Pi extension docs, and the full
      `pi-voice` reference implementation.
- [x] 2026-03-15 21:42 IST Verified external API shape for `kokoro-js`
      and Deepgram speech synthesis before implementation.
- [x] 2026-03-15 21:45 IST Wrote this ExecPlan before code edits.
- [x] 2026-03-15 22:02 IST Added `extensions/pompom-voice.ts` with
      persisted config, Kokoro and Deepgram engines, a bounded speech
      queue, native player detection, and TTS playback envelope state.
- [x] 2026-03-15 22:08 IST Patched `extensions/pompom.ts` and
      `extensions/pompom-extension.ts` to emit typed speech events, keep
      `say()` synchronous, share mouth animation with TTS playback, and
      add `/pompom:voice`.
- [x] 2026-03-15 22:15 IST Updated package metadata, changelog, repo
      temp-file ignore rules, and both handoff files.
- [x] 2026-03-15 22:17 IST Ran `pnpm typecheck`,
      `bunx tsc -p tsconfig.json --noEmit`, the `pi` smoke run, and
      export verification.
- [x] 2026-03-15 23:05 IST Reviewed the first-pass voice command flow
      against the current code and the Pi UI docs, then decided to keep
      `/pompom:voice on` zero-friction while moving manual choice into a
      guided `/pompom:voice setup` flow.
- [x] 2026-03-15 23:18 IST Updated `extensions/pompom-voice.ts`,
      `extensions/pompom-extension.ts`, package metadata, changelog, and
      handoff docs for frictionless onboarding, then reran `pnpm
      typecheck` and an explicit Pi smoke test with
      `pi -e ./extensions/pompom-extension.ts`.

## Surprises & Discoveries

- Observation: `pompomSetTalking()` currently clears the active speech
  bubble when talking starts.
  Evidence: `extensions/pompom.ts` sets `speechTimer = 0` inside
  `pompomSetTalking(active)`, which would hide a TTS bubble as soon as
  playback begins.

- Observation: the repository policy forbids runtime temp files in
  `/tmp`, but the requested audio playback design needs a transient WAV
  file for native player commands.
  Evidence: the repo `AGENTS.md` explicitly requires local `./tmp`
  instead, and `.gitignore` did not yet include that folder.

- Observation: the requested smoke run still prints an existing
  accessory load error when `~/.pi/pompom/accessories.json` does not
  exist, but the TUI stays alive and the new TTS changes do not crash
  Pi.
  Evidence: `timeout 10 pi --no-input -m "/pompom on" -m "/pompom pet"`
  exited with code `124` from the timeout wrapper after rendering the
  widget and handling both commands; the only stack trace was the older
  `ENOENT` from `loadAccessories()`.

- Observation: the current runtime fallback order does not match the
  stated "best available engine" goal once the preferred engine is
  missing.
  Evidence: `resolveEngine()` falls back in the hard-coded order
  Kokoro, Deepgram, ElevenLabs, so a saved or default cloud preference
  can still land on Kokoro before Deepgram.

## Decision Log

- Decision: keep the new TTS system in a separate module
  `extensions/pompom-voice.ts` and connect it through typed speech
  events rather than calling audio code from inside the renderer.
  Rationale: `say()` must remain synchronous, and the renderer should
  stay focused on visual state while the voice module owns queueing,
  config, synthesis, and playback.
  Date/Author: 2026-03-15 / Codex

- Decision: preserve backward compatibility for `pompomSay()` by adding
  the requested positional signature while still accepting the older
  object form used elsewhere in the extension.
  Rationale: the repo already calls `pompomSay({ text, duration })`, and
  the user explicitly asked for the full signature without breaking old
  behavior.
  Date/Author: 2026-03-15 / Codex

- Decision: stop clearing the speech bubble inside `pompomSetTalking()`.
  Rationale: TTS playback uses the same mouth animation flag as
  `pi-listen` recording, so clearing the bubble on every talking state
  change would hide the line that Pompom is currently speaking.
  Date/Author: 2026-03-15 / Codex

- Decision: treat `/pompom:voice on` as consent to auto-enable the best
  usable engine and reserve `ctx.ui.select()` for `/pompom:voice setup`.
  Rationale: the command itself is explicit intent, and adding a picker
  to the default path would add friction without solving a real
  ambiguity. Users who want control still have a dedicated guided path.
  Date/Author: 2026-03-15 / Codex

- Decision: persist whether voice has ever been configured and only show
  the session hint while that flag is false.
  Rationale: using only `enabled` is too weak because users who turned
  voice off, switched engines manually, or hit setup once would still
  look "unconfigured" to the current hint logic.
  Date/Author: 2026-03-15 / Codex

## Outcomes & Retrospective

The feature is implemented. Pompom now has an opt-in voice controller,
typed speech events, a dedicated `/pompom:voice` command, and mouth
animation that works for both live recording and queued TTS playback.
The main tradeoff is that runtime playback still depends on a native
audio player and, for Deepgram, an API key. That failure mode is handled
gracefully by leaving voice disabled or by silently skipping playback if
no player or engine is available.

The follow-up onboarding pass makes the feature discoverable instead of
expecting users to learn the engine setup sequence first. The remaining
goal for future work is only UX polish. This pass verified that the new
command flow typechecks, keeps earlier choices when possible, and
chooses a usable engine in the explicit smoke run.

## Context and Orientation

`extensions/pompom.ts` is the renderer and pet state machine. It owns
speech bubbles, mouth motion, weather reactions, keyboard-driven pet
actions, and most user-visible animation. Any new TTS hook must keep
`say()` synchronous because it is called throughout the physics loop and
interaction handlers.

`extensions/pompom-extension.ts` is the Pi extension entry point. It
creates the widget, polls `globalThis.__piListen` for recording state,
wires Pi lifecycle events, and exposes the `/pompom`, `/pompom:ask`,
and `/pompom:recap` commands. This is where the new voice module must be
initialized, where speech events must be forwarded into the TTS queue,
and where `/pompom:voice` must be registered.

`/Users/codex/Downloads/Code Files/pi-voice/extensions/voice.ts` is the
reference for command detection, native audio playback strategy, and the
shared `__piListen` audio-level pattern. The new TTS module only needs a
small subset of that behavior: command existence checks, player
selection, and a way to play a generated WAV buffer through a native
audio player.

## Plan of Work

First, create `extensions/pompom-voice.ts`. This file will define the
`SpeechEvent` and `VoiceConfig` types, load and save
`~/.pi/pompom/voice-config.json`, detect a native audio player, manage a
small speech queue, and provide two engines: Kokoro via a lazy
`kokoro-js` import, and Deepgram via a direct HTTPS request to the
speech API. The queue must stay bounded and priority-aware so ambient
commentary cannot pile up behind user actions.

Second, patch `extensions/pompom.ts`. Add the speech callback export,
extend `say()` with source and priority metadata, convert every existing
`say()` callsite to explicit categories, expose `pompomSetTalkAudioLevel`,
and keep the old `pompomSay({ text, duration })` form working alongside
the new positional form. While touching those callsites, replace any
non-ASCII speech text so the bubble and TTS stay consistent.

Third, patch `extensions/pompom-extension.ts`. Import the voice module,
initialize it on session start and session switch, forward speech events
into `enqueueSpeech()`, merge TTS playback into the mouth animation
poller, add `/pompom:voice`, show the one-time hint, and stop playback
plus clear the callback during shutdown.

Fourth, update repo metadata and living docs. Add `kokoro-js` as an
optional dependency in `package.json`, bump the package version, add a
new changelog entry, ignore `tmp/`, update both handoff files, and run
the requested verification commands.

## Concrete Steps

From `/Users/codex/Downloads/Code Files/pi-pompom`:

1. Create `docs/plans/2026-03-15-pompom-tts-voice.md`.
2. Add `extensions/pompom-voice.ts`.
3. Patch `extensions/pompom.ts`, `extensions/pompom-extension.ts`,
   `.gitignore`, `package.json`, `CHANGELOG.md`, `handoff.md`, and
   `HANDOFF.md`.
4. Run:

      pnpm typecheck
      bunx tsc -p tsconfig.json --noEmit
      timeout 10 pi --no-input -m "/pompom on" -m "/pompom pet"

5. Confirm the new exports exist with:

      rg -n "export function (initVoice|enqueueSpeech|getTTSAudioLevel|isPlayingTTS|setVoiceEnabled|setVoiceEngine|getVoiceConfig|speakTest|stopPlayback|pompomOnSpeech|pompomSetTalkAudioLevel)" extensions

## Validation and Acceptance

Acceptance is behavior, not just compilation. TypeScript passed with the
requested compiler command. The short Pi invocation completed without a
TTS-related crash when Pompom was enabled and petted; the `timeout`
wrapper ended the session after 10 seconds. After loading the extension
in an interactive Pi session, `/pompom:voice on` followed by
`/pompom:voice test` now either plays audio or fails gracefully with a
clear warning about a missing engine or API key.

The existing pet behavior must still work. `/pompom pet`, `/pompom hug`,
weather changes, accessory gifts, `/pompom:ask`, and `/pompom:recap`
must still show speech bubbles. Recording through `pi-listen` must still
move the mouth, and TTS playback must now move the mouth too.

## Idempotence and Recovery

The edits are additive and safe to reapply. The voice config lives in a
separate file under `~/.pi/pompom`, so disabling voice simply flips a
boolean and stopping playback clears the queue. The temporary playback
files are written under the repo `tmp/` directory and are deleted on
player close; if playback is interrupted, the close handler still
removes the file.

## Artifacts and Notes

Important external API references captured before implementation:

    kokoro.js/README.md
    - KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" })
    - const audio = await tts.generate(text, { voice: "af_sky" })
    - audio.save("audio.wav")

    Deepgram TTS REST docs
    - POST https://api.deepgram.com/v1/speak?model=...&encoding=linear16&container=wav
    - JSON body: { "text": "..." }

Verification evidence captured during implementation:

    pnpm typecheck
    bunx tsc -p tsconfig.json --noEmit
    rg -n "export function (...)" extensions

    timeout 10 pi --no-input -m "/pompom on" -m "/pompom pet"
    - rendered the Pompom widget
    - handled both commands
    - timed out after 10 seconds without a new crash

## Interfaces and Dependencies

At the end of this work, these exports must exist:

- `extensions/pompom-voice.ts`
  - `SpeechEvent`
  - `VoiceConfig`
  - `initVoice(isInteractive: boolean): void`
  - `enqueueSpeech(event: SpeechEvent): void`
  - `getTTSAudioLevel(): number`
  - `isPlayingTTS(): boolean`
  - `setVoiceEnabled(enabled: boolean): void`
  - `setVoiceEngine(engine: "kokoro" | "deepgram" | "elevenlabs"): void`
  - `getVoiceConfig(): VoiceConfig`
  - `hasVoiceBeenConfigured(): boolean`
  - `getVoiceAvailability(): Promise<VoiceAvailability>`
  - `autoDetectEngine(options?: { preferredEngine?: "kokoro" | "deepgram" | "elevenlabs" }): Promise<"kokoro" | "deepgram" | "elevenlabs" | null>`
  - `speakTest(): void`
  - `stopPlayback(): void`

- `extensions/pompom.ts`
  - `pompomOnSpeech(cb: ((event: SpeechEvent) => void) | null): void`
  - `pompomSetTalkAudioLevel(level: number): void`
  - `pompomSay(...)` with backward compatibility for the old object form

Plan revision note: 2026-03-15 23:05 IST. Expanded the original TTS
ExecPlan to cover frictionless voice onboarding after reviewing the new
voice code and the Pi `ctx.ui` helpers. This revision records the new
decision to keep `/pompom:voice on` automatic, add `/pompom:voice
setup`, and persist onboarding state separately from the enabled flag.

Revision note: created before implementation so the TTS work has a
living, self-contained plan in the format required by `PLANS.md`.

Revision note: updated after implementation and verification to record
the completed milestones, the existing accessory-file discovery, and the
final acceptance evidence.
