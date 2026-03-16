/**
 * pi-pompom — Pompom Companion Extension for Pi CLI.
 *
 * A 3D raymarched virtual pet that lives above the editor.
 * Hardened against conflicts with other extensions.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
	completeSimple,
	streamSimple,
	type Message,
} from "@mariozechner/pi-ai";
import fs from "node:fs";
import path from "node:path";
import {
	detectStuck,
	getActiveToolDetails,
	getAgentDashboard,
	getAgentWeather,
	getCommentary,
	getSessionStats,
	onAgentEnd,
	onAgentStart,
	onToolCall,
	onToolResult,
	resetAgentState,
	restoreState,
	serializeState,
	shouldUseAgentWeather,
} from "./pompom-agent";
import {
	pompomGetAccessories,
	pompomGiveAccessory,
	pompomKeypress,
	pompomOnSpeech,
	pompomRestoreAccessories,
	pompomSay,
	pompomSetAgentEarBoost,
	pompomSetAgentLook,
	pompomSetAgentMood,
	pompomSetAgentOverlay,
	pompomSetAntennaGlow,
	pompomSetTalkAudioLevel,
	pompomSetTalking,
	pompomSetWeatherOverride,
	pompomGetWeather,
	pompomOnSfx,
	pompomStatus,
	renderPompom,
	resetPompom,
} from "./pompom";
import {
	initAmbient,
	getAmbientConfig,
	hasAmbientBeenConfigured,
	setAmbientEnabled,
	setAmbientVolume,
	getAmbientVolume,
	setAmbientWeather,
	duckAmbient,
	unduckAmbient,
	pauseAmbient,
	resumeAmbient,
	stopAmbient,
	pregenerateAll,
	resetGeneratedAudio,
	getCachedWeathers,
	getCustomWeathers,
	isAmbientPlaying,
	getCustomAudioDir,
	playSfx,
	startWeatherSfx,
	stopWeatherSfx,
	pregenerateSfx,
	type SfxName,
} from "./pompom-ambient";
import {
	autoDetectEngine,
	enqueueSpeech,
	getVoiceAvailability,
	getTTSAudioLevel,
	getVoiceConfig,
	hasVoiceBeenConfigured,
	initVoice,
	isPlayingTTS,
	setVoiceEnabled,
	setVoiceEngine,
	setAgentBusy,
	setPersonality,
	setVoice,
	setVolume,
	getVoiceCatalog,
	speakTest,
	stopPlayback,
	type SpeechEvent,
	type Personality,
} from "./pompom-voice";

type MessageRole = "user" | "assistant" | "toolResult" | "unknown";

interface SessionEntryLike {
	type?: string;
	customType?: string;
	timestamp?: string;
	message?: unknown;
	data?: unknown;
}

interface ModelLike {
	id: string;
	provider: string;
}

interface MessageLike {
	role?: string;
	content?: unknown;
	model?: string;
	provider?: string;
	api?: string;
	usage?: unknown;
	timestamp?: number;
}

interface OverlayHint {
	forceOverlay: boolean;
	lookX: number;
	lookY: number;
	glow: number;
	earBoost: number;
}

const SAVE_DIR = path.join(process.env.HOME || "~", ".pi", "pompom");
const SAVE_FILE = path.join(SAVE_DIR, "accessories.json");
const WIDGET_ID = "codexstar-pompom-companion";
const POMPOM_AGENT_STATE_TYPE = "pompom-agent-state";
let loadedVoiceHintShown = false;

const emptyUsage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function sanitizeAscii(text: string): string {
	return text.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
}

function loadAccessories(): Record<string, boolean> {
	try {
		return JSON.parse(fs.readFileSync(SAVE_FILE, "utf-8")) as Record<string, boolean>;
	} catch {
		return {}; // File doesn't exist yet — that's fine
	}
}

function saveAccessories(): void {
	try {
		fs.mkdirSync(SAVE_DIR, { recursive: true });
		fs.writeFileSync(SAVE_FILE, JSON.stringify(pompomGetAccessories()));
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[pompom] saveAccessories failed: ${msg}`);
	}
}

function getPiListenState(): { audioLevel?: number; recording?: boolean } {
	const globalValue = globalThis as { __piListen?: { audioLevel?: number; recording?: boolean } };
	return globalValue.__piListen || {};
}

function getVoiceEngineLabel(engine: "kokoro" | "deepgram" | "elevenlabs"): string {
	if (engine === "elevenlabs") {
		return "ElevenLabs";
	}
	if (engine === "deepgram") {
		return "Deepgram";
	}
	return "Kokoro local";
}

function getVoiceSetupMessage(availability: {
	engines: Record<"kokoro" | "deepgram" | "elevenlabs", boolean>;
}): string {
	const lines: string[] = [
		"Pompom Voice Setup",
		"",
		"Nothing usable is configured yet.",
		"",
		"Best quality: set ELEVENLABS_API_KEY in your shell, then run /pompom:voice on",
		"Good quality: set DEEPGRAM_API_KEY in your shell, then run /pompom:voice on",
	];
	if (!availability.engines.kokoro) {
		lines.push("Free local: install kokoro-js, then run /pompom:voice on");
	} else {
		lines.push("Free local: Kokoro is already installed and can be enabled with /pompom:voice kokoro");
	}
	lines.push("", "Optional: run /pompom:voice setup to pick an engine manually.");
	return lines.join("\n");
}

async function enableAutoDetectedVoice(commandContext: ExtensionContext): Promise<void> {
	const voiceConfig = getVoiceConfig();
	const preferredEngine = hasVoiceBeenConfigured() ? voiceConfig.engine : undefined;
	const selectedEngine = await autoDetectEngine({ preferredEngine });
	if (!selectedEngine) {
		const availability = await getVoiceAvailability();
		commandContext.ui.notify(getVoiceSetupMessage(availability), "warning");
		return;
	}

	setVoiceEngine(selectedEngine);
	setVoiceEnabled(true);
	commandContext.ui.notify(`Pompom voice ON (${getVoiceEngineLabel(selectedEngine)}).`, "info");
}

async function runVoiceSetup(commandContext: ExtensionContext): Promise<void> {
	const availability = await getVoiceAvailability();
	if (availability.availableEngines.length === 0) {
		commandContext.ui.notify(getVoiceSetupMessage(availability), "warning");
		return;
	}

	if (!commandContext.hasUI || availability.availableEngines.length === 1) {
		const selectedEngine = availability.bestEngine;
		if (!selectedEngine) {
			commandContext.ui.notify(getVoiceSetupMessage(availability), "warning");
			return;
		}
		setVoiceEngine(selectedEngine);
		setVoiceEnabled(true);
		commandContext.ui.notify(`Pompom voice ON (${getVoiceEngineLabel(selectedEngine)}).`, "info");
		return;
	}

	const labels = availability.availableEngines.map((engine) => {
		const recommended = engine === availability.bestEngine ? "recommended" : "available";
		return `${getVoiceEngineLabel(engine)} (${recommended})`;
	});
	const selectedLabel = await commandContext.ui.select("Choose Pompom's voice engine:", labels);
	if (!selectedLabel) {
		commandContext.ui.notify("Voice setup cancelled.", "info");
		return;
	}
	const selectedIndex = labels.indexOf(selectedLabel);
	const selectedEngine = availability.availableEngines[selectedIndex];
	if (!selectedEngine) {
		commandContext.ui.notify("Could not resolve the selected voice engine.", "error");
		return;
	}
	setVoiceEngine(selectedEngine);
	setVoiceEnabled(true);
	commandContext.ui.notify(`Pompom voice ON (${getVoiceEngineLabel(selectedEngine)}).`, "info");
}

async function switchVoiceEngine(
	commandContext: ExtensionContext,
	engine: "kokoro" | "deepgram" | "elevenlabs",
): Promise<void> {
	const availability = await getVoiceAvailability();
	if (!availability.engines[engine]) {
		commandContext.ui.notify(getVoiceSetupMessage(availability), "warning");
		return;
	}
	setVoiceEngine(engine);
	commandContext.ui.notify(`Switched to ${getVoiceEngineLabel(engine)}. Run /pompom:voice test`, "info");
}

function extractTextContent(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	const texts: string[] = [];
	for (const part of content) {
		if (!isRecord(part)) {
			continue;
		}
		if (part.type !== "text" || typeof part.text !== "string") {
			continue;
		}
		texts.push(part.text);
	}
	return texts.join("\n").trim();
}

function getMessageRole(message: unknown): MessageRole {
	if (!isRecord(message) || typeof message.role !== "string") {
		return "unknown";
	}
	if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
		return message.role;
	}
	return "unknown";
}

function getMessageText(message: unknown): string {
	if (!isRecord(message)) {
		return "";
	}
	return extractTextContent(message.content);
}

function getEventMessage(event: unknown): unknown {
	if (!isRecord(event)) {
		return undefined;
	}
	return event.message;
}

function getToolEventPayload(event: unknown): {
	toolCallId?: string;
	toolName: string;
	isError: boolean;
	result?: unknown;
	args?: unknown;
} {
	if (!isRecord(event)) {
		return { toolName: "tool", isError: false };
	}
	return {
		toolCallId: typeof event.toolCallId === "string" ? event.toolCallId : undefined,
		toolName: typeof event.toolName === "string" && event.toolName.trim() ? event.toolName : "tool",
		isError: event.isError === true,
		result: event.result,
		args: event.args,
	};
}

function isModelLike(model: unknown): model is ModelLike {
	return isRecord(model) && typeof model.id === "string" && typeof model.provider === "string";
}

function createUserMessage(text: string): Message {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

function createAssistantMessage(text: string, model: ModelLike, messageLike: MessageLike): Message {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		model: typeof messageLike.model === "string" ? messageLike.model : model.id,
		provider: typeof messageLike.provider === "string" ? messageLike.provider : model.provider,
		api: typeof messageLike.api === "string" ? messageLike.api : "",
		usage: emptyUsage,
		stopReason: "stop",
		timestamp: typeof messageLike.timestamp === "number" ? messageLike.timestamp : Date.now(),
	};
}

function buildRecentSessionMessages(currentContext: ExtensionContext): Message[] {
	const model = currentContext.model;
	if (!isModelLike(model)) {
		return [];
	}

	const messages: Message[] = [];
	for (const entry of currentContext.sessionManager.getBranch() as SessionEntryLike[]) {
		if (entry.type !== "message" || !isRecord(entry.message)) {
			continue;
		}
		const messageLike = entry.message as MessageLike;
		const role = getMessageRole(messageLike);
		const text = getMessageText(messageLike);
		if (!text) {
			continue;
		}
		if (role === "user") {
			messages.push(createUserMessage(text));
			continue;
		}
		if (role === "assistant") {
			messages.push(createAssistantMessage(text, model, messageLike));
		}
	}

	return messages.slice(-12);
}

function findLatestSerializedState(currentContext: ExtensionContext) {
	let latestState: ReturnType<typeof serializeState> | null = null;
	let latestTimestamp = 0;
	for (const entry of currentContext.sessionManager.getBranch() as SessionEntryLike[]) {
		if (entry.type !== "custom" || entry.customType !== POMPOM_AGENT_STATE_TYPE || !entry.data || !entry.timestamp) {
			continue;
		}
		const timestamp = Date.parse(entry.timestamp) || 0;
		if (timestamp < latestTimestamp) {
			continue;
		}
		latestTimestamp = timestamp;
		latestState = entry.data as ReturnType<typeof serializeState>;
	}
	return latestState;
}

export default function (pi: ExtensionAPI) {
	let ctx: ExtensionContext | null = null;
	let companionTimer: ReturnType<typeof setInterval> | null = null;
	let voiceCheckTimer: ReturnType<typeof setInterval> | null = null;
	let companionActive = false;
	let widgetVisible = true;
	let lastRenderTime = Date.now();
	let terminalInputUnsub: (() => void) | null = null;
	let enabled = true;
	let overlayHint: OverlayHint | null = null;
	let overlayHintUntil = 0;
	let pulseOverlayTimer: ReturnType<typeof setTimeout> | null = null;

	function persistAgentState() {
		try {
			pi.appendEntry(POMPOM_AGENT_STATE_TYPE, serializeState());
		} catch (error) {
			// Non-fatal: agent state persistence is best-effort
		}
	}

	function currentOverlayHint(): OverlayHint | null {
		if (!overlayHint || Date.now() >= overlayHintUntil) {
			return null;
		}
		return overlayHint;
	}

	function applyAgentVisualState() {
		const stats = getSessionStats();
		const hint = currentOverlayHint();
		const overlayActive = Boolean(hint?.forceOverlay || stats.isAgentActive || stats.activeToolCount > 0);
		const glow = hint ? hint.glow : overlayActive ? Math.min(1, 0.35 + stats.activeToolCount * 0.22) : 0;
		const earBoost = hint ? hint.earBoost : overlayActive ? Math.min(1, 0.2 + stats.activeToolCount * 0.18) : 0;
		const lookX = hint ? hint.lookX : overlayActive ? 0.18 : 0;
		const lookY = hint ? hint.lookY : overlayActive ? -0.08 : 0;

		pompomSetAgentOverlay({ active: overlayActive });
		pompomSetAgentLook({ x: lookX, y: lookY });
		pompomSetAntennaGlow({ intensity: glow });
		pompomSetAgentEarBoost({ amount: earBoost });
		pompomSetWeatherOverride({ weather: shouldUseAgentWeather() ? getAgentWeather() : null });
		// Sync agent mood for comfort speech in Pompom's behavioral system
		pompomSetAgentMood(stats.mood);
	}

	function pulseOverlay(hint: OverlayHint, durationMs: number) {
		overlayHint = hint;
		overlayHintUntil = Date.now() + durationMs;
		applyAgentVisualState();
		if (pulseOverlayTimer) clearTimeout(pulseOverlayTimer);
		pulseOverlayTimer = setTimeout(() => {
			pulseOverlayTimer = null;
			if (Date.now() < overlayHintUntil) {
				return;
			}
			overlayHint = null;
			applyAgentVisualState();
		}, durationMs + 80);
	}

	function speakCommentary(request: Parameters<typeof getCommentary>[0]) {
		const commentary = getCommentary(request);
		if (!commentary) {
			applyAgentVisualState();
			return;
		}
		pompomSay(commentary, 4.6, "commentary", 1, true);
		applyAgentVisualState();
	}

	async function runSafely(label: string, fn: () => Promise<void> | void) {
		try {
			await fn();
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.error(`[pompom] ${label} failed: ${msg}`);
		}
	}

	function showVoiceHint() {
		const voiceConfig = getVoiceConfig();
		if (voiceConfig.enabled || voiceConfig.configured || loadedVoiceHintShown || !ctx?.hasUI) {
			return;
		}
		loadedVoiceHintShown = true;
		setTimeout(() => {
			if (ctx?.hasUI) {
				ctx.ui.notify(
					"Tip: Give Pompom a voice! Set ELEVENLABS_API_KEY for the best experience.\n" +
					"ElevenLabs v3 enables emotional audio tags — Pompom laughs, whispers, and sings!\n" +
					"Run /pompom:voice on or /pompom:voice setup to get started.",
					"info"
				);
			}
		}, 5000);
	}

	// ─── Ambient weather sync ─────────────────────────────────────────────
	let ambientWeatherTimer: ReturnType<typeof setInterval> | null = null;
	let loadedAmbientHintShown = false;
	let lastAmbientWeather: string | null = null;
	let wasTTSPlaying = false;

	function startAmbientWeatherSync() {
		stopAmbientWeatherSync();
		// Sync immediately, then poll every 5s (weather changes every 30min+ so this is cheap)
		syncAmbientWeather();
		ambientWeatherTimer = setInterval(syncAmbientWeather, 5000);
	}

	function stopAmbientWeatherSync() {
		if (ambientWeatherTimer) { clearInterval(ambientWeatherTimer); ambientWeatherTimer = null; }
		stopWeatherSfx();
	}

	function syncAmbientWeather() {
		try {
			const weather = pompomGetWeather();
			if (weather !== lastAmbientWeather) {
				lastAmbientWeather = weather;
				void setAmbientWeather(weather);
				startWeatherSfx(); // restart periodic SFX for new weather
			}
			// TTS ducking: duck when TTS starts, unduck when it stops
			const ttsPlaying = isPlayingTTS();
			if (ttsPlaying && !wasTTSPlaying) duckAmbient();
			else if (!ttsPlaying && wasTTSPlaying) unduckAmbient();
			wasTTSPlaying = ttsPlaying;
		} catch {
			// Non-fatal
		}
	}

	function showAmbientHint() {
		if (hasAmbientBeenConfigured() || loadedAmbientHintShown || !ctx?.hasUI) return;
		const ambientConfig = getAmbientConfig();
		if (!ambientConfig.enabled) return;
		loadedAmbientHintShown = true;
		setTimeout(() => {
			if (ctx?.hasUI && process.env.ELEVENLABS_API_KEY) {
				ctx.ui.notify(
					"Ambient sounds are enabled — Pompom will play weather-matching background audio.\n" +
					"Use /pompom:ambient off to disable, or /pompom:ambient volume 0-100 to adjust.",
					"info"
				);
			}
		}, 8000);
	}

	function safeRender(width: number): string[] {
		try {
			const now = Date.now();
			const dt = Math.min(0.1, (now - lastRenderTime) / 1000);
			lastRenderTime = now;
			const piListen = getPiListenState();
			return renderPompom(Math.max(40, width), piListen.audioLevel || 0, dt);
		} catch {
			return [" ".repeat(Math.max(1, width))];
		}
	}

	function showCompanion() {
		if (companionActive || !ctx?.hasUI) {
			return;
		}
		companionActive = true;
		lastRenderTime = Date.now();

		const setWidget = () => {
			if (!ctx?.hasUI) {
				return;
			}
			try {
				ctx.ui.setWidget(WIDGET_ID, (_tui, _theme) => ({
					invalidate() {},
					render: safeRender,
				}), { placement: "aboveEditor" });
			} catch (error) {
				// Non-fatal: defensive catch for widget/UI/lifecycle edge cases
			}
		};

		setWidget();
		if (companionTimer) {
			clearInterval(companionTimer);
		}
		companionTimer = setInterval(setWidget, 150);
		startHealthCheck();

		if (voiceCheckTimer) {
			clearInterval(voiceCheckTimer);
		}
		voiceCheckTimer = setInterval(() => {
			const piListen = getPiListenState();
			const isRecording = piListen.recording === true;
			const isPlaying = isPlayingTTS();
			pompomSetTalking(isRecording || isPlaying);

			if (isPlaying) {
				pompomSetTalkAudioLevel(getTTSAudioLevel());
				return;
			}
			if (isRecording) {
				pompomSetTalkAudioLevel(piListen.audioLevel || 0);
				return;
			}
			pompomSetTalkAudioLevel(0);
		}, 50);
	}

	function hideCompanion() {
		companionActive = false;
		if (companionTimer) {
			clearInterval(companionTimer);
			companionTimer = null;
		}
		if (voiceCheckTimer) {
			clearInterval(voiceCheckTimer);
			voiceCheckTimer = null;
		}
		stopHealthCheck();
		pompomSetTalking(false);
		pompomSetTalkAudioLevel(0);
		pompomSetAgentOverlay({ active: false });
		pompomSetAntennaGlow({ intensity: 0 });
		pompomSetAgentEarBoost({ amount: 0 });
		pompomSetWeatherOverride({ weather: null });
		try {
			if (ctx?.hasUI) {
				ctx.ui.setWidget(WIDGET_ID, undefined);
			}
		} catch (error) {
			// Non-fatal: defensive catch for widget/UI/lifecycle edge cases
		}
	}

	const optionUnicodeMap: Record<string, string> = {
		"π": "p", "ƒ": "f", "∫": "b", "µ": "m", "ç": "c",
		"∂": "d", "ß": "s", "∑": "w", "ø": "o",
		"≈": "x", "†": "t", "˙": "h", "©": "g",
	};

	const POMPOM_KEYS = "pfbmcdswoxthg";

	// Map keyboard letter → pompom action key (for Kitty CSI u sequences)
	// Alt+e sends codepoint 'e', but we need to call pompomKeypress('f') for feed
	const kittyKeyToAction: Record<string, string> = {
		p: "p", e: "f", r: "b", z: "d", u: "h",
		a: "w", t: "t", x: "x", g: "g", s: "s",
		o: "o", c: "c", m: "m",
	};

	function setupKeyHandler() {
		if (!ctx?.hasUI) {
			return;
		}
		if (terminalInputUnsub) {
			terminalInputUnsub();
			terminalInputUnsub = null;
		}

		try {
			terminalInputUnsub = ctx.ui.onTerminalInput((data: string) => {
				if (!enabled || !companionActive) {
					return undefined;
				}
				// Don't intercept keys when chat overlay has focus — let the overlay handle input
				if (chatOverlayHandle && chatOverlayHandle.isFocused()) {
					return undefined;
				}

				try {
					// Fallback: ESC prefix (legacy terminals without Kitty protocol)
					if (data.length === 2 && data[0] === "\x1b" && POMPOM_KEYS.includes(data[1])) {
						pompomKeypress(data[1]);
						return { consume: true };
					}

					const mapped = optionUnicodeMap[data];
					if (mapped) {
						pompomKeypress(mapped);
						return { consume: true };
					}

					const kittyMatch = data.match(/^\x1b\[(\d+);(\d+)u$/);
					if (kittyMatch) {
						const mod = parseInt(kittyMatch[2], 10);
						if ((mod - 1) & 2) { // Alt modifier bit set
							const keyChar = String.fromCharCode(parseInt(kittyMatch[1], 10)).toLowerCase();
							const actionKey = kittyKeyToAction[keyChar];
							if (actionKey) {
								pompomKeypress(actionKey);
								return { consume: true };
							}
						}
					}
				} catch (error) {
					// Non-fatal: defensive catch for widget/UI/lifecycle edge cases
				}

				return undefined;
			});
		} catch (error) {
			// Non-fatal: defensive catch for widget/UI/lifecycle edge cases
		}
	}

	function restoreCompanionState(startContext: ExtensionContext) {
		resetAgentState();
		const latestState = findLatestSerializedState(startContext);
		if (latestState) {
			restoreState(latestState);
		}
		try {
			pompomRestoreAccessories(loadAccessories());
		} catch (error) {
			// Non-fatal: defensive catch for widget/UI/lifecycle edge cases
		}
		applyAgentVisualState();
	}

	async function runPompomAsk(commandArgs: string, commandContext: ExtensionContext) {
		if (aiCommandInProgress) {
			commandContext.ui.notify("Pompom is already working on a request. Please wait.", "warning");
			return;
		}
		aiCommandInProgress = true; // Set IMMEDIATELY to prevent race
		const question = commandArgs.trim();
		if (!question) {
			aiCommandInProgress = false;
			commandContext.ui.notify("Usage: /pompom:ask <question>", "warning");
			return;
		}
		const model = commandContext.model;
		if (!isModelLike(model)) {
			aiCommandInProgress = false;
			commandContext.ui.notify("No model selected", "error");
			return;
		}

		const apiKey = await commandContext.modelRegistry.getApiKey(model);
		if (!apiKey) {
			aiCommandInProgress = false;
			commandContext.ui.notify(`No API key for ${model.provider}/${model.id}`, "error");
			return;
		}

		const stats = getSessionStats();
		const recentMessages = buildRecentSessionMessages(commandContext);
		const promptMessages = [
			...recentMessages,
			createUserMessage(question),
		];
		const thinkingLevel = pi.getThinkingLevel();
		const reasoning = thinkingLevel === "off" ? undefined : thinkingLevel;

		pulseOverlay({ forceOverlay: true, lookX: 0.16, lookY: -0.1, glow: 0.95, earBoost: 0.75 }, 5000);
		pompomSay("Let me think that through.", 4.2, "commentary", 1, true);

		let answer = "";
		let lastBubbleUpdate = 0;

		try {
			const stream = streamSimple(
				model,
				{
					systemPrompt: [
						"You are Pompom, a coding companion living inside Pi CLI.",
						"Answer in plain English with a warm but practical tone.",
						"Be concise, useful, and honest about uncertainty.",
						"Use the session messages as context for the current work.",
						`Current session mood: ${stats.mood}.`,
						`Recent tool calls: ${stats.toolCalls}.`,
					].join("\n"),
					messages: promptMessages,
				},
				{ apiKey, reasoning }
			);

			for await (const event of stream) {
				if (event.type === "text_delta") {
					answer += event.delta;
					const now = Date.now();
					if (now - lastBubbleUpdate > 450 && answer.trim()) {
						lastBubbleUpdate = now;
						const snippet = sanitizeAscii(answer.slice(-100));
						if (snippet) {
							pompomSay(snippet, 4.0, "assistant", 2, true);
						}
					}
					continue;
				}
				if (event.type === "thinking_delta" && !answer) {
					const now = Date.now();
					if (now - lastBubbleUpdate > 900) {
						lastBubbleUpdate = now;
						pompomSay("Thinking through the session...", 3.6, "commentary", 1, true);
					}
					continue;
				}
				if (event.type === "error") {
					throw event.error;
				}
			}

			const finalAnswer = answer.trim();
			if (!finalAnswer) {
				commandContext.ui.notify("Pompom did not return any text.", "warning");
				return;
			}

			pompomSay(sanitizeAscii(finalAnswer.slice(0, 140)), 6.0, "assistant", 3, true);
			commandContext.ui.notify(`Pompom: ${finalAnswer}`, "info");
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			pompomSay("I hit a snag while thinking.", 4.2, "commentary", 2, true);
			commandContext.ui.notify(`pompom:ask error - ${message}`, "error");
		} finally {
			aiCommandInProgress = false;
			overlayHint = null;
			overlayHintUntil = 0;
			applyAgentVisualState();
		}
	}

	async function runPompomRecap(commandContext: ExtensionContext) {
		if (aiCommandInProgress) {
			commandContext.ui.notify("Pompom is already working on a request. Please wait.", "warning");
			return;
		}
		aiCommandInProgress = true; // Set IMMEDIATELY to prevent race
		const model = commandContext.model;
		if (!isModelLike(model)) {
			aiCommandInProgress = false;
			commandContext.ui.notify("No model selected", "error");
			return;
		}

		const apiKey = await commandContext.modelRegistry.getApiKey(model);
		if (!apiKey) {
			aiCommandInProgress = false;
			commandContext.ui.notify(`No API key for ${model.provider}/${model.id}`, "error");
			return;
		}

		const stats = getSessionStats();
		const recentMessages = buildRecentSessionMessages(commandContext);
		if (recentMessages.length === 0) {
			aiCommandInProgress = false;
			commandContext.ui.notify("No session context to recap yet.", "warning");
			return;
		}

		const recapPrompt = [
			"You are Pompom, a coding companion summarizing the current Pi session.",
			"Summarize the recent session in plain English.",
			"Keep it short and useful.",
			"Cover current task, important changes, open risk, and next step.",
			"",
			`Mood: ${stats.mood}`,
			`Agent starts: ${stats.agentStarts}`,
			`Tool calls: ${stats.toolCalls}`,
			`Tool failures: ${stats.toolFailures}`,
			"",
			"<recent-session>",
			recentMessages.map((message) => {
				const text = extractTextContent(message.content);
				return `${message.role.toUpperCase()}: ${text}`;
			}).join("\n\n"),
			"</recent-session>",
		].join("\n");

		pulseOverlay({ forceOverlay: true, lookX: 0.08, lookY: -0.06, glow: 0.8, earBoost: 0.55 }, 3600);
		pompomSay("I am wrapping up the session.", 4.2, "commentary", 1, true);

		try {
			const response = await completeSimple(
				model,
				{
					messages: [createUserMessage(recapPrompt)],
				},
				{ apiKey, reasoning: "low" }
			);

			const summary = extractTextContent(response.content);

			if (!summary) {
				commandContext.ui.notify("Pompom could not build a recap.", "warning");
				return;
			}

			pompomSay(sanitizeAscii(summary.slice(0, 140)), 6.0, "assistant", 3, true);
			commandContext.ui.notify(`Pompom recap:\n${summary}`, "info");
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			pompomSay("Recap failed. I need another try.", 4.2, "commentary", 2, true);
			commandContext.ui.notify(`pompom:recap error - ${message}`, "error");
		} finally {
			aiCommandInProgress = false;
			overlayHint = null;
			overlayHintUntil = 0;
			applyAgentVisualState();
		}
	}

	pi.on("session_start", async (_event, startCtx) => {
		await runSafely("session_start", async () => {
			ctx = startCtx;
			loadedVoiceHintShown = false;
			initVoice(Boolean(startCtx.hasUI));
			initAmbient(Boolean(startCtx.hasUI));
			pompomOnSpeech((event: SpeechEvent) => {
				if (event.allowTts) {
					enqueueSpeech(event);
				}
			});
			pompomOnSfx((sfx) => { void playSfx(sfx as SfxName); });
			restoreCompanionState(startCtx);
			if (enabled) {
				showCompanion();
				setupKeyHandler();
				startAmbientWeatherSync();
			}
			showVoiceHint();
			showAmbientHint();
		});
	});

	pi.on("session_shutdown", async () => {
		await runSafely("session_shutdown", () => {
			persistAgentState();
			setAgentBusy(false);
			stopPlayback();
			stopAmbient();
			stopAmbientWeatherSync();
			if (pulseOverlayTimer) { clearTimeout(pulseOverlayTimer); pulseOverlayTimer = null; }
			chatOverlayHandle = null;
			pompomOnSpeech(null);
			pompomOnSfx(null);
			hideCompanion();
			resetPompom();
			resetAgentState();
			if (terminalInputUnsub) {
				terminalInputUnsub();
				terminalInputUnsub = null;
			}
		});
	});

	pi.on("session_switch", async (_event, switchCtx) => {
		await runSafely("session_switch", () => {
			persistAgentState();
			setAgentBusy(false);
			stopPlayback();
			stopAmbient();
			stopAmbientWeatherSync();
			if (pulseOverlayTimer) { clearTimeout(pulseOverlayTimer); pulseOverlayTimer = null; }
			chatOverlayHandle = null;
			hideCompanion();
			resetPompom();
			ctx = switchCtx;
			loadedVoiceHintShown = false;
			initVoice(Boolean(switchCtx.hasUI));
			initAmbient(Boolean(switchCtx.hasUI));
			pompomOnSpeech((event: SpeechEvent) => {
				if (event.allowTts) {
					enqueueSpeech(event);
				}
			});
			pompomOnSfx((sfx) => { void playSfx(sfx as SfxName); });
			restoreCompanionState(switchCtx);
			if (enabled) {
				showCompanion();
				setupKeyHandler();
				startAmbientWeatherSync();
			}
			showVoiceHint();
			showAmbientHint();
		});
	});

	pi.on("agent_start", async () => {
		await runSafely("agent_start", () => {
			onAgentStart();
			setAgentBusy(true);
			pulseOverlay({ forceOverlay: true, lookX: 0.2, lookY: -0.1, glow: 0.92, earBoost: 0.7 }, 2600);
			speakCommentary({ eventName: "agent_start" });
			persistAgentState();
		});
	});

	pi.on("agent_end", async () => {
		await runSafely("agent_end", () => {
			onAgentEnd();
			setAgentBusy(false);
			pulseOverlay({ forceOverlay: true, lookX: 0.06, lookY: -0.04, glow: 0.75, earBoost: 0.45 }, 2200);
			speakCommentary({ eventName: "agent_end" });
			persistAgentState();
		});
	});

	pi.on("tool_execution_start", async (event) => {
		await runSafely("tool_execution_start", () => {
			const payload = getToolEventPayload(event);
			onToolCall({ toolCallId: payload.toolCallId, toolName: payload.toolName, args: payload.args });
			pulseOverlay({ forceOverlay: true, lookX: 0.24, lookY: -0.12, glow: 1, earBoost: 0.85 }, 1800);
			speakCommentary({ eventName: "tool_call", toolName: payload.toolName });
			persistAgentState();
		});
	});

	pi.on("tool_execution_end", async (event) => {
		await runSafely("tool_execution_end", () => {
			const payload = getToolEventPayload(event);
			onToolResult({
				toolCallId: payload.toolCallId,
				toolName: payload.toolName,
				isError: payload.isError,
				result: payload.result,
			});
			pulseOverlay({
				forceOverlay: true,
				lookX: payload.isError ? -0.14 : 0.14,
				lookY: -0.08,
				glow: payload.isError ? 0.95 : 0.72,
				earBoost: payload.isError ? 0.5 : 0.3,
			}, 1800);
			speakCommentary({ eventName: "tool_result", toolName: payload.toolName, isError: payload.isError });
			persistAgentState();
		});
	});

	pi.on("message_start", async (event) => {
		await runSafely("message_start", () => {
			const role = getMessageRole(getEventMessage(event));
			if (role === "user") {
				pulseOverlay({ forceOverlay: true, lookX: -0.1, lookY: 0, glow: 0.38, earBoost: 0.25 }, 1200);
			}
			if (role === "assistant") {
				pulseOverlay({ forceOverlay: true, lookX: 0.12, lookY: -0.08, glow: 0.55, earBoost: 0.35 }, 1400);
			}
			speakCommentary({ eventName: "message_start", role });
		});
	});

	pi.on("message_end", async (event) => {
		await runSafely("message_end", () => {
			const message = getEventMessage(event);
			const role = getMessageRole(message);
			// Don't mirror assistant text as Pompom speech — that causes double-speak
			speakCommentary({ eventName: "message_end", role });
			persistAgentState();
		});
	});

	const pompomCommands: Record<string, string> = {
		pet: "p",
		feed: "f",
		ball: "b",
		music: "m",
		color: "c",
		theme: "c",
		sleep: "s",
		wake: "w",
		flip: "d",
		hide: "o",
		dance: "x",
		treat: "t",
		hug: "h",
		game: "g",
	};

	// Keyboard shortcuts — only keys NOT claimed by Pi's editor
	// Conflicts: alt+b(wordLeft) alt+f(wordRight) alt+d(deleteWord) alt+h(cursorLeft)
	//            alt+j(down) alt+k(up) alt+l(right) alt+w(wordRight) alt+y(yank)
	const shortcutDescriptions: Record<string, string> = {
		p: "Pet Pompom",
		f: "Feed Pompom",
		b: "Throw ball",
		d: "Do a flip",
		h: "Hug Pompom",
		w: "Wake Pompom",
		t: "Give treat",
		x: "Dance",
		g: "Play game",
		s: "Sleep",
		o: "Hide Pompom",
		c: "Cycle color",
		m: "Play music",
	};
	const shortcutActions: [string, string][] = [
		["alt+p", "p"],  // Pet
		["alt+e", "f"],  // Eat (feed)
		["alt+r", "b"],  // thRow (ball)
		["alt+z", "d"],  // Zoom flip
		["alt+u", "h"],  // hUg
		["alt+a", "w"],  // Awake (wake)
		["alt+t", "t"],  // Treat
		["alt+x", "x"],  // Dance
		["alt+g", "g"],  // Game
		["alt+s", "s"],  // Sleep
		["alt+o", "o"],  // Hide
		["alt+c", "c"],  // Color
		["alt+m", "m"],  // Music
	];
	for (const [shortcut, key] of shortcutActions) {
		try {
			pi.registerShortcut(shortcut as any, {
				description: shortcutDescriptions[key] || `Pompom: ${key}`,
				handler: async () => {
					if (!enabled || !companionActive) return;
					pompomKeypress(key);
					const sfxMap: Record<string, SfxName> = {
						p: "pet_purr", f: "eat_crunch", t: "eat_crunch",
						b: "ball_bounce", h: "hug_squeeze", s: "sleep_snore",
						w: "wake_yawn", x: "dance_sparkle", m: "dance_sparkle",
						d: "flip_whoosh", c: "color_switch", g: "game_start",
					};
					if (sfxMap[key]) void playSfx(sfxMap[key]);
				},
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[pompom] registerShortcut ${shortcut} failed: ${msg}`);
		}
	}

	// Toggle widget visibility — hides animation but keeps voice/health/agent tracking alive
	function toggleWidget() {
		if (!enabled) return;
		if (widgetVisible) {
			widgetVisible = false;
			companionActive = false;
			// Stop the render loop and remove widget, but keep voice/health/agent timers running
			if (companionTimer) {
				clearInterval(companionTimer);
				companionTimer = null;
			}
			pauseAmbient();
			try {
				if (ctx?.hasUI) {
					ctx.ui.setWidget(WIDGET_ID, undefined);
				}
			} catch {
				// Non-fatal: defensive catch for widget/UI/lifecycle edge cases
			}
		} else {
			widgetVisible = true;
			resumeAmbient();
			if (companionActive) {
				showCompanion();
			}
		}
	}

	try {
		pi.registerShortcut("alt+v" as any, {
			description: "Toggle Pompom view",
			handler: async () => { toggleWidget(); },
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[pompom] registerShortcut alt+v failed: ${msg}`);
	}

	// Interactive settings panel — full TUI overlay with arrow-key navigation
	pi.registerCommand("pompom-settings", {
		description: "Pompom settings — interactive panel [←→ tabs, ↑↓ navigate, Enter select]",
		handler: async (_args, cmdCtx) => {
			await runSafely("pompom-settings", async () => {
				ctx = cmdCtx;
				const { openPompomSettings } = await import("./pompom-settings");
				await openPompomSettings(cmdCtx, {
					pompomEnabled: enabled,
					onTogglePompom: (on) => {
						if (on) {
							enabled = true;
							setVoiceEnabled(true);
							setAmbientEnabled(true);
							showCompanion();
							setupKeyHandler();
							startAmbientWeatherSync();
						} else {
							enabled = false;
							hideCompanion();
							stopAmbient();
							stopAmbientWeatherSync();
							stopPlayback();
							setVoiceEnabled(false);
							setAmbientEnabled(false);
							if (terminalInputUnsub) { terminalInputUnsub(); terminalInputUnsub = null; }
						}
					},
				});
			});
		},
	});

	pi.registerCommand("pompom", {
		description: "Pompom companion — /pompom help for commands",
		handler: async (args, commandContext) => {
			await runSafely("pompom command", async () => {
				ctx = commandContext;
				const sub = (args || "").trim().toLowerCase();

				if (sub === "on") {
					enabled = true;
					setVoiceEnabled(true);
					setAmbientEnabled(true);
					showCompanion();
					setupKeyHandler();
					startAmbientWeatherSync();
					commandContext.ui.notify("Pompom on — animation, voice, ambient, everything restored!", "info");
					return;
				}

				if (sub === "off" || sub === "quiet" || sub === "zen" || sub === "mute") {
					enabled = false;
					hideCompanion();
					stopAmbient();
					stopAmbientWeatherSync();
					stopPlayback();
					setVoiceEnabled(false);
					setAmbientEnabled(false);
					resetPompom();
					if (terminalInputUnsub) {
						terminalInputUnsub();
						terminalInputUnsub = null;
					}
					commandContext.ui.notify(
						"Pompom off — animation, voice, and sounds all disabled.\n" +
						"Side chat is still available: /pompom:chat or Alt+/\n" +
						"To restore everything: /pompom on",
						"info"
					);
					return;
				}

				if (sub === "toggle") {
					toggleWidget();
					commandContext.ui.notify(
						widgetVisible ? "Pompom view restored." : "Pompom view hidden (voice & tracking still active).",
						"info"
					);
					return;
				}

				if (sub === "help" || sub === "?") {
					const modifier = process.platform === "darwin" ? "⌥" : "Alt+";
					commandContext.ui.notify(
						`Pompom Commands\n` +
						`  /pompom on           Everything on\n` +
						`  /pompom off          Everything off (chat stays)\n` +
						`  /pompom toggle       Toggle view         ${modifier}v\n` +
						`  /pompom pet          Pet Pompom          ${modifier}p\n` +
						`  /pompom feed         Drop food            ${modifier}e\n` +
						`  /pompom treat        Special treat       ${modifier}t\n` +
						`  /pompom hug          Give a hug          ${modifier}u\n` +
						`  /pompom ball         Throw a ball        ${modifier}r\n` +
						`  /pompom dance        Dance               ${modifier}x\n` +
						`  /pompom music        Sing a song         ${modifier}m\n` +
						`  /pompom flip         Do a flip           ${modifier}z\n` +
						`  /pompom sleep        Nap time            ${modifier}s\n` +
						`  /pompom wake         Wake up             ${modifier}a\n` +
						`  /pompom theme        Cycle color         ${modifier}c\n` +
						`  /pompom hide         Wander off          ${modifier}o\n` +
						`  /pompom game         Catch the stars     ${modifier}g\n` +
						`  /pompom status       Check mood and stats\n` +
						`  /pompom give <item>  Give umbrella, scarf, sunglasses, or hat\n` +
						`  /pompom inventory    See Pompom's bag\n` +
						`  /pompom:voice        Voice on|off|setup|kokoro|deepgram|elevenlabs|test\n` +
						`  /pompom:ask <q>      Ask Pompom about the session\n` +
						`  /pompom:recap        Summarize the session\n` +
						`  /pompom:agents       Agent status dashboard\n` +
						`  /pompom:stuck        Check if agent is stuck\n` +
						`  /pompom:analyze      AI session analysis\n` +
						`  /pompom:ambient      Weather ambient sounds — on|off|volume\n` +
						`  /pompom-settings     Interactive settings panel`,
						"info"
					);
					return;
				}

				if (sub === "status") {
					if (!companionActive) {
						commandContext.ui.notify("Pompom is not active. Use /pompom on first.", "info");
						return;
					}
					const status = pompomStatus();
					const agentStats = getSessionStats();
					const bar = (value: number) => "█".repeat(Math.round(value / 10)) + "░".repeat(10 - Math.round(value / 10));
					commandContext.ui.notify(
						`Pompom Status\n` +
						`  Mood:   ${status.mood}\n` +
						`  Hunger: ${bar(status.hunger)} ${status.hunger}%\n` +
						`  Energy: ${bar(status.energy)} ${status.energy}%\n` +
						`  Theme:  ${status.theme}\n` +
						`  Agent:  ${agentStats.mood}\n` +
						`  Tools:  ${agentStats.toolCalls} total, ${agentStats.activeToolCount} active`,
						"info"
					);
					return;
				}

				if (sub.startsWith("give ") || sub.startsWith("give\t")) {
					const item = sub.slice(5).trim();
					if (!item) {
						commandContext.ui.notify("Usage: /pompom give <umbrella|scarf|sunglasses|hat>", "info");
						return;
					}
					const result = pompomGiveAccessory(item);
					saveAccessories();
					if (!result.startsWith("Unknown")) void playSfx("accessory_equip");
					commandContext.ui.notify(result, "info");
					return;
				}

				if (sub === "inventory" || sub === "inv") {
					const accessories = pompomGetAccessories();
					const items = Object.entries(accessories)
						.filter(([, value]) => value)
						.map(([key]) => key);
					commandContext.ui.notify(
						items.length
							? `Pompom's bag: ${items.join(", ")}`
							: "Pompom has no accessories yet. Try /pompom give umbrella",
						"info"
					);
					return;
				}

				if (pompomCommands[sub]) {
					if (!companionActive) {
						enabled = true;
						showCompanion();
						setupKeyHandler();
					}
					const actionKey = pompomCommands[sub];
					pompomKeypress(actionKey);
					const sfxMap: Record<string, SfxName> = {
						p: "pet_purr", f: "eat_crunch", t: "eat_crunch",
						b: "ball_bounce", h: "hug_squeeze", s: "sleep_snore",
						w: "wake_yawn", x: "dance_sparkle", m: "dance_sparkle",
						d: "flip_whoosh", c: "color_switch", g: "game_start",
					};
					if (sfxMap[actionKey]) void playSfx(sfxMap[actionKey]);
					return;
				}

				if (sub === "") {
					if (companionActive) {
						enabled = false;
						hideCompanion();
						resetPompom();
						commandContext.ui.notify("Pompom companion hidden.", "info");
					} else {
						enabled = true;
						showCompanion();
						setupKeyHandler();
						commandContext.ui.notify("Pompom companion enabled. Use /pompom help for commands.", "info");
					}
					return;
				}

				commandContext.ui.notify(`Unknown command: ${sub}. Try /pompom help`, "warning");
			});
		},
	});

	pi.registerCommand("pompom:ask", {
		description: "Ask Pompom about the current session using the selected model",
		handler: async (args, commandContext) => {
			await runSafely("pompom:ask", async () => {
				ctx = commandContext;
				await runPompomAsk(args, commandContext);
			});
		},
	});

	pi.registerCommand("pompom:voice", {
		description: "Manage Pompom's voice - on/off/setup/kokoro/deepgram/elevenlabs/test",
		handler: async (args, commandContext) => {
			await runSafely("pompom:voice", async () => {
				ctx = commandContext;
				const sub = (args || "").trim().toLowerCase();
				if (sub === "on") {
					await enableAutoDetectedVoice(commandContext);
					return;
				}
				if (sub === "off") {
					setVoiceEnabled(false);
					stopPlayback();
					commandContext.ui.notify("Pompom voice disabled.", "info");
					return;
				}
				if (sub === "setup") {
					await runVoiceSetup(commandContext);
					return;
				}
				if (sub === "kokoro") {
					await switchVoiceEngine(commandContext, "kokoro");
					return;
				}
				if (sub === "deepgram") {
					await switchVoiceEngine(commandContext, "deepgram");
					return;
				}
				if (sub === "elevenlabs" || sub === "eleven" || sub === "11labs") {
					await switchVoiceEngine(commandContext, "elevenlabs");
					return;
				}
				if (sub === "test") {
					speakTest();
					commandContext.ui.notify("Speaking test phrase...", "info");
					return;
				}
				if (sub === "voices") {
					const voiceConfig = getVoiceConfig();
					const catalog = getVoiceCatalog();
					const engineVoices = catalog[voiceConfig.engine] || [];
					const currentVoice = voiceConfig.engine === "kokoro" ? voiceConfig.kokoroVoice
						: voiceConfig.engine === "elevenlabs" ? voiceConfig.elevenlabsVoice
						: voiceConfig.deepgramVoice;
					const list = engineVoices.map(v =>
						`  ${v.id === currentVoice ? ">" : " "} ${v.name} (${v.id})`
					).join("\n");
					commandContext.ui.notify(
						`Voices for ${voiceConfig.engine}:\n${list}\n\nChange: /pompom:voice set <voice-id>`,
						"info",
					);
					return;
				}
				if (sub.startsWith("set ")) {
					const voiceId = sub.slice(4).trim();
					if (!voiceId) {
						commandContext.ui.notify("Usage: /pompom:voice set <voice-id>", "info");
						return;
					}
					setVoice(voiceId);
					commandContext.ui.notify(`Voice set to: ${voiceId}. Run /pompom:voice test to hear it.`, "info");
					return;
				}
				const personalityOptions = ["quiet", "normal", "chatty", "professional", "mentor", "zen"];
				if (personalityOptions.includes(sub)) {
					setPersonality(sub as Personality);
					const labels: Record<string, string> = {
						quiet: "Quiet — user actions + errors only",
						normal: "Normal — moderate, casual",
						chatty: "Chatty — frequent commentary",
						professional: "Professional — errors, milestones, direct actions",
						mentor: "Mentor — guides on errors and completions",
						zen: "Zen — near-silent, speaks only when addressed",
					};
					commandContext.ui.notify(`Personality: ${labels[sub]}`, "info");
					return;
				}
				if (sub === "personality") {
					const voiceConfig = getVoiceConfig();
					commandContext.ui.notify(
						`Personality: ${voiceConfig.personality}\n\n` +
						"  /pompom:voice quiet          user actions + errors only\n" +
						"  /pompom:voice normal         moderate, casual\n" +
						"  /pompom:voice chatty         frequent commentary\n" +
						"  /pompom:voice professional   errors, milestones, direct actions\n" +
						"  /pompom:voice mentor         guides on errors and completions\n" +
						"  /pompom:voice zen            near-silent, only when addressed",
						"info",
					);
					return;
				}
				if (sub.startsWith("volume ") || sub.startsWith("vol ")) {
					const val = parseInt(sub.split(" ")[1]);
					if (isNaN(val) || val < 0 || val > 100) {
						commandContext.ui.notify("Usage: /pompom:voice volume 0-100", "warning");
						return;
					}
					setVolume(val);
					commandContext.ui.notify(`Volume: ${val}%`, "info");
					return;
				}
				if (sub === "volume" || sub === "vol") {
					commandContext.ui.notify(`Volume: ${getVoiceConfig().volume}%\n  /pompom:voice volume <0-100>`, "info");
					return;
				}

				const voiceConfig = getVoiceConfig();
				const voiceName = voiceConfig.engine === "kokoro" ? voiceConfig.kokoroVoice
					: voiceConfig.engine === "elevenlabs" ? voiceConfig.elevenlabsVoice
					: voiceConfig.deepgramVoice;
				commandContext.ui.notify(
					"Pompom Voice\n" +
					"  Status:      " + (voiceConfig.enabled ? "ON" : "OFF") + "\n" +
					"  Engine:      " + getVoiceEngineLabel(voiceConfig.engine) + "\n" +
					"  Voice:       " + voiceName + "\n" +
					"  Personality: " + voiceConfig.personality + "\n" +
					"  /pompom:voice on|off|setup|test\n" +
					"  /pompom:voice kokoro|deepgram|elevenlabs\n" +
					"  /pompom:voice voices|set <id>\n" +
					"  /pompom:voice quiet|normal|chatty",
					"info",
				);
			});
		},
	});

	pi.registerCommand("pompom:ambient", {
		description: "Ambient weather sounds — on/off/volume/pregenerate",
		handler: async (args, commandContext) => {
			await runSafely("pompom:ambient", async () => {
				ctx = commandContext;
				const sub = (args || "").trim().toLowerCase();

				if (sub === "on") {
					setAmbientEnabled(true);
					startAmbientWeatherSync();
					commandContext.ui.notify("Ambient sounds enabled. Weather audio will play in the background.", "info");
					return;
				}

				if (sub === "off") {
					setAmbientEnabled(false);
					stopAmbientWeatherSync();
					commandContext.ui.notify("Ambient sounds disabled.", "info");
					return;
				}

				if (sub.startsWith("volume ") || sub.startsWith("vol ")) {
					const val = parseInt(sub.split(" ")[1]);
					if (isNaN(val) || val < 0 || val > 100) {
						commandContext.ui.notify("Usage: /pompom:ambient volume 0-100", "warning");
						return;
					}
					setAmbientVolume(val);
					commandContext.ui.notify(`Ambient volume: ${val}%`, "info");
					return;
				}

				if (sub === "volume" || sub === "vol") {
					commandContext.ui.notify(`Ambient volume: ${getAmbientVolume()}%\n  /pompom:ambient volume <0-100>`, "info");
					return;
				}

				if (sub === "pregenerate" || sub === "pregen" || sub === "cache") {
					commandContext.ui.notify("Generating ambient audio for all weather types... this may take a minute.", "info");
					const count = await pregenerateAll();
					const cached = getCachedWeathers();
					commandContext.ui.notify(
						`Generated ${count} new ambient tracks. Cached: ${cached.join(", ")}`,
						"info"
					);
					return;
				}

				if (sub === "reset" || sub === "regenerate") {
					const deleted = resetGeneratedAudio();
					commandContext.ui.notify(
						`Deleted ${deleted} generated audio files. They'll regenerate on next weather change.\n` +
						`Custom files in ${getCustomAudioDir()} are preserved.`,
						"info"
					);
					return;
				}

				if (sub === "folder" || sub === "dir" || sub === "path") {
					const customDir = getCustomAudioDir();
					const custom = getCustomWeathers();
					commandContext.ui.notify(
						`Custom audio folder:\n  ${customDir}\n\n` +
						`Drop your own ambient loops here as:\n` +
						`  clear.mp3   cloudy.mp3   rain.mp3   snow.mp3   storm.mp3\n\n` +
						`Supports: .mp3 .m4a .wav .aac .aiff .flac .ogg\n` +
						`Custom files override AI-generated ones.\n` +
						(custom.length > 0
							? `\nCustom files found: ${custom.join(", ")}`
							: "\nNo custom files found yet."),
						"info"
					);
					return;
				}

				// Default: show status
				const ambientConfig = getAmbientConfig();
				const cached = getCachedWeathers();
				const custom = getCustomWeathers();
				const hasKey = Boolean(process.env.ELEVENLABS_API_KEY);
				commandContext.ui.notify(
					"Pompom Ambient\n" +
					`  Status:   ${ambientConfig.enabled ? "ON" : "OFF"}\n` +
					`  Volume:   ${ambientConfig.volume}%\n` +
					`  Playing:  ${isAmbientPlaying() ? "yes" : "no"}\n` +
					`  Cached:   ${cached.length > 0 ? cached.join(", ") : "none"}\n` +
					`  Custom:   ${custom.length > 0 ? custom.join(", ") : "none"}\n` +
					`  API key:  ${hasKey ? "set" : "missing (ELEVENLABS_API_KEY)"}\n\n` +
					"  /pompom:ambient on|off\n" +
					"  /pompom:ambient volume <0-100>\n" +
					"  /pompom:ambient pregenerate   Generate all 5 sounds\n" +
					"  /pompom:ambient reset         Delete generated, regenerate fresh\n" +
					"  /pompom:ambient folder         Show custom audio folder path",
					"info"
				);
			});
		},
	});

	pi.registerCommand("pompom:recap", {
		description: "Ask Pompom for a concise recap of the current session",
		handler: async (_args, commandContext) => {
			await runSafely("pompom:recap", async () => {
				ctx = commandContext;
				await runPompomRecap(commandContext);
			});
		},
	});

	// ─── Agent Intelligence Commands ────────────────────────────────

	pi.registerCommand("pompom:agents", {
		description: "Agent status dashboard — current tools, timing, success rate",
		handler: async (_args, commandContext) => {
			await runSafely("pompom:agents", () => {
				ctx = commandContext;
				const dashboard = getAgentDashboard();
				pompomSay("Here is what I see.", 3.0, "commentary", 1, true);
				commandContext.ui.notify("Agent Dashboard\n\n" + dashboard, "info");
			});
		},
	});

	pi.registerCommand("pompom:stuck", {
		description: "Check if the agent seems stuck in a loop or error pattern",
		handler: async (_args, commandContext) => {
			await runSafely("pompom:stuck", () => {
				ctx = commandContext;
				const signal = detectStuck();
				if (signal.isStuck) {
					const body = signal.reasons.map(r => "  - " + r).join("\n");
					pompomSay("Something looks off.", 4.0, "commentary", 2, true);
					commandContext.ui.notify(
						"Stuck Detection\n\n" +
						`Confidence: ${Math.round(signal.confidence * 100)}%\n\n` +
						"Issues:\n" + body + "\n\n" +
						"Suggestion: " + signal.suggestion,
						"warning",
					);
				} else {
					pompomSay("Everything looks smooth.", 3.0, "commentary", 1, true);
					commandContext.ui.notify("Stuck Detection\n\nNo stuck patterns detected. Session looks healthy.", "info");
				}
			});
		},
	});

	pi.registerCommand("pompom:analyze", {
		description: "AI-powered session analysis — error patterns, approach assessment, recommendations",
		handler: async (_args, commandContext) => {
			await runSafely("pompom:analyze", async () => {
				ctx = commandContext;
				const model = commandContext.model;
				if (!isModelLike(model)) {
					commandContext.ui.notify("No model selected.", "error");
					return;
				}
				const apiKey = await commandContext.modelRegistry.getApiKey(model);
				if (!apiKey) {
					commandContext.ui.notify("No API key for " + model.provider + "/" + model.id, "error");
					return;
				}

				const stats = getSessionStats();
				const stuck = detectStuck();
				const active = getActiveToolDetails();
				const recentMessages = buildRecentSessionMessages(commandContext);
				const total = stats.toolSuccesses + stats.toolFailures;
				const errorRate = total > 0 ? Math.round((stats.toolFailures / total) * 100) : 0;

				const prompt = [
					"You are Pompom, analyzing a Pi CLI coding session. Be direct and concise.",
					"",
					"Analyze and provide:",
					"1. ERROR PATTERNS: What errors are recurring?",
					"2. APPROACH: Is the current strategy working or spinning?",
					"3. EFFICIENCY: Are tools being used effectively?",
					"4. RECOMMENDATIONS: Concrete next steps (try different approach? break into smaller tasks? switch models? ask user for context?)",
					"",
					"<session-stats>",
					"Mood: " + stats.mood,
					"Agent starts: " + stats.agentStarts,
					"Tool calls: " + stats.toolCalls + " (" + stats.toolSuccesses + " ok, " + stats.toolFailures + " fail)",
					"Error rate: " + errorRate + "%",
					"Avg tool duration: " + stats.averageToolDurationMs + "ms",
					"Stuck signal: " + (stuck.isStuck ? "YES (" + stuck.reasons.join("; ") + ")" : "no"),
					"Active tools: " + active.map(t => t.toolName + " " + Math.round(t.durationMs / 1000) + "s").join(", "),
					"</session-stats>",
					"",
					"<recent-session>",
					recentMessages.map(m => {
						const text = extractTextContent(m.content);
						return m.role.toUpperCase() + ": " + text.slice(0, 200);
					}).join("\n\n"),
					"</recent-session>",
				].join("\n");

				pulseOverlay({ forceOverlay: true, lookX: 0.1, lookY: -0.08, glow: 0.85, earBoost: 0.6 }, 5000);
				pompomSay("Analyzing the session...", 3.0, "commentary", 1, true);

				try {
					const response = await completeSimple(
						model,
						{ messages: [createUserMessage(prompt)] },
						{ apiKey, reasoning: "low" },
					);
					const analysis = extractTextContent(response.content);
					if (analysis) {
						pompomSay(sanitizeAscii(analysis.slice(0, 120)), 6.0, "assistant", 3, true);
						commandContext.ui.notify("Session Analysis\n\n" + analysis, "info");
					} else {
						commandContext.ui.notify("Could not generate analysis.", "warning");
					}
				} catch (err: any) {
					const msg = err instanceof Error ? err.message : "Unknown error";
					pompomSay("Analysis hit a snag.", 3.0, "commentary", 2, true);
					commandContext.ui.notify("pompom:analyze error - " + msg, "error");
				} finally {
					overlayHint = null;
					overlayHintUntil = 0;
					applyAgentVisualState();
				}
			});
		},
	});

	// Background health check — proactive stuck detection (no AI, pure heuristics)
	let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
	let lastProactiveAlertAt = 0;

	function startHealthCheck() {
		if (healthCheckTimer) clearInterval(healthCheckTimer);
		healthCheckTimer = setInterval(() => {
			try {
				if (!enabled || !companionActive) return;
				const stats = getSessionStats();
				if (!stats.isAgentActive) return;
				const signal = detectStuck();
				if (!signal.isStuck || signal.confidence < 0.5) return;
				const now = Date.now();
				if (now - lastProactiveAlertAt < 180_000) return; // max 1 per 3 min
				lastProactiveAlertAt = now;
				const lines = [
					"Looks like we might be going in circles...",
					"I am seeing a pattern. Same errors repeating.",
					"This seems stuck. Want to try a different approach?",
					"The agent might need a nudge.",
				];
				pompomSay(lines[Math.floor(Math.random() * lines.length)], 5.0, "commentary", 2, true);
			} catch {
				// Non-fatal: health check is best-effort
			}
		}, 60_000);
	}

	function stopHealthCheck() {
		if (healthCheckTimer) { clearInterval(healthCheckTimer); healthCheckTimer = null; }
	}

	// ─── Pompom Side Chat ───────────────────────────────────────────

	const CHAT_SHORTCUT = "alt+/";
	let chatOverlayHandle: { focus: () => void; unfocus: () => void; isFocused: () => boolean } | null = null;
	let chatOpenInProgress = false;
	let aiCommandInProgress = false;

	pi.registerCommand("pompom:chat", {
		description: "Open Pompom side chat — parallel agent with read-only tools",
		handler: async (_args, commandContext) => {
			await runSafely("pompom:chat", async () => {
				ctx = commandContext;
				if (chatOverlayHandle) {
					if (chatOverlayHandle.isFocused()) chatOverlayHandle.unfocus();
					else chatOverlayHandle.focus();
					return;
				}
				await openPompomChat(commandContext);
			});
		},
	});

	try {
		pi.registerShortcut(CHAT_SHORTCUT as any, {
			description: "Toggle Pompom side chat",
			handler: async (shortcutCtx: any) => {
				if (chatOverlayHandle) {
					if (chatOverlayHandle.isFocused()) chatOverlayHandle.unfocus();
					else chatOverlayHandle.focus();
				} else {
					await openPompomChat(shortcutCtx);
				}
			},
		});
	} catch { /* silent — shortcut may already exist */ }

	async function openPompomChat(commandContext: ExtensionContext) {
		if (chatOpenInProgress || chatOverlayHandle) return;
		if (!commandContext.hasUI) return;
		if (!isModelLike(commandContext.model)) {
			commandContext.ui.notify("Cannot open chat: no model configured.", "error");
			return;
		}
		chatOpenInProgress = true;

		try {
			const { PompomChatOverlay } = await import("./pompom-chat");
			const thinkingLevel = pi.getThinkingLevel();

			await commandContext.ui.custom(
				(tui: any, theme: any, _kb: any, done: (v?: any) => void) => {
					const overlay = new PompomChatOverlay({
						tui,
						theme,
						model: commandContext.model as any,
						cwd: commandContext.cwd,
						thinkingLevel: (thinkingLevel === "off" ? "off" : thinkingLevel) as any,
						modelRegistry: commandContext.modelRegistry,
						sessionManager: commandContext.sessionManager as any,
						shortcut: CHAT_SHORTCUT,
						onUnfocus: () => chatOverlayHandle?.unfocus(),
						onClose: () => {
							chatOverlayHandle = null;
							done();
						},
					});
					return overlay;
				},
				{
					overlay: true,
					overlayOptions: {
						width: "92%" as any,
						maxHeight: "60%" as any,
						anchor: "center" as any,
						margin: { top: 0, left: 1, right: 1 } as any,
						nonCapturing: true,
					},
					onHandle: (handle: any) => {
						chatOverlayHandle = handle;
						handle.focus();
					},
				},
			);
		} catch (err) {
			chatOverlayHandle = null;
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[pompom] openPompomChat failed: ${msg}`);
		} finally {
			chatOpenInProgress = false;
		}
	}
}
