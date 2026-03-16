# ElevenLabs TTS Skill

Generate high-quality speech for Pompom companion using ElevenLabs Text-to-Speech API v3.

## When to Use
- Pompom speaks via the TTS voice system (`pompom-voice.ts` ElevenLabsEngine)
- Voice test (`/pompom:voice test`)
- Commentary, assistant replies, and reaction speech events

## Pompom Voice Config
- **Default Voice:** Jessica Anne Bogart - Chatty and Friendly
- **Voice ID:** `g6xIsTj2HwM6VR4iXFCw`
- **Model:** `eleven_v3`
- **API Key:** `ELEVENLABS_API_KEY` from environment (`~/.env.secrets`)
- **Privacy:** Zero Retention Mode — `enable_logging=false` query param + `xi-no-log: true` header
- **Stability:** 0.0 (Creative — maximum expressiveness for animated character)
- **Similarity Boost:** 0.85
- **Style:** 0.8
- **Speed:** 1.1 (slightly faster for punchy animated character lines)
- **Speaker Boost:** true
- **Output:** PCM 24kHz, wrapped in WAV for playback

## Available Voices
| Name | Voice ID | Style |
|------|----------|-------|
| Jessica Anne Bogart - Chatty (default) | `g6xIsTj2HwM6VR4iXFCw` | Chatty, friendly |
| Lily - Soft, Cute and Sweet | `Pt5YrLNyu6d2s3s4CVMg` | Soft, sweet |
| Cherry Twinkle - Bubbly and Sweet | `XJ2fW4ybq7HouelYYGcL` | Bubbly |
| Flicker - Cheerful Fairy | `piI8Kku0DcvcL6TTSeQt` | Cheerful |
| Jessica Anne Bogart - Eloquent | `flHkNRp1BlvT73UL6gyz` | Eloquent, dramatic |
| Sarah - Mature, Confident | `EXAVITQu4vr4xnSDxMaL` | Professional |

## Integration with Pompom
The voice engine is in `extensions/pompom-voice.ts` (ElevenLabsEngine class). Speech events flow:
1. `say()` in pompom.ts fires a SpeechEvent
2. pompom-extension.ts routes it to `enqueueSpeech()`
3. Speech queue applies personality gating, cooldown, dedup
4. ElevenLabsEngine.synthesize() calls the API
5. Audio plays at configured volume via native OS player (afplay/paplay/aplay)

## Eleven v3 Best Practices

### Voice Settings for Animated Characters
- **Stability 0.0 (Creative):** Required for audio tags. Maximum expressiveness — perfect for animated characters with short, emotional utterances
- **Similarity Boost 0.85:** High fidelity to source voice while allowing emotional range
- **Style 0.8:** Strong stylistic expression for character personality
- **Speed 1.1:** Slightly faster delivery suits short, punchy lines like "Yum!", "Wheee!", "Got it!"

### Audio Tags (v3 Only)
Eleven v3 supports emotional audio tags — used throughout Pompom's speech:
- `[excited]` — energetic reactions (ball, dance, game, treats)
- `[happy]` — warm moments (petting, hugs, feeding, accessories)
- `[whispers]` — quiet moments (sleep, nap)
- `[sighs]` — contentment (waking from nap)
- `[mischievously]` — playful moments (peekaboo)
- `[sings]` — musical moments (la la la)
- `[curious]` — weather observations (clouds rolling in)
- `[concerned]` — weather warnings (storm brewing)

**Rules:**
- Tags only work with stability 0.0 — NOT 0.5 or 1.0
- One tag per utterance (Pompom's lines are short)
- Match tag to the voice's character — don't force mismatched emotions
- Tag goes at the start of the text: `[excited] Catch the stars!`

### Text Preparation
- Keep sentences short and conversational (Pompom's lines are 2-6 words)
- Use contractions ("I'm", "that's", "let's")
- Use exclamation marks for energy, ellipses for pauses
- CAPITALIZATION adds emphasis and urgency
- No special characters — sanitized by `sanitizeSpeechText()`

### Pauses & Pacing
v3 does NOT support SSML `<break>` tags. Use instead:
- **Ellipses (...)** — adds pause and weight ("Time for a nap... zZz")
- **Dashes (—)** — short pause
- **CAPITALIZATION** — increases emphasis

### Stability Settings (v3 exact values only)
- **0.0 (Creative):** Most expressive — our default for Pompom
- **0.5 (Natural):** Balanced — good for professional/mentor personalities
- **1.0 (Robust):** Very stable, less responsive — good for zen personality
