import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as url from "node:url";

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
	pompomModel: string; // model ID for /pompom:ask and /pompom:analyze (empty = use main agent's model)
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
const TMP_DIR = path.join(os.tmpdir(), "pompom-voice");
const MIN_INTERVAL_MS = 45000;
const MAX_QUEUE = 3;
const ENGINE_PRIORITY = ["elevenlabs", "deepgram", "kokoro"] as const;
const VOICE_AVAILABILITY_TTL_MS = 10000;

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
	elevenlabsVoice: "g6xIsTj2HwM6VR4iXFCw", // Jessica Anne Bogart - Chatty and Friendly
	personality: "normal",
	volume: 70,
	pompomModel: "",
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
		// Cute & Character voices — perfect for Pompom
		{ name: "Jessica Anne Bogart - Chatty (default)", id: "g6xIsTj2HwM6VR4iXFCw" },
		{ name: "Lily - Soft, Cute and Sweet", id: "Pt5YrLNyu6d2s3s4CVMg" },
		{ name: "Cherry Twinkle - Bubbly and Sweet", id: "XJ2fW4ybq7HouelYYGcL" },
		{ name: "Flicker - Cheerful Fairy", id: "piI8Kku0DcvcL6TTSeQt" },
		{ name: "Bea - Cute, Sweet, Charming", id: "0OteN0TNg6Kyaflk2DY8" },
		{ name: "Blackie - Girlish, Cute, Cheerful", id: "iFhPOZcajR7W3sDL39qJ" },
		{ name: "Aerisita - Bubbly, Feminine", id: "vGQNBgLaiM3EdZtxIiuY" },
		{ name: "Minnie - Cartoon Character", id: "eppqEXVumQ3CfdndcIBd" },
		{ name: "Niki - Lively Cartoon", id: "GKXCdIjjORefHK29tFTY" },
		{ name: "Daisy - Playful Southern", id: "j45mXgB0BR0mIJbdyK09" },
		// Professional voices
		{ name: "Jessica Anne Bogart - Eloquent", id: "flHkNRp1BlvT73UL6gyz" },
		{ name: "Jessica - Playful, Warm", id: "cgSgspJ2msm6clMCkdW9" },
		{ name: "Sarah - Mature, Confident", id: "EXAVITQu4vr4xnSDxMaL" },
		{ name: "Alice - Clear Educator", id: "Xb7hH8MSUJpSbSDYk0k2" },
		{ name: "Bella - Professional, Warm", id: "hpp4J3VqNfWAUOO0d1Us" },
		{ name: "Lily - Velvety Actress", id: "pFZP5JQG7iQjIQuC4Bku" },
		{ name: "Adam - Dominant, Firm", id: "pNInz6obpgDQGcFmaJgB" },
	],
};

const kokoroCache = new Map<string, { buffer: Buffer; durationMs: number }>();
const MAX_KOKORO_CACHE = 10;

let config: VoiceConfig = loadVoiceConfig();
let interactive = false;
let detectedPlayer: AudioPlayer | null = null;
let agentBusy = false;
let micRecording = false;
let agentEndCooldownTimer: ReturnType<typeof setTimeout> | null = null;
let queue: SpeechEvent[] = [];
let isProcessingQueue = false;
let playbackActive = false;
let playbackEnvelopePhase = 0;
let lastSpokenText = "";
let lastSpeakTime = 0;
let currentPlayback: childProcess.ChildProcess | null = null;
let stopRequested = false;
let consecutiveFailures = 0;
let currentAbortController: AbortController | null = null;
let queueRestartTimer: ReturnType<typeof setTimeout> | null = null;
let voiceAvailabilityCache:
	| {
		expiresAt: number;
		value: VoiceAvailability | null;
		pending: Promise<VoiceAvailability> | null;
	}
	| null = null;

function sanitizeSpeechText(text: string): string {
	return text.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
}

/** Strip ElevenLabs v3 audio tags like [laughs], [sighs], [excited] for engines that don't support them. */
function stripAudioTags(text: string): string {
	return text.replace(/\[[\w\s]+\]\s*/g, "").replace(/\s+/g, " ").trim();
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
			pompomModel: typeof parsed.pompomModel === "string" ? parsed.pompomModel : DEFAULT_CONFIG.pompomModel,
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[pompom-voice] loadVoiceConfig failed: ${msg}`);
		return { ...DEFAULT_CONFIG };
	}
}

function saveVoiceConfig(): void {
	try {
		fs.mkdirSync(CONFIG_DIR, { recursive: true });
		const tmp = CONFIG_FILE + ".tmp." + process.pid;
		fs.writeFileSync(tmp, JSON.stringify(config, null, "\t"));
		fs.renameSync(tmp, CONFIG_FILE);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[pompom-voice] saveVoiceConfig failed: ${msg}`);
	}
}

