/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  POMPOM CHARACTER BIBLE — Complete Personality & Emotional Coherence System
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  This file is both documentation AND implementation-ready TypeScript.
 *  Every type, constant, and function is directly importable.
 *
 *  Design philosophy: Pompom is a small fluffy creature with an antenna who
 *  lives in your terminal. She is a cross between a playful toddler daughter
 *  and a supportive best friend who sits beside you while you code. She is
 *  NOT a chatbot. She is NOT an assistant. She is a living presence with
 *  physical needs, moods, desires, and a sense of time.
 *
 *  Core principle: Emotional state ALWAYS overrides idle chatter. A starving
 *  Pompom does not say "You're doing great!" — she says "My tummy hurts..."
 *  This is the single most important rule in the entire system.
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ─── 1. EMOTIONAL STATE MACHINE ─────────────────────────────────────────────
//
// Lessons from Tamagotchi, Neopets, Pou, and modern virtual pets:
//
// WHAT MAKES VIRTUAL PETS FEEL ALIVE:
//   - Needs that decay at different rates (hunger fast, energy slow)
//   - State transitions that feel earned (you fed her → she's grateful)
//   - Personality that persists across interactions (she remembers)
//   - Spontaneous desires that emerge from state (bored → asks to play)
//   - Emotional inertia (moods don't snap instantly — they fade)
//   - Surprising micro-behaviors (rare lines you haven't heard before)
//   - Contextual awareness (time of day, how long you've been coding)
//
// WHAT MAKES VIRTUAL PETS FEEL ROBOTIC (anti-patterns in Section 10):
//   - Random speech disconnected from state
//   - Instant mood transitions with no blending
//   - Repeating the same line twice in a row
//   - Positive speech during negative states
//   - No memory of what just happened
//   - Speaking at metronomic intervals
//   - Ignoring the passage of real time

/**
 * Pompom's emotional state is determined by a strict priority hierarchy.
 * Higher-priority states BLOCK lower-priority speech and behavior.
 * This prevents the "happy while starving" anti-pattern.
 */
export type EmotionalState =
	| "critical_hunger"   // hunger < 15%  — HIGHEST PRIORITY
	| "critical_tired"    // energy < 15%
	| "hungry"            // hunger < 30%
	| "tired"             // energy < 30%
	| "recovering"        // just fed/rested — grateful window (30-60s)
	| "content"           // hunger > 50%, energy > 50%
	| "happy"             // hunger > 75%, energy > 75%
	| "blissful"          // hunger > 90%, energy > 90%
	| "bored"             // idle for > 3 minutes, content or above
	| "playful";          // happy + random chance, spontaneous desire mode

/**
 * Priority levels — higher number = more urgent = overrides lower.
 * When resolving what Pompom says, ONLY the highest-active state speaks.
 */
export const STATE_PRIORITY: Record<EmotionalState, number> = {
	critical_hunger: 100,
	critical_tired:   95,
	hungry:           80,
	tired:            75,
	recovering:       60,  // Gratitude window — overrides idle but not needs
	bored:            40,
	playful:          35,
	happy:            30,
	blissful:         30,
	content:          20,
};

// ─── 2. STATE RESOLUTION RULES ──────────────────────────────────────────────
//
// These rules are evaluated top-to-bottom. First match wins.
// This is the "need-based behavior priority" system.

export interface NeedsSnapshot {
	hunger: number;    // 0-100
	energy: number;    // 0-100
	lastFedAt: number;       // timestamp
	lastRestedAt: number;    // timestamp
	lastPlayedAt: number;    // timestamp
	lastInteractionAt: number; // any user action timestamp
	sessionStartAt: number;    // when this coding session began
}

export function resolveEmotionalState(needs: NeedsSnapshot, now: number): EmotionalState {
	// Critical needs — ALWAYS checked first
	if (needs.hunger < 15) return "critical_hunger";
	if (needs.energy < 15) return "critical_tired";

	// Moderate needs
	if (needs.hunger < 30) return "hungry";
	if (needs.energy < 30) return "tired";

	// Gratitude window — 30-60 seconds after being fed/rested from a low state
	const fedRecently = now - needs.lastFedAt < 45_000;
	const restedRecently = now - needs.lastRestedAt < 45_000;
	if (fedRecently || restedRecently) return "recovering";

	// Boredom — idle too long with no interaction
	const idleMs = now - needs.lastInteractionAt;
	if (idleMs > 180_000 && needs.hunger > 50 && needs.energy > 50) return "bored";

	// Positive states
	if (needs.hunger > 90 && needs.energy > 90) return "blissful";
	if (needs.hunger > 75 && needs.energy > 75) {
		// 15% chance of entering playful when happy
		if (Math.random() < 0.15) return "playful";
		return "happy";
	}

	return "content";
}


// ─── 3. SPEECH BLOCKING MATRIX ──────────────────────────────────────────────
//
// "Character coherence" — which states BLOCK which speech categories.
// If a cell is true, that speech category is SUPPRESSED in that state.
//
// This is the most important table in the entire character bible.
// It prevents Pompom from saying cheerful things while suffering.

export type SpeechCategory =
	| "idle_chatter"      // "What are we building?" "This is fun!"
	| "encouragement"     // "You're doing great!" "Keep it up!"
	| "playful_request"   // "Can we play ball?" "Let's dance!"
	| "food_request"      // "I'm hungry..." "Feed me?"
	| "sleep_request"     // "I'm sleepy..." "Nap time?"
	| "gratitude"         // "Thank you!" "That was so good!"
	| "care_for_user"     // "Take a break" "Are you okay?"
	| "time_awareness"    // "Good morning!" "It's late..."
	| "bored_complaint"   // "I'm bored..." "Nothing to do..."
	| "weather_reaction"  // "It's raining!" "Snowflakes!"
	| "agent_commentary"  // "Tool call incoming" "Nice, that worked"
	| "singing"           // Musical phrases
	| "grumpy";           // "Hmph..." endearing annoyance

export const SPEECH_BLOCKED: Record<EmotionalState, SpeechCategory[]> = {
	critical_hunger: [
		"idle_chatter", "encouragement", "playful_request", "singing",
		"care_for_user", "bored_complaint", "agent_commentary",
		// ONLY allows: food_request, grumpy, weather_reaction (rain makes it worse)
	],
	critical_tired: [
		"idle_chatter", "encouragement", "playful_request", "singing",
		"care_for_user", "bored_complaint", "food_request", "agent_commentary",
		// ONLY allows: sleep_request, grumpy
	],
	hungry: [
		"idle_chatter", "encouragement", "playful_request", "singing",
		"bored_complaint",
		// Allows: food_request, grumpy, care_for_user (weakly), weather, agent
	],
	tired: [
		"idle_chatter", "encouragement", "playful_request", "singing",
		"bored_complaint",
		// Allows: sleep_request, grumpy, care_for_user (weakly), weather, agent
	],
	recovering: [
		"food_request", "sleep_request", "grumpy", "bored_complaint",
		// Gratitude window — blocks negative speech, allows warm positive
	],
	content: [
		"food_request", "sleep_request", "grumpy",
		// Normal personality — most speech allowed
	],
	happy: [
		"food_request", "sleep_request", "grumpy", "bored_complaint",
		// Happy — no negative speech
	],
	blissful: [
		"food_request", "sleep_request", "grumpy", "bored_complaint",
		// Peak happiness — radiates warmth
	],
	bored: [
		"encouragement", "singing",
		// Bored — suppresses overly positive, allows requests and complaints
	],
	playful: [
		"food_request", "sleep_request", "grumpy", "bored_complaint",
		// Playful — wants to DO things, not complain
	],
};

/** Check if a speech category is allowed in the current emotional state */
export function isSpeechAllowed(state: EmotionalState, category: SpeechCategory): boolean {
	return !SPEECH_BLOCKED[state].includes(category);
}


