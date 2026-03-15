# Pompom Intelligent Coding Companion

This ExecPlan is a living document. The sections `Progress`,
`Surprises & Discoveries`, `Decision Log`, and `Outcomes &
Retrospective` must be kept up to date as work proceeds.

This document follows [../PLANS.md](/Users/codex/Downloads/Code Files/PLANS.md)
from the repository root context at `../PLANS.md`.

## Purpose / Big Picture

After this change, Pompom no longer acts only like a decorative pet. It
also reacts to Pi agent work: starting a task, calling tools, finishing
tools, waiting for replies, and answering direct `/pompom:ask` and
`/pompom:recap` commands. Users should see additive visual overlays on
top of the existing pet state machine, context-aware commentary in the
speech bubble, and session-aware intelligence that survives reloads.

The change is visible in three ways. First, Pompom speaks short coding
companion lines when Pi starts or finishes work. Second, Pompom can
temporarily override weather and antenna/ear behavior to reflect the
current coding mood without removing the existing idle, fetch, sleep,
and game behaviors. Third, users can ask Pompom questions or request a
session recap through Pi model calls from the extension.

## Progress

- [x] 2026-03-15 16:53 IST Read the required files and mapped the main
      renderer, extension lifecycle, session persistence pattern, and
      Pi AI helper usage.
- [x] 2026-03-15 16:56 IST Wrote this ExecPlan before implementation so
      the multi-file work has a maintained reference.
- [x] 2026-03-15 17:17 IST Added `extensions/pompom-agent.ts` with
      event-driven agent state, 60-plus commentary lines, mood mapping,
      session stats, and serialized restore support.
- [x] 2026-03-15 17:23 IST Extended `extensions/pompom.ts` with additive
      overlay controls, overlay physics, weather override support,
      antenna glow, ear boost, and reset behavior.
- [x] 2026-03-15 17:33 IST Rebuilt `extensions/pompom-extension.ts` to
      restore and persist agent state, wire Pi lifecycle events, and add
      `/pompom:ask` plus `/pompom:recap`.
- [ ] 2026-03-15 17:39 IST Metadata and verification mostly done
      (completed: package version, peer dependency, changelog, compiler
      pass; remaining: handoff document and completion notifier).

## Surprises & Discoveries

- Observation: `extensions/pompom.ts` currently strips multi-width
  characters from speech bubbles, but many existing speech lines still
  contain emoji.
  Evidence: `drawSpeechBubble()` removes any character whose display
  width is greater than one, and current lines such as `Ball!! 🎾` would
  lose the emoji at render time.

- Observation: weather is already user-visible and dynamic, so the new
  agent weather must be an override layer rather than replacing the
  weather system.
  Evidence: the current code uses weather for sky colors, particles,
  accessories, and status text inside `getWeatherAndTime()`,
  `buildObjects()`, and `updatePhysics()`.

- Observation: `streamSimple()` does not accept Pi thinking level
  `"off"` directly in this repo's installed types.
  Evidence: `bunx tsc -p tsconfig.json --noEmit` failed until `"off"`
  was converted to `undefined` for the `reasoning` option.

- Observation: `completeSimple()` and session `Message.content` can be a
  string or a typed content array, not only a text-part array.
  Evidence: the compiler rejected direct `.filter()` calls on
  `response.content` and `message.content`; the fix was to route both
  through `extractTextContent()`.

## Decision Log

- Decision: persist agent intelligence as a custom session entry that
  stores the latest full serialized state instead of replaying many
  micro-events.
  Rationale: the extension API restores custom entries by replaying the
  session log, and latest-wins state is simpler and safer than rebuilding
  from every event after reload.
  Date/Author: 2026-03-15 / Codex

- Decision: keep the current Pompom state machine untouched and add a
  separate overlay layer for agent behavior.
  Rationale: the user asked to keep all existing features, and the
  renderer already has rich behavior that should continue to run even
  during agent activity.
  Date/Author: 2026-03-15 / Codex

## Outcomes & Retrospective

The core feature is implemented and compiles. Pompom now has a separate
intelligence state module, additive renderer overlays, Pi lifecycle
event wiring, and the new ask/recap commands. The main lesson from this
pass is that the cleanest boundary was to keep intelligence state out of
the renderer and let the extension translate that state into short-lived
visual hints plus persistent mood/weather overrides.

## Context and Orientation

The repository currently has one published Pi extension entry point in
`extensions/pompom-extension.ts`. That file owns the widget lifecycle,
keyboard shortcuts, session start/shutdown wiring, and the `/pompom`
command family. It imports all pet rendering and interaction functions
from `extensions/pompom.ts`.

`extensions/pompom.ts` is the full renderer and physics loop. It owns
the pet state machine, time-of-day sky, weather transitions, particles,
speech bubble drawing, accessory logic, and all exported imperative
functions like `renderPompom()`, `pompomSetTalking()`, `pompomKeypress()`,
`resetPompom()`, and status helpers.

The Pi extension docs in `/tmp/pi-extensions-docs.md` define the exact
event names used here. The important ones are `agent_start`,
`agent_end`, `message_start`, `message_end`, `tool_execution_start`, and
`tool_execution_end`. The docs also show that `pi.appendEntry()` stores
custom entries that survive reloads but do not enter the LLM context.

