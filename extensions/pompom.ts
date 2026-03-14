/**
 * Pompom Companion — 3D raymarched virtual pet for Pi CLI.
 *
 * A full 3D raymarched creature with physics, particles, speech bubbles,
 * moods, and interactive commands. Driven by audio level for mouth animation.
 */

// ─── Rendering Config ────────────────────────────────────────────────────────
// Widget dimensions — set once, used by renderPompom
let W = 50;
let H = 14; // character rows (each = 2 logical pixels via half-block)
const VIEW_OFFSET_Y = 0.2; // shift camera down so ground is visible in compact mode

const PHYSICS_DT = 0.016; // 60fps physics sub-stepping

// ─── Pet State ───────────────────────────────────────────────────────────────
type State = "idle" | "walk" | "flip" | "sleep" | "excited" | "chasing" | "fetching" | "singing" | "offscreen" | "peek" | "dance";

const idleSpeech = [
	"What are we building? 🤔", "This is fun! ✨", "Boop! 🐾",
	"I love it here! 💕", "Need a break? ☕", "Pom pom pom! 🎈",
	"You're doing great! 🌈", "*wiggles ears*", "Hmm... 🌟",
	"Hey! Look at me! 👋", "Tra la la~ 🎵", "*happy bounce*",
];
let currentState: State = "idle";

let time = 0;
let blinkFade = 0;
let actionTimer = 0;
let speechTimer = 0;
let speechText = "";

// Needs
let hunger = 100;
let energy = 100;
let lastNeedsTick = 0;

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

function say(text: string, duration = 4.0) {
	speechText = text;
	speechTimer = duration;
}

function project2D(x: number, y: number): [number, number] {
	const effectDim = Math.max(40, Math.min(W, H * 4));
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
	if (h >= 7 && h < 10) return "morning";
	if (h >= 10 && h < 16) return "day";
	if (h >= 16 && h < 18) return "sunset";
	if (h >= 18 && h < 20) return "dusk";
	return "night";
}

function getWeather(): Weather {
	// Cycle weather based on minute within each hour for variety
	const m = new Date().getMinutes();
	if (m < 15) return "clear";
	if (m < 25) return "cloudy";
	if (m < 35) return "rain";
	if (m < 40) return "storm";
	if (m < 45) return "snow";
	if (m < 55) return "cloudy";
	return "clear";
}