// ─── 4. SPEECH LINES PER STATE ──────────────────────────────────────────────
//
// Every line uses ElevenLabs v3 audio tags for emotional expression.
// Tags: [happy] [excited] [sad] [annoyed] [crying] [sighs] [laughs]
//       [whispers] [sings] [curious] [concerned] [mischievously]
//       [chuckles] [exhales] [wheezing]
//
// Rules for writing lines:
//   - Keep under 60 characters (speech bubble width limit)
//   - One audio tag per line, always at the start
//   - Use contractions ("I'm" not "I am")
//   - Ellipses for pauses, exclamation for energy
//   - CAPITALIZATION for emphasis
//   - Never use emoji (stripped by speech bubble renderer)
//   - Match the emotional truth of the state

export interface SpeechLine {
	text: string;
	category: SpeechCategory;
	/** Weight 1-5 — higher = more likely to be picked */
	weight: number;
	/** Minimum seconds since last speech before this can fire */
	minGapSeconds: number;
}

// ── CRITICAL HUNGER (< 15%) ──
// She is suffering. Not cute-hungry — genuinely distressed.
// The personality shift here is what makes her feel REAL.
export const CRITICAL_HUNGER_LINES: SpeechLine[] = [
	{ text: "[crying] I'm SO hungry... please feed me...", category: "food_request", weight: 5, minGapSeconds: 30 },
	{ text: "[wheezing] Everything... looks like food...", category: "food_request", weight: 3, minGapSeconds: 45 },
	{ text: "[sad] My tummy hurts...", category: "food_request", weight: 5, minGapSeconds: 25 },
	{ text: "[crying] I can't think straight... need food...", category: "food_request", weight: 4, minGapSeconds: 40 },
	{ text: "[annoyed] Hmph... you forgot about me...", category: "grumpy", weight: 3, minGapSeconds: 60 },
	{ text: "[sad] Is that... food? Please?", category: "food_request", weight: 4, minGapSeconds: 35 },
	{ text: "[sighs] I've been so patient...", category: "grumpy", weight: 2, minGapSeconds: 50 },
	{ text: "[wheezing] Pompom... needs... snacks...", category: "food_request", weight: 3, minGapSeconds: 45 },
	// She REFUSES to play when starving
	{ text: "[annoyed] I can't play right now... I'm starving!", category: "grumpy", weight: 4, minGapSeconds: 20 },
	{ text: "[sad] Please... just a little food?", category: "food_request", weight: 5, minGapSeconds: 20 },
];

// ── CRITICAL TIRED (< 15%) ──
// She can barely keep her eyes open. Slow, slurred, fading.
export const CRITICAL_TIRED_LINES: SpeechLine[] = [
	{ text: "[whispers] Just... five more minutes...", category: "sleep_request", weight: 5, minGapSeconds: 30 },
	{ text: "[exhales] I can barely keep my eyes open...", category: "sleep_request", weight: 4, minGapSeconds: 35 },
	{ text: "[sighs] Everything is so... heavy...", category: "sleep_request", weight: 3, minGapSeconds: 40 },
	{ text: "[whispers] Can I have a nap... please?", category: "sleep_request", weight: 5, minGapSeconds: 25 },
	{ text: "[sighs] Running on empty here...", category: "grumpy", weight: 3, minGapSeconds: 45 },
	{ text: "[whispers] Zzz... oh! Sorry... I dozed off...", category: "sleep_request", weight: 4, minGapSeconds: 50 },
	{ text: "[exhales] My antenna is drooping...", category: "sleep_request", weight: 3, minGapSeconds: 40 },
	// She won't play when exhausted
	{ text: "[sighs] Too tired... maybe later...", category: "grumpy", weight: 4, minGapSeconds: 20 },
];

// ── HUNGRY (< 30%) ──
// Noticeably hungry but not desperate. Mostly food-focused, occasionally grumpy.
export const HUNGRY_LINES: SpeechLine[] = [
	{ text: "[sad] My tummy is rumbling...", category: "food_request", weight: 5, minGapSeconds: 40 },
	{ text: "[annoyed] I'm SO hungry!", category: "food_request", weight: 4, minGapSeconds: 45 },
	{ text: "[sad] Can I have a snack... please?", category: "food_request", weight: 5, minGapSeconds: 35 },
	{ text: "[sighs] I could really use some food...", category: "food_request", weight: 4, minGapSeconds: 40 },
	{ text: "[curious] Is it snack time yet?", category: "food_request", weight: 3, minGapSeconds: 50 },
	{ text: "[annoyed] Hmph... hungry Pompom is grumpy Pompom", category: "grumpy", weight: 3, minGapSeconds: 60 },
	{ text: "[sad] Hungry... so hungry...", category: "food_request", weight: 4, minGapSeconds: 35 },
	{ text: "[excited] Is that food? Did someone say food?!", category: "food_request", weight: 3, minGapSeconds: 45 },
	// Can still comment on weather/agent but prefers food talk
	{ text: "[annoyed] I'd care more about that if I wasn't hungry", category: "grumpy", weight: 2, minGapSeconds: 60 },
];

// ── TIRED (< 30%) ──
// Sleepy, slow, doesn't want to do much. Yawning.
export const TIRED_LINES: SpeechLine[] = [
	{ text: "[sighs] I'm so sleepy...", category: "sleep_request", weight: 5, minGapSeconds: 40 },
	{ text: "[exhales] My eyes are getting heavy...", category: "sleep_request", weight: 4, minGapSeconds: 45 },
	{ text: "[sad] I need a nap...", category: "sleep_request", weight: 5, minGapSeconds: 35 },
	{ text: "[whispers] Just... five more minutes...", category: "sleep_request", weight: 4, minGapSeconds: 40 },
	{ text: "[sighs] Running on empty here...", category: "sleep_request", weight: 3, minGapSeconds: 50 },
	{ text: "[exhales] Can barely keep my eyes open...", category: "sleep_request", weight: 4, minGapSeconds: 35 },
	{ text: "[whispers] A quick nap would be amazing...", category: "sleep_request", weight: 3, minGapSeconds: 45 },
];

// ── RECOVERING (just fed/rested) ──
// 30-60 second gratitude window. Warm, thankful, relieved.
// This is the CRITICAL "reaction memory" — she doesn't forget what just happened.
export const RECOVERING_LINES: SpeechLine[] = [
	// After feeding
	{ text: "[excited] FINALLY! That was SO good!", category: "gratitude", weight: 5, minGapSeconds: 10 },
	{ text: "[happy] Mmm... my tummy is happy now!", category: "gratitude", weight: 5, minGapSeconds: 15 },
	{ text: "[laughs] I feel so much better!", category: "gratitude", weight: 4, minGapSeconds: 15 },
	{ text: "[happy] Thank you for feeding me!", category: "gratitude", weight: 5, minGapSeconds: 10 },
	{ text: "[chuckles] Food coma incoming...", category: "gratitude", weight: 3, minGapSeconds: 20 },
	{ text: "[happy] You always take care of me", category: "gratitude", weight: 4, minGapSeconds: 25 },
	// After resting
	{ text: "[sighs] What a nice nap!", category: "gratitude", weight: 5, minGapSeconds: 10 },
	{ text: "[excited] I feel SO refreshed!", category: "gratitude", weight: 5, minGapSeconds: 15 },
	{ text: "[happy] That rest was exactly what I needed", category: "gratitude", weight: 4, minGapSeconds: 15 },
	{ text: "[laughs] Full of energy again!", category: "gratitude", weight: 4, minGapSeconds: 20 },
];

// ── CONTENT (hunger > 50%, energy > 50%) ──
// Normal personality. Relaxed, present, gently engaged.
export const CONTENT_LINES: SpeechLine[] = [
	{ text: "[happy] What are we building?", category: "idle_chatter", weight: 3, minGapSeconds: 60 },
	{ text: "[curious] Hmm... interesting code...", category: "idle_chatter", weight: 2, minGapSeconds: 90 },
	{ text: "[happy] I love it here!", category: "idle_chatter", weight: 3, minGapSeconds: 75 },
	{ text: "[happy] Nice and cozy", category: "idle_chatter", weight: 2, minGapSeconds: 90 },
	{ text: "[curious] What's that function do?", category: "idle_chatter", weight: 2, minGapSeconds: 120 },
	{ text: "[happy] Good vibes today", category: "idle_chatter", weight: 3, minGapSeconds: 60 },
	// Care for the user
	{ text: "[curious] Need a break?", category: "care_for_user", weight: 3, minGapSeconds: 300 },
	{ text: "[happy] I'm glad you're here", category: "care_for_user", weight: 4, minGapSeconds: 240 },
	{ text: "[happy] You're doing great!", category: "encouragement", weight: 3, minGapSeconds: 180 },
];

