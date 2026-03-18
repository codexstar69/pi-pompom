---
title: Pi-Pompom Re-Audit Report
description: Fresh full-package re-audit after fixes, focused on remaining
  runtime bugs and regressions after additional feature work.
prompt: |
  can you reaudit entire code? we added a few more features
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

- Re-ran a full static audit across all `extensions/*.ts` files.
- Re-checked the previously reported high-severity areas after the recent
  fixes.
- Re-audited the new feature work, including the recent sound design and
  ambient updates in `extensions/pompom.ts`.
- Ran `pnpm typecheck`.

## Verification

- `pnpm typecheck`: passed
- Automated tests: none present
- Live Pi CLI smoke test: not run in this isolated package environment

## Previously Reported Issues Rechecked

- Fixed: Linux ambient no longer uses `spawn("true")` in the `aplay`
  branch.
- Fixed: accessory persistence no longer uses `process.env.HOME || "~"`.
- Fixed: stuck detection now uses a consecutive recent failure counter.
- Fixed: Pompom model resolution now attempts both `id` and
  `provider/id`, and the main AI commands now use the shared resolver.

## Additional Whole-Repo Pass

- Re-scanned all shipped source files after the first re-audit write-up.
- Re-checked the newer runtime-heavy files that changed around the added
  features, especially:
  - `extensions/pompom.ts`
  - `extensions/pompom-extension.ts`
  - `extensions/pompom-ambient.ts`
  - `extensions/pompom-chat.ts`
  - `extensions/pompom-settings.ts`
  - `extensions/pompom-voice.ts`
  - `extensions/pompom-instance.ts`
- No extra verified findings were discovered from the newly added
  features beyond the three still-open findings listed below.

## Remaining Findings

### 1. High: `/pompom off` still allows speech commentary to reach the live TTS queue

Files:
- `extensions/pompom-extension.ts:504-515`
- `extensions/pompom-extension.ts:721-731`
- `extensions/pompom-extension.ts:1143-1148`
- `extensions/pompom-extension.ts:1245-1315`
- `extensions/pompom-voice.ts:707-710`

`disablePompom()` now avoids persisting `enabled=false`, which fixes the
saved-preference bug, but it also means `config.enabled` in
`pompom-voice.ts` stays true. The session keeps the `pompomOnSpeech`
callback registered, and agent lifecycle handlers still call
`speakCommentary()` even while Pompom is off. `enqueueSpeech()` only
checks the voice config, not the extension's `enabled` flag.

Impact:
- `/pompom off` can still speak agent commentary if voice was enabled in
  config.
- "Everything off" is still false in practice.

Suggested fix:
- Add an extension-level gate before `enqueueSpeech()` or inside
  `speakCommentary()`.
- Keep the non-persistent preference fix, but also add a live session mute
  state.

### 2. High: the new toggle-widget fix introduces a restore regression

Files:
- `extensions/pompom-extension.ts:762-787`
- `extensions/pompom-extension.ts:1391-1414`

The hide path now keeps `companionActive = true`, but the restore path
still calls `showCompanion()`, and `showCompanion()` immediately returns
when `companionActive` is already true.

That means:
- first `toggle` hides the widget and stops the render loop
- second `toggle` sets `widgetVisible = true`
- `showCompanion()` bails out
- the widget is not recreated

Impact:
- `Alt+V` or `/pompom toggle` can hide the widget permanently until a
  larger session reset path runs.

Suggested fix:
- Split "behavior active" from "widget mounted", or
- make the restore branch recreate the widget even when
  `companionActive` is already true.

### 3. Medium: ALSA-only ambient fallback will still retry and log forever every 5 seconds

Files:
- `extensions/pompom-ambient.ts:248-251`
- `extensions/pompom-ambient.ts:353-382`
- `extensions/pompom-extension.ts:685-693`

The tight child-process loop is fixed, but on Linux systems with only
`aplay`, generated ambient audio is still `.mp3`, `startPlayback()`
returns `null`, `currentProcess` stays empty, and `syncAmbientWeather()`
keeps calling `setAmbientWeather(weather)` because `!isAmbientPlaying()`
remains true.

Impact:
- No ambient audio on ALSA-only systems.
- Repeated unsupported-format logs every poll cycle.

Suggested fix:
- Cache an unsupported-state flag per weather/player combination, or
- transcode generated ambient to WAV before trying `aplay`.

## Overall Assessment

The last round fixed real issues, but the package is not fully clean yet.

Current status:
- previous core findings mostly resolved
- two high-severity behavioral bugs remain
- one medium Linux fallback issue still causes noisy retries

If I were prioritizing fixes, I would do them in this order:

1. `/pompom off` live mute gate
2. widget restore regression in `toggleWidget()`
3. ALSA ambient unsupported-format retry suppression
