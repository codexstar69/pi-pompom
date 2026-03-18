---
title: Pi-Pompom Full Audit Report
description: End-to-end static audit of runtime risks, bugs, and polish gaps
  for pi-pompom on March 18, 2026.
prompt: |
  audit the entire code end to end and look for possible crash issues,
  bugs, flaws and unpolished code- build a complete audit report once
  done
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
  - @HANDOFF.md
---

# Pi-Pompom Full Audit Report

Date: 2026-03-18

## Scope

- Reviewed every shipped source file under `extensions/`.
- Ran `pnpm typecheck` from the package root.
- Did not run a live Pi CLI smoke test because this package depends on Pi
  peer packages and runtime behavior that are not available in isolation
  here.

## Verification

- `pnpm typecheck`: passed
- Test suite: none present

## Findings

### 1. High: ambient audio can enter a tight respawn loop on Linux ALSA-only setups

Files:
- `extensions/pompom-ambient.ts:147`
- `extensions/pompom-ambient.ts:248-251`
- `extensions/pompom-ambient.ts:279-291`

`generatedAudioPath()` always produces `.mp3` files. In the `aplay`
branch, `.mp3` playback is rejected and the code returns
`childProcess.spawn("true", [])` as a placeholder process. The close
handler treats exit code `0` as a normal loop boundary and immediately
spawns again.

Impact:
- Ambient audio never plays on Linux machines that only have `aplay`.
- The extension can churn through short-lived child processes forever.

Suggested fix:
- Do not spawn a placeholder success process.
- Detect unsupported formats before assigning `currentProcess`.
- Either transcode to WAV for `aplay`, or disable ambient with one clear
  warning.

### 2. High: `/pompom off` mutates persistent audio preferences instead of
temporarily muting

Files:
- `extensions/pompom-extension.ts:707-716`
- `extensions/pompom-extension.ts:720-729`
- `extensions/pompom-voice.ts:811-823`
- `extensions/pompom-ambient.ts:330-341`

`disablePompom()` calls `setVoiceEnabled(false)` and
`setAmbientEnabled(false)`. Both helpers persist that state to disk. When
the user later runs `/pompom on`, `enablePompom()` restores from the now
mutated config, so voice and ambient stay off. This also affects future
sessions because the config lives in `~/.pi/pompom/`.

Impact:
- `/pompom off` behaves like a preference change, not a temporary mute.
- The help text claiming "`/pompom on` restores everything" is false.

Suggested fix:
- Separate session mute state from saved user preferences.
- `disablePompom()` should stop playback/timers without overwriting the
  saved config.

### 3. High: the Pompom model picker is effectively broken

Files:
- `extensions/pompom-settings.ts:665-671`
- `extensions/pompom-extension.ts:551-556`
- `extensions/pompom-extension.ts:947-954`
- `extensions/pompom-extension.ts:1045-1056`
- `extensions/pompom-extension.ts:1882-1888`
- `extensions/pompom-voice.ts:30`

The settings panel stores model choices as `provider/id` for registry
objects, but `generateDynamicLine()` only looks up `m.id ===
pompomModelId`, so custom model selection will usually miss and fall back
to the main session model. On top of that, `/pompom:ask`,
`/pompom:recap`, and `/pompom:analyze` ignore `getPompomModel()`
entirely and always use `commandContext.model`, even though the config
comment says `pompomModel` is for those commands.

Impact:
- The visible model selector does not reliably affect runtime behavior.
- Users can believe they switched models when they did not.

Suggested fix:
- Normalize model IDs in one format.
- Route all Pompom AI commands through one shared model resolver that
  honors `getPompomModel()`.

### 4. Medium: stuck detection reports a failure streak from lifetime totals

Files:
- `extensions/pompom-agent.ts:660-666`

`detectStuck()` labels a situation as "`N recent tool failures`", but the
value comes from `state.counters.toolFailures`, which is the lifetime
failure count for the session, not a recent or consecutive streak. If the
last tool failed after many earlier failures, the warning can overstate
how bad the current loop is.

Impact:
- False-positive stuck alerts.
- Lower trust in `/pompom:stuck` and proactive commentary.

Suggested fix:
- Track a true recent failure window or consecutive failure streak.

### 5. Medium: `/pompom toggle` disables more than the view

Files:
- `extensions/pompom-extension.ts:601-631`
- `extensions/pompom-extension.ts:761-821`
- `extensions/pompom-extension.ts:1375-1402`
- `extensions/pompom-extension.ts:1963-1985`

The command text says toggle should hide the animation while keeping
voice and tracking alive. In practice, the hide path sets
`companionActive = false`, clears the voice/mic polling timer, pauses
ambient, and causes both scheduled AI speech and proactive stuck checks
to short-circuit because they gate on `companionActive`.

Impact:
- Hidden mode is not just visual hide; several behavioral features stop.
- The feature contract in help text is misleading.

Suggested fix:
- Split "widget visible" from "behavioral systems active".
- Keep tracking/commentary timers running when only the widget is hidden.

### 6. Medium: accessory persistence path is not portable on Windows

Files:
- `extensions/pompom-extension.ts:149-150`

Accessory persistence uses `path.join(process.env.HOME || "~", ...)`.
Node does not expand `~`, and `HOME` is commonly unset on Windows. In
that case the extension writes to a literal `~/.pi/...` path relative to
the working directory instead of the real home directory.

Impact:
- Accessory saves can disappear or land in the wrong folder.
- This conflicts with the package's advertised Windows support.

Suggested fix:
- Use `os.homedir()` consistently, like the other modules already do.

### 7. Low: weather transition blending still snapshots the new weather,
not the old frame

Files:
- `extensions/pompom.ts:736-751`

When weather changes, `prevWeatherColors` is assigned after the new
weather tint has already been applied. That means the blend starts from
the new weather colors instead of the previous frame, so the transition
can still pop rather than interpolate.

Impact:
- Mostly a polish issue, but visible in long sessions.

Suggested fix:
- Snapshot the previous rendered colors before applying the new weather
  tint.

## Overall Assessment

The package is in decent shape from a compile-time standpoint, but there
are still a few real runtime flaws:

- one strong Linux audio bug
- one strong state-persistence bug around `/pompom off`
- one broken model-selection path
- a few mid-level behavior mismatches and false positives

The first three items are the ones I would fix first.
