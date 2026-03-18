# pompom.ts Code Audit — Bug & Flaw Report

**File:** `extensions/pompom.ts` (2584 lines)  
**Date:** 2026-03-17  
**Auditor:** Automated deep analysis

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 5 |
| Medium | 9 |
| Low | 6 |
| **Total** | **22** |

---

## Critical

### 1. CRITICAL — Stale exported constant `POMPOM_HEIGHT` (Line 2564)

`POMPOM_HEIGHT` is computed once at module load as `H + 1` (14). But `H` is mutated dynamically inside `renderPompom()` (line 2069). Any consumer using the exported constant gets a stale value; only `pompomHeight()` returns the live value.

```ts
// Line 2564
export const POMPOM_HEIGHT = H + 1;
// Line 2069 — H is recalculated:
// H = Math.max(10, Math.min(14, Math.floor(W * 0.18)));
```

**Impact:** Layout calculations that rely on `POMPOM_HEIGHT` will be wrong after the first resize, causing clipping or overflow.  
**Fix:** Remove the exported constant entirely; the deprecation comment exists but the export is still live.

---

### 2. CRITICAL — Potential division by zero in sky color interpolation (Line 660)

```ts
const factor = (hour - h1) / (h2 - h1);
```

If keyframes land on the same hour (e.g., both entries at h=22 after the `+ 24` wrap logic), `h2 - h1` is 0, producing `Infinity`/`NaN` that propagates to all sky color calculations and eventually to `Math.floor(NaN)` → `NaN` → broken ANSI escape codes.

The wrap-around logic (lines 640–657) can also fail to enter any `if`/`else if` branch for `hour` values in range `[0, 4)` when `h1` remains at `keyframes[last].h - 24 = -2` and `h2 = 4.0`. The computed `factor` works out here, but the edge is fragile.

**Impact:** Terminal rendering garbage (NaN in color codes) at specific hours.  
**Fix:** Guard with `const factor = (h2 === h1) ? 0 : (hour - h1) / (h2 - h1);`

---

## High

### 3. HIGH — Non-null assertions on `.find()` can crash (Lines 1219-1224)

```ts
const eL = objects.find(o => o.id === "earL")!;
const eR = objects.find(o => o.id === "earR")!;
const pL = objects.find(o => o.id === "pawL")!;
const pR = objects.find(o => o.id === "pawR")!;
```

These are inside `buildObjects()` and are only reached when `isSleeping` is true. The objects are pushed unconditionally a few lines above, so currently safe. However, if `buildObjects()` is ever refactored to conditionally push body parts, these assertions will throw `TypeError: Cannot read properties of undefined`.

**Impact:** Runtime crash if object list changes.  
**Fix:** Add null guards: `if (eL) { eL.rot = 1.3; ... }`

---

### 4. HIGH — `weatherAccessoryTimers` grows unboundedly (Lines 365, 1583-1607)

Every weather transition that triggers an accessory hint pushes a `setTimeout` handle. `clearTimeout` is only called in `resetPompom()`. In a long-running session with many weather cycles, the array accumulates handles indefinitely.

```ts
const weatherAccessoryTimers: ReturnType<typeof setTimeout>[] = [];
// Line 1583+
weatherAccessoryTimers.push(handle);
// Only cleared in resetPompom() — line 2489
```

**Impact:** Unbounded memory growth. After 100+ weather transitions, hundreds of stale handles accumulate.  
**Fix:** After `setTimeout` fires, remove the handle from the array. Or better, use a single pending handle per accessory type.

---

### 5. HIGH — Race condition: `resolveEmotionalState` uses `Math.random()` for state transitions (Line 1312)

```ts
if (Math.random() < 0.05) {
    playfulUntil = now + 60000 + Math.random() * 60000;
    return "playful";
}
```

This runs every second (inside the 1-second needs tick). The 5% per-second roll means ~95% chance of entering "playful" within 60 seconds of being in the happy state. Once playful, the sticky timer means it stays for 60-120s. This creates a state machine that is effectively stuck oscillating between "happy" and "playful" for well-fed pets, reducing speech variety.

**Impact:** Emotional state system becomes repetitive — pet is "playful" far more than intended.  
**Fix:** Reduce probability or add a cooldown after playful ends.

---

### 6. HIGH — Module-level state makes this a singleton (entire file)

