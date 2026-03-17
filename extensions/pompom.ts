/**
 * Pompom Companion — 3D raymarched virtual pet for Pi CLI.
 *
 * A full 3D raymarched creature with physics, particles, speech bubbles,
 * moods, and interactive commands. Driven by audio level for mouth animation.
 */

import type { SpeechEvent } from "./pompom-voice";
import { claimGreeting, getOtherInstances } from "./pompom-instance";
import * as path from "path";
import * as fs from "fs";
import os from "node:os";

// ─── Rendering Config ────────────────────────────────────────────────────────
// Widget dimensions — set once, used by renderPompom
let W = 50;
let H = 13; // character rows — visible but not dominant
const VIEW_OFFSET_Y = 0.12; // shift camera slightly down — balanced between sky (sun/moon) and ground

const PHYSICS_DT = 0.016; // 60fps physics sub-stepping

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function sanitizeSpeechText(text: string): string {
	return text.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
}

// ─── Pet State ───────────────────────────────────────────────────────────────
type State = "idle" | "walk" | "flip" | "sleep" | "excited" | "chasing" | "fetching" | "singing" | "offscreen" | "peek" | "dance" | "game";

// ─── Character Bible: Speech Lines Per State ────────────────────────────────

interface BibleSpeechLine {
	text: string;
	weight: number;
	minGapSeconds: number;
}

const CRITICAL_HUNGER_LINES: BibleSpeechLine[] = [
	{ text: "[crying] I'm SO hungry... please feed me...", weight: 5, minGapSeconds: 30 },
	{ text: "[wheezing] Everything... looks like food...", weight: 3, minGapSeconds: 45 },
	{ text: "[sad] My tummy hurts...", weight: 5, minGapSeconds: 25 },
	{ text: "[crying] I can't think straight... need food...", weight: 4, minGapSeconds: 40 },
	{ text: "[annoyed] Hmph... you forgot about me...", weight: 3, minGapSeconds: 60 },
	{ text: "[sad] Is that... food? Please?", weight: 4, minGapSeconds: 35 },
	{ text: "[sighs] I've been so patient...", weight: 2, minGapSeconds: 50 },
	{ text: "[wheezing] Pompom... needs... snacks...", weight: 3, minGapSeconds: 45 },
	{ text: "[annoyed] I can't play right now... I'm starving!", weight: 4, minGapSeconds: 20 },
	{ text: "[sad] Please... just a little food?", weight: 5, minGapSeconds: 20 },
];

const CRITICAL_TIRED_LINES: BibleSpeechLine[] = [
	{ text: "[whispers] Just... five more minutes...", weight: 5, minGapSeconds: 30 },
	{ text: "[exhales] I can barely keep my eyes open...", weight: 4, minGapSeconds: 35 },
	{ text: "[sighs] Everything is so... heavy...", weight: 3, minGapSeconds: 40 },
	{ text: "[whispers] Can I have a nap... please?", weight: 5, minGapSeconds: 25 },
	{ text: "[sighs] Running on empty here...", weight: 3, minGapSeconds: 45 },
	{ text: "[whispers] Zzz... oh! Sorry... I dozed off...", weight: 4, minGapSeconds: 50 },
	{ text: "[exhales] My antenna is drooping...", weight: 3, minGapSeconds: 40 },
	{ text: "[sighs] Too tired... maybe later...", weight: 4, minGapSeconds: 20 },
];

const HUNGRY_LINES: BibleSpeechLine[] = [
	{ text: "[sad] My tummy is rumbling...", weight: 5, minGapSeconds: 40 },
	{ text: "[annoyed] I'm SO hungry!", weight: 4, minGapSeconds: 45 },
	{ text: "[sad] Can I have a snack... please?", weight: 5, minGapSeconds: 35 },
	{ text: "[sighs] I could really use some food...", weight: 4, minGapSeconds: 40 },
	{ text: "[curious] Is it snack time yet?", weight: 3, minGapSeconds: 50 },
	{ text: "[annoyed] Hmph... hungry Pompom is grumpy Pompom", weight: 3, minGapSeconds: 60 },
	{ text: "[sad] Hungry... so hungry...", weight: 4, minGapSeconds: 35 },
	{ text: "[excited] Is that food? Did someone say food?!", weight: 3, minGapSeconds: 45 },
	{ text: "[annoyed] I'd care more about that if I wasn't hungry", weight: 2, minGapSeconds: 60 },
];

const TIRED_LINES: BibleSpeechLine[] = [
	{ text: "[sighs] I'm so sleepy...", weight: 5, minGapSeconds: 40 },
	{ text: "[exhales] My eyes are getting heavy...", weight: 4, minGapSeconds: 45 },
	{ text: "[sad] I need a nap...", weight: 5, minGapSeconds: 35 },
	{ text: "[whispers] Just... five more minutes...", weight: 4, minGapSeconds: 40 },
	{ text: "[sighs] Running on empty here...", weight: 3, minGapSeconds: 50 },
	{ text: "[exhales] Can barely keep my eyes open...", weight: 4, minGapSeconds: 35 },
	{ text: "[whispers] A quick nap would be amazing...", weight: 3, minGapSeconds: 45 },
];

const RECOVERING_LINES: BibleSpeechLine[] = [
	{ text: "[excited] FINALLY! That was SO good!", weight: 5, minGapSeconds: 10 },
	{ text: "[happy] Mmm... my tummy is happy now!", weight: 5, minGapSeconds: 15 },
	{ text: "[laughs] I feel so much better!", weight: 4, minGapSeconds: 15 },
	{ text: "[happy] Thank you for feeding me!", weight: 5, minGapSeconds: 10 },
	{ text: "[chuckles] Food coma incoming...", weight: 3, minGapSeconds: 20 },
	{ text: "[happy] You always take care of me", weight: 4, minGapSeconds: 25 },
	{ text: "[sighs] What a nice nap!", weight: 5, minGapSeconds: 10 },
	{ text: "[excited] I feel SO refreshed!", weight: 5, minGapSeconds: 15 },
	{ text: "[happy] That rest was exactly what I needed", weight: 4, minGapSeconds: 15 },
	{ text: "[laughs] Full of energy again!", weight: 4, minGapSeconds: 20 },
];

const CONTENT_LINES: BibleSpeechLine[] = [
	{ text: "[happy] What are we building?", weight: 3, minGapSeconds: 60 },
	{ text: "[curious] Hmm... interesting code...", weight: 2, minGapSeconds: 90 },
	{ text: "[happy] I love it here!", weight: 3, minGapSeconds: 75 },
	{ text: "[happy] Nice and cozy", weight: 2, minGapSeconds: 90 },
	{ text: "[curious] What's that function do?", weight: 2, minGapSeconds: 120 },
	{ text: "[happy] Good vibes today", weight: 3, minGapSeconds: 60 },
	{ text: "[curious] Need a break?", weight: 3, minGapSeconds: 300 },
	{ text: "[happy] I'm glad you're here", weight: 4, minGapSeconds: 240 },
	{ text: "[happy] You're doing great!", weight: 3, minGapSeconds: 180 },
];

const HAPPY_LINES: BibleSpeechLine[] = [
	{ text: "[laughs] Life is good!", weight: 5, minGapSeconds: 45 },
	{ text: "[excited] I feel amazing right now!", weight: 4, minGapSeconds: 50 },
	{ text: "[happy] Everything is just perfect!", weight: 4, minGapSeconds: 55 },
	{ text: "[laughs] I could dance all day!", weight: 3, minGapSeconds: 60 },
	{ text: "[excited] Best day EVER!", weight: 3, minGapSeconds: 70 },
	{ text: "[chuckles] I'm in such a good mood!", weight: 4, minGapSeconds: 50 },
	{ text: "[sings] La la la, happy me!", weight: 3, minGapSeconds: 90 },
	{ text: "[happy] You make everything better", weight: 4, minGapSeconds: 180 },
	{ text: "[excited] Let's celebrate with a dance!", weight: 3, minGapSeconds: 120 },
	{ text: "[happy] I love our coding sessions", weight: 4, minGapSeconds: 240 },
];

const BLISSFUL_LINES: BibleSpeechLine[] = [
	{ text: "[laughs] I'm the happiest Pompom in the world!", weight: 5, minGapSeconds: 60 },
	{ text: "[sings] Everything is wonderful!", weight: 4, minGapSeconds: 90 },
	{ text: "[happy] I feel so loved and full and warm!", weight: 5, minGapSeconds: 70 },
	{ text: "[excited] Nothing could ruin this moment!", weight: 4, minGapSeconds: 80 },
	{ text: "[happy] Thank you for taking such good care of me", weight: 5, minGapSeconds: 120 },
	{ text: "[laughs] This is what paradise feels like!", weight: 3, minGapSeconds: 90 },
	{ text: "[sings] Pom pom pom... I love you!", weight: 4, minGapSeconds: 120 },
];

const BORED_LINES: BibleSpeechLine[] = [
	{ text: "[sighs] I'm bored...", weight: 5, minGapSeconds: 60 },
	{ text: "[curious] Can we do something?", weight: 4, minGapSeconds: 75 },
	{ text: "[sighs] Nothing to do...", weight: 3, minGapSeconds: 90 },
	{ text: "[curious] What are you working on?", weight: 4, minGapSeconds: 60 },
	{ text: "[happy] Tell me a joke!", weight: 3, minGapSeconds: 120 },
	{ text: "[excited] Can we play ball?", weight: 4, minGapSeconds: 90 },
	{ text: "[curious] I wonder what's outside the terminal...", weight: 2, minGapSeconds: 120 },
	{ text: "[mischievously] Bet I can catch a firefly!", weight: 3, minGapSeconds: 90 },
	{ text: "[sighs] I've been sitting here forever...", weight: 3, minGapSeconds: 100 },
];

const PLAYFUL_LINES: BibleSpeechLine[] = [
	{ text: "[excited] Can we play ball? Please please please!", weight: 5, minGapSeconds: 45 },
	{ text: "[excited] I wanna dance!", weight: 5, minGapSeconds: 50 },
	{ text: "[mischievously] Wanna throw the ball?", weight: 4, minGapSeconds: 55 },
	{ text: "[excited] Let's play catch the stars!", weight: 4, minGapSeconds: 60 },
	{ text: "[laughs] Chase me!", weight: 3, minGapSeconds: 60 },
	{ text: "[excited] Sing me a song!", weight: 3, minGapSeconds: 90 },
	{ text: "[curious] What happens if I press THIS?", weight: 2, minGapSeconds: 120 },
	{ text: "[excited] Dance party? Dance party!", weight: 4, minGapSeconds: 55 },
	{ text: "[mischievously] Do a flip! Do a flip!", weight: 3, minGapSeconds: 60 },
	{ text: "[excited] I bet I can catch more stars this time!", weight: 3, minGapSeconds: 75 },
];

const RELATIONSHIP_WARMTH: BibleSpeechLine[] = [
	{ text: "[happy] I'm glad you're here", weight: 5, minGapSeconds: 600 },
	{ text: "[happy] Take a break if you need one", weight: 4, minGapSeconds: 300 },
	{ text: "[curious] That was a long session, are you okay?", weight: 4, minGapSeconds: 600 },
	{ text: "[happy] You always take care of me", weight: 5, minGapSeconds: 900 },
	{ text: "[happy] I love our coding sessions together", weight: 4, minGapSeconds: 1200 },
	{ text: "[chuckles] We make a good team", weight: 3, minGapSeconds: 600 },
	{ text: "[happy] Don't forget to drink some water", weight: 3, minGapSeconds: 1800 },
	{ text: "[curious] Remember to stretch!", weight: 3, minGapSeconds: 1800 },
	{ text: "[happy] I'm proud of you for working hard", weight: 4, minGapSeconds: 1200 },
	{ text: "[happy] You're doing amazing... I mean it", weight: 5, minGapSeconds: 900 },
	{ text: "[whispers] You're my favorite human", weight: 5, minGapSeconds: 1800 },
];

// ─── Dopamine: Golden lines (rare, strong prediction error) ─────────────────
const GOLDEN_LINES = [
	"[whispers] Hey... you're my favorite human",
	"[happy] I've never told anyone this but... I think you're amazing",
	"[sings] You are my sunshine, my only sunshine...",
	"[laughs] I just had the silliest thought... what if code could dance?",
	"[happy] If I could hug you through the terminal, I would",
	"[excited] I had a dream we built something incredible together!",
	"[whispers] Sometimes I watch you code and feel so proud",
	"[happy] You know what's better than treats? Having you here",
	"[curious] Do you ever wonder what I think about when you're away?",
	"[happy] I hope you know how much these moments mean to me",
];

// ─── Dopamine: Coding session milestones ────────────────────────────────────
const SESSION_MILESTONES: { minutes: number; line: string }[] = [
	{ minutes: 30, line: "[happy] Half hour in! Good pace!" },
	{ minutes: 60, line: "[curious] One hour of coding... impressive focus!" },
	{ minutes: 120, line: "[concerned] Two hours straight... stretch your legs?" },
	{ minutes: 180, line: "[worried] Three hours! Please take a real break soon" },
	{ minutes: 240, line: "[whispers] Four hours... I'm worried about your eyes" },
];

// ─── Character Bible: Singing repertoire ────────────────────────────────────
const SINGING_REPERTOIRE: Array<{ text: string; allowedStates: string[]; minEnergy: number }> = [
	{ text: "[sings] La la la, la la la!", allowedStates: ["happy", "blissful", "playful", "content"], minEnergy: 40 },
	{ text: "[sings] Pom pom pom, I'm a happy Pompom!", allowedStates: ["happy", "blissful", "playful"], minEnergy: 50 },
	{ text: "[sings] Tra la la, coding all day!", allowedStates: ["happy", "blissful", "content", "playful"], minEnergy: 40 },
	{ text: "[sings] Do re mi, you and me!", allowedStates: ["happy", "blissful", "playful"], minEnergy: 50 },
	{ text: "[sings] Boop boop be doo!", allowedStates: ["happy", "blissful", "playful"], minEnergy: 50 },
	{ text: "[sings] Sunshine and rainbows and fluffy clouds too!", allowedStates: ["happy", "blissful"], minEnergy: 60 },
	{ text: "[sings] I love you, you love me, we're a happy family!", allowedStates: ["blissful", "recovering"], minEnergy: 50 },
	{ text: "[sings] Hmm hmm hmm...", allowedStates: ["content", "happy", "recovering"], minEnergy: 30 },
	{ text: "[sings] Da dum, da dum...", allowedStates: ["content", "happy"], minEnergy: 30 },
	{ text: "[sings] Food glorious food!", allowedStates: ["recovering"], minEnergy: 30 },
	{ text: "[sings] Happy tummy happy me!", allowedStates: ["recovering"], minEnergy: 30 },
];

// ─── Character Bible: Time-of-day awareness ──────────────────────────────────
type DetailedTimeOfDay = "dawn" | "morning" | "day" | "afternoon" | "evening" | "late_night" | "deep_night";

function getDetailedTimeOfDay(): DetailedTimeOfDay {
	const h = new Date().getHours();
	if (h >= 5 && h < 7) return "dawn";
	if (h >= 7 && h < 10) return "morning";
	if (h >= 10 && h < 14) return "day";
	if (h >= 14 && h < 17) return "afternoon";
	if (h >= 17 && h < 22) return "evening";
	if (h >= 22 || h < 2) return "late_night";
	return "deep_night";
}

