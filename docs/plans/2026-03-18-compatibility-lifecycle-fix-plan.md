---
title: Compatibility and Lifecycle Fix Plan
description: Combined ExecPlan for the validated Node ESM, side-chat
  lifecycle, delayed hint timer, and Windows path portability issues in
  pi-pompom.
prompt: |
  . High: demo-audio path resolution is not Node ESM compatible. The
  package declares "type": "module", but /Users/codex/Downloads/
  Code%20Files/pi-pompom/extensions/pompom-voice.ts:1033 still uses
  __dirname. I verified locally that node --input-type=module -e
  "console.log(typeof __dirname)" returns undefined. On a Node ESM host,
  importing this module can fail before demo audio features load.

  2. Medium: side chat can outlive session cleanup. Session cleanup only
  nulls chat refs in /Users/codex/Downloads/Code%20Files/pi-pompom/
  extensions/pompom-extension.ts:849, /Users/codex/Downloads/Code%20Files/
  pi-pompom/extensions/pompom-extension.ts:1580, and
  /Users/codex/Downloads/Code%20Files/pi-pompom/extensions/
  pompom-extension.ts:1614, but the actual overlay/agent teardown only
  happens in /Users/codex/Downloads/Code%20Files/pi-pompom/extensions/
  pompom-chat.ts:598 and is only wired from /Users/codex/Downloads/
  Code%20Files/pi-pompom/extensions/pompom-extension.ts:2869. If a session
  switches or shuts down while chat is open, the overlay agent and spinner
  can leak past session lifetime.

  3. Medium: delayed onboarding hints are not tracked or canceled.
  /Users/codex/Downloads/Code%20Files/pi-pompom/extensions/
  pompom-extension.ts:873 and /Users/codex/Downloads/Code%20Files/
  pi-pompom/extensions/pompom-extension.ts:993 schedule raw setTimeout
  notifications, but cleanup in /Users/codex/Downloads/Code%20Files/
  pi-pompom/extensions/pompom-extension.ts:849 never clears them. That can
  surface hints in the wrong session, or fire after shutdown against a
  stale UI context.

  4. Low: Windows path handling is still partially Unix-only.
  /Users/codex/Downloads/Code%20Files/pi-pompom/extensions/
  pompom-extension.ts:745, /Users/codex/Downloads/Code%20Files/pi-pompom/
  extensions/pompom-footer.ts:143, and /Users/codex/Downloads/Code%20Files/
  pi-pompom/extensions/pompom-settings.ts:631 assume / separators or HOME.
  This will not usually crash, but footer/settings labels and AI prompt
  path summaries degrade on Windows despite the package advertising Windows
  support. validate these issues as well and build a combined plan to fix
  them all
references:
  - @package.json
  - @extensions/pompom-voice.ts
  - @extensions/pompom-extension.ts
  - @extensions/pompom-chat.ts
  - @extensions/pompom-footer.ts
  - @extensions/pompom-settings.ts
  - @handoff.md
---

# Combined ExecPlan

Date: 2026-03-18

## Validation Summary

1. Node ESM demo-audio path bug: confirmed.
2. Side-chat lifecycle leak on session cleanup: confirmed from local code
   ownership, with medium confidence because the Pi host may also close the
   overlay, but this extension does not do so itself.
3. Delayed onboarding hint timer leak: confirmed.
4. Windows path portability gap: confirmed.

## Goal

Fix the validated compatibility and lifecycle issues without changing
Pompom's user-visible feature set, except to make cleanup and cross-platform
behavior more reliable.

## Constraints

- Keep changes small and local.
- Do not change persisted config formats.
- Do not depend on Pi host behavior for cleanup.
- Preserve current demo-audio shipped assets and existing cache behavior.
- Verify with fast package-level checks only: `pnpm typecheck`,
  `pnpm pack --dry-run`, and targeted Bun runtime smoke checks.

## Workstreams

### 1. Node ESM-safe demo audio path

Files:
- `extensions/pompom-voice.ts`

Plan:
- Replace `__dirname` usage with an ESM-safe path derived from
  `import.meta.url`.
- Keep the resolved directory pointing at the shipped `demo-audio/`
  directory one level above the module file.
- Avoid changing the public voice API.

Verification:
- `bun -e "await import('./extensions/pompom-voice.ts')"`
- `pnpm typecheck`

### 2. Explicit side-chat teardown on session cleanup

Files:
- `extensions/pompom-extension.ts`
- `extensions/pompom-chat.ts` only if a small public close/dispose handle is
  needed

Plan:
- Stop treating `chatOverlayRef = null` and `chatOverlayHandle = null` as
  cleanup.
- Add one extension-owned close path that:
  - restores editor interception
  - disposes the overlay instance if it exists
  - clears refs only after disposal
- Use that path from:
  - `cleanupSessionUiState()`
  - `session_shutdown`
  - `session_switch`
- Keep the existing `onClose` behavior working so user-driven close still
  follows the same cleanup path.

Verification:
- `bun -e "await import('./extensions/pompom-extension.ts')"`
- targeted static read to ensure no duplicate cleanup loops
- `pnpm typecheck`

### 3. Track and cancel delayed onboarding hints

Files:
- `extensions/pompom-extension.ts`

Plan:
- Replace raw fire-and-forget hint `setTimeout` calls with tracked timer
  refs.
- Add a small helper for scheduling one-shot session-scoped hints.
- Clear those timers from `cleanupSessionUiState()`.
- Guard the callback with current session state so hints do not show if the
  session already changed.

Verification:
- `pnpm typecheck`
- code read to confirm both voice and ambient hint paths use the tracked
  helper

### 4. Windows-safe path display helpers

Files:
- `extensions/pompom-extension.ts`
- `extensions/pompom-footer.ts`
- `extensions/pompom-settings.ts`

Plan:
- Stop using `process.env.HOME` and string `split("/")` for display paths.
- Use `os.homedir()` and `path.basename()` where the goal is just a label.
- Keep the change display-only; no persistence path changes are needed here.
- Prefer one small shared helper in `pompom-extension.ts` only if multiple
  call sites clearly benefit. Otherwise keep each fix local.

Verification:
- `pnpm typecheck`
- targeted Bun sanity read if needed for helper imports

## Execution Order

1. Fix Node ESM demo path first because it is the only high-severity import
   risk.
2. Fix side-chat teardown next because it is the highest lifecycle risk.
3. Fold hint timer tracking into the same extension cleanup pass.
4. Finish with Windows display-path cleanup.
5. Run final verification:
   - `pnpm typecheck`
   - `pnpm pack --dry-run`
   - Bun runtime imports for `pompom-voice`, `pompom-extension`, and
     `pompom-chat`
   - lightweight render sanity for `renderPompom(80, 0, 0.016)`

## Expected Result

- No `__dirname` dependency remains in the ESM package.
- Side chat cannot outlive session teardown due to extension-owned disposal.
- Delayed onboarding hints do not bleed into the next session.
- Windows users get sensible path labels in footer, settings, and dynamic
  context text.
