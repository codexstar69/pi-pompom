/**
 * Pompom Companion — 3D raymarched virtual pet for Pi CLI.
 *
 * A full 3D raymarched creature with physics, particles, speech bubbles,
 * moods, and interactive commands. Driven by audio level for mouth animation.
 */

import type { SpeechEvent } from "./pompom-voice";

// ─── Rendering Config ────────────────────────────────────────────────────────
// Widget dimensions — set once, used by renderPompom
let W = 50;
let H = 13; // character rows — visible but not dominant
const VIEW_OFFSET_Y = 0.22; // shift camera down so ground is visible in compact mode

const PHYSICS_DT = 0.016; // 60fps physics sub-stepping

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function sanitizeSpeechText(text: string): string {
	return text.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
}

// ─── Pet State ───────────────────────────────────────────────────────────────
type State = "idle" | "walk" | "flip" | "sleep" | "excited" | "chasing" | "fetching" | "singing" | "offscreen" | "peek" | "dance" | "game";

const idleSpeech = [
	"What are we building?", "This is fun!", "Boop!",
	"I love it here!", "Need a break?", "Pom pom pom!",
	"You're doing great!", "*wiggles ears*", "Hmm...",
	"Hey! Look at me!", "Tra la la~", "*happy bounce*",
];
let currentState: State = "idle";
let gameScore = 0;
let gameStars: {x: number, y: number, vy: number, caught: boolean}[] = [];
let gameActive = false;
let gameTimer = 0;

let time = 0;
let blinkFade = 0;
let actionTimer = 0;
let speechTimer = 0;
let speechText = "";

// Needs
let hunger = 100;
let energy = 100;
let lastNeedsTick = 0;

