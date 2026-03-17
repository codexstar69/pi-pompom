/**
 * pompom-ambient — Weather-reactive ambient soundscapes for Pompom.
 *
 * Priority order for audio sources:
 *   1. User-provided files in ~/.pi/pompom/ambient/custom/ (any format afplay supports)
 *   2. Generated via ElevenLabs Sound Effects API, cached in ~/.pi/pompom/ambient/
 *
 * Loops playback by respawning afplay on close.
 * Ducks volume automatically during TTS playback.
 */

import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Weather } from "./pompom";

// ─── Config ──────────────────────────────────────────────────────────────────

const AMBIENT_DIR = path.join(os.homedir(), ".pi", "pompom", "ambient");
const CUSTOM_DIR = path.join(AMBIENT_DIR, "custom");
const CONFIG_FILE = path.join(os.homedir(), ".pi", "pompom", "ambient-config.json");

export interface AmbientConfig {
	enabled: boolean;
	configured: boolean;
	volume: number; // 0-100
}

const DEFAULT_CONFIG: AmbientConfig = {
	enabled: true,
	configured: false,
	volume: 40,
};

// Sound-design-grade prompts — written like a foley artist's brief, not a chatbot prompt.
// Key principles: specify exact sounds, environment, what to EXCLUDE, and mood.
const WEATHER_PROMPTS: Record<Weather, string> = {
	clear:
		"Field recording of a quiet morning garden. Gentle birdsong from two or three " +
		"small birds at medium distance, soft rustling leaves in a light breeze, faint " +
		"insect hum. No music, no voices, no traffic. Warm, peaceful, continuous tone " +
		"suitable for seamless looping. Natural outdoor ambience.",

	cloudy:
		"Outdoor ambience on an overcast day. Steady gentle wind through grass and trees, " +
		"occasional soft gust, distant muffled atmosphere. No rain, no thunder, no birds. " +
		"Muted, calm, slightly hollow tone. Continuous background suitable for seamless " +
		"looping. Like standing in an open field under gray sky.",

	rain:
		"Steady gentle rain heard from inside a room with a window slightly open. Soft " +
		"raindrops on glass and leaves, light dripping from a gutter, very faint distant " +
		"traffic hum. No thunder, no heavy downpour, no music. Cozy, calming, ASMR-like. " +
		"Continuous steady rain suitable for seamless looping.",

	snow:
		"Quiet winter night outdoors. Muffled near-silence with very soft wind, occasional " +
		"faint creaking of cold branches, subtle crunchy snow texture in the air. No music, " +
		"no chimes, no voices. Extremely peaceful, hushed, almost meditative. Continuous " +
		"ambient tone suitable for seamless looping.",

	storm:
		"Thunderstorm heard from inside a cozy room. Steady heavy rain on windows, " +
		"occasional distant rolling thunder rumble every fifteen to twenty seconds, " +
		"soft wind gusts. No close lightning cracks, no scary elements, no music. " +
		"Immersive but comforting. Continuous storm suitable for seamless looping.",
};

const DUCK_VOLUME_RATIO = 0.2; // 20% of normal volume during TTS

// ─── State ───────────────────────────────────────────────────────────────────

let config: AmbientConfig = loadConfig();
let currentWeather: Weather | null = null;
let desiredWeather: Weather | null = null;
let currentProcess: childProcess.ChildProcess | null = null;
let isDucked = false;
let generating = false;
let interactive = false;

// ─── Config persistence ──────────────────────────────────────────────────────