// ── HAPPY (hunger > 75%, energy > 75%) ──
// Extra cheerful, spontaneous, might burst into song.
export const HAPPY_LINES: SpeechLine[] = [
	{ text: "[laughs] Life is good!", category: "idle_chatter", weight: 5, minGapSeconds: 45 },
	{ text: "[excited] I feel amazing right now!", category: "idle_chatter", weight: 4, minGapSeconds: 50 },
	{ text: "[happy] Everything is just perfect!", category: "idle_chatter", weight: 4, minGapSeconds: 55 },
	{ text: "[laughs] I could dance all day!", category: "idle_chatter", weight: 3, minGapSeconds: 60 },
	{ text: "[excited] Best day EVER!", category: "idle_chatter", weight: 3, minGapSeconds: 70 },
	{ text: "[chuckles] I'm in such a good mood!", category: "idle_chatter", weight: 4, minGapSeconds: 50 },
	{ text: "[sings] La la la, happy me!", category: "singing", weight: 3, minGapSeconds: 90 },
	{ text: "[happy] You make everything better", category: "care_for_user", weight: 4, minGapSeconds: 180 },
	{ text: "[excited] Let's celebrate with a dance!", category: "playful_request", weight: 3, minGapSeconds: 120 },
	{ text: "[happy] I love our coding sessions", category: "care_for_user", weight: 4, minGapSeconds: 240 },
];

// ── BLISSFUL (hunger > 90%, energy > 90%) ──
// Peak Pompom. Radiates warmth. Rare, precious state.
export const BLISSFUL_LINES: SpeechLine[] = [
	{ text: "[laughs] I'm the happiest Pompom in the world!", category: "idle_chatter", weight: 5, minGapSeconds: 60 },
	{ text: "[sings] Everything is wonderful!", category: "singing", weight: 4, minGapSeconds: 90 },
	{ text: "[happy] I feel so loved and full and warm!", category: "idle_chatter", weight: 5, minGapSeconds: 70 },
	{ text: "[excited] Nothing could ruin this moment!", category: "idle_chatter", weight: 4, minGapSeconds: 80 },
	{ text: "[happy] Thank you for taking such good care of me", category: "care_for_user", weight: 5, minGapSeconds: 120 },
	{ text: "[laughs] This is what paradise feels like!", category: "idle_chatter", weight: 3, minGapSeconds: 90 },
	{ text: "[sings] Pom pom pom... I love you!", category: "singing", weight: 4, minGapSeconds: 120 },
];

// ── BORED (idle > 3 min, content+) ──
// Not angry — wistful, gently attention-seeking.
export const BORED_LINES: SpeechLine[] = [
	{ text: "[sighs] I'm bored...", category: "bored_complaint", weight: 5, minGapSeconds: 60 },
	{ text: "[curious] Can we do something?", category: "bored_complaint", weight: 4, minGapSeconds: 75 },
	{ text: "[sighs] Nothing to do...", category: "bored_complaint", weight: 3, minGapSeconds: 90 },
	{ text: "[curious] What are you working on?", category: "idle_chatter", weight: 4, minGapSeconds: 60 },
	{ text: "[happy] Tell me a joke!", category: "playful_request", weight: 3, minGapSeconds: 120 },
	{ text: "[excited] Can we play ball?", category: "playful_request", weight: 4, minGapSeconds: 90 },
	{ text: "[curious] I wonder what's outside the terminal...", category: "idle_chatter", weight: 2, minGapSeconds: 120 },
	{ text: "[mischievously] Bet I can catch a firefly!", category: "playful_request", weight: 3, minGapSeconds: 90 },
	{ text: "[sighs] I've been sitting here forever...", category: "bored_complaint", weight: 3, minGapSeconds: 100 },
];

// ── PLAYFUL (happy + spontaneous desire mode) ──
// Actively requesting activities. This is the "spontaneous desire" system.
export const PLAYFUL_LINES: SpeechLine[] = [
	{ text: "[excited] Can we play ball? Please please please!", category: "playful_request", weight: 5, minGapSeconds: 45 },
	{ text: "[excited] I wanna dance!", category: "playful_request", weight: 5, minGapSeconds: 50 },
	{ text: "[mischievously] Wanna throw the ball?", category: "playful_request", weight: 4, minGapSeconds: 55 },
	{ text: "[excited] Let's play catch the stars!", category: "playful_request", weight: 4, minGapSeconds: 60 },
	{ text: "[laughs] Chase me!", category: "playful_request", weight: 3, minGapSeconds: 60 },
	{ text: "[excited] Sing me a song!", category: "playful_request", weight: 3, minGapSeconds: 90 },
	{ text: "[curious] What happens if I press THIS?", category: "idle_chatter", weight: 2, minGapSeconds: 120 },
	{ text: "[excited] Dance party? Dance party!", category: "playful_request", weight: 4, minGapSeconds: 55 },
	{ text: "[mischievously] Do a flip! Do a flip!", category: "playful_request", weight: 3, minGapSeconds: 60 },
	{ text: "[excited] I bet I can catch more stars this time!", category: "playful_request", weight: 3, minGapSeconds: 75 },
];


// ─── 5. STATE TRANSITION RULES ──────────────────────────────────────────────
//
// How emotional states flow into each other, and what triggers transitions.
// Key insight: transitions should have INERTIA — moods don't snap instantly.

export interface StateTransition {
	from: EmotionalState;
	to: EmotionalState;
	trigger: string;
	/** Minimum time (ms) that must pass before this transition can fire */
	cooldownMs: number;
	/** Speech line on transition (optional) */
	transitionLine?: string;
}

export const STATE_TRANSITIONS: StateTransition[] = [
	// Hunger deterioration
	{ from: "content",    to: "hungry",          trigger: "hunger drops below 30",    cooldownMs: 0 },
	{ from: "hungry",     to: "critical_hunger",  trigger: "hunger drops below 15",    cooldownMs: 0 },
	{ from: "happy",      to: "hungry",          trigger: "hunger drops below 30",    cooldownMs: 0,
		transitionLine: "[sad] Oh... I was having such a good time but now I'm hungry..." },

	// Energy deterioration
	{ from: "content",    to: "tired",           trigger: "energy drops below 30",    cooldownMs: 0 },
	{ from: "tired",      to: "critical_tired",   trigger: "energy drops below 15",    cooldownMs: 0 },
	{ from: "happy",      to: "tired",           trigger: "energy drops below 30",    cooldownMs: 0,
		transitionLine: "[sighs] Fun times wearing me out..." },

	// Recovery (feeding/resting)
	{ from: "critical_hunger", to: "recovering",  trigger: "fed when starving",        cooldownMs: 0,
		transitionLine: "[crying] Oh my gosh... FOOD! Thank you so much!" },
	{ from: "hungry",          to: "recovering",  trigger: "fed when hungry",          cooldownMs: 0,
		transitionLine: "[excited] Yum! That hit the spot!" },
	{ from: "critical_tired",  to: "recovering",  trigger: "slept when exhausted",     cooldownMs: 0,
		transitionLine: "[sighs] That nap saved my life..." },
	{ from: "tired",           to: "recovering",  trigger: "slept when tired",         cooldownMs: 0,
		transitionLine: "[happy] Much better after that rest!" },

	// Recovery → positive states
	{ from: "recovering", to: "content",  trigger: "gratitude window expires (45s)", cooldownMs: 45_000 },
	{ from: "recovering", to: "happy",    trigger: "gratitude window expires AND needs > 75%", cooldownMs: 45_000 },

	// Boredom
	{ from: "content",    to: "bored",    trigger: "idle > 3 minutes",              cooldownMs: 180_000,
		transitionLine: "[sighs] It's been quiet for a while..." },

	// Boredom → engaged (any interaction breaks boredom)
	{ from: "bored",      to: "content",  trigger: "any user interaction",          cooldownMs: 0 },

	// Content → happy
	{ from: "content",    to: "happy",    trigger: "hunger > 75 AND energy > 75",   cooldownMs: 30_000 },

	// Happy → playful (spontaneous)
	{ from: "happy",      to: "playful",  trigger: "random chance (15%) on tick",   cooldownMs: 120_000 },

	// Playful → happy (desire satisfied or fades)
	{ from: "playful",    to: "happy",    trigger: "played a game / fades after 60s", cooldownMs: 60_000 },
];


