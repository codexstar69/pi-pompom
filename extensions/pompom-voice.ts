import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface SpeechEvent {
	text: string;
	source: "reaction" | "commentary" | "assistant" | "user_action" | "system";
	priority: number;
	allowTts: boolean;
}

interface TTSEngine {
	name: string;
	synthesize(text: string, voice: string): Promise<{ buffer: Buffer; durationMs: number }>;
	isAvailable(): Promise<boolean>;
}

export type Personality = "quiet" | "normal" | "chatty" | "professional" | "mentor" | "zen";

export interface VoiceConfig {
	enabled: boolean;
	configured: boolean;
	engine: "kokoro" | "deepgram" | "elevenlabs";
	kokoroVoice: string;
	deepgramVoice: string;
	elevenlabsVoice: string;
	personality: Personality;
	volume: number; // 0-100
}

interface AudioPlayer {
	command: string;
	argsForFile(filePath: string): string[];
}

interface KokoroAudioLike {
	toBlob(): Blob;
}

interface KokoroSynthLike {
	generate(text: string, options: { voice: string }): Promise<KokoroAudioLike>;
}

interface KokoroModuleLike {
	KokoroTTS: {
		from_pretrained(
			modelId: string,
			options: { dtype: "q8"; device: "cpu" },
		): Promise<KokoroSynthLike>;
	};
}

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const CONFIG_DIR = path.join(os.homedir(), ".pi", "pompom");
const CONFIG_FILE = path.join(CONFIG_DIR, "voice-config.json");
const TMP_DIR = path.join(process.cwd(), "tmp");
const MIN_INTERVAL_MS = 12000;
const MAX_QUEUE = 3;
const ENGINE_PRIORITY = ["elevenlabs", "deepgram", "kokoro"] as const;

export interface VoiceAvailability {
	bestEngine: VoiceConfig["engine"] | null;
	availableEngines: VoiceConfig["engine"][];
	engines: Record<VoiceConfig["engine"], boolean>;
}

const DEFAULT_CONFIG: VoiceConfig = {
	enabled: false,
	configured: false,
	engine: "elevenlabs",
	kokoroVoice: "af_nicole",
	deepgramVoice: "aura-2-luna-en",
	elevenlabsVoice: "1zUSi8LeHs9M2mV8X6YS",
	personality: "normal",
	volume: 70,
};

const VOICE_CATALOG: Record<string, { name: string; id: string }[]> = {
	kokoro: [
		{ name: "Nicole (female)", id: "af_nicole" },
		{ name: "Sky (female)", id: "af_sky" },
		{ name: "Bella (female)", id: "af_bella" },
		{ name: "Nova (female)", id: "af_nova" },
		{ name: "Sarah (female)", id: "af_sarah" },
		{ name: "Adam (male)", id: "am_adam" },
		{ name: "Eric (male)", id: "am_eric" },
		{ name: "Michael (male)", id: "am_michael" },
	],
	deepgram: [
		{ name: "Luna (female)", id: "aura-2-luna-en" },
		{ name: "Asteria (female)", id: "aura-asteria-en" },
		{ name: "Athena (female)", id: "aura-2-athena-en" },
		{ name: "Orion (male)", id: "aura-2-orion-en" },
		{ name: "Apollo (male)", id: "aura-2-apollo-en" },
	],
	elevenlabs: [
		{ name: "Default (configured)", id: "1zUSi8LeHs9M2mV8X6YS" },
		{ name: "Aria (female)", id: "9BWtsMINqrJLrRacOk9x" },
		{ name: "Rachel (female)", id: "21m00Tcm4TlvDq8ikWAM" },
		{ name: "Domi (female)", id: "AZnzlk1XvdvUeBnXmlld" },
		{ name: "Adam (male)", id: "pNInz6obpgDQGcFmaJgB" },
		{ name: "Sam (male)", id: "yoZ06aMxZJJ28mfd3POQ" },
	],
};

const kokoroCache = new Map<string, { buffer: Buffer; durationMs: number }>();

let config: VoiceConfig = loadVoiceConfig();
let interactive = false;
let detectedPlayer: AudioPlayer | null = null;
let agentBusy = false;
let agentEndCooldownTimer: ReturnType<typeof setTimeout> | null = null;
let queue: SpeechEvent[] = [];
let isProcessingQueue = false;
let playbackActive = false;
let playbackEnvelopePhase = 0;
let lastSpokenText = "";
let lastSpeakTime = 0;
let currentPlayback: childProcess.ChildProcess | null = null;
let stopRequested = false;