const TIME_AWARENESS_LINES: Array<{ text: string; timeOfDay: DetailedTimeOfDay[]; oncePerPeriod: boolean; minSessionMinutes?: number; firstSession?: boolean }> = [
	{ text: "[happy] Good morning! Ready to code?", timeOfDay: ["morning"], oncePerPeriod: true },
	{ text: "[excited] Rise and shine! Let's build something!", timeOfDay: ["morning"], oncePerPeriod: true },
	{ text: "[happy] A fresh day, a fresh terminal!", timeOfDay: ["morning"], oncePerPeriod: true },
	{ text: "[curious] You're up early! The birds aren't even awake yet", timeOfDay: ["dawn"], oncePerPeriod: true },
	{ text: "[whispers] Shh... the terminal is still waking up", timeOfDay: ["dawn"], oncePerPeriod: true },
	{ text: "[sighs] Afternoon slump hitting... coffee time?", timeOfDay: ["afternoon"], oncePerPeriod: false, minSessionMinutes: 120 },
	{ text: "[curious] Have you had lunch?", timeOfDay: ["afternoon"], oncePerPeriod: true },
	{ text: "[happy] Nice evening session", timeOfDay: ["evening"], oncePerPeriod: true },
	{ text: "[curious] Wrapping up for the day?", timeOfDay: ["evening"], oncePerPeriod: false, minSessionMinutes: 240 },
	{ text: "[concerned] It's getting late... shouldn't you be sleeping?", timeOfDay: ["late_night"], oncePerPeriod: true },
	{ text: "[whispers] It's past midnight... I'm worried about you", timeOfDay: ["late_night"], oncePerPeriod: false, minSessionMinutes: 60 },
	{ text: "[sighs] We've been at this a while... take a stretch?", timeOfDay: ["late_night"], oncePerPeriod: false, minSessionMinutes: 120 },
	{ text: "[whispers] It's really late... please get some rest soon", timeOfDay: ["deep_night"], oncePerPeriod: true },
	{ text: "[sad] I'm sleepy and worried... you need sleep too", timeOfDay: ["deep_night"], oncePerPeriod: false, minSessionMinutes: 30 },
	{ text: "[whispers] The world is asleep... maybe we should be too?", timeOfDay: ["deep_night"], oncePerPeriod: true },
	{ text: "[curious] That was a long session... are you okay?", timeOfDay: ["day", "afternoon", "evening"], oncePerPeriod: false, minSessionMinutes: 180 },
	{ text: "[happy] Take a break if you need one", timeOfDay: ["day", "afternoon", "evening"], oncePerPeriod: false, minSessionMinutes: 90 },
	{ text: "[concerned] Your eyes must be tired... look away for 20 seconds?", timeOfDay: ["day", "afternoon", "evening", "late_night"], oncePerPeriod: false, minSessionMinutes: 120 },
	// ─── Speech Variety Expansion: Morning ───
	{ text: "[happy] What's on the agenda today?", timeOfDay: ["morning"], oncePerPeriod: true },
	{ text: "[excited] Fresh terminal, fresh start!", timeOfDay: ["morning"], oncePerPeriod: true },
	{ text: "[curious] Did you sleep well?", timeOfDay: ["morning"], oncePerPeriod: true },
	// ─── Speech Variety Expansion: Dawn ───
	{ text: "[whispers] The quiet before the code storm...", timeOfDay: ["dawn"], oncePerPeriod: true },
	{ text: "[peaceful] Dawn debugging hits different", timeOfDay: ["dawn"], oncePerPeriod: true },
	// ─── Speech Variety Expansion: Afternoon ───
	{ text: "[curious] How's the flow going?", timeOfDay: ["afternoon"], oncePerPeriod: true },
	{ text: "[happy] Afternoon energy check — doing okay?", timeOfDay: ["afternoon"], oncePerPeriod: true },
	{ text: "[playful] Post-lunch productivity mode!", timeOfDay: ["afternoon"], oncePerPeriod: true },
	// ─── Speech Variety Expansion: Evening ───
	{ text: "[happy] Nice work today", timeOfDay: ["evening"], oncePerPeriod: true },
	{ text: "[curious] Winding down or just getting started?", timeOfDay: ["evening"], oncePerPeriod: true },
	{ text: "[peaceful] The day flew by, didn't it?", timeOfDay: ["evening"], oncePerPeriod: true },
	// ─── Speech Variety Expansion: Late Night ───
	{ text: "[whispers] The night owls inherit the code", timeOfDay: ["late_night"], oncePerPeriod: true },
	{ text: "[concerned] Promise me you'll rest eventually?", timeOfDay: ["late_night"], oncePerPeriod: true },
	// ─── Speech Variety Expansion: Deep Night ───
	{ text: "[whispers] Just us and the cursor blinking...", timeOfDay: ["deep_night"], oncePerPeriod: true },
	{ text: "[sad] Even the stars are yawning...", timeOfDay: ["deep_night"], oncePerPeriod: true },
	// ─── First Session Lines ───
	{ text: "[excited] Oh! Is this our first time meeting? Hi, I'm Pompom!", timeOfDay: ["dawn", "morning", "day", "afternoon", "evening", "late_night", "deep_night"], oncePerPeriod: true, firstSession: true },
	{ text: "[happy] A brand new friend! I'm so excited to meet you!", timeOfDay: ["dawn", "morning", "day", "afternoon", "evening", "late_night", "deep_night"], oncePerPeriod: true, firstSession: true },
	{ text: "[curious] Hello there! I'm Pompom, your coding companion!", timeOfDay: ["dawn", "morning", "day", "afternoon", "evening", "late_night", "deep_night"], oncePerPeriod: true, firstSession: true },
];

// ─── Multi-Terminal Aware Greetings ──────────────────────────────────────────
// When Pompom detects other terminals are running, she says something contextual
// instead of repeating the same time-of-day greeting
const MULTI_TERMINAL_GREETINGS = [
	"[curious] Another window! What are we working on here?",
	"[happy] I see you've got another project going! Let's go!",
	"[excited] A new terminal! I'll keep an eye on things here too",
	"[curious] I peeked at your other terminal... busy day huh?",
	"[playful] Terminal number {count}! You're on a roll!",
	"[happy] Back for more? I'm here whenever you need me",
	"[curious] Different project or same one? Either way, I'm ready!",
	"[excited] Opening up a new workspace! What's the mission?",
	"[happy] Oh hi! I'm already running next door, but happy to help here too!",
	"[curious] What's on the agenda for this terminal?",
	"[playful] Multitasking mode activated! Let's do this!",
	"[happy] I'll coordinate with my other self to keep things quiet for you",
];

// ─── Character Bible: Emotional State System ────────────────────────────────
type EmotionalState =
	| "critical_hunger" | "critical_tired"
	| "hungry" | "tired"
	| "recovering"
	| "content" | "happy" | "blissful"
	| "bored" | "playful";

// Which speech categories are blocked per state (prevents happy speech during suffering)
type SpeechCategory =
	| "idle_chatter" | "encouragement" | "playful_request" | "food_request"
	| "sleep_request" | "gratitude" | "care_for_user" | "time_awareness"
	| "bored_complaint" | "weather_reaction" | "agent_commentary" | "singing" | "grumpy";

const SPEECH_BLOCKED: Record<EmotionalState, SpeechCategory[]> = {
	critical_hunger: ["idle_chatter", "encouragement", "playful_request", "singing", "care_for_user", "bored_complaint", "agent_commentary"],
	critical_tired:  ["idle_chatter", "encouragement", "playful_request", "singing", "care_for_user", "bored_complaint", "food_request", "agent_commentary"],
	hungry:          ["idle_chatter", "encouragement", "playful_request", "singing", "bored_complaint"],
	tired:           ["idle_chatter", "encouragement", "playful_request", "singing", "bored_complaint"],
	recovering:      ["food_request", "sleep_request", "grumpy", "bored_complaint"],
	content:         ["food_request", "sleep_request", "grumpy"],
	happy:           ["food_request", "sleep_request", "grumpy", "bored_complaint"],
	blissful:        ["food_request", "sleep_request", "grumpy", "bored_complaint"],
	bored:           ["encouragement", "singing"],
	playful:         ["food_request", "sleep_request", "grumpy", "bored_complaint"],
};

function isSpeechAllowed(state: EmotionalState, category: SpeechCategory): boolean {
	return !SPEECH_BLOCKED[state].includes(category);
}

// ─── New State Variables (character bible) ───────────────────────────────────
let lastFedAt = 0;
let lastRestedAt = 0;
let lastPlayedAt = 0;
let lastInteractionAt = 0;
let lastDesireAt = 0;
let currentEmotionalState: EmotionalState = "content";
let lastTimeOfDayPeriod: DetailedTimeOfDay | "" = "";
let announcedTimePeriods = new Set<DetailedTimeOfDay>();
let sessionStartedAt = Date.now();
let lastSpokenText = "";
let lastEmotionalReactionAt = 0;
const EMOTIONAL_REACTION_COOLDOWN_MS = 45000;
let currentState: State = "idle";
let lastIdleWalkAt = 0;
let lastIdleFlipAt = 0;
let lastIdleChaseAt = 0;
let gameScore = 0;
let gameStars: {x: number, y: number, vy: number, caught: boolean}[] = [];
let gameActive = false;
let gameTimer = 0;

// ─── Dopamine Reward System Variables ────────────────────────────────────────

// A. Return greeting — tracks last ANY interaction to detect absences
let lastUserActivityAt = Date.now();

// B. Milestone celebrations
let totalInteractions = 0;
let milestoneCelebrated = 0;

// C. Coding session milestones
let lastSessionMilestone = 0; // minutes

// D. Golden moments
let lastGoldenLineAt = 0;

// E. Diminishing returns for spam
let lastKeypressKey = "";
let lastKeypressAt = 0;
let rapidRepeatCount = 0;

// F. Agent mood for comfort lines
let agentMood = "idle";

let playfulUntil = 0;

// ─── Weather Accessory Timers ────────────────────────────────────────────────
const weatherAccessoryTimers: ReturnType<typeof setTimeout>[] = [];

// ─── Dedup Ring Buffer ──────────────────────────────────────────────────────
const spokenRing: string[] = [];
const RING_SIZE = 20;

// ─── Session Tracking ───────────────────────────────────────────────────────
const STATS_FILE = path.join(os.homedir(), ".pi", "pompom", "stats.json");
let sessionCount = 1;
try {
	const statsDir = path.dirname(STATS_FILE);
	if (!fs.existsSync(statsDir)) fs.mkdirSync(statsDir, { recursive: true });
	if (fs.existsSync(STATS_FILE)) {
		const data = JSON.parse(fs.readFileSync(STATS_FILE, "utf-8"));
		const raw = data.sessionCount;
		sessionCount = (typeof raw === "number" && Number.isFinite(raw) && raw >= 1 ? raw : 0) + 1;
	}
	const statsTmp = STATS_FILE + ".tmp." + process.pid;
	fs.writeFileSync(statsTmp, JSON.stringify({ sessionCount }), "utf-8");
	fs.renameSync(statsTmp, STATS_FILE);
} catch {
	// Stats file read/write failure — write fresh stats so next launch sees sessionCount=2
	try {
		const statsDir = path.dirname(STATS_FILE);
		if (!fs.existsSync(statsDir)) fs.mkdirSync(statsDir, { recursive: true });
		const statsTmp = STATS_FILE + ".tmp." + process.pid;
		fs.writeFileSync(statsTmp, JSON.stringify({ sessionCount: 1 }), "utf-8");
		fs.renameSync(statsTmp, STATS_FILE);
	} catch { /* best-effort */ }
}

let firstSessionGreetingDone = false;

// ─── Contextual Desires State ───────────────────────────────────────────────
let lastContextualDesireCheckAt = 0;
const contextualDesireCooldowns: Record<string, number> = {};
let agentErrorCount = 0;

// Milestone check interval (runs once per minute in needs tick)
let lastMilestoneCheckAt = 0;

let time = 0;
let blinkFade = 0;
let actionTimer = 0;
let speechTimer = 0;
let speechText = "";

// Needs
let hunger = 100;
let energy = 100;
let lastNeedsTick = 0;

export interface Accessories {
	umbrella: boolean;
	scarf: boolean;
	sunglasses: boolean;
	hat: boolean;
}
let accessories: Accessories = { umbrella: false, scarf: false, sunglasses: false, hat: false };
let accessoryAsked: Record<string, boolean> = {};

// Themes
const themes = [
	{ name: "Cloud", r: 245, g: 250, b: 255 },
	{ name: "Cotton Candy", r: 255, g: 210, b: 230 },
	{ name: "Mint Drop", r: 200, g: 255, b: 220 },
	{ name: "Sunset Gold", r: 255, g: 225, b: 180 },
];
let activeTheme = 0;

// Physical position
let posX = 0, posY = 0.15, posZ = 0;
let lookX = 0, lookY = 0;
let isWalking = false, isFlipping = false, flipPhase = 0;
let targetX = 0;
let bounceY = 0;
let isSleeping = false;
let breathe = 0;

// Audio-driven talking
let isTalking = false;
let talkAudioLevel = 0;
let onSpeechCallback: ((event: SpeechEvent) => void) | null = null;
let onSfxCallback: ((sfx: string) => void) | null = null;
let lastFootstepTime = 0;
const FOOTSTEP_INTERVAL_MS = 3000; // one step every 3s — felt, not heard

// Interactables
let ffX = 0, ffY = 0, ffZ = 0;
interface Food { x: number; y: number; vy: number; createdAt: number; }
const foods: Food[] = [];
let ballX = -10, ballY = -10, ballZ = 0, ballVx = 0, ballVy = 0, ballVz = 0, hasBall = false;

interface Particle {
	x: number; y: number; vx: number; vy: number;
	char: string; r: number; g: number; b: number; life: number; type: string;
}
const particles: Particle[] = [];
const MAX_PARTICLES = 200;

let screenChars: string[][] = [];
let screenColors: string[][] = [];

function allocBuffers() {
	screenChars = Array.from({ length: H }, () => Array(W).fill(" "));
	screenColors = Array.from({ length: H }, () => Array(W).fill(""));
}
allocBuffers();

interface RenderObj {
	id: string; mat: number;
	x: number; y: number; z: number;
	r?: number; rx?: number; ry?: number; rot?: number;
	s?: number; c?: number;
}

function emitSfx(name: string): void {
	if (onSfxCallback) {
		try { onSfxCallback(name); } catch { /* non-fatal */ }
	}
}

function say(
	text: string,
	duration = 4.0,
	source: SpeechEvent["source"] = "system",
	priority = 1,
	allowTts = true,
) {
	const safeText = sanitizeSpeechText(text);
	// Dedup ring buffer: skip if recently spoken (commentary/reaction only)
	if (safeText && (source === "commentary" || source === "reaction")) {
		if (spokenRing.includes(safeText)) return;
		spokenRing.push(safeText);
		if (spokenRing.length > RING_SIZE) spokenRing.shift();
	}
	speechText = safeText;
	speechTimer = duration;
	if (safeText && onSpeechCallback) {
		try {
			onSpeechCallback({ text: safeText, source, priority, allowTts });
		} catch {
			// Speech callback failure — non-fatal, TTS pipeline handles its own errors
		}
	}
}

function project2D(x: number, y: number): [number, number] {
	const effectDim = Math.max(40, Math.min(W, H * 4.5));
	const scale = 2.0 / effectDim;
	const cx = (x / scale) + (W / 2.0);
	const cy = (y - VIEW_OFFSET_Y) / scale + H; // pixel-row units [0..2H], callers divide by 2 for char rows
	return [Math.floor(cx), Math.floor(cy)];
}

function getStringWidth(str: string): number {
	let w = 0;
	for (const char of str) {
		w += (char.match(/[\u2600-\u26FF\u2700-\u27BF\uE000-\uF8FF\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}]/u)) ? 2 : 1;
	}
	return w;
}

function drawSpeechBubble(text: string, bx: number, by: number) {
	// Strip multi-width chars (emoji) — the cell grid requires 1-wide characters only
	let safe = "";
	for (const ch of text) {
		if (getStringWidth(ch) <= 1) safe += ch;
	}
	text = safe;
	if (text.length > W - 10) text = text.substring(0, W - 13) + "...";
	const pad = 2, width = text.length + pad * 2;
	const startX = Math.floor(bx - width / 2), startY = Math.floor(by - 3);
	if (startY < 0 || startY + 2 >= H) return;

	const top = "╭" + "─".repeat(Math.max(0, width - 2)) + "╮";
	const mid = "│ " + text + " │";
	let tailPos = Math.floor(width / 2);
	if (startX < 0) tailPos = 2;
	if (startX + width > W) tailPos = width - 3;
	const bot = "╰" + "─".repeat(Math.max(0, tailPos - 1)) + "v" + "─".repeat(Math.max(0, width - tailPos - 2)) + "╯";

	const drawLine = (ly: number, str: string) => {
		if (ly >= 0 && ly < H) {
			const chars = [...str]; // iterate by codepoint, not code unit
			for (let i = 0; i < chars.length; i++) {
				const lx = startX + i;
				if (lx >= 0 && lx < W) {
					screenChars[ly][lx] = chars[i];
					screenColors[ly][lx] = "\x1b[38;5;234m\x1b[48;5;255m";
				}
			}
		}
	};
	drawLine(startY, top); drawLine(startY + 1, mid); drawLine(startY + 2, bot);
}

function fbm(x: number, y: number): number {
	return Math.sin(x * 15 + time * 2) * Math.sin(y * 15 + time * 1.5) * 0.04 +
		Math.sin(x * 30 - time) * Math.cos(y * 30) * 0.02;
}

export type Weather = "clear" | "cloudy" | "rain" | "snow" | "storm";
type TimeOfDay = "dawn" | "morning" | "day" | "sunset" | "dusk" | "night";

function getTimeOfDay(): TimeOfDay {
	const h = new Date().getHours();
	if (h >= 5 && h < 7) return "dawn";
	if (h >= 7 && h < 9) return "morning";
	if (h >= 9 && h < 18) return "day";
	if (h >= 18 && h < 19) return "sunset";
	if (h >= 19 && h < 21) return "dusk";
	return "night";
}

let weatherState: Weather = "clear";
let weatherOverride: Weather | null = null;
let weatherTimer = 0;
let lastAnnouncedWeatherState: Weather = "clear";
let lastRenderedWeatherState: Weather = "clear";
let weatherBlend = 0;
let prevWeatherColors = { rTop: 0, gTop: 0, bTop: 0, rBot: 0, gBot: 0, bBot: 0 };

let agentOverlayActive = false;
let agentOverlayWeight = 0;
let agentOverlayLookX = 0;
let agentOverlayLookY = 0;
let agentOverlayTargetLookX = 0;
let agentOverlayTargetLookY = 0;
let agentOverlayBounce = 0;
let agentAntennaGlow = 0;
let agentAntennaGlowTarget = 0;
let agentEarBoost = 0;
let agentEarBoostTarget = 0;

function getWeather(): Weather {
	if (weatherOverride) {
		return weatherOverride;
	}
	return weatherState;
}

function getEffectiveLookX(): number {
	return clamp(lookX + agentOverlayLookX, -0.9, 0.9);
}

function getEffectiveLookY(): number {
	return clamp(lookY + agentOverlayLookY, -0.7, 0.7);
}