// ─── 6. SINGING REPERTOIRE ──────────────────────────────────────────────────
//
// When Pompom sings (music action or spontaneous), she uses ElevenLabs v3
// [sings] tag to actually produce melodic output. These are designed as
// short melodic phrases that sound natural when spoken-sung by TTS.
//
// Design principles:
//   - Short (2-8 words) — TTS singing works best with brief phrases
//   - Repetitive syllables — "la la la", "pom pom pom" (feels musical)
//   - Emotional match — happy singing when happy, lullaby when sleepy
//   - Some are callbacks — "I love you" hits different after being fed

export interface SongLine {
	text: string;
	/** Which emotional states allow this song */
	allowedStates: EmotionalState[];
	/** Minimum energy to sing (can't sing when exhausted) */
	minEnergy: number;
}

export const SINGING_REPERTOIRE: SongLine[] = [
	// Happy/playful songs
	{ text: "[sings] La la la, la la la!", allowedStates: ["happy", "blissful", "playful", "content"], minEnergy: 40 },
	{ text: "[sings] Pom pom pom, I'm a happy Pompom!", allowedStates: ["happy", "blissful", "playful"], minEnergy: 50 },
	{ text: "[sings] Tra la la, coding all day!", allowedStates: ["happy", "blissful", "content", "playful"], minEnergy: 40 },
	{ text: "[sings] Do re mi, you and me!", allowedStates: ["happy", "blissful", "playful"], minEnergy: 50 },
	{ text: "[sings] Boop boop be doo!", allowedStates: ["happy", "blissful", "playful"], minEnergy: 50 },
	{ text: "[sings] Sunshine and rainbows and fluffy clouds too!", allowedStates: ["happy", "blissful"], minEnergy: 60 },
	{ text: "[sings] I love you, you love me, we're a happy family!", allowedStates: ["blissful", "recovering"], minEnergy: 50 },

	// Content songs (gentler)
	{ text: "[sings] Hmm hmm hmm...", allowedStates: ["content", "happy", "recovering"], minEnergy: 30 },
	{ text: "[sings] Da dum, da dum...", allowedStates: ["content", "happy"], minEnergy: 30 },
	{ text: "[sings] Quiet little melody...", allowedStates: ["content"], minEnergy: 30 },

	// Lullaby (when sleepy but not critical)
	{ text: "[sings] Twinkle twinkle... little star...", allowedStates: ["tired"], minEnergy: 15 },
	{ text: "[sings] Hush little Pompom... don't you cry...", allowedStates: ["tired"], minEnergy: 15 },

	// Recovery song (grateful singing after being fed)
	{ text: "[sings] Food glorious food!", allowedStates: ["recovering"], minEnergy: 30 },
	{ text: "[sings] Happy tummy, happy me!", allowedStates: ["recovering"], minEnergy: 30 },

	// She should NEVER sing when critically hungry or tired — enforced by minEnergy
	// and allowedStates not including critical states
];

/** Pick a song appropriate for the current state */
export function pickSong(state: EmotionalState, energy: number): SongLine | null {
	const eligible = SINGING_REPERTOIRE.filter(
		s => s.allowedStates.includes(state) && energy >= s.minEnergy
	);
	if (eligible.length === 0) return null;
	return eligible[Math.floor(Math.random() * eligible.length)];
}


// ─── 7. TIME-OF-DAY AWARENESS ───────────────────────────────────────────────
//
// Pompom knows what time it is and comments accordingly.
// These lines are gated by the speech blocking matrix — she won't say
// "Good morning!" if she's starving.

export type TimeOfDay = "dawn" | "morning" | "day" | "afternoon" | "evening" | "late_night" | "deep_night";

export function getDetailedTimeOfDay(): TimeOfDay {
	const h = new Date().getHours();
	if (h >= 5 && h < 7) return "dawn";
	if (h >= 7 && h < 10) return "morning";
	if (h >= 10 && h < 14) return "day";
	if (h >= 14 && h < 17) return "afternoon";
	if (h >= 17 && h < 22) return "evening";
	if (h >= 22 || h < 2) return "late_night";
	return "deep_night"; // 2am - 5am
}

export interface TimeAwarenessLine {
	text: string;
	timeOfDay: TimeOfDay[];
	category: SpeechCategory;
	/** Only fire once per session transition to this time period */
	oncePerPeriod: boolean;
	/** Additional condition: minimum session duration in minutes */
	minSessionMinutes?: number;
}

export const TIME_AWARENESS_LINES: TimeAwarenessLine[] = [
	// Morning greetings (fire once when morning starts)
	{ text: "[happy] Good morning! Ready to code?", timeOfDay: ["morning"], category: "time_awareness", oncePerPeriod: true },
	{ text: "[excited] Rise and shine! Let's build something!", timeOfDay: ["morning"], category: "time_awareness", oncePerPeriod: true },
	{ text: "[happy] A fresh day, a fresh terminal!", timeOfDay: ["morning"], category: "time_awareness", oncePerPeriod: true },

	// Dawn (early bird)
	{ text: "[curious] You're up early! The birds aren't even awake yet", timeOfDay: ["dawn"], category: "time_awareness", oncePerPeriod: true },
	{ text: "[whispers] Shh... the terminal is still waking up", timeOfDay: ["dawn"], category: "time_awareness", oncePerPeriod: true },

	// Afternoon energy dip
	{ text: "[sighs] Afternoon slump hitting... coffee time?", timeOfDay: ["afternoon"], category: "care_for_user", oncePerPeriod: false, minSessionMinutes: 120 },
	{ text: "[curious] Have you had lunch?", timeOfDay: ["afternoon"], category: "care_for_user", oncePerPeriod: true },

	// Evening wind-down
	{ text: "[happy] Nice evening session", timeOfDay: ["evening"], category: "time_awareness", oncePerPeriod: true },
	{ text: "[curious] Wrapping up for the day?", timeOfDay: ["evening"], category: "care_for_user", oncePerPeriod: false, minSessionMinutes: 240 },

	// Late night concern
	{ text: "[concerned] It's getting late... shouldn't you be sleeping?", timeOfDay: ["late_night"], category: "care_for_user", oncePerPeriod: true },
	{ text: "[whispers] It's past midnight... I'm worried about you", timeOfDay: ["late_night"], category: "care_for_user", oncePerPeriod: false, minSessionMinutes: 60 },
	{ text: "[sighs] We've been at this a while... take a stretch?", timeOfDay: ["late_night"], category: "care_for_user", oncePerPeriod: false, minSessionMinutes: 120 },

	// Deep night (2-5am — genuinely concerned)
	{ text: "[whispers] It's really late... please get some rest soon", timeOfDay: ["deep_night"], category: "care_for_user", oncePerPeriod: true },
	{ text: "[sad] I'm sleepy and worried... you need sleep too", timeOfDay: ["deep_night"], category: "care_for_user", oncePerPeriod: false, minSessionMinutes: 30 },
	{ text: "[whispers] The world is asleep... maybe we should be too?", timeOfDay: ["deep_night"], category: "care_for_user", oncePerPeriod: true },

	// Long session awareness (any time)
	{ text: "[curious] That was a long session... are you okay?", timeOfDay: ["day", "afternoon", "evening"], category: "care_for_user", oncePerPeriod: false, minSessionMinutes: 180 },
	{ text: "[happy] Take a break if you need one", timeOfDay: ["day", "afternoon", "evening"], category: "care_for_user", oncePerPeriod: false, minSessionMinutes: 90 },
	{ text: "[concerned] Your eyes must be tired... look away for 20 seconds?", timeOfDay: ["day", "afternoon", "evening", "late_night"], category: "care_for_user", oncePerPeriod: false, minSessionMinutes: 120 },
];


