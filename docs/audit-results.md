# Pi-Pompom Full Audit Results — 10 Agent Parallel Audit

**Date:** 2026-03-17
**Version audited:** 6.1.3 → fixed in 6.2.0 + 6.2.1
**Audit scope:** All 7 extension files
**Agents deployed:** 10 (7 code reviewers + silent failure hunter + type analyzer + cross-module integration)

## Summary

- **20 bugs found** across 7 files
- **16 fixed** in v6.2.0 and v6.2.1
- **3 skipped** (by design — afplay limitation, risk > benefit, not practical)
- **1 already fixed** (duplicate finding)
- **32 silent failure issues** found — 7 critical logging fixes applied
- **10 type safety improvements** recommended (not applied — non-breaking)

## Fixed Bugs

### v6.2.0 (12 bugs)

| ID | File | Bug | Confidence | Fix |
|----|------|-----|------------|-----|
| B1 | pompom-extension.ts | `aiCommandInProgress` stuck after model check fail in /pompom:ask | 100 | Added reset before early returns |
| B2 | pompom-extension.ts | Same leak in /pompom:recap — 3 unguarded early exits | 100 | Added reset before early returns |
| B3 | pompom-extension.ts | toggleWidget re-show fails — showCompanion guard | 95 | Set companionActive=false on hide |
| A4-skip | pompom-agent.ts | lastBucketAt not serialized | 92 | Skipped — risk > benefit |
| D1 | pompom-chat.ts | syncMessages destroys local help messages | 90 | Added localMessages array |
| A1 | pompom-ambient.ts | pregenerateSfx stomps sfxGenerating flag | 90 | Added sfxGenerating guard |
| C1 | pompom-voice.ts | Null engine drains queue without circuit-breaker | 88 | Added consecutiveFailures + break |
| B4 | pompom-extension.ts | pulseOverlayTimer not cleared on shutdown/switch | 85 | Added clearTimeout in both handlers |
| A2 | pompom-ambient.ts | afplay error kills ambient loop permanently | 85 | Added 2s retry on error |
| A5 | pompom-agent.ts | Dead recentSuccesses + lifetime totals | 85 | Removed dead var, renamed |
| D2 | pompom-chat.ts | Dead "voice on/off" branches | 83 | Removed dead code |
| A3-skip | pompom-ambient.ts | duck/unduck restarts from byte 0 | 82 | Skipped — afplay limitation |
| C2 | pompom-voice.ts | playAudio swallows errors | 82 | Re-throw to processQueue |
| C3 | pompom-voice.ts | stopPlayback race — child after stop | 80 | Added stopRequested check |
| A6 | pompom-agent.ts | activeToolCalls entries leak | 80 | Added sweep fallback |

### v6.2.1 (4 bugs + 7 logging fixes)

| ID | File | Bug | Confidence | Fix |
|----|------|-----|------------|-----|
| F1 | pompom.ts | Storm accessory setTimeout no weather guard | 85 | Added weatherState check |
| F2 | pompom.ts | resetPompom triggers spurious weather announcement | 92 | Reset weatherState + lastAnnouncedWeatherState |
| F3 | pompom.ts | isFlipping never cleared on state interruption | 88 | Clear isFlipping on non-flip keypress |
| F4 | pompom.ts | Rain announcement missing emotion tag | 82 | Added [curious] tag |

### Logging Improvements (7)

| File | Location | Change |
|------|----------|--------|
| pompom-ambient.ts | generateSfx HTTP check | Now logs HTTP status + body |
| pompom-ambient.ts | generateSfx catch | Now logs error message |
| pompom-ambient.ts | SFX playback error handler | Now logs error |
| pompom-extension.ts | persistAgentState | Now logs error |
| pompom-extension.ts | Chat shortcut registration | Now logs error |
| pompom-extension.ts | syncAmbientWeather | Now logs error |
| pompom-settings.ts | Model list loading | Now logs error |

## Skipped (by design)

| ID | File | Bug | Reason |
|----|------|-----|--------|
| A3 | pompom-ambient.ts | duck/unduck restarts track | afplay has no runtime volume control — no fix possible |
| A4 | pompom-agent.ts | lastBucketAt not serialized | Changing serialization format risks breaking existing saved state |
| D3 | pompom-chat.ts | Scroll cap at 200 | Not a practical issue for most chat sessions |

## Type Safety Recommendations (not applied — low risk, future improvement)

1. `SINGING_REPERTOIRE.allowedStates: string[]` → `EmotionalState[]`
2. `Particle.type: string` → `ParticleType` union
3. `emitSfx(name: string)` → `SfxName`
4. `pompomSetAgentMood(mood: string)` → `AgentMood`
5. `pompomGiveAccessory(item: string)` → `AccessoryName`
6. `SpeechEvent.priority: number` → `1 | 2 | 3`
7. Export `WEATHERS` const array, derive `Weather` from it
8. Centralize state transitions via `setState()`
9. Fix `getWeatherAndTime()` return type to eliminate `as any` casts
10. `accessoryAsked: Record<string, boolean>` → `Partial<Record<keyof Accessories, boolean>>`

## Silent Failure Audit Summary (32 issues found)

- 6 CRITICAL (bare catches hiding important errors) — **all 6 fixed with logging**
- 10 HIGH (fire-and-forget promises, interval catches) — **1 fixed** (syncAmbientWeather), rest are acceptable fire-and-forget patterns
- 16 MEDIUM (temp file cleanup, process kills, etc.) — acceptable as-is

## Cross-Module Integration Issues

1. `setTimeout` calls in `updatePhysics()` for accessory announcements never cleared on shutdown — safe due to null guard in `say()`, but technically a timer leak
2. SFX generation blocked globally by single `sfxGenerating` flag — requests during generation silently dropped (fixed with guard in pregenerateSfx)
3. Weather override vs ambient weather interaction — verified working correctly
4. `/pompom off` → `/pompom:chat` path — verified chat works independently of enabled flag

## Verification Request for Codex

Please verify:
1. All 16 fixes are correctly applied (git diff from v6.1.3 to v6.2.1)
2. No regressions introduced (typecheck passes, no broken exports)
3. The 3 skipped bugs are genuinely not worth fixing
4. The type safety improvements are safe to defer
5. Any bugs we may have missed
</content>
</invoke>