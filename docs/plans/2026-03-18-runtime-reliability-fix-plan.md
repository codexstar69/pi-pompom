---
title: Runtime Reliability Fix Plan
description: End-to-end ExecPlan to fix the consolidated March 18, 2026
  runtime, state, compatibility, and reliability bugs in pi-pompom.
prompt: |
  run a complete code audit for optimization, bugs, compatibility, issues and
  reliability

  High: demo state leaks across session switches because session_switch tears
  down voice/ambient/widget state but never stops the running demo timers. If
  /pompom demo is active, old weather overrides, accessories, and narration can
  bleed into the new session.

  High: agent state persistence is global per cwd, not per live terminal/session.
  In a multi-terminal same-repo setup, one instance can overwrite another and
  the next restore loads the wrong mood, active tools, and counters.

  High: primary-instance election trusts only processAlive(pid) and never checks
  heartbeat freshness. A hung but still-alive process can keep primary ownership
  forever.

  High: playAudio() returns successfully when no audio player is detected, and
  processQueue() then marks the line as spoken.

  High: stopPlayback() leaves stopRequested = true, and normal-priority speech
  never clears it.

  High: the talk override forces currentState = "idle", but the later idle branch
  immediately switches to fetching whenever a ball is present.

  High: the hat is instantiated with the sunglasses material while the dedicated
  hat shader is separate.

  Medium: /pompom pet|feed|... revives Pompom from fully-off mode by calling only
  showCompanion() and setupKeyHandler().

  Medium: side-chat tool results ignore isError and image-only or metadata-heavy
  results collapse to "(completed)".

  Medium: settings accessory persistence is optimistic and can fail silently.

  Medium: the contextual shortcut bar advertises keys that pompomKeypress() does
  not handle as shown.

  Low: session_shutdown plays session_goodbye on every instance.

  Low: the stuck-detection failure streak is not serialized.

  Low: /pompom:agents reports 100% success before any tool calls have happened.

  Also include the current audit findings:
  Windows still has no ambient/SFX backend, timed-out dynamic AI chatter does
  not cancel the underlying model call, session shutdown can cut off the goodbye
  SFX, and first-use SFX generation drops concurrent requests behind a single
  global generation lock.
references:
  - @package.json
  - @README.md
  - @handoff.md
  - @extensions/pompom-extension.ts
  - @extensions/pompom-agent.ts
  - @extensions/pompom-ambient.ts
  - @extensions/pompom-voice.ts
  - @extensions/pompom-chat.ts
  - @extensions/pompom-settings.ts
  - @extensions/pompom-instance.ts
  - @extensions/pompom.ts
  - @docs/2026-03-18-full-audit-report.md
  - @docs/2026-03-18-reaudit-report.md
---

# Runtime Reliability Fix Plan

Date: 2026-03-18

## Goal

Fix the current runtime bugs in one deliberate pass without regressing the
demo, multi-terminal coordination, audio behavior, or the public command/help
surface.

## Scope

This plan covers:

- demo lifecycle leaks
- multi-terminal state isolation and failover
- voice reliability and mute/retry state
- ambient/SFX reliability and platform behavior
- renderer/state-machine correctness
- side-chat correctness
- settings persistence correctness
- user-facing help/status mismatches

This plan does not include:

- large visual redesigns
- new features unrelated to the reported bugs
- database or network architecture changes

## Assumptions

- The current dirty worktree is the source of truth.
- `pnpm typecheck` remains the main fast verification step.
- There is still no reliable standalone automated runtime harness for Pi CLI,
  so the implementation must favor small, reviewable patches plus focused
  static validation.
- We should fix the runtime first, then align docs/help text after behavior is
  correct.

## Strategy

Use four ordered workstreams:

1. lifecycle and ownership
2. audio and speech correctness
3. renderer, chat, and settings correctness
4. UI/help/doc alignment

The key rule is to fix shared state before fixing surfaces that read that
state. That means multi-terminal ownership and session lifecycle first, then
voice/ambient, then UI overlays and shortcut/help mismatches.

## Parallel Execution Layout

To reduce merge conflicts, parallel work should use disjoint write scopes.

### Main thread

Files:

- `extensions/pompom-extension.ts`
- this plan doc

Ownership:

- session lifecycle and demo cleanup
- per-instance persisted state wiring
- full-off revival path
- goodbye gating and shutdown ordering
- integration of worker-side helpers

### Worker A: ownership and agent math

Files:

- `extensions/pompom-instance.ts`
- `extensions/pompom-agent.ts`