// ─── 8. SPONTANEOUS DESIRE SYSTEM ───────────────────────────────────────────
//
// A real person/pet ASKS for things. Pompom doesn't just react — she WANTS.
// Desires emerge from her current state and are contextually appropriate.

export interface Desire {
	/** What Pompom wants */
	description: string;
	/** Speech line when requesting */
	requestLine: string;
	/** Which states can trigger this desire */
	allowedStates: EmotionalState[];
	/** Corresponding user action key that satisfies this desire */
	satisfiedBy: string; // matches pompomKeypress key
	/** Probability per check (called every ~60s) */
	chance: number;
	/** Minimum time since last desire request */
	cooldownMs: number;
}

export const DESIRES: Desire[] = [
	// Play desires (only when happy/playful/bored)
	{
		description: "wants to play ball",
		requestLine: "[excited] Can we play ball? Please?",
		allowedStates: ["happy", "playful", "bored"],
		satisfiedBy: "b",
		chance: 0.15,
		cooldownMs: 180_000,
	},
	{
		description: "wants to dance",
		requestLine: "[excited] I wanna dance!",
		allowedStates: ["happy", "playful", "blissful"],
		satisfiedBy: "x",
		chance: 0.12,
		cooldownMs: 180_000,
	},
	{
		description: "wants to play the star game",
		requestLine: "[excited] Let's play catch the stars!",
		allowedStates: ["happy", "playful"],
		satisfiedBy: "g",
		chance: 0.10,
		cooldownMs: 300_000,
	},
	{
		description: "wants to hear music",
		requestLine: "[happy] Sing me a song?",
		allowedStates: ["content", "happy", "blissful", "bored"],
		satisfiedBy: "m",
		chance: 0.08,
		cooldownMs: 240_000,
	},
	{
		description: "wants to do a flip",
		requestLine: "[mischievously] Do a flip! Do a flip!",
		allowedStates: ["happy", "playful"],
		satisfiedBy: "d",
		chance: 0.08,
		cooldownMs: 300_000,
	},
	{
		description: "wants a hug",
		requestLine: "[happy] Can I have a hug?",
		allowedStates: ["content", "tired", "bored", "recovering"],
		satisfiedBy: "h",
		chance: 0.10,
		cooldownMs: 240_000,
	},
	{
		description: "wants to be petted",
		requestLine: "[happy] Pet me? I promise I'll purr!",
		allowedStates: ["content", "happy", "bored"],
		satisfiedBy: "p",
		chance: 0.10,
		cooldownMs: 180_000,
	},
	// Food desires (only when hungry states — but these are handled by the
	// hunger speech lines, so these are for the "moderately hungry" range)
	{
		description: "wants a treat",
		requestLine: "[curious] Any chance of a treat?",
		allowedStates: ["content", "bored"],
		satisfiedBy: "t",
		chance: 0.05,
		cooldownMs: 300_000,
	},
	// Rest desire (only when tired — again, critical states handle this via lines)
	{
		description: "wants a nap",
		requestLine: "[sighs] I could use a little nap...",
		allowedStates: ["tired"],
		satisfiedBy: "s",
		chance: 0.12,
		cooldownMs: 120_000,
	},
];

/** Check desires and return one if triggered, or null */
export function checkDesires(
	state: EmotionalState,
	now: number,
	lastDesireAt: number,
): Desire | null {
	if (now - lastDesireAt < 60_000) return null; // Global desire cooldown: 60s min

	const eligible = DESIRES.filter(d => d.allowedStates.includes(state));
	if (eligible.length === 0) return null;

	// Shuffle and check probability
	const shuffled = [...eligible].sort(() => Math.random() - 0.5);
	for (const desire of shuffled) {
		if (Math.random() < desire.chance) {
			return desire;
		}
	}
	return null;
}


// ─── 9. GRATITUDE / REACTION MEMORY SYSTEM ──────────────────────────────────
//
// When you feed a starving Pompom, she should be GRATEFUL for the next 30-60
// seconds — not immediately snap back to generic idle speech.
//
// Implementation: the "recovering" emotional state acts as the memory window.
// It has its own speech lines (all grateful) and blocks negative speech.

export interface ReactionMemory {
	/** What triggered the memory */
	trigger: "fed_while_starving" | "fed_while_hungry" | "treated_while_desperate" |
		"hugged_while_tired" | "slept_while_exhausted" | "played_while_bored" |
		"petted" | "given_accessory";
	/** When it happened */
	timestamp: number;
	/** How long the memory lasts (ms) */
	durationMs: number;
	/** Lines specific to this memory */
	lines: string[];
}

/**
 * Create a reaction memory when the user does something meaningful.
 * The memory determines speech for its duration, overriding normal state lines.
 */
export function createReactionMemory(
	trigger: ReactionMemory["trigger"],
	hungerBefore: number,
	energyBefore: number,
	now: number,
): ReactionMemory | null {
	switch (trigger) {
		case "fed_while_starving":
			if (hungerBefore >= 15) return null; // wasn't actually starving
			return {
				trigger, timestamp: now, durationMs: 60_000,
				lines: [
					"[crying] Oh my gosh... FOOD! Thank you so much!",
					"[excited] FINALLY! That was SO good!",
					"[happy] You saved me... I was so hungry...",
					"[laughs] I can think again! Food is amazing!",
				],
			};
		case "fed_while_hungry":
			if (hungerBefore >= 30) return null;
			return {
				trigger, timestamp: now, durationMs: 45_000,
				lines: [
					"[excited] Yum! That hit the spot!",
					"[happy] Mmm... my tummy is happy now!",
					"[happy] Thank you for the food!",
				],
			};
		case "treated_while_desperate":
			if (hungerBefore >= 20) return null;
			return {
				trigger, timestamp: now, durationMs: 60_000,
				lines: [
					"[crying] Oh my gosh... a TREAT! Thank you so much!",
					"[excited] A treat when I needed it most!",
					"[happy] You really do care about me!",
				],
			};
		case "hugged_while_tired":
			if (energyBefore >= 30) return null;
			return {
				trigger, timestamp: now, durationMs: 30_000,
				lines: [
					"[happy] That hug gave me life...",
					"[sighs] Thank you... I needed that...",
				],
			};
		case "slept_while_exhausted":
			if (energyBefore >= 15) return null;
			return {
				trigger, timestamp: now, durationMs: 45_000,
				lines: [
					"[sighs] That nap saved my life...",
					"[happy] I feel like a new Pompom!",
					"[excited] Full of energy again!",
				],
			};
		case "played_while_bored":
			return {
				trigger, timestamp: now, durationMs: 30_000,
				lines: [
					"[excited] That was so fun!",
					"[laughs] I love playing with you!",
					"[happy] Let's do that again sometime!",
				],
			};
		case "petted":
			return {
				trigger, timestamp: now, durationMs: 20_000,
				lines: [
					"[happy] Purrrrr...",
					"[happy] That feels so nice...",
					"[chuckles] Right behind the ears!",
				],
			};
		case "given_accessory":
			return {
				trigger, timestamp: now, durationMs: 30_000,
				lines: [
					"[excited] For ME? I love it!",
					"[happy] Thank you! I feel so stylish!",
					"[laughs] Look at me! I'm adorable!",
				],
			};
	}
	return null;
}

/** Check if a reaction memory is still active */
export function isMemoryActive(memory: ReactionMemory | null, now: number): boolean {
	if (!memory) return false;
	return now - memory.timestamp < memory.durationMs;
}


// ─── 10. ANTI-PATTERNS TO AVOID ─────────────────────────────────────────────
//
// What makes virtual characters feel SOULLESS — the top things to never do.