function sanitizeSpeechText(text: string): string {
	return text.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
}

function isVoiceEngine(value: unknown): value is VoiceConfig["engine"] {
	return value === "elevenlabs" || value === "deepgram" || value === "kokoro";
}

function commandExists(cmd: string): boolean {
	try {
		const lookupCommand = process.platform === "win32" ? "where" : "which";
		return childProcess.spawnSync(lookupCommand, [cmd], { stdio: "ignore" }).status === 0;
	} catch {
		return false;
	}
}

function loadVoiceConfig(): VoiceConfig {
	try {
		if (!fs.existsSync(CONFIG_FILE)) {
			return { ...DEFAULT_CONFIG };
		}
		const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as Partial<VoiceConfig>;
		const engine = isVoiceEngine(parsed.engine) ? parsed.engine : DEFAULT_CONFIG.engine;
		const validPersonality = ["quiet", "normal", "chatty", "professional", "mentor", "zen"] as const;
		const personality = validPersonality.includes(parsed.personality as any)
			? (parsed.personality as Personality) : DEFAULT_CONFIG.personality;
		return {
			enabled: parsed.enabled ?? DEFAULT_CONFIG.enabled,
			configured: parsed.configured ?? DEFAULT_CONFIG.configured,
			engine,
			kokoroVoice: typeof parsed.kokoroVoice === "string" && parsed.kokoroVoice
				? parsed.kokoroVoice
				: DEFAULT_CONFIG.kokoroVoice,
			deepgramVoice: typeof parsed.deepgramVoice === "string" && parsed.deepgramVoice
				? parsed.deepgramVoice
				: DEFAULT_CONFIG.deepgramVoice,
			elevenlabsVoice: typeof parsed.elevenlabsVoice === "string" && parsed.elevenlabsVoice
				? parsed.elevenlabsVoice
				: DEFAULT_CONFIG.elevenlabsVoice,
			personality,
			volume: typeof parsed.volume === "number" ? Math.max(0, Math.min(100, parsed.volume)) : DEFAULT_CONFIG.volume,
		};
	} catch (error) {
		console.error("Failed to load Pompom voice config:", error);
		return { ...DEFAULT_CONFIG };
	}
}

function saveVoiceConfig(): void {
	try {
		fs.mkdirSync(CONFIG_DIR, { recursive: true });
		fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, "\t"));
	} catch (error) {
		console.error("Failed to save Pompom voice config:", error);
	}
}

function estimateDurationMs(buffer: Buffer): number {
	return Math.max(1, Math.round((buffer.length / (24000 * 2)) * 1000));
}

function markVoiceConfigured(): boolean {
	if (config.configured) {
		return false;
	}
	config.configured = true;
	return true;
}