Ownership:

- heartbeat freshness
- instance persistence key helper
- stuck-streak serialization
- dashboard success-rate fix

### Worker B: voice reliability

Files:

- `extensions/pompom-voice.ts`

Ownership:

- playback failure truthfulness
- stop-latch recovery
- queue safety preservation

### Worker C: ambient and SFX reliability

Files:

- `extensions/pompom-ambient.ts`

Ownership:

- first-use SFX generation concurrency
- weather-loop versus one-shot SFX process behavior
- local platform behavior improvements

### Worker D: renderer and shortcut truthfulness

Files:

- `extensions/pompom.ts`

Ownership:

- talk-versus-ball state machine
- hat material fix
- contextual shortcut truthfulness inside the renderer/help surface

### Worker E: chat and settings correctness

Files:

- `extensions/pompom-chat.ts`
- `extensions/pompom-settings.ts`

Ownership:

- side-chat tool-result fidelity
- settings persistence honesty

### Merge order

1. Worker A
2. Main thread state wiring
3. Worker B
4. Worker C
5. Worker D
6. Worker E
7. final `pnpm typecheck`

This keeps the shared session lifecycle file last among the state changes and
avoids two agents editing `pompom-extension.ts` at once.

## Phase 1: Lifecycle And Ownership

### 1. Demo lifecycle hardening

Files:

- `extensions/pompom-extension.ts`

Changes:

- Stop the demo on `session_switch` before any other teardown continues.
- Clear all demo timers, overlay hints, weather overrides, accessory snapshots,
  and any demo-only voice state from a single helper.
- Make demo cleanup idempotent so it is safe from `session_shutdown`,
  `session_switch`, manual stop, and error paths.

Verification:

- Start demo, switch session, verify no old narration/weather/accessory state
  survives into the new session.
- Re-run `pnpm typecheck`.

### 2. Per-instance agent state persistence

Files:

- `extensions/pompom-extension.ts`
- `extensions/pompom-instance.ts`
- `extensions/pompom-agent.ts`

Changes:

- Stop storing agent state in one global `agent-state.json`.
- Persist per-instance state keyed by `instanceId`, with cwd and timestamp.
- Restore only the current instance's state on resume/switch.
- Add stale cleanup for old per-instance agent-state files.

Verification:

- Two terminals in the same repo should not overwrite each other’s mood,
  active tool state, or counters.
- `/pompom:agents` and `/pompom:stuck` should stay stable after switching.

### 3. Heartbeat freshness in primary election

Files:

- `extensions/pompom-instance.ts`

Changes:

- Treat entries with stale heartbeat timestamps as dead even if the PID still
  exists.
- Define a small liveness threshold based on heartbeat interval, for example
  `heartbeat <= interval * 3`.
- Reuse the same stale rule in both `getLiveInstances()` and stale cleanup.

Verification:

- A frozen old primary should no longer block audio ownership forever.
- Healthy secondaries should be able to take over primary responsibilities.

## Phase 2: Audio And Speech Correctness

### 4. Voice playback truthfulness

Files:

- `extensions/pompom-voice.ts`

Changes:

- Make `playAudio()` fail loudly when no player exists instead of returning a
  success-shaped resolved promise.
- Split `stopPlayback()` into:
  - one hard interrupt path that sets `stopRequested`
  - one reset path for normal lifecycle teardown that clears the stop latch
- Ensure normal commentary can resume after lifecycle resets and non-user
  interrupts.

Verification:

- No-player setups must not mark a line as spoken.
- After an interrupt, ordinary commentary should resume without waiting for a
  priority-3 event.

### 5. Dynamic AI speech cancellation

Files:

- `extensions/pompom-extension.ts`

Changes:

- Replace the bare `Promise.race` timeout with an abortable request path if the
  API supports it, or a generation token check that prevents stale completions
  from being accepted.
- Ensure timed-out dynamic chatter does not keep leaking background work.

Verification:

- Timed-out AI chatter should not update state or consume follow-up slots after
  cancellation.

### 6. Ambient/SFX shutdown and generation correctness

Files:

- `extensions/pompom-ambient.ts`
- `extensions/pompom-extension.ts`

Changes:

- Separate weather-loop process ownership from one-shot SFX ownership, or at
  minimum stop killing the goodbye SFX immediately during shutdown.
- Primary-gate `session_goodbye` the same way startup chimes are gated.
- Replace global `sfxGenerating` with per-sound in-flight tracking so one new
  SFX does not drop another.