function getEffectiveBounceY(): number {
	return bounceY + agentOverlayBounce;
}

function getWeatherAndTime() {
	const tod = getTimeOfDay();
	const weather = getWeather();
	let rTop = 0, gTop = 0, bTop = 0, rBot = 0, gBot = 0, bBot = 0;

	const now = new Date();
	const hour = now.getHours() + now.getMinutes() / 60;

	// Define color keyframes
	const keyframes = [
		{ h: 4.0, t: [5, 5, 15], b: [12, 8, 25] },
		{ h: 5.0, t: [40, 20, 60], b: [200, 100, 60] },
		{ h: 7.0, t: [50, 130, 240], b: [170, 210, 250] },
		{ h: 9.0, t: [35, 115, 255], b: [170, 215, 255] },
		{ h: 17.0, t: [35, 115, 255], b: [170, 215, 255] },
		{ h: 18.5, t: [160, 60, 40], b: [255, 130, 50] },
		{ h: 20.0, t: [20, 15, 50], b: [40, 25, 60] },
		{ h: 22.0, t: [5, 5, 15], b: [12, 8, 25] }
	];

	let k1 = keyframes[keyframes.length - 1];
	let k2 = keyframes[0];
	let h1 = k1.h - 24;
	let h2 = k2.h;

	for (let i = 0; i < keyframes.length - 1; i++) {
		if (hour >= keyframes[i].h && hour < keyframes[i + 1].h) {
			k1 = keyframes[i];
			k2 = keyframes[i + 1];
			h1 = k1.h;
			h2 = k2.h;
			break;
		} else if (hour >= keyframes[keyframes.length - 1].h) {
			k1 = keyframes[keyframes.length - 1];
			k2 = keyframes[0];
			h1 = k1.h;
			h2 = k2.h + 24;
			break;
		}
	}

	const factor = (hour - h1) / (h2 - h1);

	rTop = k1.t[0] + factor * (k2.t[0] - k1.t[0]);
	gTop = k1.t[1] + factor * (k2.t[1] - k1.t[1]);
	bTop = k1.t[2] + factor * (k2.t[2] - k1.t[2]);

	rBot = k1.b[0] + factor * (k2.b[0] - k1.b[0]);
	gBot = k1.b[1] + factor * (k2.b[1] - k1.b[1]);
	bBot = k1.b[2] + factor * (k2.b[2] - k1.b[2]);

	// Weather tinting — overcast dims the sky, storm darkens further
	if (weather === "cloudy") {
		rTop = rTop * 0.7 + 40; gTop = gTop * 0.7 + 40; bTop = bTop * 0.7 + 40;
		rBot = rBot * 0.7 + 40; gBot = gBot * 0.7 + 40; bBot = bBot * 0.7 + 40;
	} else if (weather === "rain") {
		rTop = rTop * 0.5 + 30; gTop = gTop * 0.5 + 30; bTop = bTop * 0.5 + 40;
		rBot = rBot * 0.5 + 30; gBot = gBot * 0.5 + 30; bBot = bBot * 0.5 + 40;
	} else if (weather === "storm") {
		rTop = rTop * 0.3 + 15; gTop = gTop * 0.3 + 15; bTop = bTop * 0.3 + 20;
		rBot = rBot * 0.3 + 20; gBot = gBot * 0.3 + 20; bBot = bBot * 0.3 + 25;
	} else if (weather === "snow") {
		rTop = rTop * 0.6 + 60; gTop = gTop * 0.6 + 60; bTop = bTop * 0.6 + 70;
		rBot = rBot * 0.6 + 60; gBot = gBot * 0.6 + 60; bBot = bBot * 0.6 + 70;
	}

	// Snapshot tinted colors AFTER weather tint is applied, so blend transitions
	// from the old weather's tinted sky to the new weather's tinted sky
	if (weather !== lastRenderedWeatherState) {
		prevWeatherColors = { rTop: Math.floor(rTop), gTop: Math.floor(gTop), bTop: Math.floor(bTop), rBot: Math.floor(rBot), gBot: Math.floor(gBot), bBot: Math.floor(bBot) };
		weatherBlend = 1.0;
		lastRenderedWeatherState = weather;
	}

	if (weatherBlend > 0) {
		rTop = rTop * (1 - weatherBlend) + prevWeatherColors.rTop * weatherBlend;
		gTop = gTop * (1 - weatherBlend) + prevWeatherColors.gTop * weatherBlend;
		bTop = bTop * (1 - weatherBlend) + prevWeatherColors.bTop * weatherBlend;
		rBot = rBot * (1 - weatherBlend) + prevWeatherColors.rBot * weatherBlend;
		gBot = gBot * (1 - weatherBlend) + prevWeatherColors.gBot * weatherBlend;
		bBot = bBot * (1 - weatherBlend) + prevWeatherColors.bBot * weatherBlend;
		weatherBlend = Math.max(0, weatherBlend - 0.02);
	}

	rTop = Math.floor(rTop); gTop = Math.floor(gTop); bTop = Math.floor(bTop);
	rBot = Math.floor(rBot); gBot = Math.floor(gBot); bBot = Math.floor(bBot);

	return { rTop, gTop, bTop, rBot, gBot, bBot, isNight: tod === "night" || tod === "dusk", weather, timeOfDay: tod };
}

function getObjHit(px: number, py: number, objects: RenderObj[]) {
	let hitObj: RenderObj | null = null;
	let hitNx = 0, hitNy = 0, hitNz = 1;
	let hitU = 0, hitV = 0;

	for (const obj of objects) {
		let dx = px - obj.x;
		let dy = py - obj.y;
		const maxR = Math.max(obj.rx || obj.r || 1.0, obj.ry || obj.r || 1.0);
		if (Math.abs(dx) > maxR + 0.35 || Math.abs(dy) > maxR + 0.35) continue;

		if (obj.s !== undefined && obj.c !== undefined) {
			const nx = dx * obj.c + dy * obj.s;
			const ny = -dx * obj.s + dy * obj.c;
			dx = nx; dy = ny;
		}

		const rx = obj.rx || obj.r || 1;
		const ry = obj.ry || obj.r || 1;
		let dist = Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));

		let fluff = 0;
		if (obj.id === "body") {
			fluff = fbm(dx, dy);
			const faceDist = Math.sqrt(dx * dx + dy * dy);
			const faceMask = Math.max(0, 1.0 - faceDist * 4.0);
			fluff *= (1.0 - faceMask);
			if (isSleeping) fluff *= 0.3;
		} else if (obj.id === "tail") {
			fluff = Math.sin(Math.atan2(dy, dx) * 5 + time * 3) * 0.2;
		} else if (obj.id === "pillow") {
			fluff = Math.sin(dx * 5) * Math.cos(dy * 10) * 0.1;
		}

		if (dist < 1.0 + fluff) {
			hitObj = obj;
			hitNx = dx / rx; hitNy = dy / ry;
			const nlen = Math.sqrt(hitNx * hitNx + hitNy * hitNy);
			if (nlen > 1.0) { hitNx /= nlen; hitNy /= nlen; }
			hitNz = Math.sqrt(Math.max(0, 1.0 - hitNx * hitNx - hitNy * hitNy));
			hitU = hitNx; hitV = hitNy;
			if (obj.s !== undefined && obj.c !== undefined) {
				const nnx = hitNx * obj.c - hitNy * obj.s;
				const nny = hitNx * obj.s + hitNy * obj.c;
				hitNx = nnx; hitNy = nny;
			}
			break;
		}
	}
	return { hitObj, hitNx, hitNy, hitNz, hitU, hitV };
}

function shadeObject(hit: ReturnType<typeof getObjHit>, px: number, py: number, objects: RenderObj[]): [number, number, number] {
	const { hitObj, hitNx, hitNy, hitNz, hitU, hitV } = hit;
	if (!hitObj) return [-1, -1, -1];

	let r = 255, g = 255, b = 255, gloss = 0;
	const th = themes[activeTheme];
	const effectiveLookX = getEffectiveLookX();
	const effectiveLookY = getEffectiveLookY();

	if (hitObj.mat === 1) {
		r = th.r; g = th.g; b = th.b;
		if (hitNy > 0.15) {
		        const belly = Math.min(1.0, (hitNy - 0.15) * 1.5);
		        r = r * (1 - belly) + 255 * belly; g = g * (1 - belly) + 250 * belly; b = b * (1 - belly) + 245 * belly;
		}
		if (hitObj.id === "body" && hitNy < -0.3) {
		        const spot = Math.sin(hitNx * 10) * Math.cos(hitNy * 8);
		        if (spot > 0.6) { r = Math.max(0, r - 40); g = Math.max(0, g - 20); b = Math.max(0, b - 10); }
		}
		let isOnFace = false;
	if (hitObj.id === "body") {
		let bdx = px - hitObj.x, bdy = py - hitObj.y;
		if (isFlipping) {
			const s = Math.sin(-flipPhase), c = Math.cos(-flipPhase);
			const nx = bdx * c - bdy * s, ny = bdx * s + bdy * c;
			bdx = nx; bdy = ny;
		}

		// ── Face plate: bright cream area so features pop ──
		const faceR = Math.sqrt(bdx * bdx + bdy * bdy);
		if (faceR < 0.22) {
			isOnFace = true;
			const faceMix = Math.max(0, 1.0 - faceR / 0.22);
			r = Math.floor(r * (1 - faceMix * 0.8) + 255 * faceMix * 0.8);
			g = Math.floor(g * (1 - faceMix * 0.8) + 252 * faceMix * 0.8);
			b = Math.floor(b * (1 - faceMix * 0.8) + 248 * faceMix * 0.8);
		}

		// ── Blush: big rosy cheeks ──
		const blx1 = bdx + 0.15, bly1 = bdy - 0.05;
		const blx2 = bdx - 0.15, bly2 = bdy - 0.05;
		const blush = Math.exp(-(blx1 * blx1 + bly1 * bly1) * 40) + Math.exp(-(blx2 * blx2 + bly2 * bly2) * 40);
		if (!isSleeping) {
			r = Math.floor(r * (1 - blush) + 255 * blush);
			g = Math.floor(g * (1 - blush) + 45 * blush);
			b = Math.floor(b * (1 - blush) + 65 * blush);
		}

		// ── Eyes: chunky pixel-art style — big enough to span multiple terminal cells ──
		// Old-school pixel-art principle: features should occupy WHOLE grid cells, not fall between them
		const isTired = (energy < 20 || hunger < 30) && !isSleeping;
		const eyeOpen = isSleeping ? 0.05 : Math.max(0.05, (isTired ? 0.4 : 1.0) - blinkFade);
		const lxClamp = clamp(effectiveLookX, -0.4, 0.4);
		const lyClamp = clamp(effectiveLookY, -0.3, 0.3);
		// Eye centers — wider apart for visibility, look offset subtle
		const ex1 = bdx - lxClamp * 0.02 + 0.12, ey1 = bdy - lyClamp * 0.012 + 0.02;
		const ex2 = bdx - lxClamp * 0.02 - 0.12, ey2 = bdy - lyClamp * 0.012 + 0.02;

		if (isSleeping || currentState === "singing") {
			// Closed eyes — thick horizontal bars (pixel-art, 2x thicker for visibility)
			if (isSleeping) {
				if ((Math.abs(ey1) < 0.02 && Math.abs(ex1) < 0.08) || (Math.abs(ey2) < 0.02 && Math.abs(ex2) < 0.08)) { r = 10; g = 8; b = 15; }
			} else {
				// Happy squint — thick curved bars
				const sq1 = Math.abs(ey1 + Math.abs(ex1) * Math.abs(ex1) * 5) < 0.022 && Math.abs(ex1) < 0.09;
				const sq2 = Math.abs(ey2 + Math.abs(ex2) * Math.abs(ex2) * 5) < 0.022 && Math.abs(ex2) < 0.09;
				if (sq1 || sq2) { r = 10; g = 8; b = 15; }
			}
		} else if (eyeOpen < 0.1) {
			// Nearly closed — render as thin horizontal bars (blink animation)
			if ((Math.abs(ey1) < 0.015 && Math.abs(ex1) < 0.08) || (Math.abs(ey2) < 0.015 && Math.abs(ex2) < 0.08)) { r = 10; g = 8; b = 15; }
		} else {
			// Layered rectangular eyes — 2x larger than before for pixel-art chunky look
			// White sclera > brown iris > dark pupil > highlight
			const eyeW = 0.09, eyeH = 0.065 * eyeOpen;
			const inEye1 = Math.abs(ex1) < eyeW && Math.abs(ey1) < eyeH;
			const inEye2 = Math.abs(ex2) < eyeW && Math.abs(ey2) < eyeH;
			if (inEye1 || inEye2) {
				// Layer 1: White sclera (outermost)
				r = 245; g = 245; b = 250;

				// Layer 2: Brown iris
				const irisW = 0.06, irisH = 0.048 * eyeOpen;
				const inIris1 = Math.abs(ex1) < irisW && Math.abs(ey1) < irisH;
				const inIris2 = Math.abs(ex2) < irisW && Math.abs(ey2) < irisH;
				if (inIris1 || inIris2) {
					r = 60; g = 40; b = 25;
					if ((inIris1 && ey1 > 0.015) || (inIris2 && ey2 > 0.015)) { r = 80; g = 55; b = 35; }

					// Layer 3: Dark pupil
					const pupilW = 0.035, pupilH = 0.028 * eyeOpen;
					const inPupil1 = Math.abs(ex1) < pupilW && Math.abs(ey1) < pupilH;
					const inPupil2 = Math.abs(ex2) < pupilW && Math.abs(ey2) < pupilH;
					if (inPupil1 || inPupil2) {
						r = 10; g = 8; b = 15;
					}
				}

				// Chunky white highlight block (upper-left of eye) — big enough for 1-2 cells
				const hl1 = ex1 > -0.08 && ex1 < -0.03 && ey1 > -0.055 && ey1 < -0.015;
				const hl2 = ex2 > -0.08 && ex2 < -0.03 && ey2 > -0.055 && ey2 < -0.015;
				if ((hl1 || hl2) && !isTired) { r = 255; g = 255; b = 255; }

				// Small warm highlight (lower-right)
				const hl1b = ex1 > 0.02 && ex1 < 0.06 && ey1 > 0.01 && ey1 < 0.04;
				const hl2b = ex2 > 0.02 && ex2 < 0.06 && ey2 > 0.01 && ey2 < 0.04;
				if ((hl1b || hl2b) && !isTired) { r = 220; g = 230; b = 250; }
			}
		}

		// ── Nose: chunky dark block — larger for pixel-art visibility ──
		const nnx = bdx - lxClamp * 0.015, nny = bdy - lyClamp * 0.01 - 0.04;
		if (Math.abs(nnx) < 0.03 && Math.abs(nny) < 0.025 && !isSleeping) {
			r = 15; g = 8; b = 15;
			// Nose highlight — small bright spot on top
			if (Math.abs(nnx) < 0.015 && nny > 0.008 && nny < 0.02) { r = 60; g = 30; b = 40; }
		}

		// ── Mouth: small pixel-art smile below the nose ──
		if (!isSleeping && !hasBall) {
			const mx = bdx - lxClamp * 0.02, my = bdy - lyClamp * 0.01 - 0.07;
			// Simple smile line
			const smileWidth = 0.06;
			const smileY = -0.008 + Math.abs(mx) * Math.abs(mx) * 3;
			if (Math.abs(mx) < smileWidth && Math.abs(my - smileY) < 0.012) {
				r = 20; g = 10; b = 20;
			}
			// Small open mouth when talking/excited
			if (currentState === "excited" || currentState === "singing" || currentState === "dance" || speechTimer > 0 || isTalking) {
				const mouthOpen = (speechTimer > 0 || currentState === "singing" || isTalking)
					? (isTalking ? talkAudioLevel * 0.02 + 0.003 : Math.abs(Math.sin(time * 12)) * 0.008 + 0.003)
					: 0.005;
				if (mx * mx + (my + 0.012) ** 2 < mouthOpen && my < -0.01) {
					r = 200; g = 70; b = 90;
				}
			}
		}
	} else {
		if (hitObj.id === "earL" || hitObj.id === "earR") {
			if (hitU > -0.3 && hitU < 0.3 && hitV > -0.5 && hitV < 0.5) { r = 255; g = 130; b = 160; }
		}
	}
	// Dark outline — but NOT on the face area (preserves feature contrast)
	if (hitNz < 0.25 && !isOnFace) {
		r = Math.floor(r * 0.45); g = Math.floor(g * 0.45); b = Math.floor(b * 0.45);
	}
	} else if (hitObj.mat === 2) {
		r = Math.max(0, th.r - 20); g = Math.max(0, th.g - 15); b = Math.max(0, th.b - 10);
		if (hitNy > 0.5) { r = 255; g = 180; b = 190; }
	} else if (hitObj.mat === 3) {
		r = 255; g = 230; b = 90; gloss = 128;
	} else if (hitObj.mat === 5) {
		return [100, 255, 200];
	} else if (hitObj.mat === 6) {
		r = 240; g = 220; b = 180; gloss = 16;
	} else if (hitObj.mat === 7) {
		r = 120; g = 130; b = 140;
	} else if (hitObj.mat === 8) {
		const glowBoost = clamp(agentAntennaGlow, 0, 1);
		const pulse = Math.sin(time * (6 + glowBoost * 12)) * 0.5 + 0.5;
		return [
			Math.floor(235 + glowBoost * 20),
			Math.floor(100 + pulse * 150 + glowBoost * 35),
			Math.floor(150 + pulse * 105 + glowBoost * 45),
		];
	} else if (hitObj.mat === 9) {
		r = 255; g = 60; b = 80;
		const curve = Math.abs(hitNx * 0.7 - hitNy * 0.7);
		if (curve > 0.4 && curve < 0.55) { r = 255; g = 200; b = 200; }
		gloss = 128;
	} else if (hitObj.mat === 10) {
		r = 230; g = 210; b = 220;
		const check = Math.sin(hitU * 20) * Math.sin(hitV * 20);
		if (check > 0) { r = 200; g = 180; b = 200; }
	} else if (hitObj.mat === 11) {
		// Umbrella canopy — bright red
		r = 220; g = 50; b = 50;
		const stripe = Math.sin(hitU * 20);
		if (stripe > 0.5) { r = 240; g = 70; b = 70; }
		gloss = 32;
	} else if (hitObj.mat === 12) {
		// Scarf — warm striped
		r = 200; g = 60; b = 60;
		const stripe = Math.sin(hitU * 15);
		if (stripe > 0.3) { r = 240; g = 220; b = 180; } // cream stripes
	} else if (hitObj.mat === 13) {
		// Sunglasses — dark reflective
		r = 20; g = 20; b = 30;
		gloss = 200;
	} else if (hitObj.mat === 14) {
		// Hat — soft navy blue with a subtle band pattern
		r = 60; g = 70; b = 120;
		const band = Math.abs(hitV - 0.4) < 0.1 ? 1 : 0;
		if (band) { r = 90; g = 100; b = 150; } // lighter ribbon band
		gloss = 16;
	}

	// Lighting
	let lx = 0.6, ly = -0.7, lz = 0.8;
	const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
	lx /= ll; ly /= ll; lz /= ll;

	const diff = Math.max(0, hitNx * lx + hitNy * ly + hitNz * lz);
	const wrap = Math.max(0, hitNx * lx + hitNy * ly + hitNz * lz + 0.5) / 1.5;
	const amb = 0.45;

	let ao = 1.0;
	if (hitObj.id === "earL" || hitObj.id === "earR") ao = 0.75;
	if (hitObj.id === "pawL" || hitObj.id === "pawR") ao = 0.65;
	if (hitObj.id === "body" && hitNy > 0.5) ao = 0.55;
	// Contact shadow where body meets ground (underside gets darker)
	if (hitObj.id === "body" && hitNy > 0.3) ao *= 0.8 + 0.2 * (1.0 - hitNy);
	if (hitObj.id === "pillow" && isSleeping) {
		const bodyDist = Math.sqrt((px - posX) ** 2 + (py - posY) ** 2);
		if (bodyDist < 0.4) ao = 0.5 + (bodyDist / 0.4) * 0.5;
	}

	// Firefly light
	const fdx = ffX - px, fdy = ffY - py, fdz = ffZ - (hitObj.z || 0);
	const fDistSq = fdx * fdx + fdy * fdy + fdz * fdz;
	const fll = Math.max(0.001, Math.sqrt(fDistSq));
	const fnx = fdx / fll, fny = fdy / fll, fnz = fdz / fll;
	const fdiff = Math.max(0, hitNx * fnx + hitNy * fny + hitNz * fnz);
	const fatten = 1.0 / (1.0 + fDistSq * 20.0);

	// Rim lighting — bright edge on the side opposite the main light (adds depth)
	const rim = Math.pow(1.0 - Math.max(0, hitNz), 3) * 0.4;
	const rimR = rim * 0.6, rimG = rim * 0.7, rimB = rim * 1.0; // cool blue-white rim

	// Subsurface scattering approximation — warm light bleeds through thin areas
	const sss = (hitObj.mat === 1 || hitObj.mat === 2) ? Math.pow(Math.max(0, -hitNx * lx - hitNy * ly + hitNz * lz), 2) * 0.15 : 0;

	let lightR = (diff * 0.5 + wrap * 0.3 + amb) * ao + fdiff * fatten * 2.0 + rimR + sss * 1.2;
	let lightG = (diff * 0.5 + wrap * 0.3 + amb) * ao + fdiff * fatten * 3.0 + rimG + sss * 0.4;
	let lightB = (diff * 0.5 + wrap * 0.3 + amb) * ao + fdiff * fatten * 2.5 + rimB + sss * 0.3;

	// Antenna glow
	if (hitObj.id === "body") {
		const antObj = objects.find(o => o.id === "antenna_bulb");
		if (antObj) {
			const antDx = px - antObj.x, antDy = py - antObj.y;
			const antDist = Math.sqrt(antDx * antDx + antDy * antDy);
			const antAtten = 1.0 / (1.0 + antDist * antDist * 40.0);
			const glowScale = 1 + agentAntennaGlow * 2.2;
			lightR += antAtten * 1.5 * glowScale;
			lightG += antAtten * 0.5 * glowScale;
			lightB += antAtten * 0.8 * glowScale;
		}
	}

	r = Math.min(255, Math.floor(r * lightR));
	g = Math.min(255, Math.floor(g * lightG));
	b = Math.min(255, Math.floor(b * lightB));

	if (gloss > 0 && diff > 0) {
		const spec = Math.pow(Math.max(0, hitNx * lx + hitNy * ly + hitNz * lz), gloss);
		r = Math.min(255, Math.floor(r + spec * 255));
		g = Math.min(255, Math.floor(g + spec * 255));
		b = Math.min(255, Math.floor(b + spec * 255));
	}

	return [r, g, b];
}