function detectPlayer(): AudioPlayer | null {
	if (process.platform === "darwin" && commandExists("afplay")) {
		return {
			command: "afplay",
			argsForFile(filePath) {
				const vol = (config.volume / 100).toFixed(2);
				return ["-v", vol, filePath];
			},
		};
	}
	if (process.platform === "linux") {
		if (commandExists("paplay")) {
			return {
				command: "paplay",
				argsForFile(filePath) {
					const vol = Math.round((config.volume / 100) * 65536).toString();
					return ["--volume", vol, filePath];
				},
			};
		}
		if (commandExists("aplay")) {
			return {
				command: "aplay",
				argsForFile(filePath) {
					return [filePath];
				},
			};
		}
	}
	if (process.platform === "win32" && commandExists("powershell")) {
		return {
			command: "powershell",
			argsForFile(filePath) {
				const escapedPath = filePath.replace(/'/g, "''");
				return [
					"-NoProfile",
					"-Command",
					`$player = New-Object Media.SoundPlayer '${escapedPath}'; $player.PlaySync()`,
				];
			},
		};
	}
	return null;
}

async function playAudio(buffer: Buffer): Promise<void> {
		try {
			if (!detectedPlayer) {
				return;
			}
			const player = detectedPlayer;
			fs.mkdirSync(TMP_DIR, { recursive: true });
		const tempFile = path.join(
			TMP_DIR,
			`pompom-voice-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`,
		);
		fs.writeFileSync(tempFile, buffer);

			await new Promise<void>((resolve) => {
				stopRequested = false;
				const child = childProcess.spawn(
					player.command,
					player.argsForFile(tempFile),
					{ stdio: "ignore" },
				);
			currentPlayback = child;
			let finished = false;

			const finish = () => {
				if (finished) {
					return;
				}
				finished = true;
				try {
					fs.unlinkSync(tempFile);
				} catch (error) {
					if (fs.existsSync(tempFile)) {
						console.error("Failed to remove Pompom temp audio file:", error);
					}
				}
				currentPlayback = null;
				resolve();
			};

			child.on("error", (error) => {
				if (!stopRequested) {
					console.error("Failed to play Pompom audio:", error);
				}
				finish();
			});

			child.on("close", () => {
				finish();
			});
		});
	} catch (error) {
		console.error("Pompom audio playback failed:", error);
	}
}

class KokoroEngine implements TTSEngine {
	name = "kokoro";
	private synth: KokoroSynthLike | null = null;
	private synthPromise: Promise<KokoroSynthLike> | null = null;

	private async getSynth(): Promise<KokoroSynthLike> {
		if (this.synth) {
			return this.synth;
		}
		if (!this.synthPromise) {
			this.synthPromise = (async () => {
				const moduleName = "kokoro-js";
				const kokoroModule = await import(moduleName) as KokoroModuleLike;
				const synth = await kokoroModule.KokoroTTS.from_pretrained(MODEL_ID, {
					dtype: "q8",
					device: "cpu",
				});
				this.synth = synth;
				return synth;
			})();
		}
		return this.synthPromise;
	}

	async synthesize(text: string, voice: string): Promise<{ buffer: Buffer; durationMs: number }> {
		const cacheKey = `${voice}:${text}`;
		const cached = kokoroCache.get(cacheKey);
		if (cached) {
			return cached;
		}
		const synth = await this.getSynth();
		const audio = await synth.generate(text, { voice });
		const blob = audio.toBlob();
		const arrayBuffer = await blob.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);
		const result = {
			buffer,
			durationMs: estimateDurationMs(buffer),
		};
		kokoroCache.set(cacheKey, result);
		return result;
	}

	async isAvailable(): Promise<boolean> {
		try {
			const moduleName = "kokoro-js";
			await import(moduleName);
			return true;
		} catch {
			return false;
		}
	}
}

class DeepgramEngine implements TTSEngine {
	name = "deepgram";