function estimateDurationMs(buffer: Buffer): number {
	return Math.max(1, Math.round((buffer.length / (24000 * 2)) * 1000));
}

function clearQueueRestartTimer(): void {
	if (!queueRestartTimer) {
		return;
	}
	clearTimeout(queueRestartTimer);
	queueRestartTimer = null;
}

function scheduleQueueRestart(): void {
	if (queueRestartTimer || stopRequested) {
		return;
	}
	queueRestartTimer = setTimeout(() => {
		queueRestartTimer = null;
		consecutiveFailures = 0;
		processQueue().catch((error) => {
			console.error(`[pompom-voice] processQueue restart failed: ${error instanceof Error ? error.message : error}`);
		});
	}, 30000);
}

function findWavDataChunk(buffer: Buffer): { dataOffset: number; dataLength: number; bitsPerSample: number } | null {
	if (buffer.length < 44) {
		return null;
	}
	if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
		return null;
	}
	let bitsPerSample = 16;
	let offset = 12;
	while (offset + 8 <= buffer.length) {
		const chunkId = buffer.toString("ascii", offset, offset + 4);
		const chunkLength = buffer.readUInt32LE(offset + 4);
		const chunkDataOffset = offset + 8;
		if (chunkId === "fmt " && chunkDataOffset + 16 <= buffer.length) {
			bitsPerSample = buffer.readUInt16LE(chunkDataOffset + 14);
		}
		if (chunkId === "data") {
			return {
				dataOffset: chunkDataOffset,
				dataLength: Math.max(0, Math.min(chunkLength, buffer.length - chunkDataOffset)),
				bitsPerSample,
			};
		}
		offset = chunkDataOffset + chunkLength + (chunkLength % 2);
	}
	return null;
}

function applyGainToWav(buffer: Buffer, gain: number): Buffer {
	if (gain >= 0.999) {
		return buffer;
	}
	const wavData = findWavDataChunk(buffer);
	if (!wavData || wavData.bitsPerSample !== 16) {
		return buffer;
	}
	const scaled = Buffer.from(buffer);
	const endOffset = wavData.dataOffset + wavData.dataLength;
	for (let offset = wavData.dataOffset; offset + 1 < endOffset; offset += 2) {
		const sample = scaled.readInt16LE(offset);
		const nextSample = Math.round(sample * gain);
		const clampedSample = Math.max(-32768, Math.min(32767, nextSample));
		scaled.writeInt16LE(clampedSample, offset);
	}
	return scaled;
}