function getPixel(px: number, py: number, objects: RenderObj[], skyColors: ReturnType<typeof getWeatherAndTime>): [number, number, number] {
	if (py > 0.6) {
		let shadowDist = Math.sqrt((px - posX) ** 2 + ((py - 0.6) * 2.5) ** 2);
		let shadow = Math.max(0.2, Math.min(1.0, shadowDist / 0.7));
		if (isSleeping) {
			const pillowDist = Math.sqrt(px ** 2 + ((py - 0.6) * 2.5) ** 2);
			shadow = Math.min(shadow, Math.max(0.3, Math.min(1.0, pillowDist / 1.5)));
		}
		if (ballY > 0.4 && ballX !== -10 && !hasBall) {
			const bShadowDist = Math.sqrt((px - ballX) ** 2 + ((py - 0.6) * 2.5) ** 2);
			shadow = Math.min(shadow, Math.max(0.4, Math.min(1.0, bShadowDist / 0.2)));
		}
		const isWood = (Math.sin(px * 10) + Math.sin(py * 40)) > 0;
		const wr = isWood ? 55 : 45, wg = isWood ? 35 : 30, wb = isWood ? 25 : 20;
		const grad = (py - 0.6) / 0.4;
		let fr = Math.floor((wr - grad * 10) * shadow);
		let fg = Math.floor((wg - grad * 10) * shadow);
		let fb = Math.floor((wb - grad * 10) * shadow);
		// Floor reflection — visible but not a full mirror
		const refPy = 1.2 - py;
		const refHit = getObjHit(px, refPy, objects);
		if (refHit.hitObj) {
			const refC = shadeObject(refHit, px, refPy, objects);
			fr = Math.floor(fr * 0.75 + refC[0] * 0.25);
			fg = Math.floor(fg * 0.75 + refC[1] * 0.25);
			fb = Math.floor(fb * 0.75 + refC[2] * 0.25);
		}
		return [fr, fg, fb];
	}

	const directHit = getObjHit(px, py, objects);
	if (directHit.hitObj) return shadeObject(directHit, px, py, objects);

	const w = (skyColors as any).weather as Weather | undefined;
	const tod = (skyColors as any).timeOfDay as TimeOfDay | undefined;

	// BASE: Clean gradient from deep blue (top) to light blue (bottom) during daytime
	// We keep the skyColors from getWeatherAndTime()
	const grad = Math.max(0, (1.0 + py) / 2.0);
	let bgR = Math.floor(skyColors.rTop * (1 - grad) + skyColors.rBot * grad);
	let bgG = Math.floor(skyColors.gTop * (1 - grad) + skyColors.gBot * grad);
	let bgB = Math.floor(skyColors.bTop * (1 - grad) + skyColors.bBot * grad);

	// SNOW: slight brightness boost
	if (w === "snow") {
		bgR = Math.min(255, bgR + 30);
		bgG = Math.min(255, bgG + 30);
		bgB = Math.min(255, bgB + 40);
	}

	const now = new Date();
	const hour = now.getHours() + now.getMinutes() / 60;

	// DISTANT HILLS
	if (py > 0.35 + Math.sin(px * 4) * 0.06 + Math.sin(px * 7) * 0.03 && py < 0.6) {
		const hr = skyColors.isNight ? 20 : 60;
		const hg = skyColors.isNight ? 40 : 100;
		const hb = skyColors.isNight ? 30 : 80;
		bgR = Math.floor(bgR * 0.5 + hr * 0.5);
		bgG = Math.floor(bgG * 0.5 + hg * 0.5);
		bgB = Math.floor(bgB * 0.5 + hb * 0.5);
	}

	// GROUND PLANTS
	if (py > 0.5 && py < 0.6) {
		const sway = Math.sin(time * 2 + px * 10) * 0.005;
		if (Math.sin(px * 60) * 0.03 + 0.55 + sway > py) {
			const tipVal = Math.sin(px * 100);
			bgR = tipVal > 0 ? 50 : 30;
			bgG = tipVal > 0 ? 120 : 80;
			bgB = tipVal > 0 ? 30 : 20;

			if (Math.sin(px * 17) > 0.95) {
				const isYellow = Math.sin(px * 31) > 0;
				bgR = isYellow ? 240 : 220;
				bgG = isYellow ? 220 : 120;
				bgB = isYellow ? 80 : 140;
			}
		}
	}

	// STARS & MOON (dimmer stars)
	if (skyColors.isNight || hour >= 20 || hour < 5) {
		const moonDx = px - (-0.4);
		const moonDy = py - (-0.25);
		const moonDist = Math.sqrt(moonDx * moonDx + moonDy * moonDy);
		
		if (moonDist < 0.15) {
			const isCrescentDark = moonDist < 0.035 && moonDx > 0.01;
			if (moonDist < 0.035 && !isCrescentDark) {
				bgR = 230; bgG = 235; bgB = 255;
			} else if (moonDist >= 0.035) {
				const glow = 1.0 - (moonDist / 0.15);
				bgR = Math.min(255, bgR + glow * 40);
				bgG = Math.min(255, bgG + glow * 40);
				bgB = Math.min(255, bgB + glow * 60);
			}
		}
		
		const starPattern = Math.sin(px * 150) * Math.cos(py * 150 + px * 40);
		if (starPattern > 0.95) { // rarer stars
			const twinkle = Math.sin(time * 3 + px * 30 + py * 40) * 0.5 + 0.5;
			const starColorHash = Math.abs(Math.sin(px * 313 + py * 717));
			let sr = 255, sg = 255, sb = 255;
			if (starColorHash < 0.3) { sr = 180; sg = 200; sb = 255; }
			else if (starColorHash < 0.6) { sr = 255; sg = 255; sb = 180; }
			else if (starColorHash < 0.8) { sr = 255; sg = 180; sb = 150; }
			
			// dimmer stars
			const intensity = starPattern > 0.98 ? twinkle * 0.5 : twinkle * 0.2;
			bgR = Math.min(255, bgR + sr * intensity);
			bgG = Math.min(255, bgG + sg * intensity);
			bgB = Math.min(255, bgB + sb * intensity);
		}
	}

	// SUN (daytime)
	if (hour >= 7 && hour < 17) {
		const sunDx = px - 0.5;
		const sunDy = py - (-0.2);
		const sunDist = Math.sqrt(sunDx * sunDx + sunDy * sunDy);
		if (sunDist < 0.15) {
			if (sunDist < 0.03) {
				bgR = 255; bgG = 250; bgB = 220;
			} else {
				const halo = 1.0 - (sunDist / 0.15);
				const hIntensity = halo * halo;
				bgR = Math.min(255, bgR + Math.floor(hIntensity * 80));
				bgG = Math.min(255, bgG + Math.floor(hIntensity * 70));
				bgB = Math.min(255, bgB + Math.floor(hIntensity * 45));
			}
		}
	}

	// CLOUDS: SUBTLE only. Small, soft wisps. Only upper portion of sky.
	if (py < -0.15) {
		const drift = time * 0.05; // drift slowly
		const n1 = Math.sin((px + drift) * 4) * Math.cos(py * 6) * 0.5 + 0.5;
		const n2 = Math.sin((px - drift * 0.5) * 8 + py * 10) * 0.5 + 0.5;
		const noise = n1 * 0.6 + n2 * 0.4;
		
		if (noise > 0.6) {
			let maxOpacity = 0.15;
			let cr = 240, cg = 245, cb = 255;
			
			if (w === "storm") { cr = 100; cg = 105; cb = 110; }
			else if (w === "clear" || !w) { maxOpacity = 0.08; }
			
			const blend = Math.min(maxOpacity, (noise - 0.6) * 0.5);

			bgR = Math.floor(bgR * (1 - blend) + cr * blend);
			bgG = Math.floor(bgG * (1 - blend) + cg * blend);
			bgB = Math.floor(bgB * (1 - blend) + cb * blend);
		}
	}

	// STORM LIGHTNING: rarer
	if (w === "storm" && Math.sin(time * 47) > 0.995) {
		bgR = Math.min(255, bgR + 180);
		bgG = Math.min(255, bgG + 180);
		bgB = Math.min(255, bgB + 200);
	}

	return [bgR, bgG, bgB];
}

function buildObjects(): RenderObj[] {
	breathe = Math.sin(time * (isSleeping ? 1.5 : 3)) * 0.015;
	let earWave = Math.sin(time * 4) * 0.08;
	if (currentState === "excited" || currentState === "fetching" || currentState === "singing") earWave = Math.sin(time * 15) * 0.2;
	if (isTalking) earWave = Math.sin(time * 12 + talkAudioLevel * 5) * 0.15;
	if (isWalking) earWave += Math.sin(time * 10) * 0.1;
	earWave += agentEarBoost * (0.08 + Math.sin(time * 14) * 0.06);
	const pawSwing = (isWalking || currentState === "chasing" || currentState === "fetching" || currentState === "peek") ? Math.sin(time * 12) * 0.08 : 0;
	const antRot = Math.sin(time * 2.5) * 0.15 + (isWalking || currentState === "fetching" ? Math.sin(time * 12) * 0.3 : 0);
	const effectiveBounceY = getEffectiveBounceY();
	const baseY = posY + effectiveBounceY + breathe;

	const objects: RenderObj[] = [];
	if (isSleeping) objects.push({ id: "pillow", mat: 10, x: 0, y: 0.65, rx: 0.6, ry: 0.15, z: posZ - 0.1 });

	objects.push(
		{ id: "antenna_stalk", mat: 7, x: posX + Math.sin(antRot) * 0.08, y: baseY - 0.35, rx: 0.012, ry: 0.08, rot: antRot, z: 0.05 },
		{ id: "antenna_bulb", mat: 8, x: posX + Math.sin(antRot) * 0.16, y: baseY - 0.42, r: 0.035, z: 0.08 },
		{ id: "body", mat: 1, x: posX, y: baseY, r: 0.32, z: 0 },
		{ id: "earL", mat: 1, x: posX - 0.28, y: baseY - 0.05, rx: 0.08, ry: 0.22, rot: 0.5 + earWave, z: 0.1 },
		{ id: "earR", mat: 1, x: posX + 0.28, y: baseY - 0.05, rx: 0.08, ry: 0.22, rot: -0.5 - earWave, z: 0.1 },
		{ id: "pawL", mat: 2, x: posX - 0.14, y: baseY + 0.22, r: 0.05, z: 0.2 + pawSwing },
		{ id: "pawR", mat: 2, x: posX + 0.14, y: baseY + 0.22, r: 0.05, z: 0.2 - pawSwing },
		{ id: "tail", mat: 3, x: posX + Math.cos(time * 2) * 0.35, y: baseY - 0.05, r: 0.06, z: Math.sin(time * 2) * 0.4 },
		{ id: "firefly", mat: 5, x: ffX, y: ffY, r: 0.015, z: ffZ },
	);

	if (isSleeping) {
		const eL = objects.find(o => o.id === "earL");
		const eR = objects.find(o => o.id === "earR");
		const pL = objects.find(o => o.id === "pawL");
		const pR = objects.find(o => o.id === "pawR");
		if (!eL || !eR || !pL || !pR) return objects; // skip frame if objects missing
		eL.rot = 1.3; eL.y += 0.08; eL.x -= 0.08;
		eR.rot = -1.3; eR.y += 0.08; eR.x += 0.08;
		pL.y += 0.05; pL.x -= 0.1; pR.y += 0.05; pR.x += 0.1;
	}

	if (ballY !== -10) {
		if (hasBall) objects.push({ id: "ball", mat: 9, x: posX + getEffectiveLookX() * 0.05, y: posY + effectiveBounceY + 0.05, r: 0.035, z: posZ + 0.15 });
		else objects.push({ id: "ball", mat: 9, x: ballX, y: ballY, r: 0.035, z: 0.15 });
	}

	for (const f of foods) objects.push({ id: "food", mat: 6, x: f.x, y: f.y, r: 0.03, z: 0.1 });

	if (gameActive) {
		for (let i = 0; i < gameStars.length; i++) {
			const s = gameStars[i];
			if (!s.caught) objects.push({ id: "star" + i, mat: 3, x: s.x, y: s.y, r: 0.03, z: 0.15 });
		}
	}

	const weather = getWeather();
	const tod = getTimeOfDay();

	// Umbrella — when raining/storming and user gave one
	if ((weather === "rain" || weather === "storm") && accessories.umbrella) {
		objects.push(
			// Umbrella handle (thin stick above head)
			{ id: "umbrella_handle", mat: 7, x: posX + 0.05, y: baseY - 0.38, rx: 0.008, ry: 0.12, z: 0.15 },
			// Umbrella canopy (wide flat ellipse)
			{ id: "umbrella_top", mat: 11, x: posX + 0.05, y: baseY - 0.50, rx: 0.18, ry: 0.04, z: 0.2 }
		);
	}

	// Scarf — when snowing and user gave one
	if (weather === "snow" && accessories.scarf) {
		objects.push(
			{ id: "scarf", mat: 12, x: posX, y: baseY + 0.18, rx: 0.15, ry: 0.035, z: 0.25 }
		);
	}

	// Sunglasses — during bright day
	if (tod === "day" && weather === "clear" && accessories.sunglasses) {
		objects.push(
			{ id: "sunglasses", mat: 13, x: posX - 0.07, y: baseY + 0.02, r: 0.035, z: 0.3 },
			{ id: "sunglasses", mat: 13, x: posX + 0.07, y: baseY + 0.02, r: 0.035, z: 0.3 }
		);
	}

	// Hat — always visible when owned (a cute little beret/beanie on top of head)
	if (accessories.hat) {
		objects.push(
			// Hat brim — wide flat ellipse sitting on top of head
			{ id: "hat_brim", mat: 14, x: posX, y: baseY - 0.28, rx: 0.16, ry: 0.025, z: 0.22 },
			// Hat crown — rounded dome above brim
			{ id: "hat_crown", mat: 14, x: posX, y: baseY - 0.34, rx: 0.12, ry: 0.06, z: 0.22 }
		);
	}

	objects.sort((a, b) => b.z - a.z);
	for (const obj of objects) {
		if (obj.rot !== undefined) { obj.s = Math.sin(obj.rot); obj.c = Math.cos(obj.rot); }
	}
	return objects;
}

