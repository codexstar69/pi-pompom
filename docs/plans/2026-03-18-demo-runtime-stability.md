---
title: Demo Runtime Stability Plan
description: >
  End-to-end fix plan for the 2026-03-18 demo, weather, ambient, voice,
  and side-chat runtime regressions.
prompt: |
  build a complete end to end plan and fix it all
references:
  - @package.json
  - @CHANGELOG.md
  - @handoff.md
  - @extensions/pompom.ts
  - @extensions/pompom-extension.ts
  - @extensions/pompom-ambient.ts
  - @extensions/pompom-voice.ts
  - @extensions/pompom-chat.ts
  - @extensions/pompom-footer.ts
  - @docs/2026-03-18-reaudit-report.md
---

# Demo Runtime Stability Plan

## Goal

Make the public demo feel correct end to end:

- weather changes must visibly transition
- snow and scarf beats must read clearly
- nap must actually animate before narration
- hide/off/session changes must fully stop stale voice and ambient state
- side chat must stay safe and smooth under load

## Execution Plan

1. Stabilize core render-state handoffs in @extensions/pompom.ts.
   - keep demo weather overrides from being overwritten by the natural warmup
   - move weather blending to time-based decay
   - split clear-weather accessory timers from active-weather reactions
   - preserve sleep state while talking and hard-cap particle growth

2. Fix orchestration in @extensions/pompom-extension.ts.
   - snapshot and restore demo accessories
   - sequence nap so sleep begins before the line plays
   - transition demo weather beats with explicit blend durations
   - clear stale mic/talking state on hide, disable, shutdown, and switch

3. Harden audio in @extensions/pompom-ambient.ts and
   @extensions/pompom-voice.ts.
   - fall back to generated WAV on ALSA when custom files are not playable
   - track retry timers so pause/off does not restart audio later
   - treat non-zero voice player exits as failures
   - avoid marking interrupted lines as spoken
   - apply real gain scaling for `aplay`

4. Smooth side surfaces in @extensions/pompom-chat.ts and
   @extensions/pompom-footer.ts.
   - redact tool output consistently in `peek_main` and synced transcripts
   - cache wrapped chat lines so spinner frames do not rewrap the full history
   - memoize footer cost totals for steady render speed

5. Verify with `pnpm typecheck` and record the release in
   @CHANGELOG.md and @handoff.md.

## Result

Completed on 2026-03-18 with `pnpm typecheck` passing.