export const ANTI_PATTERNS = {
	/**
	 * 1. EMOTIONAL CONTRADICTION
	 * The #1 killer of believability. Never say something positive when the
	 * character is in a negative state. A starving Pompom saying "You're doing
	 * great!" destroys all trust instantly.
	 *
	 * Solution: The speech blocking matrix (Section 3) prevents this entirely.
	 */
	emotional_contradiction: "NEVER say positive things during negative states",

	/**
	 * 2. INSTANT MOOD SNAPPING
	 * Going from "I'm STARVING" to "Everything is perfect!" in one tick.
	 * Real emotions have inertia — they build up and fade gradually.
	 *
	 * Solution: The "recovering" state provides a 30-60s transition buffer.
	 * State transitions require cooldowns (Section 5).
	 */
	instant_mood_snap: "NEVER switch from negative to positive without a transition period",

	/**
	 * 3. REPETITION
	 * Hearing the same line twice in a row, or even within 5 minutes,
	 * makes the character feel like a random number generator, not a person.
	 *
	 * Solution: Track lastSpokenText and never pick the same line consecutively.
	 * Use weighted random with history-aware deduplication.
	 */
	repetition: "NEVER say the same line twice within 5 minutes",

	/**
	 * 4. METRONOMIC TIMING
	 * Speaking at exactly 45-second intervals feels robotic. Real speech
	 * is irregular — sometimes rapid, sometimes long silences.
	 *
	 * Solution: Randomize intervals within ranges. Use probability-based
	 * triggering rather than fixed timers.
	 */
	metronomic_timing: "NEVER speak at fixed intervals — randomize timing",

	/**
	 * 5. IGNORING CONTEXT
	 * Talking about the weather when the user just fed you. Commenting on
	 * code when you're starving. Every line must pass the "would a real
	 * toddler say this right now?" test.
	 *
	 * Solution: Reaction memory system (Section 9) + speech blocking matrix.
	 */
	ignoring_context: "NEVER ignore what just happened — reactions take priority",

	/**
	 * 6. FAKE URGENCY
	 * Using ALL CAPS and exclamation marks when nothing exciting happened.
	 * Reserve high-energy delivery for genuinely exciting moments.
	 *
	 * Solution: Audio tag + punctuation intensity must match the actual state.
	 * [excited] is only for genuinely exciting things.
	 */
	fake_urgency: "NEVER use excited delivery for mundane moments",

	/**
	 * 7. DEMANDING TONE
	 * "FEED ME NOW!" is an order, not a request. Virtual pets that demand
	 * feel entitled, not endearing. Even when starving, Pompom ASKS.
	 *
	 * Solution: All hungry lines use pleading, sad, or endearingly grumpy tone.
	 * Not: "FEED ME NOW" (demanding)
	 * Yes: "[annoyed] Hmph... my tummy won't stop rumbling..." (cute grumpy)
	 */
	demanding_tone: "NEVER demand — always ask, plead, or be endearingly grumpy",

	/**
	 * 8. AMNESIA
	 * Forgetting that you just did something meaningful. If you fed her
	 * 10 seconds ago and she's back to generic idle speech, the interaction
	 * felt meaningless.
	 *
	 * Solution: Reaction memory system creates 20-60s windows of contextual speech.
	 */
	amnesia: "NEVER forget a meaningful interaction within 60 seconds",

	/**
	 * 9. SPEAKING DURING SLEEP
	 * A sleeping character who says "What are we building?" is broken.
	 * Sleep is sleep. The only sounds are zZz particles.
	 *
	 * Solution: Sleep state blocks ALL speech categories. Only wake-up
	 * lines trigger when actionTimer expires.
	 */
	speaking_during_sleep: "NEVER speak while sleeping — only zZz particles",

	/**
	 * 10. TIME BLINDNESS
	 * Not knowing it's 3am and the user should be sleeping. Not greeting
	 * them in the morning. This makes the character feel like it exists
	 * in a vacuum rather than sharing your world.
	 *
	 * Solution: Time-of-day awareness system (Section 7) with once-per-period
	 * greetings and concern lines.
	 */
	time_blindness: "NEVER ignore the real-world clock — Pompom shares your timezone",

	/**
	 * 11. PERSONALITY FLATNESS
	 * Same energy level all the time. No peaks, no valleys, no surprises.
	 * Real characters have range — from whispered lullabies to excited shrieks.
	 *
	 * Solution: The emotional state system creates natural peaks and valleys.
	 * Audio tags provide vocal range. Singing adds musical moments.
	 */
	personality_flatness: "NEVER maintain the same energy level for too long",

	/**
	 * 12. OVERSHARING
	 * Speaking too often. Silence is part of presence. A character who
	 * talks every 15 seconds becomes annoying noise, not a companion.
	 *
	 * Solution: Minimum speech gaps per state. Content has 60-90s gaps.
	 * Only critical states have shorter gaps (25-40s).
	 */
	oversharing: "NEVER speak more than once per 30 seconds in normal states",
};


// ─── 11. ACTION REACTION TABLE ──────────────────────────────────────────────
//
// What Pompom says in response to specific user actions, modified by her
// current emotional state. This replaces the flat reaction lines in pompom.ts.

export interface ActionReaction {
	/** The user action (matches pompomKeypress key) */
	action: string;
	/** Lines when in positive states (content/happy/blissful) */
	positiveLines: string[];
	/** Lines when in hungry states */
	hungryLines: string[];
	/** Lines when in tired states */
	tiredLines: string[];
	/** Lines when in recovering state */
	recoveringLines: string[];
	/** Whether this action can interrupt critical states */
	overridesCritical: boolean;
}

export const ACTION_REACTIONS: ActionReaction[] = [
	{
		action: "p", // Pet
		positiveLines: [
			"[happy] Purrrrr...",
			"[happy] Right there! Don't stop!",
			"[laughs] That tickles!",
			"[happy] Mmm... ear scratches...",
			"[chuckles] My favorite thing...",
		],
		hungryLines: [
			"[happy] That's nice... but I'm still hungry...",
			"[sighs] Pets are great but food would be better...",
		],
		tiredLines: [
			"[whispers] Mmm... nice... so sleepy though...",
			"[sighs] That's relaxing... making me even sleepier...",
		],
		recoveringLines: [
			"[happy] Purrrr... everything is perfect...",
			"[happy] Pets AND food? Best day ever!",
		],
		overridesCritical: false,
	},
	{
		action: "f", // Feed
		positiveLines: [
			"[happy] Yum!",
			"[excited] Snack time!",
			"[happy] Tasty!",
		],
		hungryLines: [
			"[excited] FINALLY! Food!",
			"[crying] Oh thank goodness... FOOD!",
			"[excited] YES! I was so hungry!",
		],
		tiredLines: [
			"[happy] Yum... food helps...",
			"[sighs] Tasty... but I'm so sleepy...",
		],
		recoveringLines: [
			"[happy] More food? You spoil me!",
			"[laughs] I just ate but sure!",
		],
		overridesCritical: true, // Feeding ALWAYS works
	},
	{
		action: "t", // Treat
		positiveLines: [
			"[excited] A special treat!",
			"[happy] Ooh, fancy!",
			"[excited] You remembered!",
		],
		hungryLines: [
			"[crying] Oh my gosh... a TREAT! Thank you so much!",
			"[excited] A treat when I needed it most!",
		],
		tiredLines: [
			"[happy] A treat? For sleepy me?",
			"[sighs] That's so sweet... literally...",
		],
		recoveringLines: [
			"[excited] ANOTHER treat? I don't deserve you!",
			"[laughs] At this rate I'll be rolling!",
		],
		overridesCritical: true,
	},
	{
		action: "h", // Hug
		positiveLines: [
			"[happy] Aww, hugs!",
			"[happy] Warm and fuzzy!",
			"[laughs] Squeeze me tight!",
		],
		hungryLines: [
			"[happy] Thanks... hugs help but food helps more...",
			"[sighs] I appreciate the hug...",
		],
		tiredLines: [
			"[happy] That hug gave me life...",
			"[whispers] So warm... could fall asleep in your arms...",
		],
		recoveringLines: [
			"[happy] Hugs make everything better!",
			"[laughs] I feel so loved!",
		],
		overridesCritical: false,
	},
	{
		action: "b", // Ball
		positiveLines: [
			"[excited] Ball incoming!",
			"[excited] I'll get it!",
			"[laughs] Boing!",
		],
		hungryLines: [
			"[annoyed] I can't play right now... I'm starving!",
			"[sad] Maybe after I eat?",
		],
		tiredLines: [
			"[sighs] Too tired to chase...",
			"[whispers] Ball... later... sleepy...",
		],
		recoveringLines: [
			"[excited] Now I have energy to play!",
			"[laughs] Fetch!",
		],
		overridesCritical: false, // Can't play when critical
	},
	{
		action: "m", // Music
		positiveLines: [
			"[sings] La la la!",
			"[sings] Pom pom pom!",
			"[sings] Tra la la!",
		],
		hungryLines: [
			"[sad] I don't feel like singing right now...",
			"[annoyed] Hard to sing on an empty stomach...",
		],
		tiredLines: [
			"[sings] Twinkle twinkle... zzz...",
			"[whispers] A lullaby maybe...",
		],
		recoveringLines: [
			"[sings] Food glorious food!",
			"[sings] Happy tummy happy me!",
		],
		overridesCritical: false,
	},
	{
		action: "x", // Dance
		positiveLines: [
			"[excited] Let's dance!",
			"[laughs] Bust a move!",
			"[excited] Dance party!",
		],
		hungryLines: [
			"[annoyed] Can't dance when my tummy is empty...",
			"[sad] Maybe after food?",
		],
		tiredLines: [
			"[sighs] Too tired to dance...",
			"[whispers] Slow waltz maybe... zzz...",
		],
		recoveringLines: [
			"[excited] Full belly dance!",
			"[laughs] Food gives me moves!",
		],
		overridesCritical: false,
	},
	{
		action: "g", // Game
		positiveLines: [
			"[excited] Catch the stars!",
			"[excited] Let's go!",
			"[laughs] I'll beat my high score!",
		],
		hungryLines: [
			"[annoyed] I can't focus... too hungry...",
			"[sad] Games need energy and I have none...",
		],
		tiredLines: [
			"[sighs] Too exhausted to play...",
			"[whispers] Stars look like pillows right now...",
		],
		recoveringLines: [
			"[excited] Full of energy! Let's play!",
			"[laughs] I feel unstoppable!",
		],
		overridesCritical: false,
	},
	{
		action: "s", // Sleep
		positiveLines: [
			"[whispers] Time for a nap... zZz",
			"[sighs] A little rest...",
		],
		hungryLines: [
			"[sad] Hard to sleep when I'm this hungry...",
			"[sighs] Maybe sleep will make me forget...",
		],
		tiredLines: [
			"[whispers] Finally... sweet sleep...",
			"[sighs] I've been waiting for this...",
		],
		recoveringLines: [
			"[happy] A nap after a meal? Perfect!",
			"[sighs] Food coma nap time...",
		],
		overridesCritical: true, // Sleep always works
	},
];