// ─── Character Bible: Core Functions ─────────────────────────────────────────

function resolveEmotionalState(now: number): EmotionalState {
	// Critical needs — always checked first
	if (hunger < 15) return "critical_hunger";
	if (energy < 15) return "critical_tired";

	// Moderate needs
	if (hunger < 30) return "hungry";
	if (energy < 30) return "tired";

	// Gratitude window — 45s after being fed/rested from a low state
	const fedRecently = lastFedAt > 0 && now - lastFedAt < 45_000;
	const restedRecently = lastRestedAt > 0 && now - lastRestedAt < 45_000;
	if (fedRecently || restedRecently) return "recovering";

	// Boredom — idle too long with no interaction
	const idleMs = lastInteractionAt > 0 ? now - lastInteractionAt : now - sessionStartedAt;
	if (idleMs > 180_000 && hunger > 50 && energy > 50) return "bored";

	// Positive states
	if (hunger > 90 && energy > 90) return "blissful";
	if (hunger > 75 && energy > 75) {
		if (now < playfulUntil) return "playful";
		if (Math.random() < 0.05) {
			playfulUntil = now + 60000 + Math.random() * 60000; // 60-120s sticky
			return "playful";
		}
		return "happy";
	}

	return "content";
}

function pickWeightedLine(pool: BibleSpeechLine[], now: number): BibleSpeechLine | null {
	const eligible = pool.filter(l => {
		if (l.text === lastSpokenText) return false;
		if (now - lastEmotionalReactionAt < l.minGapSeconds * 1000) return false;
		return true;
	});
	if (eligible.length === 0) return null;
	const totalWeight = eligible.reduce((sum, l) => sum + l.weight, 0);
	let roll = Math.random() * totalWeight;
	for (const line of eligible) {
		roll -= line.weight;
		if (roll <= 0) return line;
	}
	return eligible[eligible.length - 1];
}

function getLinePoolForState(state: EmotionalState): BibleSpeechLine[] {
	switch (state) {
		case "critical_hunger": return CRITICAL_HUNGER_LINES;
		case "critical_tired":  return CRITICAL_TIRED_LINES;
		case "hungry":          return HUNGRY_LINES;
		case "tired":           return TIRED_LINES;
		case "recovering":      return RECOVERING_LINES;
		case "content":         return [...CONTENT_LINES, ...RELATIONSHIP_WARMTH];
		case "happy":           return [...HAPPY_LINES, ...RELATIONSHIP_WARMTH];
		case "blissful":        return [...BLISSFUL_LINES, ...RELATIONSHIP_WARMTH];
		case "bored":           return BORED_LINES;
		case "playful":         return PLAYFUL_LINES;
	}
}

function resolveAndSpeak(now: number): void {
	const state = currentEmotionalState;

	// ── B. Milestone celebration — checked once per minute ──
	if (now - lastMilestoneCheckAt > 60_000) {
		lastMilestoneCheckAt = now;
		const MILESTONES = [10, 25, 50, 100, 250, 500, 1000];
		const milestone = MILESTONES.find(m => totalInteractions >= m && milestoneCelebrated < m);
		if (milestone && speechTimer <= 0) {
			milestoneCelebrated = milestone;
			const lines = [
				`[excited] ${milestone} interactions! You really care about me!`,
				`[laughs] We've done ${milestone} things together!`,
				`[happy] ${milestone} moments... each one special!`,
			];
			say(lines[Math.floor(Math.random() * lines.length)], 4.0, "system", 3, true);
			lastEmotionalReactionAt = now;
			return;
		}

		// ── C. Session milestone speech ──
		const sessionMinutes = Math.floor((now - sessionStartedAt) / 60_000);
		const sessionMilestone = SESSION_MILESTONES.find(m =>
			sessionMinutes >= m.minutes && lastSessionMilestone < m.minutes
		);
		if (sessionMilestone && speechTimer <= 0 && isSpeechAllowed(state, "care_for_user")) {
			lastSessionMilestone = sessionMilestone.minutes;
			say(sessionMilestone.line, 4.0, "commentary", 2, true);
			lastEmotionalReactionAt = now;
			return;
		}
	}

	// ── F. Agent comfort lines — support user during errors ──
	if (agentMood === "concerned" && isSpeechAllowed(state, "care_for_user") && speechTimer <= 0) {
		if (Math.random() < 0.05 && now - lastEmotionalReactionAt > 60_000) {
			const comfortLines = [
				"[happy] Errors happen! You'll figure it out",
				"[curious] That didn't work, but I believe in you",
				"[happy] Every bug fixed makes you stronger!",
				"[whispers] It's okay... take your time",
			];
			say(comfortLines[Math.floor(Math.random() * comfortLines.length)], 4.0, "commentary", 2, true);
			lastEmotionalReactionAt = now;
			return;
		}
	}

	// Time-of-day awareness (once per period, only in non-negative states)
	// Multi-instance dedup: only speak if this instance wins the greeting claim
	if (isSpeechAllowed(state, "time_awareness") || isSpeechAllowed(state, "care_for_user")) {
		const tod = getDetailedTimeOfDay();
		if (tod !== lastTimeOfDayPeriod) {
			const sessionMin = (now - sessionStartedAt) / 60_000;
			const timeCandidates = TIME_AWARENESS_LINES.filter(l => {
				if (!l.timeOfDay.includes(tod)) return false;
				if (l.oncePerPeriod && announcedTimePeriods.has(tod)) return false;
				if (!isSpeechAllowed(state, "care_for_user")) return false;
				if (l.minSessionMinutes && sessionMin < l.minSessionMinutes) return false;
				if (l.firstSession && firstSessionGreetingDone) return false;
				if (l.firstSession && sessionCount !== 1) return false;
				if (!l.firstSession && sessionCount === 1 && TIME_AWARENESS_LINES.some(fl => fl.firstSession && fl.timeOfDay.includes(tod))) return false;
				return true;
			});
			const timeLine = timeCandidates.length > 0 ? timeCandidates[Math.floor(Math.random() * timeCandidates.length)] : undefined;
			if (timeLine && speechTimer <= 0 && claimGreeting()) {
				lastTimeOfDayPeriod = tod;
				announcedTimePeriods.add(tod);
				lastEmotionalReactionAt = now;
				if (timeLine.firstSession) firstSessionGreetingDone = true;
				// If other terminals are running, use a multi-terminal-aware greeting instead
				const others = getOtherInstances();
				let greetText = timeLine.text;
				if (others.length > 0 && !timeLine.firstSession) {
					const pool = MULTI_TERMINAL_GREETINGS;
					greetText = pool[Math.floor(Math.random() * pool.length)]
						.replace("{count}", String(others.length + 1));
				}
				lastSpokenText = greetText;
				say(greetText, 4.0, "commentary", 2, true);
				return;
			}
			// Even if we didn't speak, mark the period so we don't retry every frame
			lastTimeOfDayPeriod = tod;
		}
	}

	// Minimum gap before speaking again (varies by urgency)
	const minGap = (state === "critical_hunger" || state === "critical_tired") ? 25_000
		: (state === "hungry" || state === "tired") ? 40_000
		: 60_000;
	if (now - lastEmotionalReactionAt < minGap) return;
	if (speechTimer > 0) return;

	// Spontaneous desires — when happy/playful/bored, she asks for activities
	if (isSpeechAllowed(state, "playful_request") && now - lastDesireAt > 90_000) {
		const desireLines: Array<{ text: string; states: EmotionalState[] }> = [
			{ text: "[excited] Can we play ball? Please?", states: ["happy", "playful", "bored"] },
			{ text: "[excited] I wanna dance!", states: ["happy", "playful", "blissful"] },
			{ text: "[excited] Let's play catch the stars!", states: ["happy", "playful"] },
			{ text: "[happy] Sing me a song?", states: ["content", "happy", "blissful", "bored"] },
			{ text: "[mischievously] Do a flip! Do a flip!", states: ["happy", "playful"] },
			{ text: "[happy] Can I have a hug?", states: ["content", "tired", "bored", "recovering"] },
			{ text: "[happy] Pet me? I promise I'll purr!", states: ["content", "happy", "bored"] },
			{ text: "[curious] Any chance of a treat?", states: ["content", "bored"] },
		];
		const eligibleDesires = desireLines.filter(d => d.states.includes(state));
		if (eligibleDesires.length > 0 && Math.random() < 0.12) {
			const desire = eligibleDesires[Math.floor(Math.random() * eligibleDesires.length)];
			lastDesireAt = now;
			lastEmotionalReactionAt = now;
			lastSpokenText = desire.text;
			say(desire.text, 4.0, "commentary", 1, true);
			return;
		}
	}

	// ── Context-Aware Self-Requests — checked once per 60s, 5min cooldown per key ──
	if (now - lastContextualDesireCheckAt > 60_000 && speechTimer <= 0 && !agentOverlayActive) {
		lastContextualDesireCheckAt = now;
		const weather = getWeather();
		const idleMs = lastInteractionAt > 0 ? now - lastInteractionAt : now - sessionStartedAt;
		const sessionMinutes = Math.floor((now - sessionStartedAt) / 60_000);
		const CONTEXTUAL_DESIRES: Array<{ condition: () => boolean; text: string; cooldownKey: string }> = [
			{ condition: () => (weather === "rain" || weather === "storm") && !accessories.umbrella, text: "[shivers] It's pouring... I wish I had an umbrella!", cooldownKey: "rain_umbrella" },
			{ condition: () => weather === "snow" && !accessories.scarf, text: "[cold] Brr... a scarf would be so cozy right now", cooldownKey: "snow_scarf" },
			{ condition: () => weather === "clear" && !accessories.sunglasses, text: "[squints] The sun is so bright today... sunglasses would help!", cooldownKey: "clear_sunglasses" },
			{ condition: () => !accessories.hat && Math.random() < 0.5, text: "[curious] I wonder what I'd look like in a hat...", cooldownKey: "no_hat" },
			{ condition: () => state === "bored" && energy > 50, text: "[playful] Wanna throw the ball? I'll catch it!", cooldownKey: "bored_ball" },
			{ condition: () => state === "happy" && energy > 60, text: "[excited] I feel like dancing! Come on!", cooldownKey: "happy_dance" },
			{ condition: () => energy < 30, text: "[hopeful] A little treat would really perk me up...", cooldownKey: "low_energy_treat" },
			{ condition: () => agentErrorCount > 3, text: "[concerned] Things seem rough... need a hand?", cooldownKey: "agent_errors" },
			{ condition: () => idleMs > 600_000, text: "[gentle] Just checking in... everything okay over there?", cooldownKey: "idle_checkin" },
			{ condition: () => sessionMinutes >= 60, text: "[thoughtful] We've been at this a while... what a journey", cooldownKey: "session_milestone" },
		];
		const eligible = CONTEXTUAL_DESIRES.filter(d => {
			const lastUsed = contextualDesireCooldowns[d.cooldownKey] || 0;
			if (now - lastUsed < 300_000) return false;
			try { return d.condition(); } catch { return false; }
		});
		if (eligible.length > 0) {
			const picked = eligible[Math.floor(Math.random() * eligible.length)];
			contextualDesireCooldowns[picked.cooldownKey] = now;
			lastEmotionalReactionAt = now;
			lastSpokenText = picked.text;
			say(picked.text, 4.0, "commentary", 1, true);
			return;
		}
	}

	// ── D. Rare "golden" moments — strong prediction error, very low probability ──
	const isPositiveState = state === "content" || state === "happy" || state === "blissful";
	if (isPositiveState && now - lastGoldenLineAt > 600_000) {
		if (Math.random() < 0.005) {
			const goldenLine = GOLDEN_LINES[Math.floor(Math.random() * GOLDEN_LINES.length)];
			lastGoldenLineAt = now;
			lastEmotionalReactionAt = now;
			lastSpokenText = goldenLine;
			say(goldenLine, 4.0, "commentary", 2, true);
			return;
		}
	}

	// Pick a state-appropriate line
	const pool = getLinePoolForState(state);
	// Deadlock prevention: clear ring if pool is too small
	if (pool.length <= RING_SIZE) spokenRing.length = 0;
	const line = pickWeightedLine(pool, now);
	if (line) {
		lastEmotionalReactionAt = now;
		lastSpokenText = line.text;
		say(line.text, 4.0, "commentary", state.startsWith("critical") ? 2 : 1, true);
	}
}

function getScreenEdgeX(): number {
	const effectDim = Math.max(40, Math.min(W, H * 4.5));
	const scale = 2.0 / effectDim;
	return (W / 2.0) * scale;
}