function getPlaybackBuffer(buffer: Buffer): Buffer {
	if (detectedPlayer?.command !== "aplay" && detectedPlayer?.command !== "powershell") {
		return buffer;
	}
	return applyGainToWav(buffer, Math.max(0, Math.min(1, config.volume / 100)));
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
			throw new Error("No audio player detected — cannot play TTS audio");
		}
		const player = detectedPlayer;
		const playbackBuffer = getPlaybackBuffer(buffer);
		fs.mkdirSync(TMP_DIR, { recursive: true });
		const tempFile = path.join(
			TMP_DIR,
			`pompom-voice-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`,
		);
		fs.writeFileSync(tempFile, playbackBuffer);

		await new Promise<void>((resolve, reject) => {
			const child = childProcess.spawn(
				player.command,
				player.argsForFile(tempFile),
				{ stdio: "ignore" },
			);
			currentPlayback = child;
			let finished = false;

			const finish = (callback: () => void) => {
				if (finished) {
					return;
				}
				finished = true;
				try {
					fs.unlinkSync(tempFile);
				} catch {
					// Temp file cleanup is best-effort — file will be cleaned on next launch or OS reboot
				}
				if (currentPlayback === child) {
					currentPlayback = null;
				}
				callback();
			};

			child.on("error", (error) => {
				if (stopRequested) {
					finish(resolve);
					return;
				}
				const msg = error instanceof Error ? error.message : String(error);
				console.error(`[pompom-voice] playback error: ${msg}`);
				finish(() => reject(error instanceof Error ? error : new Error(msg)));
			});

			child.on("close", (code, signal) => {
				if (stopRequested || code === 0) {
					finish(resolve);
					return;
				}
				const detail = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
				finish(() => reject(new Error(`Playback exited with ${detail}`)));
			});
		});
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[pompom-voice] playAudio failed: ${msg}`);
		throw error; // Let processQueue's itemError handler catch it
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
				try {
					const moduleName = "kokoro-js";
					const kokoroModule = await import(moduleName) as KokoroModuleLike;
					const synth = await kokoroModule.KokoroTTS.from_pretrained(MODEL_ID, {
						dtype: "q8",
						device: "cpu",
					});
					this.synth = synth;
					return synth;
				} catch (error) {
					this.synthPromise = null; // Reset so next call retries
					throw error;
				}
			})();
		}
		return this.synthPromise;
	}

	async synthesize(text: string, voice: string): Promise<{ buffer: Buffer; durationMs: number }> {
		const cacheKey = `${voice}:${text}`;
		const cached = kokoroCache.get(cacheKey);
		if (cached) {
			kokoroCache.delete(cacheKey);
			kokoroCache.set(cacheKey, cached);
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
		if (kokoroCache.size >= MAX_KOKORO_CACHE) {
			const oldest = kokoroCache.keys().next().value;
			if (oldest !== undefined) kokoroCache.delete(oldest);
		}
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

		const signal = currentAbortController
			? AbortSignal.any([currentAbortController.signal, AbortSignal.timeout(15000)])
			: AbortSignal.timeout(15000);
		const response = await fetch(url.toString(), {
			method: "POST",
			headers: {
				Authorization: `Token ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ text }),
			signal,
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

		const signal = currentAbortController
			? AbortSignal.any([currentAbortController.signal, AbortSignal.timeout(15000)])
			: AbortSignal.timeout(15000);
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
					stability: 0.15, // Low for audio tag expressiveness, but not 0.0 which is too harsh
					similarity_boost: 0.8, // Natural clone fidelity
					style: 0.55, // Warm and animated without being jarring
					use_speaker_boost: true, // Enhances clarity for small-speaker playback
					speed: 0.95, // Slightly slower — softer, more natural delivery
				},
			}),
			signal,
		});

		if (!response.ok) {
			const rawErr = await response.text().catch(() => "");
			const safeErr = rawErr.slice(0, 200).replace(/[^\x20-\x7E]/g, "");
			throw new Error(`ElevenLabs TTS failed: HTTP ${response.status} ${safeErr}`);
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
			console.error("[pompom-voice] No TTS engine available — check API keys or install kokoro-js");
			return null;
		}
		return engineMap[preferredEngine] || null;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[pompom-voice] resolveEngine failed: ${msg}`);
		return null;
	}
}

async function processQueue(): Promise<void> {
	if (isProcessingQueue) {
		return;
	}
	clearQueueRestartTimer();
	isProcessingQueue = true;
	try {
		while (queue.length > 0 && config.enabled && interactive) {
			if (stopRequested) break;
			const nextEvent = queue.shift();
			if (!nextEvent) {
				continue;
			}
			currentAbortController = new AbortController();
			try {
				const engine = await resolveEngine();
				if (!engine) {
					consecutiveFailures++;
					if (consecutiveFailures >= 3) {
						console.error("[pompom-voice] 3 consecutive failures — pausing queue");
						break;
					}
					continue;
				}
				const voice = engine.name === "kokoro" ? config.kokoroVoice
					: engine.name === "elevenlabs" ? config.elevenlabsVoice
					: config.deepgramVoice;
				// Strip v3 audio tags for non-ElevenLabs engines — they'd be spoken literally
				const speechText = engine.name === "elevenlabs" ? nextEvent.text : stripAudioTags(nextEvent.text);
				if (!speechText || speechText.length < 3) continue;
				const audio = await engine.synthesize(speechText, voice);
				if (stopRequested) break;
				playbackActive = true;
				playbackEnvelopePhase = 0;
				const playbackTimeout = audio.durationMs + 10000;
				let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
				try {
					if (stopRequested) break;
					await Promise.race([
						playAudio(audio.buffer),
						new Promise<void>((_, reject) => {
							timeoutHandle = setTimeout(() => {
								// Kill the stuck player process on timeout
								if (currentPlayback) {
									const proc = currentPlayback;
									try { proc.kill("SIGTERM"); } catch { /* already dead */ }
									currentPlayback = null;
									setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* already dead */ } }, 1000);
								}
								const err = new Error("Playback timeout");
								err.name = "TimeoutError";
								reject(err);
							}, playbackTimeout);
						}),
					]);
				} finally {
					if (timeoutHandle) clearTimeout(timeoutHandle);
				}
				if (stopRequested) {
					playbackActive = false;
					break;
				}
				// Mark as spoken AFTER successful playback — failed plays can be retried
				lastSpokenText = nextEvent.text;
				lastSpeakTime = Date.now();
				playbackActive = false;
				consecutiveFailures = 0;
			} catch (itemError) {
				playbackActive = false;
				const errName = itemError instanceof Error ? itemError.name : "";
				if ((errName === "AbortError" || errName === "TimeoutError") && stopRequested) {
					// User-initiated stop or abort — not a synthesis failure
					break;
				}
				consecutiveFailures++;
				const msg = itemError instanceof Error ? itemError.message : String(itemError);
				console.error(`[pompom-voice] TTS failed (${consecutiveFailures}): ${msg}`);
				if (consecutiveFailures >= 3) {
					console.error("[pompom-voice] 3 consecutive failures — pausing queue");
					break;
				}
			}
		}
	} catch (error) {
		playbackActive = false;
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[pompom-voice] processQueue unexpected error: ${msg}`);
	} finally {
		playbackActive = false;
		isProcessingQueue = false;
		// stopRequested is only a transient interrupt latch. Once queue work is
		// fully unwound, clear it so normal-priority speech can recover.
		if (stopRequested && queue.length === 0) {
			stopRequested = false;
		}
		// Re-check: items may have been enqueued during processing
		if (queue.length > 0 && config.enabled && interactive && !stopRequested) {
			if (consecutiveFailures >= 3 && queue.length > 0) {
				scheduleQueueRestart();
			} else {
				processQueue().catch(err => { console.error(`[pompom-voice] processQueue restart failed: ${err instanceof Error ? err.message : err}`); });
			}
		}
	}
}

