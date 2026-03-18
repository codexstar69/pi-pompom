---
title: Helper Lifecycle And Audio Fix Plan
description: ExecPlan for the verified March 18, 2026 lifecycle, helper
  command, accessory persistence, and audio-volume bugs in pi-pompom.
prompt: |
  High: /pompom off and hidden-mode pause do not clear the mood-SFX layer, so
  hungry/tired one-shots can keep firing after Pompom is supposedly muted or
  hidden.

  High: session teardown does not cancel in-flight AI helper commands, and it
  does not clear aiCommandInProgress.

  Medium: /pompom give <item> is still optimistic about persistence.

  Medium: the AI helper context builder drops all toolResult messages and
  rescans the full branch every time.

  Medium: voice volume is not honored consistently across playback backends.

  Reaudit these bugs for authenticity and genuineness, then build a complete
  parallel plan and fix them all.
references:
  - @package.json
  - @handoff.md
  - @extensions/pompom-extension.ts
  - @extensions/pompom-ambient.ts
  - @extensions/pompom-voice.ts
  - @extensions/pompom-settings.ts
  - @docs/plans/2026-03-18-runtime-reliability-fix-plan.md
---

# Helper Lifecycle And Audio Fix Plan

Date: 2026-03-18

## Verified Bugs

- Hidden and off modes leave the mood-SFX layer able to re-arm itself after
  ambient playback is paused.
- `/pompom:ask`, `/pompom:recap`, and `/pompom:analyze` have no shared abort
  path, so old requests can outlive the session and keep the helper lock stuck.
- Accessory grant commands report success before persistence is confirmed.
- Helper-context collection skips tool results and linearly scans the whole
  branch on every call.
- Voice and ambient volume handling are inconsistent on software-only playback
  backends, especially PowerShell, and demo playback bypasses the gain path.
- The current `AbortSignal.any()` use requires Node 18.17+, so the published
  engine range should match that runtime reality.

## Scope

This plan fixes only the verified bugs above. It does not redesign Pi session
architecture, add new features, or create a new test harness.

## Assumptions

- The current dirty worktree is the source of truth.
- `pnpm typecheck` is the fastest reliable verification step in this package.
- This package still has no existing automated test file for these modules, so
  the implementation will rely on static validation and tightly scoped code
  changes instead of adding new tests against repo guidance.

## Parallel Workstreams

These workstreams are intentionally disjoint so they can be reasoned about in
parallel even when implemented serially in one branch.

### Workstream A: lifecycle and helper ownership

Files:

- `extensions/pompom-extension.ts`

Ownership:

- helper-command abort state
- session shutdown and session switch cleanup
- helper-context collection
- accessory command persistence honesty

### Workstream B: ambient and mood-SFX gating

Files:

- `extensions/pompom-ambient.ts`

Ownership:

- mood-SFX mute state
- hidden/off pause semantics
- PowerShell ambient and SFX software gain

### Workstream C: voice playback consistency

Files:

- `extensions/pompom-voice.ts`
- `package.json`

Ownership:

- software gain for PowerShell-backed TTS
- demo playback volume parity
- engine-range alignment with runtime APIs

## Implementation Order

1. Fix shared helper-command lifetime state in `pompom-extension.ts`.
2. Fix mood-SFX suppression semantics in `pompom-ambient.ts`.
3. Fix accessory persistence honesty and helper-context collection in
   `pompom-extension.ts`.
4. Fix software-gain playback paths in `pompom-ambient.ts` and
   `pompom-voice.ts`.
5. Align `package.json` engine range with the real runtime requirement.
6. Run `pnpm typecheck`.
7. Update `handoff.md` with the new status.

## Verification Plan

- `pnpm typecheck`
- manual code-path verification against:
  - hidden/off mood-SFX scheduling
  - session shutdown and session switch abort/reset behavior
  - accessory save result handling
  - helper-context inclusion of tool results
  - software-gain playback paths on PowerShell and demo playback