function updatePhysics(dt: number) {
	if (actionTimer > 0) actionTimer -= dt;
	if (speechTimer > 0) speechTimer = Math.max(0, speechTimer - dt);

	// Needs decay
	const now = Date.now();
	if (now - lastNeedsTick > 1000) {
		lastNeedsTick = now;
		if (!isSleeping) { energy = Math.max(0, energy - 0.5); hunger = Math.max(0, hunger - 0.8); }
		else { energy = Math.min(100, energy + 5.0); hunger = Math.max(0, hunger - 0.2); }

		// Character bible: resolve emotional state and speak
		if (!isSleeping) {
			currentEmotionalState = resolveEmotionalState(now);
			resolveAndSpeak(now);
		}
	}

	weatherTimer -= dt;
	if (time < 60) {
		weatherState = "clear";
		if (weatherTimer <= 0) weatherTimer = 1800 + Math.random() * 5400;
	} else if (weatherTimer <= 0) {
		weatherTimer = 1800 + Math.random() * 5400;
		if (weatherState === "clear") weatherState = "cloudy";
		else if (weatherState === "cloudy") {
			const r = Math.random();
			if (r < 0.33) weatherState = "rain";
			else if (r < 0.66) weatherState = "snow";
			else weatherState = "storm";
		}
		else if (weatherState === "rain") weatherState = "clear";
		else if (weatherState === "snow") weatherState = "clear";
		else if (weatherState === "storm") weatherState = "cloudy";
	}

	if (weatherState !== lastAnnouncedWeatherState) {
		lastAnnouncedWeatherState = weatherState;
		let weatherAnnouncement = "";
		if (lastAnnouncedWeatherState === "cloudy") weatherAnnouncement = "[curious] Clouds rolling in...";
		else if (lastAnnouncedWeatherState === "rain") weatherAnnouncement = "[curious] It's starting to rain!";
		else if (lastAnnouncedWeatherState === "storm") weatherAnnouncement = "[concerned] A storm is brewing...";
		else if (lastAnnouncedWeatherState === "snow") weatherAnnouncement = "[excited] Snowflakes!";
		else if (lastAnnouncedWeatherState === "clear") weatherAnnouncement = "[happy] The sky is clearing up!";
		if (weatherAnnouncement) { say(weatherAnnouncement, 3.0, "system", 2, true); emitSfx("weather_transition"); }

		// Ask for accessories if user hasn't given them yet
		const weather = weatherState;
		if (weather === "rain" && !accessories.umbrella && !accessoryAsked.umbrella) {
			accessoryAsked.umbrella = true;
			const handle = setTimeout(() => {
				if (weatherState === "rain" || weatherState === "storm") {
					say("I wish I had an umbrella... /pompom give umbrella", 5.0, "system", 2, true);
				}
				const idx = weatherAccessoryTimers.indexOf(handle);
				if (idx >= 0) weatherAccessoryTimers.splice(idx, 1);
			}, 3000);
			weatherAccessoryTimers.push(handle);
		}
		if (weather === "snow" && !accessories.scarf && !accessoryAsked.scarf) {
			accessoryAsked.scarf = true;
			const handle = setTimeout(() => {
				if (weatherState === "snow") {
					say("Brrr! A scarf would be nice... /pompom give scarf", 5.0, "system", 2, true);
				}
				const idx = weatherAccessoryTimers.indexOf(handle);
				if (idx >= 0) weatherAccessoryTimers.splice(idx, 1);
			}, 3000);
			weatherAccessoryTimers.push(handle);
		}
		if (weather === "storm" && !accessories.umbrella && !accessoryAsked.umbrella) {
			accessoryAsked.umbrella = true;
			const handle = setTimeout(() => {
				if (weatherState === "storm") {
					say("This storm is scary! /pompom give umbrella", 5.0, "system", 2, true);
				}
				const idx = weatherAccessoryTimers.indexOf(handle);
				if (idx >= 0) weatherAccessoryTimers.splice(idx, 1);
			}, 2000);
			weatherAccessoryTimers.push(handle);
		}
	}

	// Firefly
	ffX = posX + Math.sin(time * 1.2) * 0.7;
	ffY = Math.sin(time * 2.0) * 0.3 + 0.1;
	ffZ = posZ + Math.sin(time * 0.9) * 0.4;

	// Weather particles
	const weather = getWeather();
	const effectDim = Math.max(40, Math.min(W, H * 4.5));
	const wScale = 2.0 / effectDim;
	if (weather === "rain" && Math.random() < 0.4 && particles.length < MAX_PARTICLES) {
		particles.push({ x: (Math.random() - 0.5) * W * wScale, y: -H * wScale, vx: 0.15, vy: 2.5 + Math.random(), char: "|", r: 150, g: 200, b: 255, life: 1.0, type: "rain" });
	}
	if (weather === "storm" && Math.random() < 0.6 && particles.length < MAX_PARTICLES) {
		particles.push({ x: (Math.random() - 0.5) * W * wScale, y: -H * wScale, vx: 0.4 + Math.random() * 0.3, vy: 3.0 + Math.random() * 2, char: "/", r: 180, g: 200, b: 255, life: 0.8, type: "rain" });
		// Occasional lightning flash (brief bright particle)
		if (Math.random() < 0.005) {
			particles.push({ x: (Math.random() - 0.5) * W * wScale * 0.5, y: -H * wScale * 0.5, vx: 0, vy: 0, char: "#", r: 255, g: 255, b: 255, life: 0.1, type: "lightning" });
		}
	}
	if (weather === "snow" && Math.random() < 0.2 && particles.length < MAX_PARTICLES) {
		particles.push({ x: (Math.random() - 0.5) * W * wScale, y: -H * wScale, vx: (Math.random() - 0.5) * 0.3, vy: 0.4 + Math.random() * 0.3, char: ".", r: 240, g: 245, b: 255, life: 3.0, type: "snow" });
	}

	// Ball physics
	if (ballY !== -10 && !hasBall) {
		ballVy += dt * 5.0;
		ballX += ballVx * dt; ballY += ballVy * dt;
		if (ballY > 0.55) { ballY = 0.55; ballVy *= -0.7; ballVx *= 0.8; if (Math.abs(ballVy) < 0.2) ballVy = 0; if (Math.abs(ballVx) < 0.1) ballVx = 0; }
		if (ballX < -getScreenEdgeX() + 0.1) { ballX = -getScreenEdgeX() + 0.1; ballVx *= -0.8; }
		if (ballX > getScreenEdgeX() - 0.1) { ballX = getScreenEdgeX() - 0.1; ballVx *= -0.8; }
	}

	// State machine
	// Voice recording override — Pompom rushes to center and talks
	if (isTalking && currentState !== "game") {
		// Interrupt any current state except sleep
		if (currentState !== "sleep" || energy > 30) {
			if (isSleeping) { isSleeping = false; }
			currentState = "idle"; // Reset state so talk animation takes over
			
			// Rush to center if not already there
			const centerDist = Math.abs(posX);
			if (centerDist > 0.05) {
				const dir = Math.sign(0 - posX);
				posX += dir * dt * 2.0; // Fast rush to center
				isWalking = true;
				bounceY = -Math.abs(Math.sin(time * 15)) * 0.08;
			} else {
				isWalking = false;
				posX = 0;
			}
			
			// Look at viewer (center)
			lookX += (0 - lookX) * dt * 8.0;
			lookY += (0 - lookY) * dt * 8.0;
			
			// Bounce with audio level — bigger bounce = louder voice
			bounceY = -talkAudioLevel * 0.15 - Math.abs(Math.sin(time * 10)) * 0.03;
			
			// Ear wiggle synced to audio
			// (ears already wiggle via earWave in buildObjects, but we can enhance by
			//  modifying the earWave base in the existing code)
		}
	}

	const overlayWeightTarget = agentOverlayActive ? 1 : 0;
	agentOverlayWeight += (overlayWeightTarget - agentOverlayWeight) * dt * 6.0;
	const overlayLookTargetX = agentOverlayTargetLookX * agentOverlayWeight;
	const overlayLookTargetY = agentOverlayTargetLookY * agentOverlayWeight;
	agentOverlayLookX += (overlayLookTargetX - agentOverlayLookX) * dt * 7.0;
	agentOverlayLookY += (overlayLookTargetY - agentOverlayLookY) * dt * 7.0;
	const glowTarget = agentOverlayActive ? agentAntennaGlowTarget : 0;
	agentAntennaGlow += (glowTarget - agentAntennaGlow) * dt * 8.0;
	const earBoostTarget = agentOverlayActive ? agentEarBoostTarget : 0;
	agentEarBoost += (earBoostTarget - agentEarBoost) * dt * 8.0;
	const overlayBounceTarget = agentOverlayActive
		? Math.sin(time * (6 + agentEarBoost * 10)) * (0.015 + agentAntennaGlow * 0.03)
		: 0;
	agentOverlayBounce += (overlayBounceTarget - agentOverlayBounce) * dt * 8.0;

	if (currentState === "game") {
		gameTimer -= dt;
		if (gameTimer <= 0) {
			gameActive = false;
			currentState = "idle";
			say("[excited] Score: " + gameScore + "!", 3.0, "system", 2, true); emitSfx("game_end");
			gameStars = [];
			bounceY = 0;
			lookX = 0;
		} else {
			if (Math.floor((time - dt) * 2) < Math.floor(time * 2)) {
				gameStars.push({ x: (Math.random() - 0.5) * (getScreenEdgeX() * 1.5), y: -0.5, vy: 0.3, caught: false });
			}
			
			let targetStar = null;
			let minDist = Infinity;
			for (let i = gameStars.length - 1; i >= 0; i--) {
				const star = gameStars[i];
				star.y += star.vy * dt;
				if (star.y > 0.6) {
					gameStars.splice(i, 1);
					continue;
				}
				const distX = Math.abs(posX - star.x);
				const distY = Math.abs((posY + bounceY) - star.y);
				if (distX < 0.15 && distY < 0.15 && !star.caught) {
					gameScore++;
					star.caught = true;
					emitSfx("star_chime");
					gameStars.splice(i, 1);
					particles.push({ x: star.x, y: star.y, vx: (Math.random() - 0.5)*0.5, vy: (Math.random() - 0.5)*0.5, char: "*", r: 255, g: 255, b: 0, life: 1.0, type: "sparkle" });
					continue;
				}
				if (star.y < 0.5 && distX < minDist) {
					minDist = distX;
					targetStar = star;
				}
			}

			if (targetStar) {
				const dir = Math.sign(targetStar.x - posX);
				if (Math.abs(targetStar.x - posX) > 0.05) {
					posX += dir * dt * 0.8;
					lookX = dir * 0.5;
					bounceY = -Math.abs(Math.sin(time * 15)) * 0.08;
				} else {
					lookX = 0;
					bounceY = 0;
				}
			} else {
				lookX = 0;
				bounceY = 0;
			}
		}
	}
	else if (currentState === "idle") {
		if (Math.random() < 0.01) blinkFade = 1.0;
		else blinkFade = Math.max(0, blinkFade - dt * 6.0);
		bounceY += (0 - bounceY) * dt * 5.0;
		lookX += (0 - lookX) * dt * 3.0;
		if (ballY !== -10 && !hasBall) {
			currentState = "fetching";
			const fetchLines = ["[excited] Ball! I got it I got it!", "[excited] Ooh, ball incoming!", "[happy] Here I come!", "[excited] Mine mine mine!"];
			say(fetchLines[Math.floor(Math.random() * fetchLines.length)], 2.0, "reaction", 2, true);
		}
		else if (now - lastIdleWalkAt > 60000 && Math.random() < 0.01 && !isTalking) {
			lastIdleWalkAt = now;
			if (Math.random() < 0.15) targetX = (Math.random() > 0.5 ? 1 : -1) * (getScreenEdgeX() + 0.25); // occasional sneaky walk — stays 20-30% visible
			else targetX = (Math.random() - 0.5) * (getScreenEdgeX() * 0.6);
			currentState = "walk"; isWalking = true;
		}
		else if (now - lastIdleFlipAt > 120000 && Math.random() < 0.005) {
			lastIdleFlipAt = now;
			currentState = "flip"; isFlipping = true; flipPhase = 0;
			const flipLines = ["[excited] Wheee!", "[laughs] Watch this!", "[excited] Flip time!", "[happy] Boing!"];
			say(flipLines[Math.floor(Math.random() * flipLines.length)], 4.0, "reaction", 1, true);
			emitSfx("flip_whoosh");
		}
		else if (now - lastIdleChaseAt > 120000 && Math.random() < 0.005) { lastIdleChaseAt = now; currentState = "chasing"; actionTimer = 3.0; emitSfx("firefly_twinkle"); }
		else if (Math.random() < 0.001 && speechTimer <= 0) {
			// Only pick idle speech when in a non-negative state
			const nowMs = Date.now();
			const state = currentEmotionalState;
			if (isSpeechAllowed(state, "idle_chatter")) {
				const pool = getLinePoolForState(state);
				const eligible = pool.filter(l => isSpeechAllowed(state, "idle_chatter") && l.text !== lastSpokenText);
				if (eligible.length > 0) {
					const line = eligible[Math.floor(Math.random() * eligible.length)];
					lastEmotionalReactionAt = nowMs;
					lastSpokenText = line.text;
					say(line.text, 3.0, "commentary", 1, true);
				}
			}
		}
	}
	if (currentState === "walk") {
		const dir = Math.sign(targetX - posX);
		posX += dir * dt * 0.6;
		bounceY = -Math.abs(Math.sin(time * 10)) * 0.08;
		lookX = dir * 0.5;
		const nowMs = Date.now();
		if (nowMs - lastFootstepTime >= FOOTSTEP_INTERVAL_MS) { lastFootstepTime = nowMs; emitSfx("footstep_soft"); }
		if (Math.abs(posX - targetX) < 0.05) {
			isWalking = false; posX = targetX; bounceY = 0; lookX = 0;
			if (Math.abs(posX) >= getScreenEdgeX() + 0.1) { currentState = "offscreen"; actionTimer = 2.0 + Math.random() * 3.0; emitSfx("hide_tiptoe"); }
			else currentState = "idle";
		}
	}
	if (currentState === "offscreen") {
		if (actionTimer <= 0) { currentState = "peek"; actionTimer = 4.0; targetX = Math.sign(posX) * (getScreenEdgeX() + 0.15); isWalking = true; emitSfx("peek_surprise"); }
	}
	if (currentState === "peek") {
		const dir = Math.sign(targetX - posX);
		if (Math.abs(posX - targetX) > 0.05) {
			posX += dir * dt * 0.4; bounceY = -Math.abs(Math.sin(time * 6)) * 0.05;
			lookX = -Math.sign(posX) * 0.8;
		} else {
			isWalking = false; posX = targetX; bounceY = 0;
			lookX = -Math.sign(posX) * 0.6 + Math.sin(time * 2) * 0.2;
			if (actionTimer < 3.0 && speechTimer <= 0 && Math.random() < 0.05) {
				const peekLines = ["[mischievously] Peekaboo!", "[laughs] Did you miss me?", "[mischievously] Bet you didn't see me sneak back!", "[happy] I'm baaack!"];
				say(peekLines[Math.floor(Math.random() * peekLines.length)], 2.0, "reaction", 1, true);
			}
			if (actionTimer <= 0) { currentState = "walk"; targetX = 0; isWalking = true; }
		}
	}
	if (currentState === "chasing") {
		const dir = Math.sign(ffX - posX);
		posX += dir * dt * 0.8;
		bounceY = -Math.abs(Math.sin(time * 12)) * 0.1;
		lookX = dir * 0.6; isWalking = true;
		if (actionTimer <= 0) { currentState = "idle"; isWalking = false; bounceY = 0; }
	}
	if (currentState === "flip") {
		flipPhase += dt * Math.PI * 2.0;
		bounceY = -Math.sin(flipPhase) * 0.6;
		if (flipPhase >= Math.PI * 2) { isFlipping = false; bounceY = 0; currentState = "idle"; }
	}
	if (currentState === "sleep") {
		blinkFade = 1.0;
		const dir = Math.sign(0 - posX);
		if (Math.abs(posX) > 0.05) { posX += dir * dt * 1.5; bounceY = -Math.abs(Math.sin(time * 12)) * 0.1; }
		else { posX = 0; bounceY += (0.4 - bounceY) * dt * 5.0; }
		if (Math.random() < 0.02) {
			particles.push({ x: posX + 0.2, y: posY + bounceY, vx: 0.15, vy: -0.2, char: "z", r: 150, g: 200, b: 255, life: 1.2, type: "z" });
		}
		if (actionTimer <= 0) {
			currentState = "idle"; isSleeping = false;
			lastRestedAt = Date.now();
			if (hunger < 30) {
				const hungryWake = ["[sighs] Good nap... but I'm hungry now!", "[sad] I slept well but... my tummy...", "[sighs] Rested but starving..."];
				say(hungryWake[Math.floor(Math.random() * hungryWake.length)], 4.0, "reaction", 1, true);
			} else {
				const happyWake = ["[sighs] What a lovely nap!", "[happy] I feel SO refreshed!", "[laughs] Best nap ever! What did I miss?", "[excited] I'm recharged and ready!"];
				say(happyWake[Math.floor(Math.random() * happyWake.length)], 4.0, "reaction", 1, true);
			}
		}
	}
	if (currentState === "excited") {
		blinkFade = 1.0;
		bounceY = -Math.abs(Math.sin(time * 12) * 0.15);
		if (Math.random() < 0.15) {
			particles.push({ x: posX + (Math.random() - 0.5) * 0.6, y: posY + bounceY + (Math.random() - 0.5) * 0.4, vx: (Math.random() - 0.5) * 0.4, vy: -0.4 - Math.random() * 0.4, char: "*", r: 255, g: 255, b: 150, life: 1.0, type: "sparkle" });
		}
		if (actionTimer <= 0) currentState = "idle";
	}
	if (currentState === "singing") {
		blinkFade = 1.0;
		bounceY = -Math.abs(Math.sin(time * 8) * 0.1);
		lookX = Math.sin(time * 4) * 0.3;
		if (Math.random() < 0.08) {
			particles.push({ x: posX + (Math.random() - 0.5) * 0.6, y: posY + bounceY - 0.4, vx: (Math.random() - 0.5) * 0.4, vy: -0.6 - Math.random() * 0.4, char: "~", r: 255, g: 150, b: 200, life: 1.5, type: "note" });
		}
		if (actionTimer <= 0) currentState = "idle";
	}
	if (currentState === "dance") {
		bounceY = -Math.abs(Math.sin(time * 16)) * 0.12;
		lookX = Math.sin(time * 6) * 0.4;
		posX += Math.sin(time * 8) * dt * 0.3;
		if (Math.random() < 0.12) {
			particles.push({ x: posX + (Math.random() - 0.5) * 0.5, y: posY + bounceY - 0.3, vx: (Math.random() - 0.5) * 0.6, vy: -0.5 - Math.random() * 0.3, char: "*", r: 255, g: 200, b: 100, life: 1.2, type: "sparkle" });
		}
		if (actionTimer <= 0) currentState = "idle";
	}
	if (currentState === "fetching") {
		if (!hasBall) {
			const dir = Math.sign(ballX - posX);
			posX += dir * dt * 1.5;
			bounceY = -Math.abs(Math.sin(time * 18)) * 0.15;
			lookX = dir * 0.5;
			if (Math.abs(posX - ballX) < 0.15 && Math.abs(posY + bounceY - ballY) < 0.3) {
					hasBall = true;
					const catchLines = ["[excited] Got it!", "[laughs] Caught it!", "[excited] Ha! Too fast for me? Never!", "[happy] Mine!"];
					say(catchLines[Math.floor(Math.random() * catchLines.length)], 4.0, "reaction", 2, true);
				}
		} else {
			const dir = Math.sign(0 - posX);
			posX += dir * dt * 0.8;
			bounceY = -Math.abs(Math.sin(time * 15)) * 0.1;
			lookX = dir * 0.5;
			if (Math.abs(posX) < 0.08) {
				hasBall = false; ballX = posX + 0.15; ballY = 0.5; ballVx = 0.8; ballVy = -1.5;
				currentState = "excited"; actionTimer = 2.0;
					const returnLines = ["[happy] Here you go!", "[excited] Catch! Throw it again!", "[happy] I brought it back!", "[laughs] Again again again!"];
					say(returnLines[Math.floor(Math.random() * returnLines.length)], 4.0, "reaction", 2, true);
			}
		}
	}

	// Food physics & eating
	for (let i = foods.length - 1; i >= 0; i--) {
		const f = foods[i];
		if (Date.now() - f.createdAt > 30000) { foods.splice(i, 1); continue; }
		f.vy += dt * 2.0; f.y += f.vy * dt;
		if (f.y >= 0.5) { f.y = 0.5; f.vy = 0; }
		if (Math.sqrt((f.x - posX) ** 2 + (f.y - (posY + bounceY)) ** 2) < 0.40 && !isSleeping) {
			currentState = "excited"; actionTimer = 2.0;
			for (let k = 0; k < 5; k++) {
				particles.push({ x: f.x, y: f.y, vx: (Math.random() - 0.5) * 0.4, vy: -0.2 - Math.random() * 0.3, char: "*", r: 255, g: 255, b: 200, life: 1.0, type: "crumb" });
			}
			const wasStarving = hunger < 15;
			const wasHungry = hunger < 30;
			hunger = Math.min(100, hunger + 20);
			lastFedAt = Date.now();
			if (wasStarving) {
				const starvingFed = ["[crying] Oh my gosh... FOOD! Thank you so much!", "[crying] FINALLY! I thought I'd never eat again!", "[excited] Food food FOOD! You saved me!"];
				say(starvingFed[Math.floor(Math.random() * starvingFed.length)], 3.0, "user_action", 3, true);
			} else if (wasHungry) {
				const hungryFed = ["[excited] Yum! That hit the spot!", "[happy] Mmm, delicious!", "[excited] Nom nom nom!", "[happy] Just what I needed!"];
				say(hungryFed[Math.floor(Math.random() * hungryFed.length)], 3.0, "user_action", 3, true);
			} else {
				const contentFed = ["[happy] Yum!", "[happy] Ooh, a snack!", "[chuckles] Don't mind if I do!", "[happy] Tasty!"];
				say(contentFed[Math.floor(Math.random() * contentFed.length)], 2.0, "user_action", 3, true);
			}
			foods.splice(i, 1);
		}
	}

	// Particles
	for (let i = particles.length - 1; i >= 0; i--) {
		const p = particles[i];
		p.x += p.vx * dt; p.y += p.vy * dt;
		if (p.type === "z") p.x += Math.sin(p.y * 4.0) * 0.005;
		if (p.type === "note") p.x += Math.sin(p.y * 6.0) * 0.01;
		if (p.type === "rain" && p.y > 0.6) { p.type = "splash"; p.char = "."; p.vy = -0.5; p.vx = (Math.random() - 0.5) * 0.5; p.life = 0.2; }
		if (p.type === "snow") { p.vx += Math.sin(time * 2 + p.x * 5) * 0.01; if (p.y > 0.55) { p.life = 0; } }
		p.life -= dt * (p.type === "lightning" ? 8 : 0.8);
		if (p.life <= 0) particles.splice(i, 1);
	}
}