export function initVoice(isInteractive: boolean): void {
	try {
		stopPlayback(); // kills player, clears queue, sets stopRequested
		queue = [];
		playbackActive = false;
		stopRequested = false;
		isProcessingQueue = false;
		consecutiveFailures = 0;
		lastSpeakTime = 0;
		clearQueueRestartTimer();
		interactive = isInteractive;
		config = loadVoiceConfig();
		detectedPlayer = detectPlayer();
		if (isInteractive && !detectedPlayer) {
			console.error("[pompom-voice] No audio player found (afplay/paplay/aplay) — voice will not produce audio");
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[pompom-voice] initVoice failed: ${msg}`);
	}
}

/** Set mic recording state — when true, all TTS is suppressed to avoid audio conflict */
export function setMicRecording(active: boolean): void {
	micRecording = active;
	if (active) {
		// Cancel any in-flight TTS synthesis AND active playback
		if (currentAbortController) { currentAbortController.abort(); currentAbortController = null; }
		if (playbackActive) stopPlayback();
	}
}

export function isMicRecording(): boolean {
	return micRecording;
}

export function setAgentBusy(busy: boolean): void {
	agentBusy = busy;
	if (busy) {
		// Cancel stale cooldown from previous agent run
		if (agentEndCooldownTimer) { clearTimeout(agentEndCooldownTimer); agentEndCooldownTimer = null; }
	} else {
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
	// Volume is read dynamically in argsForFile() — no need to re-detect player
	saveVoiceConfig();
}

export function setPompomModel(modelId: string): void {
	config.pompomModel = modelId;
	saveVoiceConfig();
}

export function getPompomModel(): string {
	return config.pompomModel;
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
		// Silence TTS when mic/voice input is active to avoid audio conflicts
		if (micRecording) {
			return;
		}
		// Clear stop flag — only high-priority speech should re-enable after a stop
		if (event.priority >= 3) stopRequested = false;
		if (stopRequested) return;
		// During playback, only accept high-priority events into the queue
		if (playbackActive && event.priority < 3) {
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
		if (event.priority === 1 && Math.random() > 0.12) {
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
		clearQueueRestartTimer();
		void processQueue();
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[pompom-voice] enqueueSpeech failed: ${msg}`);
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
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[pompom-voice] setVoiceEnabled failed: ${msg}`);
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
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[pompom-voice] setVoiceEngine failed: ${msg}`);
	}
}

export function getVoiceConfig(): VoiceConfig {
	return { ...config };
}

export function hasVoiceBeenConfigured(): boolean {
	return config.configured;
}