`/Users/codex/Downloads/btw.ts` is the local API reference for
`streamSimple()`, `completeSimple()`, `pi.sendUserMessage()`, and the
hidden persistence pattern using `appendEntry()`.

## Plan of Work

First, add a new module at `extensions/pompom-agent.ts`. This file will
be purely stateful TypeScript logic with no renderer code. It will track
whether an agent is active, which tools are running, when recent events
happened, what commentary lines are available for each event family, and
what session statistics should be exposed. It must expose the exact
functions requested by the user, including serialization and restore.

Second, extend `extensions/pompom.ts` without replacing the existing pet
behaviors. Add new top-level overlay state for speech, look targeting,
weather override, antenna glow, and ear boost. Update `getWeather()` so
the renderer can optionally use an override. Update `buildObjects()`,
`shadeObject()`, and `updatePhysics()` so the overlay can increase ear
motion, drive the antenna bulb color/intensity, steer the look vector,
and apply additive bounce/attention motion after the existing voice
block. Add new exports so the extension can drive these effects.

Third, extend `extensions/pompom-extension.ts` so it restores serialized
agent state on `session_start`, listens to Pi events with defensive
`try/catch` blocks, asks `pompom-agent.ts` for commentary and weather,
and pushes those results into the new renderer control functions. Add
`/pompom:ask` to stream a reply using the current model plus recent
session context, and `/pompom:recap` to generate a concise session
summary. Persist the intelligence state after meaningful changes through
`pi.appendEntry()`.

Fourth, update `package.json` peer dependencies for `@mariozechner/pi-ai`,
add a changelog entry, refresh the root handoff document, and run the
TypeScript verification command. If verification fails because peer types
are unavailable locally, fix code issues first and capture the remaining
environment constraint in the plan and handoff.

## Concrete Steps

From `/Users/codex/Downloads/Code Files/pi-pompom`:

1. Create `extensions/pompom-agent.ts` and define the state shape,
   commentary tables, and exported functions.
2. Patch `extensions/pompom.ts` to add overlay state and exports, then
   thread the overlay through weather selection, object building, shading,
   physics, and reset.
3. Patch `extensions/pompom-extension.ts` to:
   - restore serialized agent state on session start,
   - handle agent and tool events with `try/catch`,
   - update renderer overlays from agent state,
   - register `/pompom:ask`,
   - register `/pompom:recap`,
   - persist serialized agent state with `pi.appendEntry()`.
4. Patch `package.json`, `CHANGELOG.md`, and `handoff.md`.
5. Run:

      bunx tsc -p tsconfig.json --noEmit

## Validation and Acceptance

The minimum acceptance proof is successful TypeScript verification from
the repository root:

    bunx tsc -p tsconfig.json --noEmit

User-visible acceptance is:

- Pompom still renders and keeps prior interactions intact.
- Pompom can speak ASCII commentary triggered by agent and tool events.
- Pompom can switch into additive visual overlays during coding activity
  without losing the current pet state machine.
- `/pompom:ask <question>` streams a model answer based on session
  context and shows the result through the extension.
- `/pompom:recap` produces a concise session summary.
- Reloading the extension restores the latest serialized agent state.

## Idempotence and Recovery

All code changes are additive and safe to rerun. Session persistence uses
latest serialized state, so replaying the same session should restore the
latest known agent state deterministically. If a handler throws at
runtime, each Pi event wrapper must catch the error so the TUI does not
crash. If verification fails, fix the TypeScript error and rerun the same
command.

## Artifacts and Notes

Important reference findings collected before implementation:

    streamSimple(model, { systemPrompt, messages }, { apiKey, reasoning })
    completeSimple(model, { messages }, { apiKey, reasoning })
    pi.appendEntry("custom-type", data)

Renderer seams for the overlay layer:

    extensions/pompom.ts
    - getWeather()
    - shadeObject() mat === 8
    - buildObjects()
    - updatePhysics()
    - resetPompom()

## Interfaces and Dependencies

At the end of this work, these exports must exist:

- `extensions/pompom-agent.ts`
  - `onToolCall(toolName: string, args?: unknown): void`
  - `onToolResult(toolName: string, isError: boolean, result?: unknown): void`
  - `onAgentStart(): void`
  - `onAgentEnd(): void`
  - `getCommentary(eventName: string): string | null`
  - `getAgentWeather(): "clear" | "cloudy" | "rain" | "snow" | "storm"`
  - `shouldUseAgentWeather(): boolean`
  - `getSessionStats(): ...`
  - `getAgentState(): ...`
  - `resetAgentState(): void`
  - `serializeState(): ...`
  - `restoreState(state: ...): void`

- `extensions/pompom.ts`
  - `pompomSay(text: string, duration?: number): void`
  - `pompomSetAgentOverlay(active: boolean): void`
  - `pompomSetAgentLook(x: number, y: number): void`
  - `pompomSetAntennaGlow(intensity: number): void`
  - `pompomSetAgentEarBoost(amount: number): void`
  - `pompomSetWeatherOverride(weather: Weather | null): void`

Revision note: created the initial ExecPlan before code changes so the
implementation can keep the living sections current.

Revision note: updated after implementation and compiler verification to
record the finished milestones, the typing discoveries, and the
remaining close-out task.