All state (hunger, energy, posX, posY, weatherState, etc.) is stored in module-level `let` variables. If this module is ever imported by two different consumers in the same process, they share state silently.

```ts
// Lines 15-16
let W = 50;
let H = 13;
// Lines 356-404 — 30+ module-level let variables
```

**Impact:** Cannot have multiple Pompom instances; any future use in a test harness with parallel tests will cause flaky state corruption.  
**Fix:** Encapsulate state in a class or factory function. (Low urgency if singleton is the design intent.)

---

### 7. HIGH — `gameStars` splice-in-reverse-loop has a subtle double-decrement bug (Lines 1710, 1719)

```ts
for (let i = gameStars.length - 1; i >= 0; i--) {
    // ...
    if (star.y > 0.6) {
        gameStars.splice(i, 1);  // Line 1710
        continue;
    }
    // ...
    if (distX < 0.15 && distY < 0.15 && !star.caught) {
        // ...
        gameStars.splice(i, 1);  // Line 1719
        continue;
    }
    // ...
}
```

The reverse iteration + splice pattern is correct per iteration, but after `splice(i, 1)` on line 1710, the `continue` skips the catch check. A star that is both off-screen AND within catch distance will never be scored. This is a minor gameplay bug — the real concern is that the `targetStar` selection below (line 1723) references elements that may have shifted indices after splices, though in this reverse-iteration pattern indices below `i` are untouched, so this particular instance is safe.

**Impact:** Stars at the bottom edge can't be caught on their last frame.  
**Fix:** Check catch condition before off-screen removal, or combine conditions.

---

## Medium

### 8. MEDIUM — `process.env.HOME` fallback to `"~"` doesn't work (Line 372)

```ts
const STATS_FILE = path.join(process.env.HOME || "~", ".pi", "pompom", "stats.json");
```

`path.join("~", ...)` produces `"~/.pi/pompom/stats.json"` as a literal string. The shell tilde expansion doesn't work in Node.js `path.join` or `fs` APIs. On systems where `HOME` is unset (some CI, Docker containers), this creates a directory literally called `~` in the CWD.

**Impact:** Stats file written to wrong location; `fs.mkdirSync` creates `~/` as a literal directory name.  
**Fix:** Use `os.homedir()` instead of `process.env.HOME || "~"`.

---

### 9. MEDIUM — Weather blend captures stale "previous" colors (Lines 688-692)

```ts
if (weather !== lastRenderedWeatherState) {
    prevWeatherColors = { rTop: Math.floor(rTop), ... };
    weatherBlend = 1.0;
    lastRenderedWeatherState = weather;
}
```

`prevWeatherColors` is set to the *current* weather's already-tinted sky colors (because weather tinting already ran above). This means the blend transitions from the new weather's colors back to the new weather's colors — i.e., no visible blend at all for the first frame. The blend `weatherBlend -= 0.02` then runs on subsequent frames where both old and new are the same.

**Impact:** Weather transitions appear as a sudden jump rather than smooth blend.  
**Fix:** Snapshot the previous frame's final colors *before* applying the new weather tint.

---

### 10. MEDIUM — `getWeatherAndTime()` casts through `any` (Lines 1073-1074)

```ts
const w = (skyColors as any).weather as Weather | undefined;
const tod = (skyColors as any).timeOfDay as TimeOfDay | undefined;
```

`getWeatherAndTime()` already returns `weather` and `timeOfDay` fields. The `as any` casts bypass TypeScript's type checking and introduce potential `undefined` handling for fields that are always present.

**Impact:** Type safety bypass; if the return type changes, these lines won't get compiler errors.  
**Fix:** Remove the `as any` casts and use the typed return directly.

---

### 11. MEDIUM — `foods` array has no hard cap (Lines 1893+)

In `pompomKeypress` keys `"f"` and `"t"`, there's a check `if (foods.length >= 10) foods.shift()`. But `updatePhysics` also creates a 30-second expiry (line 1900). If a user rapidly spams food (e.g., automated testing sending "f" every frame at 60fps), foods are capped at 10 in the keypress handler — but the physics loop iterates all foods every frame for distance checks, which is fine for 10 but the cap is only in keypress, not a general invariant.

**Impact:** Minor — cap exists but only at keypress entry point. Programmatic food creation via other paths could bypass it.  
**Fix:** Add a cap check in `updatePhysics` food loop as a safety net.

---