function getWeatherAndTime() {
	const tod = getTimeOfDay();
	const weather = getWeather();
	let rTop = 0, gTop = 0, bTop = 0, rBot = 0, gBot = 0, bBot = 0;

	// Sky gradients per time of day
	if (tod === "dawn") {
		rTop = 40; gTop = 30; bTop = 80; rBot = 255; gBot = 140; bBot = 80;
	} else if (tod === "morning") {
		rTop = 60; gTop = 140; bTop = 255; rBot = 200; gBot = 220; bBot = 255;
	} else if (tod === "day") {
		rTop = 40; gTop = 120; bTop = 255; rBot = 180; gBot = 220; bBot = 255;
	} else if (tod === "sunset") {
		rTop = 140; gTop = 50; bTop = 120; rBot = 255; gBot = 120; bBot = 60;
	} else if (tod === "dusk") {
		rTop = 50; gTop = 20; bTop = 80; rBot = 120; gBot = 60; bBot = 80;
	} else { // night
		rTop = 5; gTop = 5; bTop = 15; rBot = 15; gBot = 10; bBot = 30;
	}

	// Weather tinting — overcast dims the sky, storm darkens further
	if (weather === "cloudy") {
		rTop = Math.floor(rTop * 0.7 + 40); gTop = Math.floor(gTop * 0.7 + 40); bTop = Math.floor(bTop * 0.7 + 40);
		rBot = Math.floor(rBot * 0.7 + 40); gBot = Math.floor(gBot * 0.7 + 40); bBot = Math.floor(bBot * 0.7 + 40);
	} else if (weather === "rain") {
		rTop = Math.floor(rTop * 0.5 + 30); gTop = Math.floor(gTop * 0.5 + 30); bTop = Math.floor(bTop * 0.5 + 40);
		rBot = Math.floor(rBot * 0.5 + 30); gBot = Math.floor(gBot * 0.5 + 30); bBot = Math.floor(bBot * 0.5 + 40);
	} else if (weather === "storm") {
		rTop = Math.floor(rTop * 0.3 + 15); gTop = Math.floor(gTop * 0.3 + 15); bTop = Math.floor(bTop * 0.3 + 20);
		rBot = Math.floor(rBot * 0.3 + 20); gBot = Math.floor(gBot * 0.3 + 20); bBot = Math.floor(bBot * 0.3 + 25);
	} else if (weather === "snow") {
		rTop = Math.floor(rTop * 0.6 + 60); gTop = Math.floor(gTop * 0.6 + 60); bTop = Math.floor(bTop * 0.6 + 70);
		rBot = Math.floor(rBot * 0.6 + 60); gBot = Math.floor(gBot * 0.6 + 60); bBot = Math.floor(bBot * 0.6 + 70);
	}

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
			r = Math.floor(r * (1 - faceMix * 0.6) + 255 * faceMix * 0.6);
			g = Math.floor(g * (1 - faceMix * 0.6) + 252 * faceMix * 0.6);
			b = Math.floor(b * (1 - faceMix * 0.6) + 248 * faceMix * 0.6);
		}

		// ── Blush: big rosy cheeks ──
		const blx1 = bdx + 0.15, bly1 = bdy - 0.05;
		const blx2 = bdx - 0.15, bly2 = bdy - 0.05;
		const blush = Math.exp(-(blx1 * blx1 + bly1 * bly1) * 40) + Math.exp(-(blx2 * blx2 + bly2 * bly2) * 40);
		if (!isSleeping) {
			r = Math.floor(r * (1 - blush) + 255 * blush);
			g = Math.floor(g * (1 - blush) + 70 * blush);
			b = Math.floor(b * (1 - blush) + 90 * blush);
		}

		// ── Eyes: kawaii style — white sclera → colored iris → dark pupil → highlight ──
		const isTired = (energy < 20 || hunger < 30) && !isSleeping;
		const eyeOpen = isSleeping ? 0.05 : (isTired ? 0.4 : 1.0) - blinkFade;
		const ex1 = bdx - lookX * 0.08 + 0.11, ey1 = bdy - lookY * 0.05 + 0.02;
		const ex2 = bdx - lookX * 0.08 - 0.11, ey2 = bdy - lookY * 0.05 + 0.02;

		if (isSleeping || currentState === "singing") {
			// Closed eyes — horizontal lines
			if (isSleeping) {
				if ((Math.abs(ey1) < 0.012 && Math.abs(ex1) < 0.06) || (Math.abs(ey2) < 0.012 && Math.abs(ex2) < 0.06)) { r = 40; g = 30; b = 50; }
			} else {
				// Happy squint arcs
				if ((Math.abs(ey1 + ex1 * ex1 * 12) < 0.018 && Math.abs(ex1) < 0.07 && ey1 > -ex1 * ex1 * 12) ||
					(Math.abs(ey2 + ex2 * ex2 * 12) < 0.018 && Math.abs(ex2) < 0.07 && ey2 > -ex2 * ex2 * 12)) { r = 40; g = 30; b = 50; }
			}
		} else {
			const eDist1 = ex1 * ex1 + (ey1 * ey1) / (eyeOpen * eyeOpen + 0.001);
			const eDist2 = ex2 * ex2 + (ey2 * ey2) / (eyeOpen * eyeOpen + 0.001);

			// Layer 1: White sclera (outermost)
			if (eDist1 < 0.009 || eDist2 < 0.009) {
				r = 250; g = 250; b = 255;

				// Layer 2: Colored iris
				if (eDist1 < 0.005 || eDist2 < 0.005) {
					r = 50; g = 35; b = 25; // dark brown iris
					// Lower iris lighter
					if (ey1 > 0.01 || ey2 > 0.01) { r = 70; g = 50; b = 35; } // warm brown

					// Layer 3: Dark pupil
					if (eDist1 < 0.002 || eDist2 < 0.002) {
						r = 10; g = 10; b = 15;
					}
				}

				// Big highlight (upper-left) — spans ~2 chars
				if ((ex1 + 0.02) ** 2 + (ey1 + 0.02) ** 2 < 0.0015 || (ex2 + 0.02) ** 2 + (ey2 + 0.02) ** 2 < 0.0015) {
					if (!isTired) { r = 255; g = 255; b = 255; }
				}
				// Small secondary highlight (lower-right)
				if ((ex1 - 0.02) ** 2 + (ey1 - 0.02) ** 2 < 0.0006 || (ex2 - 0.02) ** 2 + (ey2 - 0.02) ** 2 < 0.0006) {
					if (!isTired) { r = 255; g = 250; b = 240; } // warm white
				}
			}
		}

		// ── Nose: small dark oval ──
		const nnx = bdx - lookX * 0.06, nny = bdy - lookY * 0.05 - 0.03;
		if (nnx * nnx * 1.2 + nny * nny < 0.001 && !isSleeping) { r = 40; g = 30; b = 40; }

		// ── Mouth: clear smile arc ──
		if (!isSleeping && !hasBall) {
			const mx = bdx - lookX * 0.06, my = bdy - lookY * 0.05 - 0.07;
			// Smile curves
			if ((Math.abs(my - (mx - 0.03) ** 2 * 15 + 0.012) < 0.013 && mx > 0 && mx < 0.06) ||
				(Math.abs(my - (mx + 0.03) ** 2 * 15 + 0.012) < 0.013 && mx < 0 && mx > -0.06)) {
				r = 50; g = 30; b = 40;
			}
			// Open mouth when excited/talking
			if (currentState === "excited" || currentState === "singing" || currentState === "dance" || speechTimer > 0 || isTalking) {
				const mouthOpen = (speechTimer > 0 || currentState === "singing" || isTalking)
					? (isTalking ? talkAudioLevel * 0.04 + 0.008 : Math.abs(Math.sin(time * 12)) * 0.03)
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
		r = Math.floor(r * 0.6); g = Math.floor(g * 0.6); b = Math.floor(b * 0.6);
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
		const pulse = Math.sin(time * 6) * 0.5 + 0.5;
		return [255, Math.floor(100 + pulse * 150), Math.floor(150 + pulse * 105)];
	} else if (hitObj.mat === 9) {
		r = 255; g = 60; b = 80;
		const curve = Math.abs(hitNx * 0.7 - hitNy * 0.7);
		if (curve > 0.4 && curve < 0.55) { r = 255; g = 200; b = 200; }
		gloss = 128;
	} else if (hitObj.mat === 10) {
		r = 230; g = 210; b = 220;
		const check = Math.sin(hitU * 20) * Math.sin(hitV * 20);
		if (check > 0) { r = 200; g = 180; b = 200; }
	}

	// Lighting
	let lx = 0.6, ly = -0.7, lz = 0.8;
	const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
	lx /= ll; ly /= ll; lz /= ll;

	const diff = Math.max(0, hitNx * lx + hitNy * ly + hitNz * lz);
	const wrap = Math.max(0, hitNx * lx + hitNy * ly + hitNz * lz + 0.5) / 1.5;
	const amb = 0.45;

	let ao = 1.0;
	if (hitObj.id === "earL" || hitObj.id === "earR") ao = 0.8;
	if (hitObj.id === "pawL" || hitObj.id === "pawR") ao = 0.7;
	if (hitObj.id === "body" && hitNy > 0.5) ao = 0.6;
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

	let lightR = (diff * 0.5 + wrap * 0.3 + amb) * ao + fdiff * fatten * 2.0;
	let lightG = (diff * 0.5 + wrap * 0.3 + amb) * ao + fdiff * fatten * 3.0;
	let lightB = (diff * 0.5 + wrap * 0.3 + amb) * ao + fdiff * fatten * 2.5;

	// Antenna glow
	if (hitObj.id === "body") {
		const antObj = objects.find(o => o.id === "antenna_bulb");
		if (antObj) {
			const antDx = px - antObj.x, antDy = py - antObj.y;
			const antDist = Math.sqrt(antDx * antDx + antDy * antDy);
			const antAtten = 1.0 / (1.0 + antDist * antDist * 40.0);
			lightR += antAtten * 1.5; lightG += antAtten * 0.5; lightB += antAtten * 0.8;
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
		// Floor reflection
		const refPy = 1.2 - py;
		const refHit = getObjHit(px, refPy, objects);
		if (refHit.hitObj) {
			const refC = shadeObject(refHit, px, refPy, objects);
			fr = Math.floor(fr * 0.7 + refC[0] * 0.3);
			fg = Math.floor(fg * 0.7 + refC[1] * 0.3);
			fb = Math.floor(fb * 0.7 + refC[2] * 0.3);
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

	// STARS & MOON (dimmer stars)
	if (skyColors.isNight) {
		const moonDist = Math.sqrt((px - 0.4) ** 2 + (py + 0.4) ** 2);
		if (moonDist < 0.15) {
			const moonGlow = 1.0 - (moonDist / 0.15);
			bgR = Math.min(255, bgR + moonGlow * 60);
			bgG = Math.min(255, bgG + moonGlow * 60);
			bgB = Math.min(255, bgB + moonGlow * 80);
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

	// SUNSET/DAWN: subtle warm glow
	if (tod === "sunset" || tod === "dawn") {
		const sunDist = Math.sqrt((px + 0.3) ** 2 + (py - 0.2) ** 2);
		const halo = Math.max(0, 1.0 - sunDist * 2.0);
		if (halo > 0) {
			const hIntensity = Math.pow(halo, 2) * 0.5; // more subtle
			bgR = Math.min(255, bgR + hIntensity * 120);
			bgG = Math.min(255, bgG + hIntensity * (tod === "sunset" ? 70 : 90));
			bgB = Math.min(255, bgB + hIntensity * 40);
		}
	}

	// CLOUDS: SUBTLE only. Small, soft wisps. Only upper 30% of sky. Opacity max 0.15. Light gray-white.
	if ((w === "cloudy" || w === "rain" || w === "storm" || w === "snow") && py < -0.4) {
		const drift = time * 0.05; // drift slowly
		const n1 = Math.sin((px + drift) * 4) * Math.cos(py * 6) * 0.5 + 0.5;
		const n2 = Math.sin((px - drift * 0.5) * 8 + py * 10) * 0.5 + 0.5;
		const noise = n1 * 0.6 + n2 * 0.4;
		
		if (noise > 0.6) {
			const blend = Math.min(0.15, (noise - 0.6) * 0.5); // Max opacity 0.15
			
			const cr = w === "storm" ? 100 : 240;
			const cg = w === "storm" ? 105 : 245;
			const cb = w === "storm" ? 115 : 255;

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
	if (isWalking) earWave += Math.sin(time * 10) * 0.1;
	const pawSwing = (isWalking || currentState === "chasing" || currentState === "fetching" || currentState === "peek") ? Math.sin(time * 12) * 0.08 : 0;
	const antRot = Math.sin(time * 2.5) * 0.15 + (isWalking || currentState === "fetching" ? Math.sin(time * 12) * 0.3 : 0);

	const objects: RenderObj[] = [];
	if (isSleeping) objects.push({ id: "pillow", mat: 10, x: 0, y: 0.65, rx: 0.6, ry: 0.15, z: posZ - 0.1 });

	objects.push(
		{ id: "antenna_stalk", mat: 7, x: posX + Math.sin(antRot) * 0.08, y: posY + bounceY + breathe - 0.35, rx: 0.012, ry: 0.08, rot: antRot, z: 0.05 },
		{ id: "antenna_bulb", mat: 8, x: posX + Math.sin(antRot) * 0.16, y: posY + bounceY + breathe - 0.42, r: 0.035, z: 0.08 },
		{ id: "body", mat: 1, x: posX, y: posY + bounceY + breathe, r: 0.32, z: 0 },
		{ id: "earL", mat: 1, x: posX - 0.28, y: posY + bounceY + breathe - 0.05, rx: 0.08, ry: 0.22, rot: 0.5 + earWave, z: 0.1 },
		{ id: "earR", mat: 1, x: posX + 0.28, y: posY + bounceY + breathe - 0.05, rx: 0.08, ry: 0.22, rot: -0.5 - earWave, z: 0.1 },
		{ id: "pawL", mat: 2, x: posX - 0.14, y: posY + bounceY + breathe + 0.22, r: 0.05, z: 0.2 + pawSwing },
		{ id: "pawR", mat: 2, x: posX + 0.14, y: posY + bounceY + breathe + 0.22, r: 0.05, z: 0.2 - pawSwing },
		{ id: "tail", mat: 3, x: posX + Math.cos(time * 2) * 0.35, y: posY + bounceY + breathe - 0.05, r: 0.06, z: Math.sin(time * 2) * 0.4 },
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
		if (hasBall) objects.push({ id: "ball", mat: 9, x: posX + lookX * 0.05, y: posY + bounceY + 0.05, r: 0.035, z: posZ + 0.15 });
		else objects.push({ id: "ball", mat: 9, x: ballX, y: ballY, r: 0.035, z: 0.15 });
	}

	for (const f of foods) objects.push({ id: "food", mat: 6, x: f.x, y: f.y, r: 0.03, z: 0.1 });

	objects.sort((a, b) => a.z - b.z);
	for (const obj of objects) {
		if (obj.rot !== undefined) { obj.s = Math.sin(obj.rot); obj.c = Math.cos(obj.rot); }
	}
	return objects;
}

function getScreenEdgeX(): number {
	const effectDim = Math.max(40, Math.min(W, H * 4));
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

	// Firefly
	ffX = posX + Math.sin(time * 1.2) * 0.7;
	ffY = Math.sin(time * 2.0) * 0.3 + 0.1;
	ffZ = posZ + Math.sin(time * 0.9) * 0.4;

	// Weather particles
	const weather = getWeather();
	const effectDim = Math.max(40, Math.min(W, H * 4));
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
	if (currentState === "idle") {
		if (Math.random() < 0.01) blinkFade = 1.0;
		else blinkFade = Math.max(0, blinkFade - dt * 6.0);
		bounceY += (0 - bounceY) * dt * 5.0;
		lookX += (0 - lookX) * dt * 3.0;
		if (ballY !== -10 && !hasBall) { currentState = "fetching"; say("Ball!! 🎾", 2.0); }
		else if (Math.random() < 0.005) {
			if (Math.random() < 0.15) targetX = (Math.random() > 0.5 ? 1 : -1) * (getScreenEdgeX() + 1.5); // occasional offscreen walk
			else targetX = (Math.random() - 0.5) * (getScreenEdgeX() * 0.6);
			currentState = "walk"; isWalking = true;
		}
		else if (Math.random() < 0.003) { currentState = "flip"; isFlipping = true; flipPhase = 0; say("Wheee! 💫"); }
		else if (Math.random() < 0.002) { currentState = "chasing"; actionTimer = 3.0; }
		else if (Math.random() < 0.001 && speechTimer <= 0) {
			say(idleSpeech[Math.floor(Math.random() * idleSpeech.length)], 3.0);
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
			if (actionTimer < 3.0 && speechTimer <= 0 && Math.random() < 0.05) say("Peekaboo! 👀", 2.0);
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
		if (actionTimer <= 0) { currentState = "idle"; isSleeping = false; say("What a nice nap! ✨"); }
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
			if (Math.abs(posX - ballX) < 0.15 && Math.abs(posY + bounceY - ballY) < 0.3) { hasBall = true; say("Got it! 🎾"); }
		} else {
			const dir = Math.sign(0 - posX);
			posX += dir * dt * 0.8;
			bounceY = -Math.abs(Math.sin(time * 15)) * 0.1;
			lookX = dir * 0.5;
			if (Math.abs(posX) < 0.08) {
				hasBall = false; ballX = posX + 0.15; ballY = 0.5; ballVx = 0.8; ballVy = -1.5;
				currentState = "excited"; actionTimer = 2.0; say("Here you go! ✨");
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
			say("Yum! 🍪", 2.0);
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
	const effectDim = Math.max(40, Math.min(W, H * 4));
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
		const [scX, scY] = project2D(posX, posY + bounceY - 0.6);
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
	// Adapt dimensions — balanced: compact but sharp
	if (width !== W && width > 10) {
		W = width;
		H = Math.max(14, Math.min(18, Math.floor(W * 0.24)));
		allocBuffers();
	}

	// Update talking state from audio
	talkAudioLevel = audioLevel;

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
	else if (isTalking) stateMsg = "Pompom is listening to you speak";
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
	if (active && currentState !== "excited" && currentState !== "singing") {
		speechTimer = 0; // Clear auto-speech when user is talking
	}
}

/** Handle a user keypress command */
export function pompomKeypress(key: string) {
	if (key === "p") { currentState = "excited"; actionTimer = 2.5; isSleeping = false; say("Purrrrr... ♥"); }
	else if (key === "w") { currentState = "idle"; isSleeping = false; blinkFade = 0; say("I'm awake! 👀"); }
	else if (key === "s") { currentState = "sleep"; isSleeping = true; actionTimer = 10; say("Time for a nap... zZz"); }
	else if (key === "f") {
		isSleeping = false; currentState = "idle";
		foods.push({ x: posX + (Math.random() - 0.5) * 0.4, y: -0.8, vy: 0 });
	}
	else if (key === "b") {
		isSleeping = false;
		if (ballY === 0.55 && !hasBall && Math.abs(posX - ballX) < 0.4) { ballVy = -1.8; ballVx = (Math.random() - 0.5) * 2.5; say("Boing! 🎾", 2.0); }
		else { ballX = posX + (Math.random() > 0.5 ? 0.8 : -0.8); ballY = -0.4; ballVx = (Math.random() - 0.5) * 1.5; ballVy = -1.2; hasBall = false; }
	}
	else if (key === "m") { isSleeping = false; currentState = "singing"; actionTimer = 5.0; say("La la la~ 🎵"); }
	else if (key === "c") { activeTheme = (activeTheme + 1) % themes.length; }
	else if (key === "d") { currentState = "flip"; isFlipping = true; flipPhase = 0; isSleeping = false; }
	else if (key === "o") { isSleeping = false; currentState = "walk"; targetX = (Math.random() > 0.5 ? 1 : -1) * (getScreenEdgeX() + 1.5); isWalking = true; }
	else if (key === "x") { isSleeping = false; currentState = "dance"; actionTimer = 4.0; say("Let's dance! 💃"); }
	else if (key === "t") {
		isSleeping = false; currentState = "excited"; actionTimer = 2.5;
		foods.push({ x: posX + (Math.random() - 0.5) * 0.3, y: -0.8, vy: 0 });
		hunger = Math.min(100, hunger + 30);
		say("A special treat! 🍰", 2.0);
	}
	else if (key === "h") { isSleeping = false; currentState = "excited"; actionTimer = 3.0; energy = Math.min(100, energy + 10); say("Aww, hugs! 💕"); }
}

/** Reset companion state */
export function resetPompom() {
	time = 0; currentState = "idle"; blinkFade = 0; actionTimer = 0;
	speechTimer = 0; speechText = "";
	posX = 0; posY = 0.15; posZ = 0; bounceY = 0; lookX = 0; lookY = 0;
	isWalking = false; isFlipping = false; isSleeping = false; isTalking = false;
	talkAudioLevel = 0; flipPhase = 0;
	hunger = 100; energy = 100; lastNeedsTick = 0;
	activeTheme = 0;
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