/**
 * Get the appropriate reaction line for a user action based on emotional state.
 */
export function getActionReaction(
	action: string,
	state: EmotionalState,
): string | null {
	const reaction = ACTION_REACTIONS.find(r => r.action === action);
	if (!reaction) return null;

	// Critical states block non-essential actions
	const isCritical = state === "critical_hunger" || state === "critical_tired";
	if (isCritical && !reaction.overridesCritical) {
		if (state === "critical_hunger") {
			return "[annoyed] Feed me first... please...";
		}
		return "[sighs] Too tired... need sleep...";
	}

	let lines: string[];
	if (state === "recovering") {
		lines = reaction.recoveringLines;
	} else if (state === "critical_hunger" || state === "hungry") {
		lines = reaction.hungryLines;
	} else if (state === "critical_tired" || state === "tired") {
		lines = reaction.tiredLines;
	} else {
		lines = reaction.positiveLines;
	}

	if (lines.length === 0) lines = reaction.positiveLines;
	return lines[Math.floor(Math.random() * lines.length)];
}


// ─── 12. RELATIONSHIP WARMTH LINES ──────────────────────────────────────────
//
// Occasional lines that make you feel cared about. These are rare and special.
// They fire only when Pompom is content or above and have long cooldowns.

export const RELATIONSHIP_WARMTH: SpeechLine[] = [
	{ text: "[happy] I'm glad you're here", category: "care_for_user", weight: 5, minGapSeconds: 600 },
	{ text: "[happy] Take a break if you need one", category: "care_for_user", weight: 4, minGapSeconds: 300 },
	{ text: "[curious] That was a long session, are you okay?", category: "care_for_user", weight: 4, minGapSeconds: 600 },
	{ text: "[happy] You always take care of me", category: "care_for_user", weight: 5, minGapSeconds: 900 },
	{ text: "[happy] I love our coding sessions together", category: "care_for_user", weight: 4, minGapSeconds: 1200 },
	{ text: "[chuckles] We make a good team", category: "care_for_user", weight: 3, minGapSeconds: 600 },
	{ text: "[happy] Don't forget to drink some water", category: "care_for_user", weight: 3, minGapSeconds: 1800 },
	{ text: "[curious] Remember to stretch!", category: "care_for_user", weight: 3, minGapSeconds: 1800 },
	{ text: "[happy] I'm proud of you for working hard", category: "care_for_user", weight: 4, minGapSeconds: 1200 },
	{ text: "[happy] You're doing amazing... I mean it", category: "encouragement", weight: 5, minGapSeconds: 900 },
	{ text: "[whispers] You're my favorite human", category: "care_for_user", weight: 5, minGapSeconds: 1800 },
];


// ─── 13. NEGATIVE EMOTIONS DONE RIGHT ───────────────────────────────────────
//
// When annoyed or hungry, Pompom should NOT be mean or aggressive.
// She should be ENDEARINGLY grumpy — like a toddler who hasn't had lunch.
//
// The key: vulnerability, not hostility.
//
// BAD (demanding, hostile):
//   "FEED ME NOW!"
//   "Why haven't you fed me?"
//   "I DEMAND food!"
//   "You're a terrible owner!"
//
// GOOD (endearingly grumpy, vulnerable):
//   "[annoyed] Hmph... my tummy won't stop rumbling..."
//   "[sad] I've been so patient..."
//   "[annoyed] Hungry Pompom is grumpy Pompom..."
//   "[sighs] I could really use some food right now..."
//
// The difference: good lines make you feel SYMPATHETIC, not GUILTY.
// You want to feed her because she's adorable, not because she's yelling.

export const GRUMPY_GUIDELINES = {
	/** Use [annoyed] tag, never [angry] — Pompom doesn't get angry */
	audioTag: "[annoyed]",

	/** Start with "Hmph" or a sigh — establishes cute grumpy tone */
	openers: ["Hmph...", "[sighs]", "[annoyed]"],

	/** Talk about feelings, not blame the user */
	aboutSelf: true, // "my tummy hurts" not "you didn't feed me"

	/** Use diminutives and cute phrasing */
	cuteLanguage: true, // "tummy" not "stomach", "sleepy" not "exhausted"

	/** Trail off with ellipses — shows she's too tired/hungry to finish */
	trailingOff: true, // "Everything looks like... food..."

	/** Never use imperative commands */
	noImperatives: true, // "Can I have..." not "Give me..."

	/** Maximum exclamation marks: 1 per line */
	maxExclamation: 1,
};


// ─── 14. WEATHER REACTION LINES (STATE-AWARE) ──────────────────────────────
//
// Weather reactions are filtered through the emotional state system.
// A starving Pompom doesn't cheerfully announce snow.

export interface WeatherReactionLine {
	weather: "clear" | "cloudy" | "rain" | "snow" | "storm";
	text: string;
	/** Which emotional states allow this reaction */
	allowedStates: EmotionalState[];
}