	async synthesize(text: string, voice: string): Promise<{ buffer: Buffer; durationMs: number }> {
		const apiKey = process.env.DEEPGRAM_API_KEY;
		if (!apiKey) {
			throw new Error("DEEPGRAM_API_KEY is not set");
		}
		const url = new URL("https://api.deepgram.com/v1/speak");
		url.searchParams.set("model", voice);
		url.searchParams.set("encoding", "linear16");
		url.searchParams.set("container", "wav");

		const response = await fetch(url.toString(), {
			method: "POST",
			headers: {
				Authorization: `Token ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ text }),
		});
		if (!response.ok) {
			throw new Error(`Deepgram TTS failed: HTTP ${response.status}`);
		}
		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);
		return {
			buffer,
			durationMs: estimateDurationMs(buffer),
		};
	}

	async isAvailable(): Promise<boolean> {
		return Boolean(process.env.DEEPGRAM_API_KEY);
	}
}

class ElevenLabsEngine implements TTSEngine {
	name = "elevenlabs";

	async synthesize(text: string, voice: string): Promise<{ buffer: Buffer; durationMs: number }> {
		const apiKey = process.env.ELEVENLABS_API_KEY;
		if (!apiKey) {
			throw new Error("ELEVENLABS_API_KEY is not set");
		}

		// Use the text-to-speech API v1
		// voice can be a voice ID or a name — the API accepts both
		const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`;

		const response = await fetch(url + "?enable_logging=false&output_format=pcm_24000", {
			method: "POST",
			headers: {
				"xi-api-key": apiKey,
				"xi-no-log": "true",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				text,
				model_id: "eleven_v3",
				voice_settings: {
					stability: 0.5,
					similarity_boost: 0.8,
					style: 0.7,
					use_speaker_boost: true,
				},
			}),
		});

		if (!response.ok) {
			const errText = await response.text().catch(() => "");
			throw new Error(`ElevenLabs TTS failed: HTTP ${response.status} ${errText}`);
		}

		// ElevenLabs returns raw PCM when output_format is pcm_*
		// We need to wrap it in a WAV header for playback
		const pcmBuffer = Buffer.from(await response.arrayBuffer());
		const wavBuffer = wrapPcmInWav(pcmBuffer, 24000, 1, 16);

		return {
			buffer: wavBuffer,
			durationMs: Math.max(1, Math.round((pcmBuffer.length / (24000 * 2)) * 1000)),
		};
	}

	async isAvailable(): Promise<boolean> {
		return Boolean(process.env.ELEVENLABS_API_KEY);
	}
}

function wrapPcmInWav(pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
	const byteRate = sampleRate * channels * (bitsPerSample / 8);
	const blockAlign = channels * (bitsPerSample / 8);
	const header = Buffer.alloc(44);

	header.write("RIFF", 0);
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write("WAVE", 8);
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16); // chunk size
	header.writeUInt16LE(1, 20); // PCM format
	header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(bitsPerSample, 34);
	header.write("data", 36);
	header.writeUInt32LE(pcm.length, 40);

	return Buffer.concat([header, pcm]);
}

const kokoroEngine = new KokoroEngine();
const deepgramEngine = new DeepgramEngine();
const elevenlabsEngine = new ElevenLabsEngine();

const engineMap: Record<string, TTSEngine> = {
	kokoro: kokoroEngine,
	deepgram: deepgramEngine,
	elevenlabs: elevenlabsEngine,
};

async function resolveEngine(): Promise<TTSEngine | null> {
	try {
		const preferredEngine = await autoDetectEngine({ preferredEngine: config.engine });
		if (!preferredEngine) {
			return null;
		}
		return engineMap[preferredEngine] || null;
	} catch {
		return null;
	}
}

async function processQueue(): Promise<void> {
	if (isProcessingQueue) {
		return;
	}
	isProcessingQueue = true;
	try {
		while (queue.length > 0 && config.enabled && interactive) {
			const nextEvent = queue.shift();
			if (!nextEvent) {
				continue;
			}
			const engine = await resolveEngine();
			if (!engine) {
				continue;
			}
			const voice = engine.name === "kokoro" ? config.kokoroVoice
				: engine.name === "elevenlabs" ? config.elevenlabsVoice
				: config.deepgramVoice;
			const audio = await engine.synthesize(nextEvent.text, voice);
			lastSpokenText = nextEvent.text;
			lastSpeakTime = Date.now();
			playbackActive = true;
			playbackEnvelopePhase = 0;
			await playAudio(audio.buffer);
			playbackActive = false;
		}
	} catch (error) {
		playbackActive = false;
		console.error("Pompom speech queue failed:", error);
	} finally {
		isProcessingQueue = false;
	}
}

export function initVoice(isInteractive: boolean): void {
	try {
		interactive = isInteractive;
		config = loadVoiceConfig();
		detectedPlayer = detectPlayer();
	} catch (error) {
		console.error("Failed to initialize Pompom voice:", error);
	}
}

export function setAgentBusy(busy: boolean): void {
	agentBusy = busy;
	if (!busy) {
		// After agent finishes, keep quiet for 5s before re-enabling TTS
		if (agentEndCooldownTimer) clearTimeout(agentEndCooldownTimer);
		agentEndCooldownTimer = setTimeout(() => { agentEndCooldownTimer = null; }, 5000);
	}
}

export function setPersonality(p: Personality): void {
	config.personality = p;
	saveVoiceConfig();
}

export function getVoiceCatalog(): Record<string, { name: string; id: string }[]> {
	return VOICE_CATALOG;
}

export function setVolume(vol: number): void {
	config.volume = Math.max(0, Math.min(100, vol));
	detectedPlayer = detectPlayer(); // re-detect to pick up new volume
	saveVoiceConfig();
}

export function setVoice(voice: string): void {
	if (config.engine === "kokoro") config.kokoroVoice = voice;
	else if (config.engine === "deepgram") config.deepgramVoice = voice;
	else config.elevenlabsVoice = voice;
	saveVoiceConfig();
}

export function enqueueSpeech(event: SpeechEvent): void {
	try {
		if (!config.enabled || !interactive || !event.allowTts) {
			return;
		}
		// Agent busy gate — suppress TTS audio during agent work (speech bubbles still show)
		if (agentBusy && event.priority < 3) {
			return;
		}
		// Post-agent cooldown
		if (agentEndCooldownTimer && event.priority < 3) {
			return;
		}
		// Personality gate
		if (config.personality === "quiet" && event.priority < 3 && event.source !== "user_action") {
			return;
		}
		if (config.personality === "normal" && event.priority < 2 && event.source === "commentary") {
			return;
		}
		// Professional: speaks only on errors, milestones, and direct user actions. No idle chatter.
		if (config.personality === "professional" && event.source === "commentary" && event.priority < 3) {
			return;
		}
		// Mentor: speaks on errors and completion summaries. Skips routine tool commentary.
		if (config.personality === "mentor" && event.source === "commentary" && event.priority < 2) {
			return;
		}
		// Zen: almost silent. Only speaks when directly addressed (user_action priority 3).
		if (config.personality === "zen" && event.priority < 3) {
			return;
		}
		const text = sanitizeSpeechText(event.text);
		if (text.length < 5) {
			return;
		}
		if (text === lastSpokenText && Date.now() - lastSpeakTime < 30000) {
			return;
		}
		if (queue.some((queued) => queued.text === text)) {
			return;
		}
		if (event.priority === 1 && Math.random() > 0.25) {
			return;
		}
		if (Date.now() - lastSpeakTime < MIN_INTERVAL_MS && event.priority < 3) {
			return;
		}

		const nextEvent: SpeechEvent = {
			...event,
			text,
		};

		if (queue.length >= MAX_QUEUE) {
			let lowestIndex = -1;
			let lowestPriority = Number.POSITIVE_INFINITY;
			queue.forEach((queued, index) => {
				if (queued.priority < lowestPriority) {
					lowestPriority = queued.priority;
					lowestIndex = index;
				}
			});
			if (lowestIndex >= 0 && queue[lowestIndex].priority < nextEvent.priority) {
				queue.splice(lowestIndex, 1);
			} else {
				return;
			}
		}

		queue.push(nextEvent);
		queue.sort((left, right) => {
			return right.priority - left.priority;
		});
		void processQueue();
	} catch (error) {
		console.error("Failed to enqueue Pompom speech:", error);
	}
}

export function getTTSAudioLevel(): number {
	if (!playbackActive) {
		return 0;
	}
	playbackEnvelopePhase += 0.15;
	return 0.3 + Math.abs(Math.sin(playbackEnvelopePhase * 4)) * 0.5;
}

export function isPlayingTTS(): boolean {
	return playbackActive;
}

export function setVoiceEnabled(enabled: boolean): void {
	try {
		let shouldSave = false;
		if (config.enabled !== enabled) {
			config.enabled = enabled;
			shouldSave = true;
		}
		if (markVoiceConfigured()) {
			shouldSave = true;
		}
		if (shouldSave) {
			saveVoiceConfig();
		}
		if (!enabled) {
			stopPlayback();
		}
	} catch (error) {
		console.error("Failed to update Pompom voice enabled state:", error);
	}
}

export function setVoiceEngine(engine: "kokoro" | "deepgram" | "elevenlabs"): void {
	try {
		let shouldSave = false;
		if (config.engine !== engine) {
			config.engine = engine;
			shouldSave = true;
		}
		if (markVoiceConfigured()) {
			shouldSave = true;
		}
		if (shouldSave) {
			saveVoiceConfig();
		}
	} catch (error) {
		console.error("Failed to update Pompom voice engine:", error);
	}
}

export function getVoiceConfig(): VoiceConfig {
	return { ...config };
}

export function hasVoiceBeenConfigured(): boolean {
	return config.configured;
}

export async function getVoiceAvailability(): Promise<VoiceAvailability> {
	const [elevenlabs, deepgram, kokoro] = await Promise.all([
		elevenlabsEngine.isAvailable(),
		deepgramEngine.isAvailable(),
		kokoroEngine.isAvailable(),
	]);
	const engines: VoiceAvailability["engines"] = {
		elevenlabs,
		deepgram,
		kokoro,
	};
	const availableEngines = ENGINE_PRIORITY.filter((engine) => {
		return engines[engine];
	});
	return {
		bestEngine: availableEngines[0] || null,
		availableEngines,
		engines,
	};
}

export async function autoDetectEngine(options?: {
	preferredEngine?: VoiceConfig["engine"];
}): Promise<VoiceConfig["engine"] | null> {
	const availability = await getVoiceAvailability();
	if (options?.preferredEngine && availability.engines[options.preferredEngine]) {
		return options.preferredEngine;
	}
	return availability.bestEngine;
}

export function speakTest(): void {
	try {
		enqueueSpeech({
			text: "Hello. I am Pompom. Voice test ready.",
			source: "system",
			priority: 3,
			allowTts: true,
		});
	} catch (error) {
		console.error("Failed to run Pompom voice test:", error);
	}
}

export function stopPlayback(): void {
	try {
		queue = [];
		playbackActive = false;
		stopRequested = true;
		if (currentPlayback) {
			try {
				currentPlayback.kill("SIGTERM");
			} catch (error) {
				console.error("Failed to stop Pompom playback:", error);
			}
		}
		currentPlayback = null;
	} catch (error) {
		console.error("Failed to stop Pompom voice playback:", error);
	}
}