interface Accessories {
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

// Interactables
let ffX = 0, ffY = 0, ffZ = 0;
interface Food { x: number; y: number; vy: number; }
const foods: Food[] = [];
let ballX = -10, ballY = -10, ballZ = 0, ballVx = 0, ballVy = 0, ballVz = 0, hasBall = false;

interface Particle {
	x: number; y: number; vx: number; vy: number;
	char: string; r: number; g: number; b: number; life: number; type: string;
}
const particles: Particle[] = [];

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

function say(
	text: string,
	duration = 4.0,
	source: SpeechEvent["source"] = "system",
	priority = 1,
	allowTts = true,
) {
	const safeText = sanitizeSpeechText(text);
	speechText = safeText;
	speechTimer = duration;
	if (safeText && onSpeechCallback) {
		try {
			onSpeechCallback({ text: safeText, source, priority, allowTts });
		} catch (error) {
			/* silent */
		}
	}
}

function project2D(x: number, y: number): [number, number] {
	const effectDim = Math.max(40, Math.min(W, H * 4.5));
	const scale = 2.0 / effectDim;
	const cx = (x / scale) + (W / 2.0);
	const cy = ((y - VIEW_OFFSET_Y) / scale + H) / 2.0;
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
	if (startY < 0 || startY >= H) return;

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

type Weather = "clear" | "cloudy" | "rain" | "snow" | "storm";
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
let lastWeatherChange = 0;
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

	if (weather !== lastRenderedWeatherState) {
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
	
	prevWeatherColors = { rTop, gTop, bTop, rBot, gBot, bBot };

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

		// ── Eyes: kawaii style — white sclera → colored iris → dark pupil → highlight ──
		const isTired = (energy < 20 || hunger < 30) && !isSleeping;
		const eyeOpen = isSleeping ? 0.05 : (isTired ? 0.4 : 1.0) - blinkFade;
		const ex1 = bdx - effectiveLookX * 0.08 + 0.11, ey1 = bdy - effectiveLookY * 0.05 + 0.02;
		const ex2 = bdx - effectiveLookX * 0.08 - 0.11, ey2 = bdy - effectiveLookY * 0.05 + 0.02;

		if (isSleeping || currentState === "singing") {
			// Closed eyes — flat horizontal dark bars (pixel-art)
			if (isSleeping) {
				if ((Math.abs(ey1) < 0.012 && Math.abs(ex1) < 0.055) || (Math.abs(ey2) < 0.012 && Math.abs(ex2) < 0.055)) { r = 10; g = 8; b = 15; }
			} else {
				// Happy squint — flat bars with slight upward curve at edges
				const sq1 = Math.abs(ey1 + Math.abs(ex1) * Math.abs(ex1) * 8) < 0.015 && Math.abs(ex1) < 0.065;
				const sq2 = Math.abs(ey2 + Math.abs(ex2) * Math.abs(ex2) * 8) < 0.015 && Math.abs(ex2) < 0.065;
				if (sq1 || sq2) { r = 10; g = 8; b = 15; }
			}
		} else {
			const eDist1 = ex1 * ex1 + (ey1 * ey1) / (eyeOpen * eyeOpen + 0.001);
			const eDist2 = ex2 * ex2 + (ey2 * ey2) / (eyeOpen * eyeOpen + 0.001);

			// Layered rectangular eyes — white sclera > brown iris > dark pupil > highlight
			// All layers use box math for grid alignment
			const eyeW = 0.06, eyeH = 0.045 * eyeOpen;
			const inEye1 = Math.abs(ex1) < eyeW && Math.abs(ey1) < eyeH;
			const inEye2 = Math.abs(ex2) < eyeW && Math.abs(ey2) < eyeH;
			if (inEye1 || inEye2) {
				// Layer 1: White sclera (outermost box)
				r = 245; g = 245; b = 250;

				// Layer 2: Brown iris (inner box)
				const irisW = 0.04, irisH = 0.032 * eyeOpen;
				const inIris1 = Math.abs(ex1) < irisW && Math.abs(ey1) < irisH;
				const inIris2 = Math.abs(ex2) < irisW && Math.abs(ey2) < irisH;
				if (inIris1 || inIris2) {
					r = 60; g = 40; b = 25; // warm brown
					// Lower iris slightly lighter
					if ((inIris1 && ey1 > 0.01) || (inIris2 && ey2 > 0.01)) { r = 80; g = 55; b = 35; }

					// Layer 3: Dark pupil (center box)
					const pupilW = 0.022, pupilH = 0.02 * eyeOpen;
					const inPupil1 = Math.abs(ex1) < pupilW && Math.abs(ey1) < pupilH;
					const inPupil2 = Math.abs(ex2) < pupilW && Math.abs(ey2) < pupilH;
					if (inPupil1 || inPupil2) {
						r = 10; g = 8; b = 15;
					}
				}

				// White highlight block (upper-left of eye)
				const hl1 = ex1 > -0.055 && ex1 < -0.025 && ey1 > -0.038 && ey1 < -0.01;
				const hl2 = ex2 > -0.055 && ex2 < -0.025 && ey2 > -0.038 && ey2 < -0.01;
				if ((hl1 || hl2) && !isTired) { r = 255; g = 255; b = 255; }

				// Small warm highlight (lower-right)
				const hl1b = ex1 > 0.015 && ex1 < 0.04 && ey1 > 0.008 && ey1 < 0.028;
				const hl2b = ex2 > 0.015 && ex2 < 0.04 && ey2 > 0.008 && ey2 < 0.028;
				if ((hl1b || hl2b) && !isTired) { r = 220; g = 230; b = 250; }
			}
		}

		// ── Nose: small dark oval ──
		const nnx = bdx - effectiveLookX * 0.06, nny = bdy - effectiveLookY * 0.05 - 0.03;
		// Pixel-art rectangular nose — small dark block
		if (Math.abs(nnx) < 0.02 && Math.abs(nny) < 0.018 && !isSleeping) { r = 15; g = 8; b = 15; }

		// ── Mouth: clear smile arc ──
		if (!isSleeping && !hasBall) {
			const mx = bdx - effectiveLookX * 0.06, my = bdy - effectiveLookY * 0.05 - 0.07;
			// Pixel-art smile — flat dark line, slightly curved via step
			const smileWidth = 0.06;
			const smileY = -0.008 + Math.abs(mx) * Math.abs(mx) * 3; // slight upward curve at edges
			if (Math.abs(mx) < smileWidth && Math.abs(my - smileY) < 0.012) {
				r = 20; g = 10; b = 20;
			}
			// Open mouth when excited/talking
			if (currentState === "excited" || currentState === "singing" || currentState === "dance" || speechTimer > 0 || isTalking) {
				const mouthOpen = (speechTimer > 0 || currentState === "singing" || isTalking)
					? (isTalking ? talkAudioLevel * 0.08 + 0.01 : Math.abs(Math.sin(time * 12)) * 0.03)
					: 0.02;
				if (mx * mx + (my + 0.012) ** 2 < mouthOpen && my < -0.01) {
					r = 230; g = 70; b = 90;
					if (my < -0.03) { r = 255; g = 110; b = 130; }
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
		const moonDy = py - (-0.35);
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
		const sunDy = py - (-0.3);
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

	// CLOUDS: SUBTLE only. Small, soft wisps. Only upper 30% of sky.
	if (py < -0.4) {
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
		const eL = objects.find(o => o.id === "earL")!;
		const eR = objects.find(o => o.id === "earR")!;
		eL.rot = 1.3; eL.y += 0.08; eL.x -= 0.08;
		eR.rot = -1.3; eR.y += 0.08; eR.x += 0.08;
		const pL = objects.find(o => o.id === "pawL")!;
		const pR = objects.find(o => o.id === "pawR")!;
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

	objects.sort((a, b) => a.z - b.z);
	for (const obj of objects) {
		if (obj.rot !== undefined) { obj.s = Math.sin(obj.rot); obj.c = Math.cos(obj.rot); }
	}
	return objects;
}

function getScreenEdgeX(): number {
	const effectDim = Math.max(40, Math.min(W, H * 4.5));
	const scale = 2.0 / effectDim;
	return (W / 2.0) * scale;
}

function updatePhysics(dt: number) {
	if (actionTimer > 0) actionTimer -= dt;
	if (speechTimer > 0) speechTimer -= dt;

	// Needs decay
	const now = Date.now();
	if (now - lastNeedsTick > 1000) {
		lastNeedsTick = now;
		if (!isSleeping) { energy = Math.max(0, energy - 0.5); hunger = Math.max(0, hunger - 0.8); }
		else { energy = Math.min(100, energy + 5.0); hunger = Math.max(0, hunger - 0.2); }
	}

	weatherTimer -= dt;
	if (time < 60) {
		weatherState = "clear";
		if (weatherTimer <= 0) weatherTimer = 45 + Math.random() * 45;
	} else if (weatherTimer <= 0) {
		weatherTimer = 45 + Math.random() * 45;
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
		if (lastAnnouncedWeatherState === "cloudy") weatherAnnouncement = "Clouds rolling in...";
		else if (lastAnnouncedWeatherState === "rain") weatherAnnouncement = "It's starting to rain!";
		else if (lastAnnouncedWeatherState === "storm") weatherAnnouncement = "A storm is brewing...";
		else if (lastAnnouncedWeatherState === "snow") weatherAnnouncement = "Snowflakes!";
		else if (lastAnnouncedWeatherState === "clear") weatherAnnouncement = "The sky is clearing up";
		if (weatherAnnouncement) say(weatherAnnouncement, 3.0, "system", 2, true);

		// Ask for accessories if user hasn't given them yet
		const weather = weatherState;
		if (weather === "rain" && !accessories.umbrella && !accessoryAsked.umbrella) {
			accessoryAsked.umbrella = true;
			setTimeout(() => {
				if (weatherState === "rain" || weatherState === "storm") {
					say("I wish I had an umbrella... /pompom give umbrella", 5.0, "system", 2, true);
				}
			}, 3000);
		}
		if (weather === "snow" && !accessories.scarf && !accessoryAsked.scarf) {
			accessoryAsked.scarf = true;
			setTimeout(() => {
				if (weatherState === "snow") {
					say("Brrr! A scarf would be nice... /pompom give scarf", 5.0, "system", 2, true);
				}
			}, 3000);
		}
		if (weather === "storm" && !accessories.umbrella && !accessoryAsked.umbrella) {
			accessoryAsked.umbrella = true;
			setTimeout(() => {
				say("This storm is scary! /pompom give umbrella", 5.0, "system", 2, true);
			}, 2000);
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
	if (weather === "rain" && Math.random() < 0.4) {
		particles.push({ x: (Math.random() - 0.5) * W * wScale, y: -H * wScale, vx: 0.15, vy: 2.5 + Math.random(), char: "|", r: 150, g: 200, b: 255, life: 1.0, type: "rain" });
	}
	if (weather === "storm" && Math.random() < 0.6) {
		particles.push({ x: (Math.random() - 0.5) * W * wScale, y: -H * wScale, vx: 0.4 + Math.random() * 0.3, vy: 3.0 + Math.random() * 2, char: "/", r: 180, g: 200, b: 255, life: 0.8, type: "rain" });
		// Occasional lightning flash (brief bright particle)
		if (Math.random() < 0.005) {
			particles.push({ x: (Math.random() - 0.5) * W * wScale * 0.5, y: -H * wScale * 0.5, vx: 0, vy: 0, char: "#", r: 255, g: 255, b: 255, life: 0.1, type: "lightning" });
		}
	}
	if (weather === "snow" && Math.random() < 0.2) {
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
			say("Score: " + gameScore + "!", 3.0, "system", 2, true);
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
		if (ballY !== -10 && !hasBall) { currentState = "fetching"; say("Ball incoming!", 2.0, "reaction", 2, true); }
		else if (Math.random() < 0.005) {
			if (Math.random() < 0.15) targetX = (Math.random() > 0.5 ? 1 : -1) * (getScreenEdgeX() + 1.5); // occasional offscreen walk
			else targetX = (Math.random() - 0.5) * (getScreenEdgeX() * 0.6);
			currentState = "walk"; isWalking = true;
		}
		else if (Math.random() < 0.003) { currentState = "flip"; isFlipping = true; flipPhase = 0; say("Wheee!", 4.0, "reaction", 1, true); }
		else if (Math.random() < 0.002) { currentState = "chasing"; actionTimer = 3.0; }
		else if (Math.random() < 0.001 && speechTimer <= 0) {
			say(idleSpeech[Math.floor(Math.random() * idleSpeech.length)], 3.0, "commentary", 1, true);
		}
	}
	if (currentState === "walk") {
		const dir = Math.sign(targetX - posX);
		posX += dir * dt * 0.6;
		bounceY = -Math.abs(Math.sin(time * 10)) * 0.08;
		lookX = dir * 0.5;
		if (Math.abs(posX - targetX) < 0.05) {
			isWalking = false; posX = targetX; bounceY = 0; lookX = 0;
			if (Math.abs(posX) >= getScreenEdgeX() + 0.5) { currentState = "offscreen"; actionTimer = 2.0 + Math.random() * 3.0; }
			else currentState = "idle";
		}
	}
	if (currentState === "offscreen") {
		if (actionTimer <= 0) { currentState = "peek"; actionTimer = 4.0; targetX = Math.sign(posX) * (getScreenEdgeX() + 0.35); isWalking = true; }
	}
	if (currentState === "peek") {
		const dir = Math.sign(targetX - posX);
		if (Math.abs(posX - targetX) > 0.05) {
			posX += dir * dt * 0.4; bounceY = -Math.abs(Math.sin(time * 6)) * 0.05;
			lookX = -Math.sign(posX) * 0.8;
		} else {
			isWalking = false; posX = targetX; bounceY = 0;
			lookX = -Math.sign(posX) * 0.6 + Math.sin(time * 2) * 0.2;
			if (actionTimer < 3.0 && speechTimer <= 0 && Math.random() < 0.05) say("Peekaboo!", 2.0, "reaction", 1, true);
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
		if (actionTimer <= 0) { currentState = "idle"; isSleeping = false; say("What a nice nap!", 4.0, "reaction", 1, true); }
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
			if (Math.abs(posX - ballX) < 0.15 && Math.abs(posY + bounceY - ballY) < 0.3) { hasBall = true; say("Got it!", 4.0, "reaction", 2, true); }
		} else {
			const dir = Math.sign(0 - posX);
			posX += dir * dt * 0.8;
			bounceY = -Math.abs(Math.sin(time * 15)) * 0.1;
			lookX = dir * 0.5;
			if (Math.abs(posX) < 0.08) {
				hasBall = false; ballX = posX + 0.15; ballY = 0.5; ballVx = 0.8; ballVy = -1.5;
				currentState = "excited"; actionTimer = 2.0; say("Here you go!", 4.0, "reaction", 2, true);
			}
		}
	}

	// Food physics & eating
	for (let i = foods.length - 1; i >= 0; i--) {
		const f = foods[i];
		f.vy += dt * 2.0; f.y += f.vy * dt;
		if (f.y >= 0.5) { f.y = 0.5; f.vy = 0; }
		if (Math.sqrt((f.x - posX) ** 2 + (f.y - (posY + bounceY)) ** 2) < 0.25 && !isSleeping) {
			currentState = "excited"; actionTimer = 2.0;
			for (let k = 0; k < 5; k++) {
				particles.push({ x: f.x, y: f.y, vx: (Math.random() - 0.5) * 0.4, vy: -0.2 - Math.random() * 0.3, char: "*", r: 255, g: 255, b: 200, life: 1.0, type: "crumb" });
			}
			hunger = Math.min(100, hunger + 20);
			say("Yum!", 2.0, "user_action", 3, true);
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
		if (p.type === "lightning") { p.life -= dt * 8; }
		p.life -= dt * 0.8;
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
		const [scX, scY] = project2D(posX, posY + getEffectiveBounceY() - 0.6);
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
	if (width !== W && width > 10) {
		W = width;
		H = Math.max(10, Math.min(14, Math.floor(W * 0.18)));
		allocBuffers();
	}

	// Preserve backward compatibility for callers that still pass the
	// talk level through render, but do not overwrite live talking state.
	if (!isTalking) {
		talkAudioLevel = audioLevel;
	}

	// Sub-step physics for stability
	time += dt;
	let remaining = dt;
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

	// State message — descriptive so users know what's happening & what to do
	let stateMsg = "";
	if (hunger < 30) stateMsg = `Pompom is starving! Drop a treat with ${mod}f`;
	else if (energy < 20 && !isSleeping) stateMsg = `Pompom looks exhausted... put them to sleep with ${mod}s`;
	else if (currentState === "excited") stateMsg = "Pompom is bouncing with joy!";
	else if (isSleeping) stateMsg = "Shhh... Pompom is napping on a cozy pillow";
	else if (currentState === "walk") stateMsg = "Pompom is out for a little stroll";
	else if (currentState === "chasing") stateMsg = "Pompom spotted a firefly and is chasing it!";
	else if (currentState === "fetching") stateMsg = hasBall ? "Pompom grabbed the ball! Bringing it back" : "Pompom dashes after the ball!";
	else if (currentState === "singing") stateMsg = "Pompom is humming a little melody";
	else if (currentState === "dance") stateMsg = "Pompom is busting out some moves!";
	else if (currentState === "peek") stateMsg = "Pompom is peeking back in... hi!";
	else if (currentState === "offscreen") stateMsg = "Pompom wandered off... they'll be back";
	else if (isTalking) stateMsg = "Pompom is talking with you";
	else {
		const w = getWeather(), tod = getTimeOfDay();
		if (w === "storm") stateMsg = "Pompom hides from the thunder!";
		else if (w === "rain") stateMsg = "Pompom watches the rain fall";
		else if (w === "snow") stateMsg = "Pompom catches snowflakes!";
		else if (tod === "dawn") stateMsg = "Pompom watches the sunrise";
		else if (tod === "sunset") stateMsg = "Pompom enjoys the sunset";
		else if (tod === "night") stateMsg = "Pompom stargazes under the night sky";
		else stateMsg = "Pompom is vibing. Pet, feed, or play!";
	}

	// Build status: "─ ⌥ w·Wake p·Pet ... │ State ───" exactly W visible chars
	const shortcuts: [string, string][] = [
		["w","Wake"],["p","Pet"],["f","Feed"],["b","Ball"],
		["m","Music"],["c","Color"],["s","Sleep"],["d","Flip"],
	];

	// Build plain text to measure, styled text to render
	let plainHints = "";
	let styledHints = "";
	const stateW = getStringWidth(stateMsg);
	// Fixed parts: "─ " + mod + " " + hints + "│ " + state + " " + pad
	const fixedW = 2 + getStringWidth(mod) + 1 + 2 + stateW + 1; // "─ ⌥ " ... "│ state ─"
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

/** Handle a user keypress command */
export function pompomKeypress(key: string) {
	if (key === "p") { currentState = "excited"; actionTimer = 2.5; isSleeping = false; say("Purrrrr...", 4.0, "user_action", 3, true); }
	else if (key === "w") { currentState = "idle"; isSleeping = false; blinkFade = 0; say("I'm awake!", 4.0, "user_action", 3, true); }
	else if (key === "s") { currentState = "sleep"; isSleeping = true; actionTimer = 10; say("Time for a nap... zZz", 4.0, "user_action", 3, true); }
	else if (key === "f") {
		isSleeping = false; currentState = "idle";
		foods.push({ x: posX + (Math.random() - 0.5) * 0.4, y: -0.8, vy: 0 });
	}
	else if (key === "b") {
		isSleeping = false;
		if (ballY === 0.55 && !hasBall && Math.abs(posX - ballX) < 0.4) { ballVy = -1.8; ballVx = (Math.random() - 0.5) * 2.5; say("Boing!", 2.0, "user_action", 3, true); }
		else { ballX = posX + (Math.random() > 0.5 ? 0.8 : -0.8); ballY = -0.4; ballVx = (Math.random() - 0.5) * 1.5; ballVy = -1.2; hasBall = false; }
	}
	else if (key === "m") { isSleeping = false; currentState = "singing"; actionTimer = 5.0; say("La la la~", 4.0, "user_action", 3, true); }
	else if (key === "c") { activeTheme = (activeTheme + 1) % themes.length; }
	else if (key === "d") { currentState = "flip"; isFlipping = true; flipPhase = 0; isSleeping = false; }
	else if (key === "o") { isSleeping = false; currentState = "walk"; targetX = (Math.random() > 0.5 ? 1 : -1) * (getScreenEdgeX() + 1.5); isWalking = true; }
	else if (key === "x") { isSleeping = false; currentState = "dance"; actionTimer = 4.0; say("Let's dance!", 4.0, "user_action", 3, true); }
	else if (key === "t") {
		isSleeping = false; currentState = "excited"; actionTimer = 2.5;
		foods.push({ x: posX + (Math.random() - 0.5) * 0.3, y: -0.8, vy: 0 });
		hunger = Math.min(100, hunger + 30);
		say("A special treat!", 2.0, "user_action", 3, true);
	}
	else if (key === "h") { isSleeping = false; currentState = "excited"; actionTimer = 3.0; energy = Math.min(100, energy + 10); say("Aww, hugs!", 4.0, "user_action", 3, true); }
	else if (key === "g") { isSleeping = false; gameScore = 0; gameStars = []; gameActive = true; gameTimer = 20; currentState = "game"; say("Catch the stars!", 3.0, "user_action", 3, true); }

	// Accessory giving is handled separately via pompomGiveAccessory
}

/** Reset companion state */
export function resetPompom() {
	time = 0; currentState = "idle"; blinkFade = 0; actionTimer = 0;
	speechTimer = 0; speechText = "";
	posX = 0; posY = 0.15; posZ = 0; bounceY = 0; lookX = 0; lookY = 0;
	isWalking = false; isFlipping = false; isSleeping = false; isTalking = false;
	talkAudioLevel = 0; flipPhase = 0;
	gameScore = 0; gameTimer = 0; gameActive = false; gameStars = [];
	hunger = 100; energy = 100; lastNeedsTick = 0;
	activeTheme = 0;
	weatherOverride = null;
	lastAnnouncedWeatherState = weatherState;
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
/** @deprecated Use pompomHeight() — this constant is stale after resize. */
export const POMPOM_HEIGHT = H + 1;

export function pompomGiveAccessory(item: string): string {
	const key = item.toLowerCase().trim();
	if (key === "umbrella") { accessories.umbrella = true; say("Yay, an umbrella! Thank you!", 4.0, "user_action", 3, true); return "Gave Pompom an umbrella!"; }
	if (key === "scarf") { accessories.scarf = true; say("So warm and cozy! Thanks!", 4.0, "user_action", 3, true); return "Gave Pompom a scarf!"; }
	if (key === "sunglasses") { accessories.sunglasses = true; say("Looking cool! Thanks!", 4.0, "user_action", 3, true); return "Gave Pompom sunglasses!"; }
	if (key === "hat") { accessories.hat = true; say("I love hats! Thank you!", 4.0, "user_action", 3, true); return "Gave Pompom a hat!"; }
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