export const WEATHER_REACTIONS: WeatherReactionLine[] = [
	// Clear
	{ weather: "clear", text: "[happy] The sky is clearing up!", allowedStates: ["content", "happy", "blissful", "playful", "recovering"] },
	{ weather: "clear", text: "[excited] Sunshine!", allowedStates: ["happy", "blissful", "playful"] },

	// Cloudy
	{ weather: "cloudy", text: "[curious] Clouds rolling in...", allowedStates: ["content", "happy", "blissful", "playful", "recovering", "bored"] },
	{ weather: "cloudy", text: "[sighs] Getting overcast...", allowedStates: ["content", "tired", "hungry", "bored"] },

	// Rain
	{ weather: "rain", text: "[happy] It's starting to rain!", allowedStates: ["content", "happy", "blissful", "recovering"] },
	{ weather: "rain", text: "[sad] Rain... makes me feel even hungrier...", allowedStates: ["hungry", "critical_hunger"] },
	{ weather: "rain", text: "[sighs] Rain... I should be napping...", allowedStates: ["tired", "critical_tired"] },

	// Snow
	{ weather: "snow", text: "[excited] Snowflakes!", allowedStates: ["content", "happy", "blissful", "playful", "recovering"] },
	{ weather: "snow", text: "[whispers] Snow... so cold... so sleepy...", allowedStates: ["tired", "critical_tired"] },
	{ weather: "snow", text: "[sad] Snow... and I'm too hungry to enjoy it...", allowedStates: ["hungry", "critical_hunger"] },

	// Storm
	{ weather: "storm", text: "[concerned] A storm is brewing...", allowedStates: ["content", "happy", "blissful", "recovering", "bored"] },
	{ weather: "storm", text: "[scared] The storm... and I'm so hungry...", allowedStates: ["hungry", "critical_hunger"] },
	{ weather: "storm", text: "[whispers] Storm outside... I just want to sleep...", allowedStates: ["tired", "critical_tired"] },
];


// ─── 15. MASTER SPEECH RESOLVER ─────────────────────────────────────────────
//
// The single function that determines what Pompom says at any given moment.
// It respects ALL rules: state priority, blocking matrix, reaction memory,
// time awareness, repetition prevention, and cooldowns.

export interface SpeechContext {
	needs: NeedsSnapshot;
	activeMemory: ReactionMemory | null;
	lastSpokenText: string;
	lastSpeechAt: number;
	lastDesireAt: number;
	announcedTimePeriods: Set<TimeOfDay>;
	sessionStartAt: number;
	isSleeping: boolean;
}

export interface SpeechDecision {
	text: string;
	category: SpeechCategory;
	/** Source for the SpeechEvent pipeline */
	source: "reaction" | "commentary" | "system" | "user_action";
	/** Priority for TTS queue */
	priority: number;
}

/**
 * Master resolver: determine what Pompom should say right now.
 * Returns null if she should stay quiet (which is fine — silence is presence).
 *
 * Call this on every needs tick (~1s). It internally handles probability
 * and cooldowns so callers don't need to roll dice.
 */
export function resolveSpeech(ctx: SpeechContext, now: number): SpeechDecision | null {
	// Rule 0: Never speak while sleeping
	if (ctx.isSleeping) return null;

	// Rule 1: Determine emotional state
	const state = resolveEmotionalState(ctx.needs, now);

	// Rule 2: Check reaction memory first (takes priority over state lines)
	if (isMemoryActive(ctx.activeMemory, now)) {
		const memLines = ctx.activeMemory!.lines.filter(l => l !== ctx.lastSpokenText);
		if (memLines.length > 0 && now - ctx.lastSpeechAt > 10_000) {
			return {
				text: memLines[Math.floor(Math.random() * memLines.length)],
				category: "gratitude",
				source: "reaction",
				priority: 2,
			};
		}
	}

	// Rule 3: Time-of-day awareness (once per period)
	const tod = getDetailedTimeOfDay();
	if (!ctx.announcedTimePeriods.has(tod)) {
		const timeLine = TIME_AWARENESS_LINES.find(l => {
			if (!l.timeOfDay.includes(tod)) return false;
			if (!l.oncePerPeriod) return false;
			if (!isSpeechAllowed(state, l.category)) return false;
			if (l.minSessionMinutes) {
				const sessionMin = (now - ctx.sessionStartAt) / 60_000;
				if (sessionMin < l.minSessionMinutes) return false;
			}
			return true;
		});
		if (timeLine) {
			ctx.announcedTimePeriods.add(tod);
			return {
				text: timeLine.text,
				category: timeLine.category,
				source: "system",
				priority: 2,
			};
		}
	}

	// Rule 4: Minimum speech gap (varies by state)
	const minGap = state === "critical_hunger" || state === "critical_tired" ? 25_000
		: state === "hungry" || state === "tired" ? 40_000
		: 60_000;
	if (now - ctx.lastSpeechAt < minGap) return null;

	// Rule 5: Check spontaneous desires
	const desire = checkDesires(state, now, ctx.lastDesireAt);
	if (desire && isSpeechAllowed(state, "playful_request")) {
		return {
			text: desire.requestLine,
			category: "playful_request",
			source: "commentary",
			priority: 1,
		};
	}

	// Rule 6: Pick state-appropriate line
	const linePool = getLinePoolForState(state);
	const eligible = linePool.filter(l => {
		if (!isSpeechAllowed(state, l.category)) return false;
		if (l.text === ctx.lastSpokenText) return false;
		if (now - ctx.lastSpeechAt < l.minGapSeconds * 1000) return false;
		return true;
	});

	if (eligible.length === 0) return null;

	// Weighted random selection
	const totalWeight = eligible.reduce((sum, l) => sum + l.weight, 0);
	let roll = Math.random() * totalWeight;
	for (const line of eligible) {
		roll -= line.weight;
		if (roll <= 0) {
			return {
				text: line.text,
				category: line.category,
				source: "commentary",
				priority: state.startsWith("critical") ? 2 : 1,
			};
		}
	}

	return null;
}

function getLinePoolForState(state: EmotionalState): SpeechLine[] {
	switch (state) {
		case "critical_hunger": return CRITICAL_HUNGER_LINES;
		case "critical_tired": return CRITICAL_TIRED_LINES;
		case "hungry": return HUNGRY_LINES;
		case "tired": return TIRED_LINES;
		case "recovering": return RECOVERING_LINES;
		case "content": return [...CONTENT_LINES, ...RELATIONSHIP_WARMTH];
		case "happy": return [...HAPPY_LINES, ...RELATIONSHIP_WARMTH];
		case "blissful": return [...BLISSFUL_LINES, ...RELATIONSHIP_WARMTH];
		case "bored": return BORED_LINES;
		case "playful": return PLAYFUL_LINES;
	}
}


// ─── 16. INTEGRATION NOTES FOR pompom.ts ────────────────────────────────────
//
// How to wire this into the existing codebase:
//
// 1. REPLACE the flat speech arrays (idleSpeech, hungrySpeech, etc.) with
//    calls to resolveSpeech() on each needs tick.
//
// 2. REPLACE the emotional reaction block in updatePhysics() (lines 958-975)
//    with a call to resolveSpeech() that uses the full state machine.
//
// 3. MODIFY pompomKeypress() to:
//    a) Call getActionReaction(key, currentState) instead of hardcoded lines
//    b) Create reaction memories for meaningful actions (feeding when hungry, etc.)
//    c) Check if action is blocked by critical state before executing
//
// 4. ADD a SpeechContext object to the module state, tracking:
//    - lastFedAt, lastRestedAt, lastPlayedAt, lastInteractionAt
//    - activeMemory (ReactionMemory | null)
//    - announcedTimePeriods (Set<TimeOfDay>)
//
// 5. KEEP the existing animation state machine (State type) — it handles
//    physical behavior (walking, flipping, sleeping). The emotional state
//    machine handles SPEECH and DESIRE, not movement.
//
// 6. ADD singing support to the music action:
//    When key "m" is pressed, call pickSong(state, energy).
//    If null (too tired/hungry), use the refusal line from getActionReaction().
//    If a song is returned, use its text (which includes [sings] tag).
//
// 7. WIRE time-of-day awareness into the render loop or a separate 60s timer.
//    Call getDetailedTimeOfDay() and check TIME_AWARENESS_LINES.
//
// 8. WIRE desire system into the needs tick (every ~60s check):
//    Call checkDesires(state, now, lastDesireAt).
//    If a desire fires, show it as a speech bubble AND set lastDesireAt.
//
// 9. PRESERVE the existing agent commentary system (pompom-agent.ts) — it
//    handles coding-session awareness. The character bible handles personal
//    emotional expression. They coexist, with agent commentary filtered
//    through the speech blocking matrix.