- Decide the Windows policy clearly:
  - either add a Windows ambient/SFX backend
  - or downgrade docs/metadata so only voice is cross-platform

Verification:

- Goodbye audio should play once, not zero times and not multiple times.
- Concurrent first-use SFX requests should no longer vanish.
- Platform support claims must match runtime behavior.

## Phase 3: Renderer, Chat, And Settings Correctness

### 7. Talk-state and accessory render fixes

Files:

- `extensions/pompom.ts`

Changes:

- Prevent idle-fetch logic from overriding the active talk pose.
- Introduce an explicit talk-state guard or skip fetch transitions while
  `isTalking`.
- Change the hat objects to use the dedicated hat material instead of the
  sunglasses material.

Verification:

- A visible talk pose should survive when a ball is present.
- Hat rendering should use its intended shader/material.

### 8. Side-chat result fidelity

Files:

- `extensions/pompom-chat.ts`

Changes:

- Include `isError` in tool-result summaries.
- Improve formatting so image-only and metadata-heavy tool results produce a
  truthful summary instead of `(completed)`.
- Keep redaction intact while expanding the summary format.

Verification:

- Failed tool results must look like failures.
- Non-text outputs should still show meaningful transcript entries.

### 9. Settings persistence honesty

Files:

- `extensions/pompom-settings.ts`
- `extensions/pompom-extension.ts`

Changes:

- Stop showing unconditional success before persistence completes.
- Either await persistence before showing success, or show a pending message
  with rollback/error handling if persistence fails.

Verification:

- A failed accessory save should be visible immediately and not only after
  restart.

## Phase 4: UI And Status Alignment

### 10. Full-off revival path

Files:

- `extensions/pompom-extension.ts`

Changes:

- Route `/pompom pet|feed|...` revival through the same enable helper used by
  `/pompom on`.
- Do not partially revive the widget without ambient sync and AI speech timers.

Verification:

- Action commands from fully-off mode should restore the whole companion
  system, not just visuals.

### 11. Contextual shortcut truthfulness

Files:

- `extensions/pompom.ts`
- `extensions/pompom-extension.ts`
- `extensions/pompom-settings.ts`
- `README.md`

Changes:

- Align displayed shortcut keys with actual `pompomKeypress()` mappings.
- Decide whether to change the UI labels to current bindings or add alias
  support so shown keys work as advertised.

Verification:

- Every visible shortcut in the shortcut bar and settings panel must work.

### 12. Small user-facing status fixes

Files:

- `extensions/pompom-agent.ts`

Changes:

- Serialize and restore the recent failure streak used by stuck detection.
- Change the pre-tool-call success rate from `100%` to a neutral value such as
  `n/a` or `0 tool calls yet`.

Verification:

- Restored stuck detection should retain its signal.
- `/pompom:agents` should not claim false 100% success on an empty session.

## Recommended Implementation Order

1. `pompom-instance.ts`
2. `pompom-agent.ts`
3. `pompom-extension.ts` lifecycle changes
4. `pompom-voice.ts`
5. `pompom-ambient.ts`
6. `pompom.ts`
7. `pompom-chat.ts`
8. `pompom-settings.ts`
9. docs/help alignment

This order reduces churn because the later files mostly consume state owned by
the earlier files.

## Verification Plan

After each file group:

- run `pnpm typecheck`

Manual behavior checks after the full pass:

1. Start `/pompom demo`, then switch session.
2. Run two terminals in the same repo and verify primary failover.
3. Disable audio player availability and verify voice does not report false
   playback.
4. Trigger `stopPlayback()` paths and confirm commentary resumes.
5. Throw a ball while speaking and verify the talk pose wins.
6. Check hat visuals.
7. Open side chat and inspect failed and non-text tool outputs.
8. Grant an accessory from settings and confirm persistence failure is visible.
9. Use contextual shortcuts shown in the UI and confirm they match behavior.
10. Check `/pompom:agents` before any tool call and after failures/restores.

## Risks

- Multi-instance changes can introduce new ownership regressions if heartbeat
  rules and state-file cleanup are not kept simple.
- Voice and ambient both have lifecycle code in multiple places, so partial
  fixes can create new mute or double-audio bugs.
- Shortcut/help fixes can drift again unless one canonical mapping is shared.

## Done Criteria

The work is done when:

- all listed high-severity bugs are fixed
- medium bugs are fixed or explicitly downgraded with code evidence
- docs/help text matches behavior
- `pnpm typecheck` passes after each major phase and at the end
- `handoff.md` is updated with the completed work and remaining risk