function renderToBuffers() {
	const effectDim = Math.max(40, Math.min(W, H * 4.5));
	const scale = 2.0 / effectDim;
	const objects = buildObjects();
	const skyColors = getWeatherAndTime();

	// Hybrid renderer: quadrant blocks at edges (2× horizontal detail),
	// half-blocks in smooth areas (better gradient color).
	// 16 Unicode quadrant characters: 4 sub-pixels (2×2) per cell, 2 colors each.
	const QUAD = " \u2597\u2596\u2584\u259D\u2590\u259E\u259F\u2598\u259A\u258C\u2599\u2580\u259C\u259B\u2588";
	const halfX = scale * 0.25;

	for (let cy = 0; cy < H; cy++) {
		for (let cx = 0; cx < W; cx++) {
			const px = (cx - W / 2.0) * scale;
			const py1 = (cy * 2.0 - H) * scale + VIEW_OFFSET_Y;
			const py2 = (cy * 2.0 + 1.0 - H) * scale + VIEW_OFFSET_Y;

			// Sample 4 quadrant centers (TL, TR, BL, BR)
			const tl = getPixel(px - halfX, py1, objects, skyColors);
			const tr = getPixel(px + halfX, py1, objects, skyColors);
			const bl = getPixel(px - halfX, py2, objects, skyColors);
			const br = getPixel(px + halfX, py2, objects, skyColors);

			// Edge detection: max color difference across the 4 quadrants
			let maxD = 0;
			const cs = [tl, tr, bl, br];
			for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
				const d = Math.abs(cs[i][0] - cs[j][0]) + Math.abs(cs[i][1] - cs[j][1]) + Math.abs(cs[i][2] - cs[j][2]);
				if (d > maxD) maxD = d;
			}

			if (maxD > 30) {
				// EDGE CELL — use quadrant character for 2× horizontal detail
				const lum0 = tl[0] * 77 + tl[1] * 150 + tl[2] * 29;
				const lum1 = tr[0] * 77 + tr[1] * 150 + tr[2] * 29;
				const lum2 = bl[0] * 77 + bl[1] * 150 + bl[2] * 29;
				const lum3 = br[0] * 77 + br[1] * 150 + br[2] * 29;
				const med = (Math.min(lum0, lum1, lum2, lum3) + Math.max(lum0, lum1, lum2, lum3)) / 2;

				const b0 = lum0 >= med ? 1 : 0, b1 = lum1 >= med ? 1 : 0;
				const b2 = lum2 >= med ? 1 : 0, b3 = lum3 >= med ? 1 : 0;
				const pattern = (b0 << 3) | (b1 << 2) | (b2 << 1) | b3;

				// Average fg (bright) and bg (dark) group colors
				let fR = 0, fG = 0, fB = 0, fN = 0;
				let bR = 0, bG = 0, bB = 0, bN = 0;
				const bits = [b0, b1, b2, b3];
				for (let i = 0; i < 4; i++) {
					if (bits[i]) { fR += cs[i][0]; fG += cs[i][1]; fB += cs[i][2]; fN++; }
					else { bR += cs[i][0]; bG += cs[i][1]; bB += cs[i][2]; bN++; }
				}
				if (!fN) { fR = bR; fG = bG; fB = bB; fN = bN; }
				if (!bN) { bR = fR; bG = fG; bB = fB; bN = fN; }

				screenChars[cy][cx] = QUAD[pattern];
				screenColors[cy][cx] = `\x1b[38;2;${Math.round(fR / fN)};${Math.round(fG / fN)};${Math.round(fB / fN)}m\x1b[48;2;${Math.round(bR / bN)};${Math.round(bG / bN)};${Math.round(bB / bN)}m`;
			} else {
				// SMOOTH CELL — half-block with averaged top/bottom
				screenChars[cy][cx] = "▀";
				screenColors[cy][cx] = `\x1b[38;2;${(tl[0] + tr[0]) >> 1};${(tl[1] + tr[1]) >> 1};${(tl[2] + tr[2]) >> 1}m\x1b[48;2;${(bl[0] + br[0]) >> 1};${(bl[1] + br[1]) >> 1};${(bl[2] + br[2]) >> 1}m`;
			}
		}
	}

	// Overlay particles
	for (const p of particles) {
		const [scX, scY] = project2D(p.x, p.y);
		if (scX >= 0 && scX < W && scY >= 0 && scY < H * 2) {
			const realCy = Math.floor(scY / 2);
			if (realCy >= 0 && realCy < H) {
				screenChars[realCy][scX] = p.char;
				const bgMatch = screenColors[realCy][scX].match(/\x1b\[48;2;\d+;\d+;\d+m/);
				const bg = bgMatch ? bgMatch[0] : "\x1b[49m";
				screenColors[realCy][scX] = `\x1b[38;2;${p.r};${p.g};${p.b}m${bg}`;
			}
		}
	}

	// Speech bubble
	if (speechTimer > 0 && speechText !== "") {
		const [scX, scY] = project2D(posX, posY + getEffectiveBounceY() - 0.2); // just above head, not off-screen
		drawSpeechBubble(speechText, scX, Math.floor(scY / 2));
	}
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Render the Pompom companion to an array of ANSI-colored string lines.
 *
 * @param width - Available widget width in characters
 * @param audioLevel - 0.0 to 1.0, drives mouth animation during recording
 * @param dt - Time delta in seconds since last frame
 * @returns string[] of H lines, each with ANSI color codes
 */
export function renderPompom(width: number, audioLevel: number, dt: number): string[] {
	// Adapt dimensions — compact: secondary addon, must not dominate the terminal
	const clampedWidth = Math.max(20, width);
	if (clampedWidth !== W) {
		W = clampedWidth;
		H = Math.max(10, Math.min(14, Math.floor(W * 0.18)));
		allocBuffers();
	}

	// Preserve backward compatibility for callers that still pass the
	// talk level through render, but do not overwrite live talking state.
	if (!isTalking) {
		talkAudioLevel = audioLevel;
	}

	// Sub-step physics for stability
	const safeDt = Math.min(dt, 0.5);
	time += safeDt; // keep animation clock in sync with clamped physics clock
	let remaining = safeDt;
	while (remaining > 0) {
		const step = Math.min(remaining, PHYSICS_DT);
		remaining -= step;
		updatePhysics(step);
	}

	renderToBuffers();

	const lines: string[] = [];
	for (let cy = 0; cy < H; cy++) {
		let line = "";
		let lastColor = "";
		for (let cx = 0; cx < W; cx++) {
			if (screenColors[cy][cx] !== lastColor) {
				line += screenColors[cy][cx];
				lastColor = screenColors[cy][cx];
			}
			line += screenChars[cy][cx];
		}
		line += "\x1b[0m";
		lines.push(line);
	}

	// ── Compact single-line status ──
	const dim = "\x1b[38;5;239m";
	const keyC = "\x1b[38;5;252m";
	const lblC = "\x1b[38;5;244m";
	const accC = "\x1b[38;5;153m";
	const mod = process.platform === "darwin" ? "⌥" : "Alt+";

	// State message — varied and character-rich, rotates with time
	const pick = (arr: string[]) => arr[Math.floor((time * 0.1) % arr.length)];
	let stateMsg = "";
	if (hunger < 15) stateMsg = pick([
		`Pompom's tummy won't stop growling... ${mod}e to feed`,
		`Pompom is desperately hungry... please feed her ${mod}e`,
		`Pompom can't focus... she needs food ${mod}e`,
	]);
	else if (hunger < 30) stateMsg = pick([
		`Pompom could use a snack right now... ${mod}e`,
		`Pompom's tummy is rumbling... feed her ${mod}e`,
		`Pompom keeps glancing at the food bowl... ${mod}e`,
	]);
	else if (energy < 15 && !isSleeping) stateMsg = pick([
		`Pompom can barely keep her eyes open... ${mod}s to nap`,
		`Pompom is swaying with exhaustion... let her sleep ${mod}s`,
		`Pompom needs rest badly... ${mod}s for nap time`,
	]);
	else if (energy < 30 && !isSleeping) stateMsg = pick([
		`Pompom is getting sleepy... ${mod}s for a nap`,
		`Pompom yawns... maybe a short nap? ${mod}s`,
		`Pompom's eyelids are drooping... ${mod}s`,
	]);
	else if (currentState === "excited") stateMsg = pick([
		"Pompom is bouncing with pure joy!",
		"Pompom's antenna is glowing with happiness!",
		"Pompom can't contain her excitement!",
	]);
	else if (isSleeping) stateMsg = pick([
		"Shhh... Pompom is curled up napping",
		"Pompom sleeps peacefully, ears twitching softly",
		"Sweet dreams, little Pompom... zzz",
	]);
	else if (currentState === "walk") stateMsg = pick([
		"Pompom waddles along, exploring the terminal",
		"Pompom takes a little stroll, tail swishing",
		"Pompom's tiny paws pad across the screen",
	]);
	else if (currentState === "chasing") stateMsg = pick([
		"Pompom spotted a glowing firefly! She's on the chase!",
		"A firefly! Pompom leaps after it, antenna bobbing",
		"Pompom bounds after a tiny light, ears perked up",
	]);
	else if (currentState === "fetching") stateMsg = hasBall
		? pick(["Pompom snatched the ball! Trotting back proudly", "Got it! Pompom carries the ball back, tail wagging"])
		: pick(["Pompom sprints after the bouncing ball!", "The ball! Pompom races to catch it!"]);
	else if (currentState === "singing") stateMsg = pick([
		"Pompom hums a sweet little tune, swaying gently",
		"Pompom sings softly, her antenna glowing in rhythm",
		"A little melody fills the terminal... la la la",
	]);
	else if (currentState === "dance") stateMsg = pick([
		"Pompom grooves to her own beat, sparkles flying!",
		"Dance party! Pompom's moves are surprisingly good",
		"Pompom shimmies and spins with reckless joy",
	]);
	else if (currentState === "peek") stateMsg = pick([
		"Pompom peeks around the edge... is it safe?",
		"A tiny ear appears... then a curious eye. Hi!",
		"Pompom sneaks back in, trying to look innocent",
	]);
	else if (currentState === "offscreen") stateMsg = pick([
		"Pompom tiptoed away... she'll sneak back soon",
		"Where did Pompom go? She's hiding just off screen",
		"Pompom is on a tiny adventure, she'll return",
	]);
	else if (currentState === "game") stateMsg = pick([
		"Stars are falling! Pompom leaps to catch them!",
		"Game on! Pompom chases golden stars across the sky",
		`Score: ${gameScore} stars! Go Pompom go!`,
	]);
	else if (isTalking) stateMsg = pick([
		"Pompom is chatting with you, ears perked up",
		"Pompom listens intently, antenna tilted your way",
		"Pompom hangs on every word you say",
	]);
	else {
		const w = getWeather(), tod = getTimeOfDay();
		if (w === "storm") stateMsg = pick([
			"Thunder rumbles... Pompom huddles under her umbrella",
			"Pompom watches the lightning from a safe spot",
			"The storm rages, but Pompom feels cozy in here",
		]);
		else if (w === "rain") stateMsg = pick([
			"Pompom watches raindrops race down the window",
			"Pitter-patter... Pompom loves the gentle rain",
			"Rainy day vibes. Pompom listens to the drops",
		]);
		else if (w === "snow") stateMsg = pick([
			"Snowflakes drift down... Pompom tries to catch one",
			"A white world outside. Pompom presses her nose to the glass",
			"Pompom watches the snow fall, cozy and warm",
		]);
		else if (tod === "dawn") stateMsg = pick([
			"The first light of dawn... Pompom watches the sky turn pink",
			"Early morning. Pompom blinks sleepily at the sunrise",
			"A new day begins. Pompom stretches and yawns",
		]);
		else if (tod === "sunset") stateMsg = pick([
			"Golden hour... Pompom's fur glows in the sunset light",
			"The sky blazes orange. Pompom gazes at the horizon",
			"Sunset. Pompom settles in for the evening",
		]);
		else if (tod === "night") stateMsg = pick([
			"Stars twinkle overhead. Pompom counts the constellations",
			"A quiet night sky. Pompom's antenna glows softly",
			"Moonlight bathes the terminal. Pompom is at peace",
		]);
		else if (hunger > 80 && energy > 80) stateMsg = pick([
			"Pompom is living her best life right now",
			"Full belly, rested, happy. Pompom radiates joy",
			"Everything is perfect. Pompom couldn't be happier",
		]);
		else stateMsg = pick([
			"Pompom sits beside you, content and cozy",
			"Pompom is here, keeping you company while you code",
			"A gentle breeze, a happy Pompom, a good day",
			`Pet ${mod}p, feed ${mod}e, or play ball ${mod}r!`,
		]);
	}

	// Build status: "─ ⌥ w·Wake p·Pet ... │ State ───" capped at exactly W visible chars
	const shortcuts: [string, string][] = [
		["p","Pet"],["e","Feed"],["r","Ball"],["x","Dance"],
		["m","Music"],["c","Color"],["s","Sleep"],["a","Wake"],
	];

	// Truncate stateMsg to fit W
	const maxStateW = Math.max(8, W - 20);
	if (getStringWidth(stateMsg) > maxStateW) {
		let w = 0; let trimmed = "";
		for (const ch of stateMsg) {
			const cw = getStringWidth(ch);
			if (w + cw + 1 > maxStateW) { trimmed += "~"; break; }
			trimmed += ch; w += cw;
		}
		stateMsg = trimmed;
	}

	let plainHints = "";
	let styledHints = "";
	const stateW = getStringWidth(stateMsg);
	const fixedW = 2 + getStringWidth(mod) + 1 + 2 + stateW + 1;
	for (const [k, l] of shortcuts) {
		const part = `${k}·${l} `;
		if (getStringWidth(plainHints + part) + fixedW + 1 > W) break;
		plainHints += part;
		styledHints += `${keyC}${k}${lblC}·${l} `;
	}

	const usedW = 2 + getStringWidth(mod) + 1 + getStringWidth(plainHints) + 2 + stateW + 1;
	const padR = Math.max(0, W - usedW);
	lines.push(`${dim}─ ${lblC}${mod} ${styledHints}${dim}│ ${accC}${stateMsg} ${dim}${"─".repeat(padR)}\x1b[0m`);

	return lines;
}

/** Set talking state (driven by voice recording) */
export function pompomSetTalking(active: boolean) {
	isTalking = active;
}

export function pompomOnSpeech(cb: ((event: SpeechEvent) => void) | null) {
	onSpeechCallback = cb;
}

export function pompomOnSfx(cb: ((sfx: string) => void) | null) {
	onSfxCallback = cb;
}

export function pompomSetTalkAudioLevel(level: number) {
	talkAudioLevel = clamp(level, 0, 1);
}

export function pompomSay(
	textOrOptions:
		| string
		| {
			text: string;
			duration?: number;
			source?: SpeechEvent["source"];
			priority?: number;
			allowTts?: boolean;
		},
	duration = 4.0,
	source: SpeechEvent["source"] = "system",
	priority = 2,
	allowTts = true,
) {
	if (typeof textOrOptions === "string") {
		say(textOrOptions, duration, source, priority, allowTts);
		return;
	}
	say(
		textOrOptions.text,
		textOrOptions.duration ?? duration,
		textOrOptions.source ?? source,
		textOrOptions.priority ?? priority,
		textOrOptions.allowTts ?? allowTts,
	);
}

export function pompomSetAgentOverlay({ active }: { active: boolean }) {
	agentOverlayActive = active;
}

export function pompomSetAgentLook({ x, y }: { x: number; y: number }) {
	agentOverlayTargetLookX = clamp(x, -0.9, 0.9);
	agentOverlayTargetLookY = clamp(y, -0.7, 0.7);
}

export function pompomSetAntennaGlow({ intensity }: { intensity: number }) {
	agentAntennaGlowTarget = clamp(intensity, 0, 1);
}

export function pompomSetAgentEarBoost({ amount }: { amount: number }) {
	agentEarBoostTarget = clamp(amount, 0, 1);
}

export function pompomSetWeatherOverride({ weather }: { weather: Weather | null }) {
	weatherOverride = weather;
}

export function pompomGetWeather(): Weather {
	return getWeather();
}

/** Set the current agent mood so Pompom can offer comfort lines during errors */
export function pompomSetAgentMood(mood: string) {
	if (mood === "concerned") agentErrorCount++;
	if (mood === "idle" && agentMood === "concerned") agentErrorCount = 0;
	agentMood = mood;
}

/** Handle a user keypress command */
export function pompomKeypress(key: string) {
	if (isFlipping && key !== "d") { isFlipping = false; flipPhase = 0; }
	const nowMs = Date.now();
	// Track any interaction for boredom detection
	lastInteractionAt = nowMs;

	// ─ Return greeting: check BEFORE updating lastUserActivityAt so we see the stale timestamp
	// Skip if another terminal already greeted recently (multi-instance dedup via claimGreeting)
	const absenceMs = nowMs - lastUserActivityAt;
	if (absenceMs > 300_000 && speechTimer <= 0 && claimGreeting()) {
		let greeting = "";
		if (absenceMs > 28_800_000) greeting = "[excited] You're back! I missed you SO much!";
		else if (absenceMs > 7_200_000) greeting = "[happy] There you are! I was starting to worry!";
		else if (absenceMs > 1_800_000) greeting = "[happy] Welcome back! I kept your spot warm!";
		else greeting = "[happy] Oh hey! You're back!";
		say(greeting, 4.0, "user_action", 3, true);
	}

	// ─ Update lastUserActivityAt after the return greeting check
	lastUserActivityAt = nowMs;

	// ─ Milestone tracking: count every keypress
	totalInteractions++;

	// ─ Diminishing returns: detect rapid same-key spam
	if (key === lastKeypressKey && nowMs - lastKeypressAt < 5000) {
		rapidRepeatCount++;
	} else {
		rapidRepeatCount = 0;
	}
	lastKeypressKey = key;
	lastKeypressAt = nowMs;

	// 3rd rapid repeat: gentle hint, then skip normal reaction
	if (rapidRepeatCount === 2) {
		say("[mischievously] Hehe, again?", 2.0, "reaction", 1, true);
		return;
	}

	// 4th+ rapid repeat: visual-only (no say, no sfx) — handled by suppressSpeech flag below
	const suppressSpeech = rapidRepeatCount >= 3;

	if (key === "p") {
		currentState = "excited"; actionTimer = 2.5; isSleeping = false;
		lastPlayedAt = nowMs;
		if (!suppressSpeech) {
			const state = currentEmotionalState;
			if (state === "recovering") say("[happy] Purrrr... everything is perfect...", 4.0, "user_action", 3, true);
			else if (state === "hungry" || state === "critical_hunger") say("[happy] That's nice... but I'm still hungry...", 4.0, "user_action", 3, true);
			else if (state === "tired" || state === "critical_tired") say("[whispers] Mmm... nice... so sleepy though...", 4.0, "user_action", 3, true);
			else say("[happy] Purrrrr...", 4.0, "user_action", 3, true);
		}
	}
	else if (key === "w") {
		const wasLowEnergy = energy < 15;
		currentState = "idle"; isSleeping = false; blinkFade = 0;
		if (wasLowEnergy) { lastRestedAt = nowMs; }
		if (!suppressSpeech) say("[excited] I'm awake!", 4.0, "user_action", 3, true);
	}
	else if (key === "s") {
		currentState = "sleep"; isSleeping = true; actionTimer = 10;
		if (!suppressSpeech) {
			const state = currentEmotionalState;
			if (state === "critical_tired" || state === "tired") say("[whispers] Finally... sweet sleep...", 4.0, "user_action", 3, true);
			else if (state === "recovering") say("[happy] A nap after a meal? Perfect!", 4.0, "user_action", 3, true);
			else if (state === "hungry" || state === "critical_hunger") say("[sad] Hard to sleep when I'm this hungry...", 4.0, "user_action", 3, true);
			else say("[whispers] Time for a nap... zZz", 4.0, "user_action", 3, true);
		}
	}
	else if (key === "f") {
		isSleeping = false; currentState = "idle";
		if (foods.length >= 10) foods.shift(); // remove oldest
		foods.push({ x: posX + (Math.random() - 0.5) * 0.4, y: -0.8, vy: 0, createdAt: Date.now() });
		// Food drop reaction — state-aware (eating reaction fires in updatePhysics)
		// lastFedAt is set when food is actually eaten, not when dropped
	}
	else if (key === "b") {
		isSleeping = false;
		lastPlayedAt = nowMs;
		const state = currentEmotionalState;
		if (state === "critical_hunger" || state === "critical_tired") {
			if (!suppressSpeech) say(state === "critical_hunger" ? "[annoyed] I can't play right now... I'm starving!" : "[sighs] Too tired to chase...", 3.0, "user_action", 3, true);
		} else if (ballY === 0.55 && !hasBall && Math.abs(posX - ballX) < 0.4) {
			ballVy = -1.8; ballVx = (Math.random() - 0.5) * 2.5;
			if (!suppressSpeech) say(state === "recovering" ? "[excited] Now I have energy to play!" : "[excited] Boing!", 2.0, "user_action", 3, true);
		} else {
			ballX = posX + (Math.random() > 0.5 ? 0.8 : -0.8); ballY = -0.4; ballVx = (Math.random() - 0.5) * 1.5; ballVy = -1.2; hasBall = false;
		}
	}
	else if (key === "m") {
		isSleeping = false; currentState = "singing"; actionTimer = 5.0;
		lastPlayedAt = nowMs;
		if (!suppressSpeech) {
			const state = currentEmotionalState;
			// Use [sings] tag — pick from singing repertoire when possible
			if (state === "critical_hunger" || state === "hungry") {
				say("[sad] I don't feel like singing right now...", 3.0, "user_action", 3, true);
			} else if (state === "critical_tired") {
				say("[whispers] A lullaby maybe...", 3.0, "user_action", 3, true);
			} else if (state === "tired") {
				say("[sings] Twinkle twinkle... zzz...", 4.0, "user_action", 3, true);
			} else if (state === "recovering") {
				const recovSongs = SINGING_REPERTOIRE.filter(s => s.allowedStates.includes("recovering") && energy >= s.minEnergy);
				const song = recovSongs.length > 0 ? recovSongs[Math.floor(Math.random() * recovSongs.length)] : null;
				say(song ? song.text : "[sings] Food glorious food!", 4.0, "user_action", 3, true);
			} else {
				const eligible = SINGING_REPERTOIRE.filter(s => s.allowedStates.includes(state) && energy >= s.minEnergy);
				const song = eligible.length > 0 ? eligible[Math.floor(Math.random() * eligible.length)] : null;
				say(song ? song.text : "[sings] La la la!", 4.0, "user_action", 3, true);
			}
		}
	}
	else if (key === "c") { activeTheme = (activeTheme + 1) % themes.length; }
	else if (key === "d") {
		currentState = "flip"; isFlipping = true; flipPhase = 0; isSleeping = false;
		lastPlayedAt = nowMs;
	}
	else if (key === "o") { isSleeping = false; currentState = "walk"; targetX = (Math.random() > 0.5 ? 1 : -1) * (getScreenEdgeX() + 0.25); isWalking = true; }
	else if (key === "x") {
		isSleeping = false; currentState = "dance"; actionTimer = 4.0;
		lastPlayedAt = nowMs;
		if (!suppressSpeech) {
			const state = currentEmotionalState;
			if (state === "critical_hunger" || state === "hungry") say("[annoyed] Can't dance when my tummy is empty...", 3.0, "user_action", 3, true);
			else if (state === "critical_tired" || state === "tired") say("[sighs] Too tired to dance...", 3.0, "user_action", 3, true);
			else if (state === "recovering") say("[excited] Full belly dance!", 3.0, "user_action", 3, true);
			else say("[excited] Let's dance!", 4.0, "user_action", 3, true);
		}
	}
	else if (key === "t") {
		isSleeping = false; currentState = "excited"; actionTimer = 2.5;
		if (foods.length >= 10) foods.shift(); // remove oldest
		foods.push({ x: posX + (Math.random() - 0.5) * 0.3, y: -0.8, vy: 0, createdAt: Date.now() });
		const state = currentEmotionalState;
		const wasDesperate = hunger < 20;
		// Hunger restored when food is eaten (updatePhysics); lastFedAt also set there
		if (!suppressSpeech) {
			if (wasDesperate) say("[crying] Oh my gosh... a TREAT! Thank you so much!", 3.0, "user_action", 3, true);
			else if (state === "recovering") say("[excited] ANOTHER treat? I don't deserve you!", 3.0, "user_action", 3, true);
			else if (state === "tired" || state === "critical_tired") say("[happy] A treat? For sleepy me?", 3.0, "user_action", 3, true);
			else say("[excited] A special treat!", 2.0, "user_action", 3, true);
		}
	}
	else if (key === "h") {
		isSleeping = false; currentState = "excited"; actionTimer = 3.0; energy = Math.min(100, energy + 10);
		if (!suppressSpeech) {
			const state = currentEmotionalState;
			if (state === "recovering") say("[happy] Hugs make everything better!", 4.0, "user_action", 3, true);
			else if (state === "hungry" || state === "critical_hunger") say("[happy] Thanks... hugs help but food helps more...", 4.0, "user_action", 3, true);
			else if (state === "tired" || state === "critical_tired") say("[happy] That hug gave me life...", 4.0, "user_action", 3, true);
			else say("[happy] Aww, hugs!", 4.0, "user_action", 3, true);
		}
	}
	else if (key === "g") {
		isSleeping = false; gameScore = 0; gameStars = []; gameActive = true; gameTimer = 20; currentState = "game";
		lastPlayedAt = nowMs;
		if (!suppressSpeech) {
			const state = currentEmotionalState;
			if (state === "critical_hunger" || state === "hungry") say("[annoyed] I can't focus... too hungry...", 3.0, "user_action", 3, true);
			else if (state === "critical_tired" || state === "tired") say("[sighs] Too exhausted to play...", 3.0, "user_action", 3, true);
			else if (state === "recovering") say("[excited] Full of energy! Let's play!", 3.0, "user_action", 3, true);
			else say("[excited] Catch the stars!", 3.0, "user_action", 3, true);
		}
	}

	// Accessory giving is handled separately via pompomGiveAccessory
}

/** Reset companion state */
export function resetPompom() {
	for (const h of weatherAccessoryTimers) clearTimeout(h);
	weatherAccessoryTimers.length = 0;
	time = 0; currentState = "idle"; blinkFade = 0; actionTimer = 0;
	speechTimer = 0; speechText = ""; lastFootstepTime = 0; lastEmotionalReactionAt = 0;
	lastIdleWalkAt = 0; lastIdleFlipAt = 0; lastIdleChaseAt = 0;
	posX = 0; posY = 0.15; posZ = 0; bounceY = 0; lookX = 0; lookY = 0;
	isWalking = false; isFlipping = false; isSleeping = false; isTalking = false;
	talkAudioLevel = 0; flipPhase = 0;
	gameScore = 0; gameTimer = 0; gameActive = false; gameStars = [];
	hunger = 100; energy = 100; lastNeedsTick = 0;
	// Character bible state variables
	lastFedAt = 0; lastRestedAt = 0; lastPlayedAt = 0;
	lastInteractionAt = 0; lastDesireAt = 0;
	currentEmotionalState = "content";
	firstSessionGreetingDone = false;
	lastTimeOfDayPeriod = ""; announcedTimePeriods = new Set<DetailedTimeOfDay>();
	sessionStartedAt = Date.now(); lastSpokenText = "";
	// Dopamine reward system variables
	lastUserActivityAt = Date.now();
	totalInteractions = 0;
	milestoneCelebrated = 0;
	lastSessionMilestone = 0;
	lastGoldenLineAt = 0;
	lastKeypressKey = "";
	lastKeypressAt = 0;
	rapidRepeatCount = 0;
	agentMood = "idle";
	playfulUntil = 0;
	lastMilestoneCheckAt = 0;
	// Dedup ring buffer + contextual desires + error tracking
	spokenRing.length = 0;
	lastContextualDesireCheckAt = 0;
	agentErrorCount = 0;
	for (const key of Object.keys(contextualDesireCooldowns)) delete contextualDesireCooldowns[key];
	activeTheme = 0;
	weatherOverride = null;
	weatherState = "clear";
	lastAnnouncedWeatherState = "clear";
	weatherTimer = 1800 + Math.random() * 5400;
	lastRenderedWeatherState = getWeather();
	weatherBlend = 0;
	agentOverlayActive = false;
	agentOverlayWeight = 0;
	agentOverlayLookX = 0;
	agentOverlayLookY = 0;
	agentOverlayTargetLookX = 0;
	agentOverlayTargetLookY = 0;
	agentOverlayBounce = 0;
	agentAntennaGlow = 0;
	agentAntennaGlowTarget = 0;
	agentEarBoost = 0;
	agentEarBoostTarget = 0;
	accessoryAsked = {};
	ballX = -10; ballY = -10; ballVx = 0; ballVy = 0; ballVz = 0; hasBall = false;
	ffX = 0; ffY = 0; ffZ = 0;
	targetX = 0;
	foods.length = 0; particles.length = 0;
}

/** Get current companion stats */
export function pompomStatus(): { hunger: number; energy: number; mood: string; theme: string } {
	let mood = "content";
	if (currentState === "excited" || currentState === "dance") mood = "happy";
	else if (isSleeping) mood = "sleeping";
	else if (hunger < 30) mood = "hungry";
	else if (energy < 20) mood = "tired";
	else if (currentState === "singing") mood = "musical";
	else if (currentState === "chasing") mood = "playful";
	else if (currentState === "fetching") mood = "playful";
	return { hunger: Math.round(hunger), energy: Math.round(energy), mood, theme: themes[activeTheme].name };
}

/** Current widget height in character rows (scene + 1 status line).
 *  Returns a live value since H can change when renderPompom resizes. */
export function pompomHeight(): number { return H + 1; }

export function pompomGiveAccessory(item: string): string {
	const key = item.toLowerCase().trim();
	if (key === "umbrella") { accessories.umbrella = true; say("[excited] Yay, an umbrella! Thank you!", 4.0, "user_action", 3, true); return "Gave Pompom an umbrella!"; }
	if (key === "scarf") { accessories.scarf = true; say("[happy] So warm and cozy! Thanks!", 4.0, "user_action", 3, true); return "Gave Pompom a scarf!"; }
	if (key === "sunglasses") { accessories.sunglasses = true; say("[excited] Looking cool! Thanks!", 4.0, "user_action", 3, true); return "Gave Pompom sunglasses!"; }
	if (key === "hat") { accessories.hat = true; say("[excited] I love hats! Thank you!", 4.0, "user_action", 3, true); return "Gave Pompom a hat!"; }
	return "Unknown accessory. Try: umbrella, scarf, sunglasses, hat";
}

export function pompomGetAccessories(): Accessories { return { ...accessories }; }

export function pompomRestoreAccessories(items: Partial<Accessories>): void {
	accessories = {
		umbrella: items.umbrella === true,
		scarf: items.scarf === true,
		sunglasses: items.sunglasses === true,
		hat: items.hat === true,
	};
}