### 12. MEDIUM — Particle array can temporarily exceed `MAX_PARTICLES` (Lines throughout)

```ts
const MAX_PARTICLES = 200;
// Line 1629: if (... && particles.length < MAX_PARTICLES) particles.push(...)
// But lines 1719, 1755, 1805, 1880, 1913, etc. push particles without checking MAX_PARTICLES
```

Weather particles check `MAX_PARTICLES`, but sparkle/crumb/note/z particles from eating, singing, dancing, excited, and star-catching do not. Under heavy activity, particle count can exceed 200.

**Impact:** Performance degradation during intense activity sequences.  
**Fix:** Add `particles.length < MAX_PARTICLES` guard to all `particles.push()` calls.

---

### 13. MEDIUM — `pickWeightedLine` uses per-line `minGapSeconds` but checks against global `lastEmotionalReactionAt` (Line 1322)

```ts
const eligible = pool.filter(l => {
    if (l.text === lastSpokenText) return false;
    if (now - lastEmotionalReactionAt < l.minGapSeconds * 1000) return false;
    return true;
});
```

`lastEmotionalReactionAt` is the timestamp of *any* last emotional reaction, not the last time *that specific line* was spoken. A line with `minGapSeconds: 60` will be blocked for 60s after *any* speech, not after its own last usage. The `minGapSeconds` per-line is effectively just a global cooldown selector.

**Impact:** Speech frequency doesn't match the per-line design intent. Lines with short `minGapSeconds` still get blocked by the global cooldown.  
**Fix:** Track per-line last-spoken timestamps if the intent is per-line cooldowns.

---

### 14. MEDIUM — `bounceY` overwritten in multiple places without coordination (Lines throughout)

```ts
// Line 1667: bounceY = -talkAudioLevel * 0.15 - Math.abs(Math.sin(time * 10)) * 0.03;
// Line 1743: bounceY = -Math.abs(Math.sin(time * 15)) * 0.08;
// Line 1753: bounceY = 0;
// Line 1786: bounceY += (0 - bounceY) * dt * 5.0;
```

The talking handler (line 1667) sets `bounceY` absolutely, then the state machine (idle, walk, etc.) also sets it. When `isTalking` is true and `currentState` is not "game", the talking section runs first, but then the idle/walk state still runs and may overwrite `bounceY` in the same frame.

**Impact:** Bouncing animation fights between talk mode and idle/walk states, causing jitter.  
**Fix:** Add `return`/`else` guards so only one bounce controller writes per frame, or use the agent overlay blend approach for talk bounce too.

---

### 15. MEDIUM — `keyframes` loop fallback can leave stale `k1`/`k2` (Lines 640-657)

```ts
let k1 = keyframes[keyframes.length - 1];
let k2 = keyframes[0];
let h1 = k1.h - 24;  // = 22 - 24 = -2
let h2 = k2.h;       // = 4.0

for (let i = 0; i < keyframes.length - 1; i++) {
    if (hour >= keyframes[i].h && hour < keyframes[i + 1].h) {
        k1 = keyframes[i]; k2 = keyframes[i + 1];
        h1 = k1.h; h2 = k2.h;
        break;
    } else if (hour >= keyframes[keyframes.length - 1].h) {
        // This runs on EVERY iteration where the first condition is false
        k1 = keyframes[keyframes.length - 1]; k2 = keyframes[0];
        h1 = k1.h; h2 = k2.h + 24;
        break;
    }
}
```

The `else if` inside the loop triggers on the first iteration where `hour >= 22` regardless of whether a better keyframe pair exists. For `hour = 23`, the first iteration checks `hour >= 4 && hour < 5` (false), then falls to `else if hour >= 22` (true) → breaks. This happens to be correct here, but the pattern is fragile: if keyframes are reordered, the early break produces wrong interpolation.

**Impact:** Currently works by accident because keyframes are sorted. Fragile to maintenance.  
**Fix:** Find the right keyframe pair outside the loop, or restructure the loop to only check the wrap-around case after the loop completes without a match.

---

### 16. MEDIUM — `isTalking` override doesn't skip state transitions properly (Lines 1652-1672)

```ts
if (isTalking && currentState !== "game") {
    if (currentState !== "sleep" || energy > 30) {
        if (isSleeping) { isSleeping = false; }
        currentState = "idle";
        // ... rush to center, etc.
    }
}
```

