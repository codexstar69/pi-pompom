/**
 * pompom-ambient — Weather-reactive ambient soundscapes for Pompom.
 *
 * Generates ambient audio via ElevenLabs Sound Effects API on first use,
 * caches to ~/.pi/pompom/ambient/, and loops with afplay.
 * Ducks volume automatically during TTS playback.
 */

import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Weather } from "./pompom";

// ─── Config ──────────────────────────────────────────────────────────────────

const AMBIENT_DIR = path.join(os.homedir(), ".pi", "pompom", "ambient");
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

const WEATHER_PROMPTS: Record<Weather, string> = {
	clear: "Gentle outdoor ambience with soft birdsong, light breeze through leaves, peaceful nature sounds, perfect for focus and concentration",
	cloudy: "Soft atmospheric wind, gentle distant breeze, muted outdoor ambience, calm overcast day, subtle and soothing",
	rain: "Gentle rain falling on a window, soft raindrops, cozy indoor rain ambience, calming and steady, lo-fi rain",
	snow: "Quiet winter ambience, soft muffled wind, gentle snowfall atmosphere, peaceful and serene, distant soft chimes",
	storm: "Steady rain with distant rolling thunder, atmospheric storm ambience, not too intense, cozy and immersive",
};

const DUCK_VOLUME_RATIO = 0.2; // 20% of normal volume during TTS

// ─── State ───────────────────────────────────────────────────────────────────

let config: AmbientConfig = loadConfig();
let currentWeather: Weather | null = null;
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

function audioPath(weather: Weather): string {
	return path.join(AMBIENT_DIR, `${weather}.mp3`);
}

function hasAudio(weather: Weather): boolean {
	try {
		return fs.existsSync(audioPath(weather)) && fs.statSync(audioPath(weather)).size > 1000;
	} catch {
		return false;
	}
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
				duration_seconds: 30,
				prompt_influence: 0.4,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			const errText = await response.text().catch(() => "");
			console.error(`[pompom-ambient] ElevenLabs sound generation failed: HTTP ${response.status} ${errText.slice(0, 200)}`);
			return false;
		}

		const buffer = Buffer.from(await response.arrayBuffer());
		fs.mkdirSync(AMBIENT_DIR, { recursive: true });
		fs.writeFileSync(audioPath(weather), buffer);
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
	const file = audioPath(weather);
	if (!fs.existsSync(file)) return;

	stopCurrent();

	if (process.platform !== "darwin") {
		// afplay looping is macOS-only; other platforms would need a different approach
		console.error("[pompom-ambient] Looping playback only supported on macOS (afplay)");
		return;
	}

	const vol = effectiveVolume().toFixed(2);
	const child = childProcess.spawn("afplay", ["-v", vol, "-l", "0", file], {
		stdio: "ignore",
		detached: false,
	});

	child.on("error", (err) => {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[pompom-ambient] playback error: ${msg}`);
		currentProcess = null;
	});

	child.on("close", () => {
		if (currentProcess === child) currentProcess = null;
	});

	currentProcess = child;
}

function restartWithVolume(): void {
	if (!currentWeather || !currentProcess) return;
	// afplay doesn't support runtime volume changes — restart with new volume
	startPlayback(currentWeather);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function initAmbient(isInteractive: boolean): void {
	interactive = isInteractive;
	config = loadConfig();
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
	if (weather === currentWeather) return;

	currentWeather = weather;

	// If audio file doesn't exist yet, generate it (non-blocking for other weather)
	if (!hasAudio(weather)) {
		if (generating) return; // Don't stack generation requests
		generating = true;
		try {
			const ok = await generateAudio(weather);
			if (!ok) { generating = false; return; }
		} finally {
			generating = false;
		}
		// Weather may have changed during generation
		if (currentWeather !== weather) return;
	}

	startPlayback(weather);
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

/** Pre-generate all weather audio files in the background */
export async function pregenerateAll(): Promise<number> {
	const weathers: Weather[] = ["clear", "cloudy", "rain", "snow", "storm"];
	let generated = 0;
	for (const w of weathers) {
		if (hasAudio(w)) continue;
		const ok = await generateAudio(w);
		if (ok) generated++;
	}
	return generated;
}

/** Check which weather sounds are cached */
export function getCachedWeathers(): Weather[] {
	const weathers: Weather[] = ["clear", "cloudy", "rain", "snow", "storm"];
	return weathers.filter(hasAudio);
}

export function isAmbientPlaying(): boolean {
	return currentProcess !== null;
}