function loadConfig(): AmbientConfig {
	try {
		if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
		const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as Partial<AmbientConfig>;
		return {
			enabled: parsed.enabled ?? DEFAULT_CONFIG.enabled,
			configured: parsed.configured ?? DEFAULT_CONFIG.configured,
			volume: typeof parsed.volume === "number"
				? Math.max(0, Math.min(100, parsed.volume))
				: DEFAULT_CONFIG.volume,
		};
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

function saveConfig(): void {
	try {
		fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
		fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, "\t"));
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[pompom-ambient] saveConfig failed: ${msg}`);
	}
}

// ─── Audio file management ───────────────────────────────────────────────────

const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".wav", ".aac", ".aiff", ".flac", ".ogg"];

/** Find user-provided custom audio file for a weather type (any supported format). */
function findCustomAudio(weather: Weather): string | null {
	try {
		if (!fs.existsSync(CUSTOM_DIR)) return null;
		for (const ext of AUDIO_EXTENSIONS) {
			const file = path.join(CUSTOM_DIR, `${weather}${ext}`);
			if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;
		}
	} catch { /* non-fatal */ }
	return null;
}

function generatedAudioPath(weather: Weather): string {
	return path.join(AMBIENT_DIR, `${weather}.mp3`);
}

/** Resolve the best audio file: custom > generated */
function resolveAudioPath(weather: Weather): string | null {
	const custom = findCustomAudio(weather);
	if (custom) return custom;
	const generated = generatedAudioPath(weather);
	if (fs.existsSync(generated) && fs.statSync(generated).size > 1000) return generated;
	return null;
}

function hasAudio(weather: Weather): boolean {
	return resolveAudioPath(weather) !== null;
}

function hasCustomAudio(weather: Weather): boolean {
	return findCustomAudio(weather) !== null;
}

async function generateAudio(weather: Weather): Promise<boolean> {
	const apiKey = process.env.ELEVENLABS_API_KEY;
	if (!apiKey) {
		console.error("[pompom-ambient] ELEVENLABS_API_KEY not set — cannot generate ambient audio");
		return false;
	}

	const prompt = WEATHER_PROMPTS[weather];
	try {
		const response = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
			method: "POST",
			headers: {
				"xi-api-key": apiKey,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				text: prompt,
				duration_seconds: 22,
				prompt_influence: 0.3,
			}),
			signal: AbortSignal.timeout(45000),
		});

		if (!response.ok) {
			const errText = await response.text().catch(() => "");
			console.error(`[pompom-ambient] ElevenLabs sound generation failed: HTTP ${response.status} ${errText.slice(0, 200)}`);
			return false;
		}

		const buffer = Buffer.from(await response.arrayBuffer());
		fs.mkdirSync(AMBIENT_DIR, { recursive: true });
		fs.writeFileSync(generatedAudioPath(weather), buffer);
		return true;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[pompom-ambient] generateAudio(${weather}) failed: ${msg}`);
		return false;
	}
}

// ─── Playback ────────────────────────────────────────────────────────────────

function effectiveVolume(): number {
	const base = config.volume / 100;
	return isDucked ? base * DUCK_VOLUME_RATIO : base;
}

function stopCurrent(): void {
	if (currentProcess) {
		try { currentProcess.kill("SIGTERM"); } catch { /* already dead */ }
		currentProcess = null;
	}
}