This sets `currentState = "idle"` every frame while talking. But later in `updatePhysics`, the `if (currentState === "idle")` block (line 1756) runs its own state transitions — including random walks, flips, and chasing. So while talking, Pompom can randomly start walking or chasing fireflies.

**Impact:** Pompom breaks out of talk mode into random actions.  
**Fix:** Either set a dedicated `"talking"` state, or guard the idle state's random actions with `if (!isTalking)`.

---

## Low

### 17. LOW — `foods` splice during reverse iteration is correct but fragile (Line 1900)

The `for (let i = foods.length - 1; i >= 0; i--)` loop with `splice(i, 1)` is safe, but the `continue` on line 1900 after the expiry splice skips the eating check. A food item that expires AND is close enough to Pompom on the same frame will be silently removed without the eating animation.

**Impact:** Extremely rare edge case — food must expire at the exact frame Pompom reaches it.

---

### 18. LOW — `accessoryAsked` is reset in `resetPompom()` but `accessories` is also reset (Line 2506)

```ts
accessoryAsked = {};
```

After reset, accessories are cleared but `accessoryAsked` is also cleared. This means weather accessory hints will fire again. This is probably intentional (re-ask after reset), but if the user manually gives accessories before the weather triggers, they'll get redundant hints.

**Impact:** Minor UX annoyance — accessory hints fire after reset even if user re-gives accessories quickly.

---

### 19. LOW — `getStringWidth` regex doesn't cover all wide characters (Line 515)

```ts
w += (char.match(/[\u2600-\u26FF\u2700-\u27BF\uE000-\uF8FF\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}]/u)) ? 2 : 1;
```

Missing: CJK characters (U+4E00-U+9FFF), fullwidth forms (U+FF01-U+FF60), and emoji in supplementary ranges (U+1FA00-U+1FAFF). These would be counted as width 1 instead of 2, causing speech bubble misalignment.

**Impact:** Speech bubbles with CJK text or newer emoji will overflow their box drawing.

---

### 20. LOW — `lastRenderedWeatherState` not reset in `resetPompom()` properly (Line 2508)

```ts
lastRenderedWeatherState = getWeather();
```

`resetPompom()` calls `getWeather()` after setting `weatherOverride = null` and `weatherState = "clear"`, so this is fine. But `weatherBlend` is set to 0, meaning if the next render happens with a different weather (e.g., override set immediately after reset), the blend won't transition smoothly.

**Impact:** Very minor visual glitch on rare reset-then-immediate-weather-change sequences.

---

### 21. LOW — `agentErrorCount` only increments, never naturally decays (Line 2316)

```ts
export function pompomSetAgentMood(mood: string) {
    if (mood === "concerned") agentErrorCount++;
    if (mood === "idle" && agentMood === "concerned") agentErrorCount = 0;
    agentMood = mood;
}
```

If the agent mood goes from "concerned" → "working" → "concerned", the count never resets (only "concerned" → "idle" resets it). Error count can grow large over a session with alternating moods.

**Impact:** Contextual desire "Things seem rough" triggers incorrectly when `agentErrorCount > 3` from historical non-consecutive errors.

---

### 22. LOW — `ballVz` and `ballZ` declared but never meaningfully used (Line 450)

```ts
let ballX = -10, ballY = -10, ballZ = 0, ballVx = 0, ballVy = 0, ballVz = 0, hasBall = false;
```

`ballZ` is set to 0 and never updated. `ballVz` is set to 0 and never updated. They're reset in `resetPompom()`. Dead variables that add noise.

**Impact:** Code clarity only — no runtime issue.  
**Fix:** Remove `ballZ` and `ballVz`.

---

## Additional Observations (not bugs)

- **No async code at all** — the entire module is synchronous. No dangling promise risk.
- **Timer cleanup** — `weatherAccessoryTimers` is the only timer source; cleaned up in `resetPompom()`. The `setTimeout` callbacks reference module-level state, so they're safe from garbage collection issues.
- **The module-level try/catch for stats file** (lines 373-394) silently catches all errors including permissions issues. This is intentional best-effort behavior but means stats corruption is invisible.
- **The `for (const key of Object.keys(contextualDesireCooldowns)) delete` pattern** in `resetPompom()` (line 2521) works but `Object.keys().forEach(k => delete obj[k])` or reassigning to `{}` would be cleaner.