export async function getVoiceAvailability(): Promise<VoiceAvailability> {
	const now = Date.now();
	if (voiceAvailabilityCache?.value && voiceAvailabilityCache.expiresAt > now) {
		return voiceAvailabilityCache.value;
	}
	if (voiceAvailabilityCache?.pending) {
		return voiceAvailabilityCache.pending;
	}
	const pending = Promise.all([
		elevenlabsEngine.isAvailable(),
		deepgramEngine.isAvailable(),
		kokoroEngine.isAvailable(),
	]).then(([elevenlabs, deepgram, kokoro]) => {
		const engines: VoiceAvailability["engines"] = {
			elevenlabs,
			deepgram,
			kokoro,
		};
		const availableEngines = ENGINE_PRIORITY.filter((engine) => {
			return engines[engine];
		});
		const availability: VoiceAvailability = {
			bestEngine: availableEngines[0] || null,
			availableEngines,
			engines,
		};
		voiceAvailabilityCache = {
			expiresAt: Date.now() + VOICE_AVAILABILITY_TTL_MS,
			value: availability,
			pending: null,
		};
		return availability;
	}).catch((error) => {
		voiceAvailabilityCache = null;
		throw error;
	});
	voiceAvailabilityCache = {
		expiresAt: now,
		value: null,
		pending,
	};
	return pending;
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
	enqueueSpeech({
		text: "Hello. I am Pompom. Voice test ready.",
		source: "system",
		priority: 3,
		allowTts: true,
	});
}

// ─── Demo voiceover pre-generation + cached playback ─────────────────────────

// Demo audio ships with the package — look in the repo's demo-audio/ directory
const MODULE_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const DEMO_AUDIO_DIR = path.join(MODULE_DIR, "..", "demo-audio");

/** Synthesize a line and save to disk. Returns true if cached file exists or was generated. */
export async function pregenerateDemoLine(key: string, text: string): Promise<boolean> {
	const wavPath = path.join(DEMO_AUDIO_DIR, `${key}.wav`);
	if (fs.existsSync(wavPath) && fs.statSync(wavPath).size > 1000) return true; // already cached
	try {
		const engine = await resolveEngine();
		if (!engine) return false;
		const voice = engine.name === "kokoro" ? config.kokoroVoice
			: engine.name === "elevenlabs" ? config.elevenlabsVoice
			: config.deepgramVoice;
		const speechText = engine.name === "elevenlabs" ? text : stripAudioTags(text);
		const audio = await engine.synthesize(speechText, voice);
		fs.mkdirSync(DEMO_AUDIO_DIR, { recursive: true });
		const tmp = wavPath + ".tmp." + process.pid;
		fs.writeFileSync(tmp, audio.buffer);
		fs.renameSync(tmp, wavPath);
		return true;
	} catch (err) {
		console.error(`[pompom-voice] pregenerateDemoLine(${key}) failed: ${err instanceof Error ? err.message : err}`);
		return false;
	}
}

/** Play a pre-generated demo audio file. Stops any previous playback first. */
export function playDemoLine(key: string): void {
	const wavPath = path.join(DEMO_AUDIO_DIR, `${key}.wav`);
	if (!fs.existsSync(wavPath) || !detectedPlayer) return;
	try {
		stopPlayback();
		if (detectedPlayer.command === "aplay" || detectedPlayer.command === "powershell") {
			const buffer = fs.readFileSync(wavPath);
			void playAudio(buffer).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`[pompom-voice] playDemoLine(${key}) failed: ${message}`);
			});
			return;
		}
		const proc = childProcess.spawn(
			detectedPlayer.command,
			detectedPlayer.argsForFile(wavPath),
			{ stdio: "ignore", detached: false },
		);
		currentPlayback = proc;
		playbackActive = true;
		proc.on("close", () => { if (currentPlayback === proc) { currentPlayback = null; playbackActive = false; } });
		proc.on("error", () => { if (currentPlayback === proc) { currentPlayback = null; playbackActive = false; } });
	} catch { /* best-effort */ }
}

/** Check if all demo lines are cached. */
export function isDemoCached(keys: string[]): boolean {
	return keys.every(k => {
		const p = path.join(DEMO_AUDIO_DIR, `${k}.wav`);
		return fs.existsSync(p) && fs.statSync(p).size > 1000;
	});
}

export function stopPlayback(): void {
	try {
		queue = [];
		playbackActive = false;
		stopRequested = true;
		consecutiveFailures = 0;
		clearQueueRestartTimer();
		if (currentAbortController) { currentAbortController.abort(); currentAbortController = null; }
		// Do NOT set isProcessingQueue = false here — let processQueue's own finally handle it.
		// Setting it here would break mutual exclusion if processQueue is still running.
		if (agentEndCooldownTimer) { clearTimeout(agentEndCooldownTimer); agentEndCooldownTimer = null; }
		if (currentPlayback) {
			try {
				currentPlayback.kill("SIGTERM");
			} catch (error) {
				try { currentPlayback.kill("SIGKILL"); } catch { /* truly dead */ }
			}
		}
		currentPlayback = null;
		// If no queue worker is active, we can safely clear the transient latch now.
		if (!isProcessingQueue) {
			stopRequested = false;
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[pompom-voice] stopPlayback failed: ${msg}`);
	}
}
