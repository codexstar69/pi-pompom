---
title: Pi-Pompom Re-Audit Report
description: Current-state full re-audit of the shipped runtime code on
  March 18, 2026 after the latest fixes.
prompt: |
  do a complete audit again of entire code
references:
  - @package.json
  - @tsconfig.json
  - @extensions/pompom-extension.ts
  - @extensions/pompom.ts
  - @extensions/pompom-agent.ts
  - @extensions/pompom-chat.ts
  - @extensions/pompom-settings.ts
  - @extensions/pompom-voice.ts
  - @extensions/pompom-ambient.ts
  - @extensions/pompom-instance.ts
  - @docs/2026-03-18-full-audit-report.md
  - @handoff.md
---

# Pi-Pompom Re-Audit Report

Date: 2026-03-18

## Scope

- Re-audited every shipped runtime file under `extensions/`.
- Re-checked the older audit findings against the current working tree.
- Verified compile health with `pnpm exec tsc -p tsconfig.json`.

## Verification

- `pnpm exec tsc -p tsconfig.json`: passed
- Automated tests: none present
- Live Pi CLI smoke test: not run in this isolated package environment

## Rechecked Fixed Issues

These previously reported bugs are fixed in the current code:

- `/pompom off` commentary leak
- widget restore regression after `/pompom toggle`
- AI command deadlock after API key lookup failure
- side-chat raw tool-result forwarding in `peek_main`
- session-switch seniority reset in `registerInstance()`
- import-time session-count mutation
- mic activation not aborting in-flight TTS synthesis
- generated ambient and generated SFX `.mp3` breakage on `aplay`

## Confirmed Remaining Findings

### 1. High: custom ambient files still break on ALSA-only Linux unless they are WAV

Files:

- `extensions/pompom-ambient.ts`

Relevant lines:

- `AUDIO_EXTENSIONS` still accepts `.mp3`, `.m4a`, `.wav`, `.aac`,
  `.aiff`, `.flac`, and `.ogg`.
- `isAmbientBlockedOnAplay()` only treats `.mp3` as unsupported.
- `startPlayback()` only blocks `.mp3` in the `aplay` branch.

Why this is still a bug:

- `resolveAudioPath()` prefers user custom audio over generated audio.
- On Linux systems that only have `aplay`, a user can still provide
  `clear.ogg`, `rain.m4a`, `snow.flac`, and other accepted formats.
- Those formats are not handled by `aplay`, but the guard only blocks
  `.mp3`.
- That leaves the extension retrying playback instead of cleanly
  falling back to the generated WAV file or marking the weather as
  blocked.

Impact:

- Custom ambient audio can fail on ALSA-only Linux even though the file
  extension is advertised as supported.
- The weather loop can keep retrying every ambient sync cycle and keep
  logging playback failures.

Suggested fix:

- Treat `aplay` as WAV-only for custom ambient files, not just
  `.mp3`-unsupported.
- If a custom file is not WAV, either skip it and fall back to the
  generated WAV file or mark that weather as blocked with one clear
  warning.

### 2. Medium: failed TTS playback still suppresses retries for 30 seconds

Files:

- `extensions/pompom-voice.ts`

Relevant lines:

- `processQueue()` sets `lastSpokenText` and `lastSpeakTime` before
  `playAudio()` completes.
- `enqueueSpeech()` drops any new event whose text matches
  `lastSpokenText` inside the next 30 seconds.

Why this is still a bug:

- If playback fails after synthesis succeeds, the code still records the
  line as the last spoken line.
- The next attempt with the same text is then rejected as a duplicate,
  even though no audible playback happened.

Impact:

- A transient player failure can mute the same reaction/commentary for
  30 seconds.
- Users can miss important spoken feedback after one bad playback
  attempt.

Suggested fix:

- Move the `lastSpokenText` and `lastSpeakTime` update to after
  successful playback, or only set them once `playAudio()` starts
  cleanly and no playback error occurs.

## Final State

- Full shipped runtime surface re-audited.
- Only the two issues above remain clearly verified from static review.
- No other earlier high-severity findings stayed reproducible in the
  current tree.

## Residual Risk

- This pass was static plus type-check only.
- There is still no automated test suite in the package.
- A live Pi CLI smoke test would be the best next check for audio,
  widget, and multi-terminal behavior.
