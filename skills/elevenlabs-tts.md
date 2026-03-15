# ElevenLabs TTS Skill

Generate high-quality voice notes using ElevenLabs Text-to-Speech API. Based on official best practices for Eleven v3.

## When to Use
- User requests voice notes, audio replies, or TTS
- Sending ad reports (voice summary component)
- Any voice-enabled response on WhatsApp/Telegram

## Current Config
- **Voice ID:** `1zUSi8LeHs9M2mV8X6YS`
- **Model:** `eleven_v3`
- **API Key:** Configured in OpenClaw (xi-no-log enabled)
- **Privacy:** Zero Retention Mode enabled — `enable_logging=false` query param + `xi-no-log: true` header. Nothing stored on ElevenLabs dashboard.
- **Stability:** 0.0 (Creative — max expressiveness, required for audio tags)
- **Similarity Boost:** 0.8
- **Style:** 0.7
- **Speed:** 0.95 (slightly slower for softer delivery)
- **Speaker Boost:** true

## How to Send Voice Notes
```
1. Generate with tts tool: tts("your text here")
2. Send via message tool with asVoice=true and filePath
```

**NEVER use inline MEDIA: tags or [[audio_as_voice]] — always use the message tool.**

## Eleven v3 Best Practices

### Text Preparation Rules

**ALWAYS pre-process text before sending to TTS:**

1. **Expand numbers to words:**
   - ₹18,278 → "eighteen thousand two hundred seventy-eight rupees"
   - 52 → "fifty-two"
   - 2.50x → "two point five x"
   - 1.22% → "one point two two percent"

2. **Expand abbreviations:**
   - CTR → "click-through rate"
   - CPC → "cost per click"
   - ROAS → "R-O-A-S" or "return on ad spend"
   - ATC → "add to cart"
   - LPV → "landing page views"
   - CPM → "cost per mille"

3. **No special characters:**
   - Remove ₹, $, %, / symbols — write them as words
   - URLs → spell out ("eleven labs dot io")
   - Dates → "February sixth, twenty twenty-six"

4. **Natural speech patterns:**
   - Write as if speaking to someone, not reading a report
   - Use contractions ("you're", "that's", "here's")
   - Keep sentences short and conversational
   - Avoid bullet-point style — use flowing narrative

### Audio Tags (v3 Only)

Eleven v3 supports emotional audio tags. Use them sparingly for natural delivery:

**Voice/Emotion:**
- `[laughs]`, `[laughs harder]`, `[wheezing]`
- `[whispers]`
- `[sighs]`, `[exhales]`
- `[sarcastic]`, `[curious]`, `[excited]`, `[crying]`
- `[mischievously]`

**Sound Effects:**
- `[applause]`, `[clapping]`
- `[gunshot]`, `[explosion]`

**Special:**
- `[strong X accent]` (replace X with accent)
- `[sings]`

**Rules for tags:**
- Match tags to voice character — don't force mismatched emotions
- Tags ONLY work with stability 0.0 (Creative) or 0.5 (Natural) — NOT 1.0
- Don't overuse — one or two per paragraph max
- Tags are NOT spoken as text — they become actual sounds/emotions
- Confirmed working with voice ID 1zUSi8LeHs9M2mV8X6YS on eleven_v3

### Pauses & Pacing

**v3 does NOT support SSML `<break>` tags.** Use instead:

- **Ellipses (…)** → adds pause and weight
- **Dashes (— or -)** → short pause
- **CAPITALIZATION** → increases emphasis on words
- **Punctuation** → natural rhythm (commas, periods, question marks)

**Example:**
```
Here's your report for today… fifty-two purchases, generating an estimated revenue of forty-five thousand seven hundred sixty rupees — that's a ROAS of two point five x.
```

### Speed Control
- Default: 1.0 (no adjustment)
- Slow down: 0.7 minimum
- Speed up: 1.2 maximum
- Set via `speed` parameter in voice settings

### Stability Settings (v3 ONLY accepts these exact values)
- **0.0 (Creative):** Most emotional/expressive — REQUIRED for audio tags to work
- **0.5 (Natural):** Balanced, closest to original voice
- **1.0 (Robust):** Very stable, less responsive to prompts — consistent like v2

⚠️ **v3 rejects any other stability values (e.g. 0.3, 0.7).** Only 0.0, 0.5, or 1.0.
Our default: **0.0 (Creative)** for maximum expressiveness.

### Voice Selection Tips
- Voice must match intended delivery style
- Neutral voices are more stable across languages
- For Hindi: use multilingual-capable voices
- IVC (Instant Voice Clone) works better than PVC on v3 currently

## Text Normalization for Reports

When generating voice summaries for ad reports, ALWAYS normalize:

```
BAD:  "₹18,278 spend, 52 purchases, 1.22% CTR, ₹351.49 CPC"
GOOD: "You spent about eighteen thousand three hundred rupees and got fifty-two purchases. 
       Your click-through rate was one point two two percent, with a cost per purchase of 
       about three hundred fifty-one rupees."
```

### Currency (Indian Rupees)
- ₹18,278 → "eighteen thousand two hundred seventy-eight rupees"
- ₹45,760 → "forty-five thousand seven hundred sixty rupees"
- Round to nearest hundred for voice: ₹351.49 → "about three fifty rupees"

### Percentages
- 1.22% → "one point two two percent"
- 3.15% → "three point one five percent"

### Large Numbers
- 213,639 → "about two lakh fourteen thousand" (Indian) or "two hundred thirteen thousand"
- 44,819 → "almost forty-five thousand"
- Use approximations for voice — exact numbers sound robotic

### Metrics
- ROAS 2.50x → "two point five x ROAS" or "you're making two fifty back for every one rupee spent"
- Frequency 1.42 → "frequency of about one point four"

## Hindi Voice Notes

For Hindi TTS, write in natural spoken Hindi (Hinglish is fine):

```
GOOD: "Aaj ka report sun lo — Armour Guards ne fifty-two purchases kiye, 
       total revenue lagbhag pachis hazaar rupaye. ROAS do point paanch x tha, 
       matlab har ek rupaye pe dhai rupaye wapas aaye."
```

Use Devanagari or Roman script — v3 handles both. Hinglish (mixed Hindi-English) sounds most natural for business reports.

## Response Flow for Reports

1. **Fetch data** from fbads/gads
2. **Calculate** revenue, ROAS, funnel rates
3. **Write voice script** — normalize all numbers, use natural language
4. **Generate TTS** via `tts` tool
5. **Send voice note** via `message` tool with `asVoice=true`
6. **Send dashboard image** via nano-banana-pro (see reports-dashboard skill)
7. **Send text breakdown** with exact figures

## Pronunciation Tips

- "ROAS" → say "R-O-A-S" (spell it out) or "return on ad spend"
- "CTR" → "C-T-R" or "click-through rate"
- "CPC" → "C-P-C" or "cost per click"  
- "CPM" → "C-P-M" or "cost per thousand"
- "ATC" → "add to cart" (don't abbreviate)
- "LPV" → "landing page views" (don't abbreviate)
- Brand names: spell phonetically if unusual
