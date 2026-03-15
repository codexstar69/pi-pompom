# Handoff

## Current Status

- Reviewed the current voice queue, engine fallback, and `/pompom:voice`
  command flow.
- Added frictionless voice onboarding so `/pompom:voice on` now
  auto-detects the best usable engine, and `/pompom:voice setup` offers
  an explicit picker when more than one engine is available.
- Added persisted `configured` state to the voice config so the session
  hint only appears before voice has been configured once.
- Changed engine priority to ElevenLabs, then Deepgram, then Kokoro.

## Validation

- Ran `pnpm typecheck`
- Result: passed
- Ran `timeout 5 pi -e ./extensions/pompom-extension.ts --no-input -m "/pompom:voice on"`
- Result: timeout exited after 5 seconds, but the captured log showed
  `Pompom voice ON (Deepgram).` and no onboarding-flow errors

## Last Prompts

- "Review and improve this voice onboarding plan for pi-pompom. Read
  the current code first..."
- "After review, implement the changes, run typecheck, and smoke test."

## Next Checks

- In a real interactive Pi session, run `/pompom:voice setup` when more
  than one engine is available to confirm the picker wording feels good.
- If Pi later exposes a cleaner headless mode, replace the timeout-based
  smoke run with that flow so logs stay smaller.
