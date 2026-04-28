# Pi-Pompom Audit Report — godspeed multi-model review

**Date:** 2026-04-28
**Tool:** `~/bin/godspeed` (8 LLM reviewers in parallel + Opus 4.7 advisor)
**Upstream baseline at audit time:** `pi-coding-agent@0.65.0`
**Upstream HEAD:** `pi-coding-agent@0.70.5` (5+ releases of breaking changes since pompom's last sync)
**Trigger:** user request — "audit the entire code to see if we can optimize pi-pompom based on the [pi-mono coding-agent] changelog updates"

---

## Run summary

| Bundle | File slice reviewed | Run dir | Verdict | Available | Vetos |
|---|---|---|---|---|---|
| Footer | `extensions/pompom-footer.ts` (full) | `/tmp/godspeed-20260428-120420-17720` | DEGRADED | 5/8 | 0 (1 cleared by advisor) |
| Chat | `extensions/pompom-chat.ts` (full) | `/tmp/godspeed-20260428-120420-17721` | DEGRADED | 5/8 | 0 |
| Lifecycle | `extensions/pompom-extension.ts` lines 1690–1870 | `/tmp/godspeed-20260428-120420-17722` | **BLOCK** | 5/8 | **3 advisor-confirmed** |

**Reviewer availability across all 3 runs:**

| Reviewer | Footer | Chat | Lifecycle | Cause |
|---|---|---|---|---|
| architect (gpt-5.5) | ✓ | ✓ | ✓ | — |
| security (claude-opus-4.7) | ✓ | ✓ | ✓ | — |
| sonnet (claude-sonnet-4-6) | ✓ | ✓ | ✓ | — |
| deepseek (v4-pro/flash) | ✓ | ✓ | ✓ | — |
| minimax (m2p7) | ✓ | ✓ | ✓ | — |
| **runtime** (gemini-3.1-pro-preview) | UNAVAIL | UNAVAIL | UNAVAIL | Google capacity exhausted across companion/amp + copilot 500. All 4 candidates same model family. |
| **moonshot** (fireworks/kimi-k2p6) | UNAVAIL | UNAVAIL | UNAVAIL | Transient fireworks 30s per-attempt timeout (recovered post-audit) |
| **glm** (fireworks/glm-5p1) | UNAVAIL | UNAVAIL | UNAVAIL | Transient fireworks 30s per-attempt timeout (recovered post-audit) |

5/8 reviewers responded; the captured-ctx finding (BLOCK 1) had independent agreement from 4 of the 5 across two different code slices, with the advisor CONFIRM'ing 3 at HIGH severity.

---

## 🔴 BLOCK 1 — Captured `pi`/`ctx` will throw after `/clone`, `/fork`, `/resume` (HIGH, concurrency+migration)

**Confirmed by:** architect, security, minimax (advisor: CONFIRM_CRITICAL ×3, DOWNGRADE ×1, INVALID ×1).

**Where:** `extensions/pompom-footer.ts:262-284` and the call sites in `pompom-extension.ts:1735` (session_start) and `:1828` (session_switch).

### The bug

```ts
// pompom-footer.ts line 262
export function installPompomFooter(ctx, getSessionStartMs, getThinkingLevel): void {
  ctx.ui.setFooter((_tui, _theme, _footerData) => {
    return {
      render(width: number): string[] {
        // captured `ctx` and via getThinkingLevel → captured `pi`
        return [truncateToWidth(renderFooter(width, getSessionStartMs(), getThinkingLevel(), ctx), width), ""];
      }, ...
    };
  });
}
```

The footer render closure holds:

1. The `ctx` parameter (used for `ctx.cwd`, `ctx.sessionManager`, `ctx.model`, `ctx.getContextUsage()`).
2. The top-level `pi` reference indirectly via `getThinkingLevel = () => pi.getThinkingLevel()` passed from `pompom-extension.ts:1735` / `:1828`.

Per upstream **0.69.0 BREAKING CHANGE** (CHANGELOG L120-128):

> *Captured `pi`/`ctx` references after `ctx.newSession()`, `ctx.fork()`, `ctx.switchSession()` now THROW instead of silently targeting the replaced session. Migration: pass `withSession` to those calls.*

The `try/catch` on line 278 silently swallows the throw and returns `["", ""]` — the footer goes blank with no diagnostic. Pompom *does* re-install the footer in its `session_switch` handler, but for `/clone`, `/fork`, and SDK-level programmatic forks the captured `ctx` and `pi` references can go stale before the re-install completes.

### Advisor adjudication on the lifecycle slice

| Reviewer | Decision | Severity | Reasoning summary |
|---|---|---|---|
| architect | CONFIRM_CRITICAL | high | "After subsequent session_switch those captured refs become poisoned and will throw when footer/key/ambient callbacks next fire. Practical DoS of the extension." |
| security | CONFIRM_CRITICAL | high | "Top-level `pi` reference inside `installPompomFooter` closure `() => pi.getThinkingLevel()` will throw after switch. Footer re-renders invoke this getter, breaking UI." |
| minimax | CONFIRM_CRITICAL | high | "session_switch handler reassigns module-level `ctx` and passes `switchCtx` directly into `installPompomFooter`/`restoreCompanionState`. Real, reachable, durable state inconsistency." |
| sonnet | DOWNGRADE | medium | "`pompomOnSpeech`/`Sfx`/`EmotionalState` callbacks close over module-level `ctx`, not the parameter, so they read whatever the current `ctx` is at invocation time. Genuine issue is that `installPompomFooter`/`restoreCompanionState` retain `startCtx`/`switchCtx`. Bounded blast radius." |
| deepseek | INVALID | none | "session_switch handler is synchronous (no awaits in runSafely body for switch), `ctx=switchCtx` happens before any other queued handler can interleave. The race interleaving claim is not demonstrated." |

### Fix

```ts
// pompom-footer.ts — keep ctx live by re-fetching on each render
export function installPompomFooter(
  pi: ExtensionAPI,
  getCtx: () => ExtensionContext | null,   // ← fetch fresh ctx
  getSessionStartMs: () => number,
  getThinkingLevel: () => string,
): void {
  const initialCtx = getCtx();
  if (!initialCtx?.hasUI) return;
  initialCtx.ui.setFooter((_tui, _theme, _footerData) => ({
    invalidate() {},
    dispose() {},
    render(width) {
      const live = getCtx();
      if (!live) return ["", ""];
      try {
        return [truncateToWidth(renderFooter(width, getSessionStartMs(), getThinkingLevel(), live), width), ""];
      } catch { return ["", ""]; }
    },
  }));
}
```

And at the call sites (`pompom-extension.ts:1735, 1828`):

```ts
installPompomFooter(pi, () => ctx, () => sessionStartMs, () => pi.getThinkingLevel());
```

The module-level `ctx` is already updated on `session_switch`, so re-reading it per render gets the current session automatically. Same pattern applies anywhere a long-lived UI registration captures `ctx` or `pi` directly.

---

## 🟡 BLOCK 2 — `session_shutdown` handler ignores new event payload (medium, migration)

**Where:** `pompom-extension.ts:1761`.

Upstream **0.68.0** added `reason` and `targetSessionFile` to `session_shutdown` events to distinguish quit / reload / new-session / resume / fork teardown paths. Pompom's handler is `pi.on("session_shutdown", async () => { ... })` — discards the event entirely. It also doesn't null `ctx` after teardown, leaving stale references reachable.

### Fix

```ts
pi.on("session_shutdown", async (event) => {
  await runSafely("session_shutdown", async () => {
    const reason = event.reason; // "quit" | "reload" | "new_session" | "resume" | "fork"
    // For switch-style teardowns, skip the goodbye chime to avoid double-chimes
    const skipGoodbyeChime = reason === "new_session" || reason === "fork" || reason === "resume";
    // ... existing teardown ...
    if (wasPrimary && enabled && !skipGoodbyeChime) await playSfx("session_goodbye");
    // ... rest ...
    ctx = null; // explicit invalidation
  });
});
```

Worth using `event.targetSessionFile` to seed warmup for the next session if it's a switch instead of a full cold restart.

---

## 🟢 Optimization wins (changelog-derived, NOT godspeed consensus)

These came from reading the upstream changelog, not from multi-model review. Lower confidence than the BLOCK findings above; treat as "worth considering."

### 1. `ctx.ui.setWorkingIndicator()` (0.68.0) — bind streaming spinner to Pompom's mood

The streaming working indicator is now extension-customizable. Pompom already tracks `mood` and `status` in `pompom.ts` — wire those frames through:

```ts
// In session_start, after enabling pompom:
ctx.ui.setWorkingIndicator(() => {
  const mood = pompomStatus().mood;
  const frames = MOOD_SPINNER_FRAMES[mood] ?? DEFAULT_FRAMES;
  return { frames, intervalMs: 80 };
});
```

Replaces Pi's default braille spinner with mood-aware Pompom frames during agent streaming. Brand win, removes redundant animation work.

### 2. `ctx.ui.setWorkingVisible(false)` (0.70.3) — hide the loader row when companion is up

When Pompom's companion overlay is rendering, the built-in single-line loader row above the editor is duplicate visual chrome:

```ts
function showCompanion() {
  // ... existing ...
  ctx.ui.setWorkingVisible(false); // suppress built-in loader, Pompom owns working state
}
function hideCompanion() {
  // ... existing ...
  ctx.ui.setWorkingVisible(true);
}
```

Reclaims a row of layout space.

### 3. `terminate: true` on `peek_main` for "status" shortcut (0.69.0) — save one LLM turn

`pompom-chat.ts:254` defines `peek_main` whose result is fed back to the side agent for analysis. For the `status` shortcut that just dumps recent activity, the auto-follow-up LLM turn is wasted spend:

```ts
execute: async (_id, args) => {
  // ...build formatted...
  const isStatusOnly = (args as any)?.since_last === true;
  return {
    content: [{ type: "text", text: "Main agent activity:\n\n" + formatted }],
    details: {},
    terminate: isStatusOnly, // skip follow-up LLM call for plain status checks
  };
},
```

Cuts ~one model call per `status` invocation.

### 4. `ctx.ui.addAutocompleteProvider()` (0.69.0) — autocomplete `/pompom:*` commands

Pompom registers ~15 commands (`pompom`, `pompom:ask`, `pompom:voice`, `pompom:ambient`, …). Stack a provider that surfaces those plus the inline shortcut keywords (`analyze`/`stuck`/`recap`/`status`/`help`) in the side-chat editor too.

### 5. TypeBox 1.x migration (0.69.0) — soft signal

`pompom-chat.ts:22` imports from `@sinclair/typebox`. Legacy alias still resolves but upstream extensions and the SDK now use `typebox` 1.x. Migration is one line:

```ts
import { Type } from "typebox"; // was: "@sinclair/typebox"
```

Then add `"typebox": "^1.0.0"` to `peerDependencies` in `package.json`.

---

## 🟢 Already correct — no action needed

- `pompom-chat.ts:217` uses `createReadOnlyTools(cwd)` (the post-0.68.0 factory) ✓
- No reliance on removed `readTool`/`bashTool`/`codingTools` exports ✓
- No `process.cwd()` fallback assumptions ✓
- No `fs.watch` calls (so EMFILE-retry fix in 0.70.0 is irrelevant — but you also don't gain it) ✓
- Session-switch handler properly tears down and re-installs UI subscriptions ✓ (just needs the captured-ctx fix above)
- `pompom-chat.ts:220` uses `new Agent(...)` from `pi-agent-core`, NOT `createAgentSession({ tools })` from `pi-coding-agent` — so the 0.68 tool-allowlist breaking change does not apply here. (architect's review flagged this as a NO_SHIP but the calibration was wrong; no other reviewer agreed.)

## 🟢 Passive wins from upstream bumps (no code changes needed)

When users upgrade past 0.70.0 your extension automatically benefits from:

- Footer crash fix on `/quit` when render() accesses ctx (#3595) — covers the case where your try/catch was masking the throw at shutdown.
- Extension shortcut conflict diagnostics at startup (#3617) — your many `Alt+*` bindings get flagged earlier.
- Better stale-ctx error messages telling extension authors to use `withSession` (helps you debug if any captured-ctx case slips through).
- Sanitized markdown link URLs in HTML export (#3532) — `javascript:` payloads blocked before reaching the browser.

---

## 🔧 Minor findings (single-reviewer, low severity)

- **`pompom-chat.ts:591`** — `wrapInto()` accepts `_prefixW` but never uses it; multi-line wraps don't hang-indent. Latent rendering bug for long messages, low severity. (sonnet)
- **`pompom-chat.ts:91`** — `redactToolText` regex `/\b[A-Za-z0-9+/_=-]{40,}\b/g` over-redacts benign long strings (commit hashes, URLs). Consider tightening or marking redactions explicitly. (security, info)
- **`pompom-extension.ts`** is 3187 lines and registers ~15 commands + 7 lifecycle hooks. Splitting commands into a `pompom-commands.ts` module would reduce blast radius for future audits. (architectural observation)

---

## Recommended action plan (priority order)

| # | Task | Effort | Confidence |
|---|---|---|---|
| 1 | Fix captured-ctx in `installPompomFooter` (signature change to take `() => ctx` getter) | 10 min | HIGH (4/5 reviewers + 3 advisor CONFIRM_CRITICAL) |
| 2 | Adopt typed `session_shutdown` event — branch on `reason`, null `ctx` after teardown | 15 min | MEDIUM (2/5 reviewers, changelog-confirmed) |
| 3 | Wire `ctx.ui.setWorkingIndicator()` to Pompom mood | 30 min | MEDIUM (changelog-derived, biggest brand win) |
| 4 | Add `terminate: true` to `peek_main` for "status" invocations | 5 min | MEDIUM (changelog-derived) |
| 5 | `ctx.ui.setWorkingVisible(false)` while companion is up | 5 min | MEDIUM (changelog-derived) |
| 6 | TypeBox import migration + peerDep update | 2 min | LOW (1/5 reviewers, soft signal) |
| 7 | `addAutocompleteProvider` for `/pompom:*` commands | 30 min | LOW (changelog-derived, DX win) |
| 8 | Investigate proxy/model availability for `runtime`, `moonshot`, `glm` reviewers | n/a | meta |

---

## Additional evidence — re-runs after partial proxy recovery

Three additional godspeed runs were attempted on the lifecycle slice as proxies recovered and as `~/bin/godspeed` was patched to add a `cli://gemini` runtime fallback (gemini CLI on user's personal OAuth, bypassing exhausted proxy quotas):

| Run | Avail | SHIP | NO_SHIP | VETO | Reviewers naming captured-ctx | Severity |
|---|---|---|---|---|---|---|
| 1 (orig) | 5/8 | 0 | 5 | 3 | architect, security, minimax | high |
| 2 (post-recovery) | 6/8 | 1 | 5 | 2 | security, glm | high |
| 3 (CLI-90s) | 7/8 | 0 | 7 | 2 | security, architect, moonshot, deepseek, minimax | high |
| 4 (CLI-300s) | 6/8 | 1 | 5 | 0 | architect, moonshot, deepseek, minimax | medium |

The captured-ctx finding has now been independently identified in **all 4 runs by 7 distinct reviewers across 6 model families** (gpt-5.5, claude-opus-4.7, claude-sonnet-4-6, kimi-k2p6, glm-5p1, minimax-m2p7, deepseek-v4). Severity calibration ranges from medium (UI breakage, bounded blast radius) to high (permanent extension breakage in production). Both readings are defensible — the bug is real either way.

The CLI fallback patch (cli://gemini in runtime's chain) functioned in isolated testing but had a JSON-wrap defect in the parallel ensemble context that left runtime UNAVAIL despite reaching the CLI candidate. Documented for future debugging; not blocking.

## Honest accounting of consensus strength

The captured-ctx finding has **4 of 5 responding reviewers in agreement** across two different code slices (footer + lifecycle) in the original run, with the advisor CONFIRMing 3 at HIGH severity. Reinforced by 3 additional runs (see above). Strong evidence.

Everything else is one of:

- **2 of 5 reviewers** (the `session_shutdown` event payload finding — sonnet + minimax) — solid but lower than the BLOCK finding.
- **1 of 5 reviewers** (TypeBox migration, `_prefixW`, `redactToolText`) — informational; treat as worth-knowing rather than authoritative.
- **0 of 5 reviewers** — all the optimization wins (`setWorkingIndicator`, `setWorkingVisible`, `terminate:true`, `addAutocompleteProvider`). These are MY synthesis from the changelog, not multi-model consensus.

architect's NO_SHIP on `pompom-chat.ts` (tool-allowlist concern) was **incorrect calibration** — the file uses `new Agent()` from `pi-agent-core`, not `createAgentSession()` from `pi-coding-agent`. The 0.68 breaking change does not apply. Disregarded in the recommendations above.