function startPlayback(weather: Weather): void {
	const resolved = resolveAudioPath(weather);
	if (!resolved) return;
	const file: string = resolved;

	stopCurrent();

	if (process.platform !== "darwin") {
		console.error("[pompom-ambient] Looping playback only supported on macOS (afplay)");
		return;
	}

	let spawnRetries = 0; // reset on each new startPlayback call

	// afplay doesn't support -l (loop) on modern macOS — loop manually by restarting on close
	function spawnPlayer(): childProcess.ChildProcess {
		const vol = effectiveVolume().toFixed(2);
		const child = childProcess.spawn("afplay", ["-v", vol, file], {
			stdio: "ignore",
			detached: false,
		});

		child.on("error", (err) => {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[pompom-ambient] playback error: ${msg}`);
			if (currentProcess === child) {
				currentProcess = null;
				spawnRetries++;
				if (spawnRetries <= 3 && currentWeather === weather && config.enabled) {
					const delay = 2000 * Math.pow(2, spawnRetries - 1); // 2s, 4s, 8s
					setTimeout(() => {
						if (currentWeather === weather && config.enabled && !currentProcess) {
							currentProcess = spawnPlayer();
						}
					}, delay);
				} else if (spawnRetries > 3) {
					console.error(`[pompom-ambient] giving up after ${spawnRetries} retries`);
				}
			}
		});

		child.on("close", () => {
			// If this child is still the active one, loop by spawning again
			if (currentProcess === child && currentWeather === weather && config.enabled) {
				currentProcess = spawnPlayer();
			} else if (currentProcess === child) {
				currentProcess = null;
			}
		});

		return child;
	}

	currentProcess = spawnPlayer();
}

function restartWithVolume(): void {
	if (!currentWeather) return;
	startPlayback(currentWeather);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function initAmbient(isInteractive: boolean): void {
	interactive = isInteractive;
	config = loadConfig();
	// Ensure custom directory exists so users know where to drop files
	try { fs.mkdirSync(CUSTOM_DIR, { recursive: true }); } catch { /* non-fatal */ }
}

export function getAmbientConfig(): AmbientConfig {
	return { ...config };
}

export function hasAmbientBeenConfigured(): boolean {
	return config.configured;
}

export function setAmbientEnabled(enabled: boolean): void {
	config.enabled = enabled;
	config.configured = true;
	saveConfig();
	if (!enabled) {
		stopCurrent();
		currentWeather = null;
	}
}

export function setAmbientVolume(vol: number): void {
	config.volume = Math.max(0, Math.min(100, vol));
	saveConfig();
	if (currentProcess) restartWithVolume();
}

export function getAmbientVolume(): number {
	return config.volume;
}

/** Called by the extension when weather changes. Transitions ambient audio. */
export async function setAmbientWeather(weather: Weather): Promise<void> {
	if (!config.enabled || !interactive) return;

	desiredWeather = weather;

	// If already playing the right weather, skip
	if (weather === currentWeather && currentProcess) return;

	// If generation in progress, just update desired — it'll be picked up after
	if (generating) return;

	// Process the latest desired weather (iterative, not recursive)
	while (desiredWeather) {
		const target: Weather = desiredWeather;

		if (!hasAudio(target)) {
			generating = true;
			try {
				const ok = await generateAudio(target);
				if (!ok || !config.enabled) break;
			} finally {
				generating = false;
			}
			// Check if desired changed during generation
			if (desiredWeather !== target) continue; // loop to process new desired
		}

		startPlayback(target);
		currentWeather = target;
		break;
	}
}

/** Duck ambient volume during TTS playback */
export function duckAmbient(): void {
	if (isDucked) return;
	isDucked = true;
	if (currentProcess) restartWithVolume();
}

/** Restore ambient volume after TTS ends */
export function unduckAmbient(): void {
	if (!isDucked) return;
	isDucked = false;
	if (currentProcess) restartWithVolume();
}

/** Pause ambient (for alt+v hide) — stops audio but remembers weather */
export function pauseAmbient(): void {
	stopCurrent();
}

/** Resume ambient (for alt+v show) — restarts if was playing */
export function resumeAmbient(): void {
	if (!config.enabled || !interactive || !currentWeather) return;
	if (hasAudio(currentWeather)) {
		startPlayback(currentWeather);
	}
}

/** Full stop — clears weather state too (for /pompom off) */
export function stopAmbient(): void {
	stopCurrent();
	currentWeather = null;
}

/** Pre-generate all weather audio files in the background (skips weathers with custom files) */
export async function pregenerateAll(): Promise<number> {
	const weathers: Weather[] = ["clear", "cloudy", "rain", "snow", "storm"];
	let generated = 0;
	for (const w of weathers) {
		if (hasCustomAudio(w)) continue; // Don't overwrite user files
		if (hasAudio(w)) continue;
		if (generating) {
			console.error(`[pompom-ambient] skipping ${w} — generation in progress`);
			continue;
		}
		generating = true;
		try {
			const ok = await generateAudio(w);
			if (ok) generated++;
		} finally {
			generating = false;
		}
	}
	return generated;
}

/** Delete all generated audio files so they regenerate fresh (preserves custom files) */
export function resetGeneratedAudio(): number {
	const weathers: Weather[] = ["clear", "cloudy", "rain", "snow", "storm"];
	let deleted = 0;
	for (const w of weathers) {
		const file = generatedAudioPath(w);
		try {
			if (fs.existsSync(file)) {
				fs.unlinkSync(file);
				deleted++;
			}
		} catch { /* non-fatal */ }
	}
	// Stop current playback if it was using a generated file
	if (currentWeather && !hasCustomAudio(currentWeather)) {
		stopCurrent();
	}
	return deleted;
}

/** Check which weather sounds are cached (generated or custom) */
export function getCachedWeathers(): Weather[] {
	const weathers: Weather[] = ["clear", "cloudy", "rain", "snow", "storm"];
	return weathers.filter(hasAudio);
}

/** Check which weather sounds have custom user files */
export function getCustomWeathers(): Weather[] {
	const weathers: Weather[] = ["clear", "cloudy", "rain", "snow", "storm"];
	return weathers.filter(hasCustomAudio);
}

export function isAmbientPlaying(): boolean {
	return currentProcess !== null;
}

/** Return the path where users should drop custom audio files */
export function getCustomAudioDir(): string {
	return CUSTOM_DIR;
}

/** Return the path where generated audio files are stored */
export function getAmbientDir(): string {
	return AMBIENT_DIR;
}

// ─── SFX Overlay System ──────────────────────────────────────────────────────
// Short one-shot sound effects layered on top of the ambient loop.
// Generated via ElevenLabs SFX API on first use, cached in ~/.pi/pompom/sfx/

const SFX_DIR = path.join(os.homedir(), ".pi", "pompom", "sfx");

export type SfxName =
	| "thunder" | "bird_chirp" | "bee_buzz"
	| "eat_crunch" | "ball_bounce" | "pet_purr"
	| "sleep_snore" | "star_chime" | "hug_squeeze"
	| "wake_yawn" | "dance_sparkle" | "wind_gust"
	| "flip_whoosh" | "rain_drip" | "footstep_soft"
	| "accessory_equip" | "game_start" | "game_end"
	| "hide_tiptoe" | "peek_surprise" | "firefly_twinkle"
	| "color_switch" | "weather_transition";

const SFX_PROMPTS: Record<SfxName, { prompt: string; duration: number }> = {
	pet_purr:      { prompt: "Soft warm purring with a gentle ascending hum at the end, like a tiny cat settling contentedly, short and sweet", duration: 2 },
	eat_crunch:    { prompt: "Satisfying crispy crunch followed by a tiny happy squeak, like biting into the perfect snack, brief and delightful", duration: 1 },
	ball_bounce:   { prompt: "Playful soft rubber bounce with a subtle rising boing at the end, cheerful and light", duration: 1 },
	hug_squeeze:   { prompt: "Warm soft fabric press with a tiny ascending sparkle, like squeezing a plush toy, cozy and brief", duration: 1 },
	sleep_snore:   { prompt: "One tiny adorable snore, soft nasal inhale followed by a gentle puff, barely audible", duration: 2 },
	wake_yawn:     { prompt: "Cute tiny yawn with an ascending stretch sound, refreshed and bright ending", duration: 1 },
	dance_sparkle: { prompt: "Quick ascending three-note chime like tiny bells going up a scale, magical and joyful", duration: 1 },
	flip_whoosh:   { prompt: "Quick soft swoosh with a satisfying ascending whistle, like a small acrobat spinning, brief", duration: 1 },
	star_chime:    { prompt: "Bright ascending two-note sparkle chime, like collecting a golden coin, satisfying ding", duration: 1 },
	game_start:    { prompt: "Three quick ascending bright notes going up a major scale, cheerful arcade start, cute not loud", duration: 1 },
	game_end:      { prompt: "Gentle descending three notes resolving to a warm major chord, satisfying completion, not sad", duration: 1 },
	thunder:       { prompt: "Single distant low rolling rumble, cozy and atmospheric, no sharp cracks, feels safe", duration: 1 },
	bird_chirp:    { prompt: "Two cheerful ascending chirps from a small garden bird, natural and pleasant", duration: 1 },
	bee_buzz:      { prompt: "Brief gentle buzzing that fades past like a friendly bee visiting, soft and warm", duration: 1 },
	wind_gust:     { prompt: "Soft brief whoosh of wind through leaves, atmospheric and calming", duration: 1 },
	rain_drip:     { prompt: "Single perfect raindrop landing on a leaf with a tiny satisfying plop", duration: 1 },
	footstep_soft: { prompt: "One barely audible tiny soft pad on grass, like a small plush creature stepping", duration: 1 },
	accessory_equip: { prompt: "Quick cheerful equip click with a tiny ascending sparkle, like putting on something cute", duration: 1 },
	hide_tiptoe:   { prompt: "Two very quiet playful tiptoe steps, sneaky and cute, cartoon-like", duration: 1 },
	peek_surprise: { prompt: "Quick gentle pop with a tiny ascending sparkle, like a friendly surprise", duration: 1 },
	firefly_twinkle: { prompt: "Soft magical ascending twinkle, like tiny bells following a light, brief and dreamy", duration: 1 },
	color_switch:  { prompt: "Quick satisfying click-pop followed by a brief ascending shimmer, clean and bright", duration: 1 },
	weather_transition: { prompt: "Soft atmospheric whoosh that resolves upward, gentle and calming transition", duration: 1 },
};

// Weather-contextual SFX that play periodically on top of the ambient loop
// Weather SFX intervals — intentionally rare for surprise/dopamine.
// Research: rewards at 10-20% of expected frequency create strongest prediction error.
const WEATHER_SFX: Record<Weather, { sfx: SfxName; minGapMs: number; maxGapMs: number }[]> = {
	clear: [
		{ sfx: "bird_chirp", minGapMs: 120000, maxGapMs: 300000 },  // 2-5 min
		{ sfx: "bee_buzz", minGapMs: 240000, maxGapMs: 480000 },    // 4-8 min
	],
	cloudy: [
		{ sfx: "wind_gust", minGapMs: 180000, maxGapMs: 360000 },   // 3-6 min
	],
	rain: [
		{ sfx: "rain_drip", minGapMs: 120000, maxGapMs: 300000 },   // 2-5 min
	],
	snow: [
		{ sfx: "wind_gust", minGapMs: 240000, maxGapMs: 480000 },   // 4-8 min
	],
	storm: [
		{ sfx: "thunder", minGapMs: 90000, maxGapMs: 240000 },      // 1.5-4 min
	],
};

let sfxProcess: childProcess.ChildProcess | null = null;
let weatherSfxTimer: ReturnType<typeof setTimeout> | null = null;
let sfxGenerating = false;

// Per-SFX cooldown map — prevents same sound repeating too fast (kills dopamine)
const sfxLastPlayedAt: Map<string, number> = new Map();
const SFX_COOLDOWN_MS = 8000;    // same SFX can't repeat within 8s
const SFX_GLOBAL_GAP_MS = 3000;  // ANY SFX needs 3s gap from last SFX
let lastAnySfxAt = 0;

function sfxPath(name: SfxName): string {
	return path.join(SFX_DIR, `${name}.mp3`);
}

function hasSfx(name: SfxName): boolean {
	try {
		return fs.existsSync(sfxPath(name)) && fs.statSync(sfxPath(name)).size > 500;
	} catch { return false; }
}

async function generateSfx(name: SfxName): Promise<boolean> {
	const apiKey = process.env.ELEVENLABS_API_KEY;
	if (!apiKey) return false;

	const spec = SFX_PROMPTS[name];
	try {
		const response = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
			method: "POST",
			headers: {
				"xi-api-key": apiKey,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				text: spec.prompt,
				duration_seconds: spec.duration,
				prompt_influence: 0.35,
			}),
			signal: AbortSignal.timeout(20000),
		});
		if (!response.ok) {
			const errText = await response.text().catch(() => "");
			console.error(`[pompom-ambient] SFX generation failed for ${name}: HTTP ${response.status} ${errText.slice(0, 200)}`);
			return false;
		}
		const buffer = Buffer.from(await response.arrayBuffer());
		fs.mkdirSync(SFX_DIR, { recursive: true });
		fs.writeFileSync(sfxPath(name), buffer);
		return true;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[pompom-ambient] generateSfx(${name}) failed: ${msg}`);
		return false;
	}
}

async function ensureSfx(name: SfxName): Promise<string | null> {
	if (hasSfx(name)) return sfxPath(name);
	if (sfxGenerating) return null;
	sfxGenerating = true;
	try {
		const ok = await generateSfx(name);
		return ok ? sfxPath(name) : null;
	} finally {
		sfxGenerating = false;
	}
}

function playSfxFile(filePath: string): boolean {
	if (process.platform !== "darwin") return false;
	// Don't interrupt another SFX that's playing
	if (sfxProcess) return false;

	const vol = Math.max(0.05, config.volume / 100 * 0.15).toFixed(2); // SFX at ~15% of ambient volume — barely-there accents, never distracting
	const child = childProcess.spawn("afplay", ["-v", vol, filePath], {
		stdio: "ignore",
		detached: false,
	});
	sfxProcess = child;
	child.on("close", () => { if (sfxProcess === child) sfxProcess = null; });
	child.on("error", (err) => {
		console.error(`[pompom-ambient] SFX playback error: ${err instanceof Error ? err.message : String(err)}`);
		if (sfxProcess === child) sfxProcess = null;
	});
	return true;
}

/** Play a one-shot sound effect by name. Generates on first use.
 *  Respects per-SFX cooldown (8s) and global gap (3s) to prevent fatigue. */
export async function playSfx(name: SfxName): Promise<void> {
	if (!config.enabled || !interactive) return;
	const now = Date.now();

	// Global gap — no SFX back-to-back
	if (now - lastAnySfxAt < SFX_GLOBAL_GAP_MS) return;

	// Per-SFX cooldown — same sound can't repeat within 8s
	const lastPlayed = sfxLastPlayedAt.get(name) || 0;
	if (now - lastPlayed < SFX_COOLDOWN_MS) return;

	const file = await ensureSfx(name);
	if (file) {
		if (playSfxFile(file)) {
			sfxLastPlayedAt.set(name, now);
			lastAnySfxAt = now;
		}
	}
}

function scheduleNextWeatherSfx(): void {
	clearWeatherSfxTimer();
	if (!config.enabled || !interactive || !currentWeather) return;

	const sfxList = WEATHER_SFX[currentWeather];
	if (sfxList.length === 0) return;

	// Pick a random SFX from the list for this weather
	const entry = sfxList[Math.floor(Math.random() * sfxList.length)];
	const delay = entry.minGapMs + Math.random() * (entry.maxGapMs - entry.minGapMs);

	weatherSfxTimer = setTimeout(async () => {
		if (!config.enabled || !interactive) return;
		await playSfx(entry.sfx);
		// Schedule next one
		scheduleNextWeatherSfx();
	}, delay);
}

function clearWeatherSfxTimer(): void {
	if (weatherSfxTimer) { clearTimeout(weatherSfxTimer); weatherSfxTimer = null; }
}

/** Start periodic weather SFX for the current weather. Called when weather changes. */
export function startWeatherSfx(): void {
	scheduleNextWeatherSfx();
}

/** Stop periodic weather SFX. */
export function stopWeatherSfx(): void {
	clearWeatherSfxTimer();
	if (sfxProcess) {
		try { sfxProcess.kill("SIGTERM"); } catch { /* dead */ }
		sfxProcess = null;
	}
}

/** Pre-generate all SFX files */
export async function pregenerateSfx(): Promise<number> {
	const names = Object.keys(SFX_PROMPTS) as SfxName[];
	let count = 0;
	for (const name of names) {
		if (hasSfx(name)) continue;
		if (sfxGenerating) continue;
		sfxGenerating = true;
		try {
			const ok = await generateSfx(name);
			if (ok) count++;
		} finally {
			sfxGenerating = false;
		}
	}
	return count;
}
