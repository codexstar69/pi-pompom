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
			currentProcess = null;
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

/** Pre-generate all weather audio files in the background (skips weathers with custom files) */
export async function pregenerateAll(): Promise<number> {
	const weathers: Weather[] = ["clear", "cloudy", "rain", "snow", "storm"];
	let generated = 0;
	for (const w of weathers) {
		if (hasCustomAudio(w)) continue; // Don't overwrite user files
		if (hasAudio(w)) continue;
		const ok = await generateAudio(w);
		if (ok) generated++;
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
