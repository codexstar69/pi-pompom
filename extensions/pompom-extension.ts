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
import os from "node:os";
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
	pompomOnEmotionalState,
	pompomStatus,
	renderPompom,
	resetPompom,
	initSessionCount,
	pompomClearParticles,
} from "./pompom";
import * as pompomModule from "./pompom";
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
	duckAmbientForSleep,
	unduckAmbientForSleep,
	setMoodSfxState,
	pauseAmbient,
	resumeAmbient,
	stopAmbient,
	pregenerateAll,
	resetGeneratedAudio,
	getCachedWeathers,
	getCustomWeathers,
	isAmbientPlaying,
	isAmbientPlaybackBlocked,
	getCustomAudioDir,
	playSfx,
	startWeatherSfx,
	stopWeatherSfx,
	pregenerateSfx,
	setMicSilence,
	setMoodSfxEnabled,
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
	getPompomModel,
	setMicRecording,
	setVoiceEnabled,
	setVoiceEngine,
	setAgentBusy,
	setPersonality,
	setVoice,
	setVolume,
	getVoiceCatalog,
	speakTest,
	stopPlayback,
	playDemoLine,
	isDemoCached,
	type SpeechEvent,
	type Personality,
} from "./pompom-voice";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { installPompomFooter } from "./pompom-footer";
import {
	registerInstance,
	deregisterInstance,
	getInstancePersistenceKey,
	isPrimaryInstance,
	getOtherInstances,
	getInstanceCount,
	markGreeting,
} from "./pompom-instance";
import {
	isGlimpseAvailable,
	isWindowEnabled,
	openNativeWindow,
	closeNativeWindow,
	toggleNativeWindow,
} from "./pompom-glimpse";

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
	toolCallId?: string;
	toolName?: string;
	details?: unknown;
	isError?: boolean;
}

interface OverlayHint {
	forceOverlay: boolean;
	lookX: number;
	lookY: number;
	glow: number;
	earBoost: number;
}

const SAVE_DIR = path.join(os.homedir(), ".pi", "pompom");
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

// ─── Theme Auto-Install ──────────────────────────────────────────────────────
// Copies the Pompom theme to ~/.pi/agent/themes/ and sets it as active
// on first install. Does not override if the user has already set a
// non-default theme (respects user choice).

function installPompomTheme(): void {
	try {
		const settingsFile = path.join(os.homedir(), ".pi", "agent", "settings.json");

		// Remove legacy files if they exist
		const legacyTheme = path.join(os.homedir(), ".pi", "agent", "themes", "pompom.json");
		if (fs.existsSync(legacyTheme)) {
			try { fs.unlinkSync(legacyTheme); } catch { /* ignore */ }
		}
		// Remove legacy cross-session chat history (chat is now per-session only)
		const legacyChatHistory = path.join(os.homedir(), ".pi", "pompom", "chat-history.json");
		if (fs.existsSync(legacyChatHistory)) {
			try { fs.unlinkSync(legacyChatHistory); } catch { /* ignore */ }
		}

		// Auto-activate only if user is on a default theme or no theme set
		if (!fs.existsSync(settingsFile)) return;
		const settings = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
		const current = settings.theme;
		// Only override if on built-in defaults or already on pompom
		if (!current || current === "dark" || current === "light" || current === "neapple" || current === "pompom") {
			settings.theme = "pompom";
			const tmp = settingsFile + ".tmp." + process.pid;
			fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
			fs.renameSync(tmp, settingsFile);
		}
	} catch {
		// Non-fatal — theme install is best-effort
	}
}

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

let accessoriesSavePromise: Promise<void> | null = null;
let accessoriesDirty = false;

async function saveAccessories(): Promise<void> {
	if (accessoriesSavePromise) {
		const pendingSave = accessoriesSavePromise;
		accessoriesDirty = true;
		await pendingSave;
		if (accessoriesDirty) {
			await saveAccessories();
		}
		return;
	}
	const runSave = async (): Promise<void> => {
		do {
			accessoriesDirty = false;
			const dir = SAVE_DIR;
			await fs.promises.mkdir(dir, { recursive: true });
			const tmp = SAVE_FILE + ".tmp." + process.pid;
			await fs.promises.writeFile(tmp, JSON.stringify(pompomGetAccessories()));
			await fs.promises.rename(tmp, SAVE_FILE);
		} while (accessoriesDirty);
	};
	accessoriesSavePromise = runSave();
	try {
		await accessoriesSavePromise;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[pompom] saveAccessories failed: ${msg}`);
		throw error;
	} finally {
		if (accessoriesSavePromise) {
			accessoriesSavePromise = null;
		}
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

function summarizeToolResultDetails(details: unknown): string {
	if (!isRecord(details)) {
		return "";
	}
	const keys = Object.keys(details).slice(0, 4);
	if (keys.length === 0) {
		return "";
	}
	return `details:${keys.join("|")}`;
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

function createToolResultMessage(messageLike: MessageLike): Message | null {
	const toolName = typeof messageLike.toolName === "string" && messageLike.toolName.trim()
		? messageLike.toolName
		: "tool";
	const toolCallId = typeof messageLike.toolCallId === "string" && messageLike.toolCallId.trim()
		? messageLike.toolCallId
		: `${toolName}-${messageLike.timestamp ?? Date.now()}`;
	const contentText = getMessageText(messageLike);
	const detailsText = summarizeToolResultDetails(messageLike.details);
	const stateLabel = messageLike.isError === true ? "failed" : "ok";
	const parts = [`[${toolName} ${stateLabel}]`];
	if (contentText) {
		parts.push(contentText);
	}
	if (!contentText && detailsText) {
		parts.push(`(${detailsText})`);
	}
	if (!contentText && !detailsText) {
		parts.push("(completed without text output)");
	}
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text: parts.join(" ") }],
		isError: messageLike.isError === true,
		timestamp: typeof messageLike.timestamp === "number" ? messageLike.timestamp : Date.now(),
	};
}

function buildRecentSessionMessages(currentContext: ExtensionContext): Message[] {
	const model = currentContext.model;
	if (!isModelLike(model)) {
		return [];
	}

	const messages: Message[] = [];
	const branch = currentContext.sessionManager.getBranch() as SessionEntryLike[];
	for (let index = branch.length - 1; index >= 0 && messages.length < 12; index--) {
		const entry = branch[index];
		if (entry.type !== "message" || !isRecord(entry.message)) {
			continue;
		}
		const messageLike = entry.message as MessageLike;
		const role = getMessageRole(messageLike);
		if (role === "user") {
			const text = getMessageText(messageLike);
			if (!text) {
				continue;
			}
			messages.unshift(createUserMessage(text));
			continue;
		}
		if (role === "assistant") {
			const text = getMessageText(messageLike);
			if (!text) {
				continue;
			}
			messages.unshift(createAssistantMessage(text, model, messageLike));
			continue;
		}
		if (role === "toolResult") {
			const toolResultMessage = createToolResultMessage(messageLike);
			if (!toolResultMessage) {
				continue;
			}
			messages.unshift(toolResultMessage);
		}
	}

	return messages;
}

// Agent state is cached in-memory and persisted to a file — no more appending
// to session history (which caused O(n) scans and unbounded entry growth).
const AGENT_STATE_DIR = path.join(os.homedir(), ".pi", "pompom", "agent-states");
const AGENT_STATE_RESTORE_MAX_AGE_MS = 30000;

interface PersistedAgentStateRecord {
	cwd: string;
	persistedAt: number;
	state: ReturnType<typeof serializeState>;
}

function agentStateFilePath(): string {
	return path.join(AGENT_STATE_DIR, `${getInstancePersistenceKey()}.json`);
}

function findLatestSerializedState(currentContext: ExtensionContext) {
	// Read from file cache instead of scanning session history
	try {
		const agentStateFile = agentStateFilePath();
		if (fs.existsSync(agentStateFile)) {
			const parsed = JSON.parse(fs.readFileSync(agentStateFile, "utf-8")) as unknown;
			if (!isRecord(parsed)) {
				return null;
			}
			if ("cwd" in parsed && "persistedAt" in parsed && "state" in parsed) {
				const record = parsed as Partial<PersistedAgentStateRecord>;
				if (
					record.cwd !== currentContext.cwd
					|| typeof record.persistedAt !== "number"
					|| Date.now() - record.persistedAt > AGENT_STATE_RESTORE_MAX_AGE_MS
				) {
					return null;
				}
				return record.state as ReturnType<typeof serializeState>;
			}
		}
	} catch { /* corrupt or missing — start fresh */ }
	return null;
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
	let lastAgentTickAt = 0;
	const AGENT_TICK_COOLDOWN_MS = 30000; // max 1 agent_tick per 30s
	let primaryAmbientOwner = false;
	let demoAccessorySnapshot: ReturnType<typeof pompomGetAccessories> | null = null;

	function persistAgentState() {
		try {
			if (!ctx) {
				return;
			}
			const agentStateFile = agentStateFilePath();
			const dir = path.dirname(agentStateFile);
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
			const tmp = agentStateFile + ".tmp." + process.pid;
			const payload: PersistedAgentStateRecord = {
				cwd: ctx.cwd,
				persistedAt: Date.now(),
				state: serializeState(),
			};
			fs.writeFileSync(tmp, JSON.stringify(payload), "utf-8");
			fs.renameSync(tmp, agentStateFile);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.error(`[pompom] persistAgentState failed: ${msg}`);
		}
	}

	function resetVoiceActivityState() {
		setMicRecording(false);
		setMicSilence(false);
		pompomSetTalking(false);
		pompomSetTalkAudioLevel(0);
		unduckAmbient();
		unduckAmbientForSleep();
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
		if (!enabled) {
			applyAgentVisualState();
			return;
		}
		const commentary = getCommentary(request);
		if (!commentary) {
			applyAgentVisualState();
			return;
		}
		// Only primary instance speaks agent commentary to prevent duplicate audio
		if (isPrimaryInstance()) {
			pompomSay(commentary, 4.6, "commentary", 1, true);
		}
		applyAgentVisualState();
	}

	// ─── AI-Generated Dynamic Speech ─────────────────────────────────────
	let aiSpeechTimer: ReturnType<typeof setTimeout> | null = null;
	let aiSpeechCount = 0;
	let aiSpeechEverScheduled = false;
	let aiSpeechGeneration = 0;
	let sessionStartMs = 0;
	const AI_SPEECH_MAX = 15; // up to 15 unique AI-generated lines per session
	const aiSpeechHistory: string[] = []; // last 10 AI-generated lines for dedup

	function jaccardSimilarity(a: string, b: string): number {
		const setA = new Set(a.toLowerCase().split(/\s+/));
		const setB = new Set(b.toLowerCase().split(/\s+/));
		let intersection = 0;
		for (const word of setA) {
			if (setB.has(word)) intersection++;
		}
		const union = setA.size + setB.size - intersection;
		return union === 0 ? 0 : intersection / union;
	}

	function isDuplicateAiLine(line: string): boolean {
		for (const prev of aiSpeechHistory) {
			if (jaccardSimilarity(line, prev) > 0.6) return true;
		}
		return false;
	}

	function trackAiLine(line: string): void {
		aiSpeechHistory.push(line);
		if (aiSpeechHistory.length > 10) aiSpeechHistory.shift();
	}

	async function generateDynamicLine(): Promise<string | null> {
		try {
			if (!ctx) return null;
			const model = resolvePompomModel(ctx);
			if (!model) return null;
			const apiKey = await ctx.modelRegistry.getApiKey(model);
			if (!apiKey) return null;

			const stats = getSessionStats();
			const weather = pompomGetWeather();
			const activeTools = getActiveToolDetails();
			const hour = new Date().getHours();
			const timeOfDay = hour < 6 ? "late night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
			const sessionMinutes = sessionStartMs > 0 ? Math.round((Date.now() - sessionStartMs) / 60000) : 0;
			const toolDesc = activeTools.length > 0
				? activeTools.map(t => t.toolName).join(", ")
				: "idle";

			const others = getOtherInstances();
			const otherInfo = others.length > 0
				? `other_terminals=${others.length} (dirs: ${others.map((otherInstance) => {
					const dirName = path.basename(otherInstance.cwd) || otherInstance.cwd;
					return dirName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40);
				}).join(", ")})`
				: "only_terminal=true";
			// Grab a brief snapshot of recent conversation so Pompom can comment on actual work
			let workContext = "";
			try {
				const recent = buildRecentSessionMessages(ctx);
				if (recent.length > 0) {
					// Take last 2-3 messages, truncate heavily — just enough for topic awareness
					const last = recent.slice(-3);
					workContext = last.map(m => {
						const text = extractTextContent(m.content);
						return `${m.role}: ${text.slice(0, 80)}`;
					}).join("\n");
				}
			} catch { /* non-fatal */ }

			const systemPrompt = [
				"You are Pompom, a small fluffy pink coding companion who lives in the terminal.",
				"Generate ONE short line (under 15 words) that Pompom would say right now.",
				"Use an emotion tag at the start like [happy], [curious], [excited], [whispers], [concerned], [playful].",
				"Be warm, caring, natural, and NEVER repeat yourself.",
				"If recent conversation context is provided, you may briefly and naturally reference what the user is working on — but keep it casual, not technical. You're a pet commenting on the vibes, not a code reviewer.",
				"Only interrupt about the work rarely. Most of the time, comment on weather, time, mood, or just be cute.",
			].join(" ");
			const userPrompt = [
				`State: mood=${stats.mood}, weather=${weather}, time=${timeOfDay}, agent=${toolDesc}, session=${sessionMinutes}min, ${otherInfo}`,
				workContext ? `\nRecent work:\n${workContext}` : "",
			].join("");

			const controller = new AbortController();
			const timeoutHandle = setTimeout(() => {
				controller.abort();
			}, 6000);
			let response: Awaited<ReturnType<typeof completeSimple>> | null = null;
			try {
				response = await completeSimple(
					model as any,
					{ messages: [createUserMessage(userPrompt)], systemPrompt },
					{ apiKey, signal: controller.signal },
				);
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") {
					return null;
				}
				return null;
			} finally {
				clearTimeout(timeoutHandle);
			}
			if (!response) return null;
			const text = extractTextContent(response.content);
			if (!text || text.length < 3) return null;
			return sanitizeAscii(text.slice(0, 140));
		} catch {
			return null;
		}
	}

	function scheduleAiSpeech() {
		if (aiSpeechTimer) clearTimeout(aiSpeechTimer);
		const myGen = aiSpeechGeneration;
		// First AI speech after 2-3 min, then every 4-6 min — keeps things lively
		const isFirst = !aiSpeechEverScheduled;
		const delayMs = isFirst
			? (2 + Math.random()) * 60 * 1000       // 2-3 min for first
			: (4 + Math.random() * 2) * 60 * 1000;  // 4-6 min thereafter
		aiSpeechTimer = setTimeout(async () => {
			try {
				if (myGen !== aiSpeechGeneration) return;
				if (!enabled || !companionActive) { scheduleAiSpeech(); return; }
				if (!isPrimaryInstance()) { scheduleAiSpeech(); return; }
				if (aiSpeechCount >= AI_SPEECH_MAX) return; // no more this session
				const stats = getSessionStats();
				// During active agent work, only interrupt rarely (20% chance) — most of
				// Pompom's best comments come from watching the user work, not from silence
				if (stats.isAgentActive && Math.random() > 0.2) { scheduleAiSpeech(); return; }
				if (isPlayingTTS()) { scheduleAiSpeech(); return; }

				const line = await generateDynamicLine();
				if (line && !isDuplicateAiLine(line)) {
					trackAiLine(line);
					pompomSay(line, 5.0, "commentary", 1, true);
					aiSpeechCount++;
					aiSpeechEverScheduled = true;
				}
			} catch {
				// silent
			}
			if (myGen !== aiSpeechGeneration) return;
			if (aiSpeechCount < AI_SPEECH_MAX) scheduleAiSpeech();
		}, delayMs);
	}

	function stopAiSpeech() {
		aiSpeechGeneration++;
		if (aiSpeechTimer) { clearTimeout(aiSpeechTimer); aiSpeechTimer = null; }
	}

	function resetAiSpeechState() {
		stopAiSpeech();
		aiSpeechCount = 0;
		aiSpeechEverScheduled = false;
		aiSpeechHistory.length = 0;
	}

	function cleanupSessionUiState() {
		if (pulseOverlayTimer) { clearTimeout(pulseOverlayTimer); pulseOverlayTimer = null; }
		clearHintTimers();
		overlayHint = null;
		overlayHintUntil = 0;
		closeChatOverlay();
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
		voiceHintTimer = scheduleSessionHint({
			commandContext: ctx,
			delayMs: 5000,
			onFire: (commandContext) => {
				commandContext.ui.notify(
					"Tip: Give Pompom a voice! Set ELEVENLABS_API_KEY for the best experience.\n" +
					"ElevenLabs v3 enables emotional audio tags — Pompom laughs, whispers, and sings!\n" +
					"Run /pompom:voice on or /pompom:voice setup to get started.",
					"info"
				);
			},
		});
	}

	// ─── Ambient weather sync ─────────────────────────────────────────────
	let ambientWeatherTimer: ReturnType<typeof setInterval> | null = null;
	let voiceHintTimer: ReturnType<typeof setTimeout> | null = null;
	let ambientHintTimer: ReturnType<typeof setTimeout> | null = null;
	let loadedAmbientHintShown = false;
	let lastAmbientWeather: string | null = null;
	let wasTTSPlaying = false;

	function clearHintTimers() {
		if (voiceHintTimer) { clearTimeout(voiceHintTimer); voiceHintTimer = null; }
		if (ambientHintTimer) { clearTimeout(ambientHintTimer); ambientHintTimer = null; }
	}

	function scheduleSessionHint({
		commandContext,
		delayMs,
		onFire,
	}: {
		commandContext: ExtensionContext;
		delayMs: number;
		onFire: (commandContext: ExtensionContext) => void;
	}): ReturnType<typeof setTimeout> {
		return setTimeout(() => {
			if (ctx !== commandContext || !commandContext.hasUI) {
				return;
			}
			onFire(commandContext);
		}, delayMs);
	}

	function startAmbientWeatherSync() {
		stopAmbientWeatherSync();
		// Sync immediately, then poll every 5s (weather changes every 30min+ so this is cheap)
		syncAmbientWeather();
		ambientWeatherTimer = setInterval(syncAmbientWeather, 5000);
	}

	function stopAmbientWeatherSync() {
		if (ambientWeatherTimer) { clearInterval(ambientWeatherTimer); ambientWeatherTimer = null; }
		primaryAmbientOwner = false;
		stopWeatherSfx();
	}

	function syncAmbientWeather() {
		try {
			const weather = pompomGetWeather();
			const ambientBlocked = isAmbientPlaybackBlocked(weather);
			if (!widgetVisible) {
				lastAmbientWeather = weather;
				const ttsPlaying = isPlayingTTS();
				if (ttsPlaying && !wasTTSPlaying) duckAmbient();
				else if (!ttsPlaying && wasTTSPlaying) unduckAmbient();
				wasTTSPlaying = ttsPlaying;
				return;
			}
			if (isPrimaryInstance()) {
				primaryAmbientOwner = true;
				if (weather !== lastAmbientWeather || (!isAmbientPlaying() && !ambientBlocked)) {
					lastAmbientWeather = weather;
					setAmbientWeather(weather).catch(err => { console.error(`[pompom] setAmbientWeather failed: ${err instanceof Error ? err.message : err}`); });
					startWeatherSfx();
				}
			} else {
				if (primaryAmbientOwner) {
					stopAmbient();
					stopWeatherSfx();
					primaryAmbientOwner = false;
				}
				if (weather !== lastAmbientWeather) {
					lastAmbientWeather = weather;
				}
			}
			// TTS ducking: duck when TTS starts, unduck when it stops
			const ttsPlaying = isPlayingTTS();
			if (ttsPlaying && !wasTTSPlaying) duckAmbient();
			else if (!ttsPlaying && wasTTSPlaying) unduckAmbient();
			wasTTSPlaying = ttsPlaying;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.error(`[pompom] syncAmbientWeather failed: ${msg}`);
		}
	}

	function enablePompom(commandContext: ExtensionContext) {
		enabled = true;
		setVoiceEnabled(getVoiceConfig().enabled);
		setMoodSfxEnabled(true);
		// Only primary instance enables ambient audio to prevent duplicate sounds
		if (isPrimaryInstance()) {
			setAmbientEnabled(getAmbientConfig().enabled);
		}
		showCompanion();
		setupKeyHandler();
		startAmbientWeatherSync();
		scheduleAiSpeech();
		// Open native window if available + enabled + primary instance
		if (isPrimaryInstance() && isWindowEnabled()) {
			void isGlimpseAvailable().then(ok => { if (ok && enabled) void openNativeWindow(); });
		}
	}

	function disablePompom() {
		enabled = false;
		cancelAiCommand();
		stopAiSpeech();
		setMoodSfxEnabled(false);
		hideCompanion();
		resetVoiceActivityState();
		stopAmbient();
		stopAmbientWeatherSync();
		stopPlayback();
		closeNativeWindow();
		// Session-only mute: stop playback without persisting disabled state to disk.
		// This way /pompom on can restore the user's saved preferences.
		resetPompom();
		if (terminalInputUnsub) { terminalInputUnsub(); terminalInputUnsub = null; }
	}

	function canForwardSpeech(event: SpeechEvent): boolean {
		if (!enabled || !event.allowTts) {
			return false;
		}
		// During demo, block all live TTS — cached demo audio handles voiceover
		if (demoRunning) {
			return false;
		}
		if (!isPrimaryInstance() && event.source !== "user_action") {
			return false;
		}
		return true;
	}

	function showAmbientHint() {
		if (hasAmbientBeenConfigured() || loadedAmbientHintShown || !ctx?.hasUI) return;
		const ambientConfig = getAmbientConfig();
		if (!ambientConfig.enabled) return;
		loadedAmbientHintShown = true;
		ambientHintTimer = scheduleSessionHint({
			commandContext: ctx,
			delayMs: 8000,
			onFire: (commandContext) => {
				commandContext.ui.notify(
					"Ambient sounds are enabled — Pompom will play weather-matching background audio.\n" +
					"Use /pompom:ambient off to disable, or /pompom:ambient volume 0-100 to adjust.",
					"info"
				);
			},
		});
	}

	function safeRender(width: number): string[] {
		try {
			const w = Math.max(1, width);
			const now = Date.now();
			const dt = Math.min(0.1, (now - lastRenderTime) / 1000);
			lastRenderTime = now;
			const piListen = getPiListenState();
			const lines = renderPompom(w, piListen.audioLevel || 0, dt);
			// Strict truncation: every line must be exactly <= width visible chars.
			// Pi TUI crashes if any rendered line exceeds terminal width.
			for (let i = 0; i < lines.length; i++) {
				lines[i] = truncateToWidth(lines[i], w);
			}
			return lines;
		} catch {
			return [" ".repeat(Math.max(1, width))];
		}
	}

	function mountCompanionWidget() {
		if (!ctx?.hasUI || !widgetVisible) {
			return;
		}
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
	}

	function showCompanion() {
		if (companionActive || !ctx?.hasUI) {
			return;
		}
		companionActive = true;
		mountCompanionWidget();
		startHealthCheck();

		if (voiceCheckTimer) {
			clearInterval(voiceCheckTimer);
		}
		let wasMicActive = false;
		voiceCheckTimer = setInterval(() => {
			const piListen = getPiListenState();
			const isRecording = piListen.recording === true;
			const isPlaying = isPlayingTTS();
			pompomSetTalking(isRecording || isPlaying);

			// Auto-silence Pompom when mic/voice input is active (pi listen, pi voice, etc.)
			if (isRecording && !wasMicActive) {
				wasMicActive = true;
				setMicRecording(true);   // suppresses TTS + stops current playback
				setMicSilence(true);     // suppresses SFX
				duckAmbient();           // lower ambient volume
			} else if (!isRecording && wasMicActive) {
				wasMicActive = false;
				setMicRecording(false);
				setMicSilence(false);
				unduckAmbient();
			}

			if (isPlaying) {
				pompomSetTalkAudioLevel(getTTSAudioLevel());
				return;
			}
			if (isRecording) {
				pompomSetTalkAudioLevel(piListen.audioLevel || 0);
				return;
			}
			pompomSetTalkAudioLevel(0);

			// Sleep ambient ducking — lower ambient while Pompom naps
			const sleepStatus = pompomStatus();
			if (sleepStatus.mood === "sleeping") duckAmbientForSleep();
			else unduckAmbientForSleep();
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
		resetVoiceActivityState();
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

	const shortcutKeyToAction: Record<string, string> = {
		p: "p",
		e: "f",
		f: "f",
		t: "t",
		u: "h",
		h: "h",
		r: "b",
		b: "b",
		z: "d",
		d: "d",
		a: "w",
		w: "w",
		s: "s",
		x: "x",
		g: "g",
		m: "m",
		o: "o",
		c: "c",
	};

	function mapLegacyShortcutToAction(rawKey: string): string | null {
		const key = rawKey.toLowerCase();
		return shortcutKeyToAction[key] ?? null;
	}

	function resetSessionCountGuardIfAvailable(): void {
		const maybeHelper = Object.entries(pompomModule)
			.filter(([exportName, value]) => {
				const loweredName = exportName.toLowerCase();
				return (
					loweredName.includes("session")
					&& loweredName.includes("count")
					&& loweredName.includes("reset")
					&& typeof value === "function"
				);
			})
			.map(([, value]) => value)
			.find((value): value is () => void => typeof value === "function");
		if (!maybeHelper) {
			return;
		}
		maybeHelper();
	}

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
					if (data.length === 2 && data[0] === "\x1b") {
						const actionKey = mapLegacyShortcutToAction(data[1]);
						if (!actionKey) {
							return undefined;
						}
						pompomKeypress(actionKey);
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
							const actionKey = mapLegacyShortcutToAction(keyChar);
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

	/** Resolve the Pompom AI model: honors getPompomModel() config, falls back to session model.
	 *  Returns the full model registry object (not just ModelLike) so it can be passed to API calls. */
	function resolvePompomModel(commandContext: ExtensionContext): any | null {
		const pompomModelId = getPompomModel();
		if (pompomModelId) {
			try {
				const all = commandContext.modelRegistry.getAll();
				const found = all.find((m: any) => m.id === pompomModelId || `${m.provider}/${m.id}` === pompomModelId);
				if (found && isModelLike(found)) return found;
			} catch { /* fall through to session model */ }
		}
		const model = commandContext.model;
		return isModelLike(model) ? model : null;
	}

	function beginAiCommand(): { runId: number; signal: AbortSignal } {
		aiCommandRunId += 1;
		aiCommandInProgress = true;
		if (aiCommandAbortController) {
			aiCommandAbortController.abort();
		}
		aiCommandAbortController = new AbortController();
		return {
			runId: aiCommandRunId,
			signal: aiCommandAbortController.signal,
		};
	}

	function isAiCommandCurrent(runId: number): boolean {
		return runId === aiCommandRunId;
	}

	function throwIfAiCommandCanceled(runId: number): void {
		if (isAiCommandCurrent(runId)) {
			return;
		}
		const error = new Error("Pompom AI command canceled");
		error.name = "AbortError";
		throw error;
	}

	function cancelAiCommand(): void {
		aiCommandRunId += 1;
		aiCommandInProgress = false;
		if (!aiCommandAbortController) {
			return;
		}
		aiCommandAbortController.abort();
		aiCommandAbortController = null;
	}

	function finishAiCommand(runId: number): void {
		if (!isAiCommandCurrent(runId)) {
			return;
		}
		aiCommandInProgress = false;
		aiCommandAbortController = null;
	}

	async function giveAccessoryWithPersistence({
		item,
		commandContext,
	}: {
		item: string;
		commandContext: ExtensionContext;
	}): Promise<void> {
		const previousAccessories = { ...pompomGetAccessories() };
		const result = pompomGiveAccessory(item);
		if (result.startsWith("Unknown")) {
			commandContext.ui.notify(result, "info");
			return;
		}
		try {
			await saveAccessories();
		} catch (error) {
			pompomRestoreAccessories(previousAccessories);
			const message = error instanceof Error ? error.message : String(error);
			commandContext.ui.notify(`Could not save ${item}: ${message}`, "error");
			return;
		}
		await playSfx("accessory_equip");
		commandContext.ui.notify(result, "info");
	}

	async function runPompomAsk(commandArgs: string, commandContext: ExtensionContext) {
		if (aiCommandInProgress) {
			commandContext.ui.notify("Pompom is already working on a request. Please wait.", "warning");
			return;
		}
		const question = commandArgs.trim();
		if (!question) {
			commandContext.ui.notify("Usage: /pompom:ask <question>", "warning");
			return;
		}
		const aiCommand = beginAiCommand();
		const { runId, signal } = aiCommand;
		const model = resolvePompomModel(commandContext);
		if (!model) {
			commandContext.ui.notify("No model selected", "error");
			finishAiCommand(runId);
			return;
		}

		let apiKey: string | undefined;
		try {
			apiKey = await commandContext.modelRegistry.getApiKey(model);
		} catch (err) {
			commandContext.ui.notify(`API key lookup failed: ${err instanceof Error ? err.message : err}`, "error");
			finishAiCommand(runId);
			return;
		}
		if (!apiKey) {
			commandContext.ui.notify(`No API key for ${model.provider}/${model.id}`, "error");
			finishAiCommand(runId);
			return;
		}
		throwIfAiCommandCanceled(runId);

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
				{ apiKey, reasoning, signal }
			);

			for await (const event of stream) {
				throwIfAiCommandCanceled(runId);
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
			throwIfAiCommandCanceled(runId);

			const finalAnswer = answer.trim();
			if (!finalAnswer) {
				commandContext.ui.notify("Pompom did not return any text.", "warning");
				return;
			}

			pompomSay(sanitizeAscii(finalAnswer.slice(0, 140)), 6.0, "assistant", 3, true);
			commandContext.ui.notify(`Pompom: ${finalAnswer}`, "info");
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				return;
			}
			const message = error instanceof Error ? error.message : "Unknown error";
			pompomSay("I hit a snag while thinking.", 4.2, "commentary", 2, true);
			commandContext.ui.notify(`pompom:ask error - ${message}`, "error");
		} finally {
			finishAiCommand(runId);
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
		const aiCommand = beginAiCommand();
		const { runId, signal } = aiCommand;
		const model = resolvePompomModel(commandContext);
		if (!model) {
			commandContext.ui.notify("No model selected", "error");
			finishAiCommand(runId);
			return;
		}

		let apiKey: string | undefined;
		try {
			apiKey = await commandContext.modelRegistry.getApiKey(model);
		} catch (err) {
			commandContext.ui.notify(`API key lookup failed: ${err instanceof Error ? err.message : err}`, "error");
			finishAiCommand(runId);
			return;
		}
		if (!apiKey) {
			commandContext.ui.notify(`No API key for ${model.provider}/${model.id}`, "error");
			finishAiCommand(runId);
			return;
		}
		throwIfAiCommandCanceled(runId);

		const stats = getSessionStats();
		const recentMessages = buildRecentSessionMessages(commandContext);
		if (recentMessages.length === 0) {
			commandContext.ui.notify("No session context to recap yet.", "warning");
			finishAiCommand(runId);
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
				{ apiKey, reasoning: "low", signal }
			);
			throwIfAiCommandCanceled(runId);

			const summary = extractTextContent(response.content);

			if (!summary) {
				commandContext.ui.notify("Pompom could not build a recap.", "warning");
				return;
			}

			pompomSay(sanitizeAscii(summary.slice(0, 140)), 6.0, "assistant", 3, true);
			commandContext.ui.notify(`Pompom recap:\n${summary}`, "info");
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				return;
			}
			const message = error instanceof Error ? error.message : "Unknown error";
			pompomSay("Recap failed. I need another try.", 4.2, "commentary", 2, true);
			commandContext.ui.notify(`pompom:recap error - ${message}`, "error");
		} finally {
			finishAiCommand(runId);
			overlayHint = null;
			overlayHintUntil = 0;
			applyAgentVisualState();
		}
	}

		pi.on("session_start", async (_event, startCtx) => {
			await runSafely("session_start", async () => {
				ctx = startCtx;
				sessionStartMs = Date.now();
				loadedVoiceHintShown = false;
				installPompomTheme();
				registerInstance(startCtx.cwd);
				initSessionCount();
				initVoice(Boolean(startCtx.hasUI));
				initAmbient(Boolean(startCtx.hasUI));
				if (isPrimaryInstance()) void playSfx("session_chime");
				pompomOnSpeech((event: SpeechEvent) => {
					if (!canForwardSpeech(event)) return;
					enqueueSpeech(event);
				});
				pompomOnSfx((sfx) => {
					// Block SFX during demo — demo voiceover handles all audio
					if (demoRunning) return;
					// Weather SFX only on primary; user-triggered SFX on all instances
					const weatherSfx = ["thunder", "bird_chirp", "bee_buzz", "weather_transition", "wind_gust", "rain_drip", "cricket_chirp"];
					if (weatherSfx.includes(sfx) && !isPrimaryInstance()) return;
					void playSfx(sfx as SfxName);
				});
				pompomOnEmotionalState((state) => {
					if (isPrimaryInstance()) setMoodSfxState(state);
				});
				installPompomFooter(startCtx, () => sessionStartMs, () => pi.getThinkingLevel());
				restoreCompanionState(startCtx);
				if (enabled) {
					showCompanion();
					setupKeyHandler();
					startAmbientWeatherSync();
					scheduleAiSpeech();
					// Auto-open native window on session start (primary only)
					if (isPrimaryInstance() && isWindowEnabled()) {
						void isGlimpseAvailable().then(ok => { if (ok && enabled) void openNativeWindow(); });
					}
				}
				showVoiceHint();
				showAmbientHint();
			});
		});

		pi.on("session_shutdown", async () => {
			await runSafely("session_shutdown", async () => {
				const wasPrimary = isPrimaryInstance();
				closeNativeWindow();
				deregisterInstance();
				stopDemo();
				cancelAiCommand();
				persistAgentState();
				setAgentBusy(false);
				setMoodSfxEnabled(false);
				resetVoiceActivityState();
				stopPlayback();
				stopAmbient();
				stopAmbientWeatherSync();
				if (wasPrimary) {
					await playSfx("session_goodbye");
				}
				resetAiSpeechState();
				sessionStartMs = 0;
				cleanupSessionUiState();
				pompomOnSpeech(null);
				pompomOnSfx(null);
				pompomOnEmotionalState(null);
				setMoodSfxState(null);
				resetSessionCountGuardIfAvailable();
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
				// Teardown old session state (but keep instance registered until new one is ready)
				stopDemo();
				cancelAiCommand();
				persistAgentState();
				setAgentBusy(false);
				setMoodSfxEnabled(false);
				resetVoiceActivityState();
				stopPlayback();
				stopAmbient();
				stopAmbientWeatherSync();
				closeNativeWindow();
				resetAiSpeechState();
				sessionStartMs = Date.now();
				cleanupSessionUiState();
				resetSessionCountGuardIfAvailable();
				initSessionCount();
			hideCompanion();
			resetPompom();
			ctx = switchCtx;
				// Re-register with new cwd (replaces old heartbeat atomically)
				registerInstance(switchCtx.cwd);
				loadedVoiceHintShown = false;
				loadedAmbientHintShown = false;
				lastAmbientWeather = null;
				wasTTSPlaying = false;
				lastProactiveAlertAt = 0;
				widgetVisible = true;
				initVoice(Boolean(switchCtx.hasUI));
				initAmbient(Boolean(switchCtx.hasUI));
				pompomOnSpeech((event: SpeechEvent) => {
					if (!canForwardSpeech(event)) return;
					enqueueSpeech(event);
				});
				pompomOnSfx((sfx) => {
					if (demoRunning) return;
					const weatherSfx = ["thunder", "bird_chirp", "bee_buzz", "weather_transition", "wind_gust", "rain_drip", "cricket_chirp"];
					if (weatherSfx.includes(sfx) && !isPrimaryInstance()) return;
					void playSfx(sfx as SfxName);
				});
				pompomOnEmotionalState((state) => {
					if (isPrimaryInstance()) setMoodSfxState(state);
				});
			installPompomFooter(switchCtx, () => sessionStartMs, () => pi.getThinkingLevel());
			restoreCompanionState(switchCtx);
			if (enabled) {
				showCompanion();
				setupKeyHandler();
				startAmbientWeatherSync();
				scheduleAiSpeech();
				if (isPrimaryInstance() && isWindowEnabled()) {
					void isGlimpseAvailable().then(ok => { if (ok && enabled) void openNativeWindow(); });
				}
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
			// Subtle agent activity audio — max once per 30s, primary only
			const now = Date.now();
			if (isPrimaryInstance() && now - lastAgentTickAt >= AGENT_TICK_COOLDOWN_MS) {
				lastAgentTickAt = now;
				void playSfx("agent_tick");
			}
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
			setMoodSfxEnabled(false);
			// Only stop the render loop and remove the widget — keep companionActive true
			// so that AI speech, health checks, and voice/mic timers continue running.
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
			setMoodSfxEnabled(true);
			const weather = pompomGetWeather();
			lastAmbientWeather = weather;
			if (isPrimaryInstance()) {
				setAmbientWeather(weather).catch(err => { console.error(`[pompom] setAmbientWeather failed: ${err instanceof Error ? err.message : err}`); });
				startWeatherSfx();
			} else {
				stopAmbient();
				stopWeatherSfx();
			}
			if (companionActive) {
				mountCompanionWidget();
			} else {
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
							enablePompom(cmdCtx);
						} else {
							disablePompom();
						}
					},
					onAmbientToggle: (on) => {
						if (on) startAmbientWeatherSync();
						else stopAmbientWeatherSync();
					},
					onAccessoryChange: async () => {
						await saveAccessories();
					},
					onWindowToggle: async () => {
						return toggleNativeWindow();
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
					enablePompom(commandContext);
					commandContext.ui.notify("Pompom on — animation, voice, ambient, everything restored!", "info");
					return;
				}

				if (sub === "off" || sub === "quiet" || sub === "zen" || sub === "mute") {
					disablePompom();
					commandContext.ui.notify(
						"Pompom off — animation, voice, and sounds all disabled.\n" +
						`Side chat is still available: /pompom:chat or ${process.platform === "darwin" ? "\u2325/" : "Alt+/"}\n` +
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

				if (sub === "window") {
					const available = await isGlimpseAvailable();
					if (!available) {
						commandContext.ui.notify(
							"Native window requires the 'glimpseui' package.\n" +
							"Install with: bun add glimpseui",
							"warning"
						);
						return;
					}
					const opened = await toggleNativeWindow();
					commandContext.ui.notify(
						opened ? "Native window opened." : "Native window closed.",
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
						`  /pompom:ambient      Weather ambient sounds — on|off|volume|pregenerate|reset\n` +
						`  /pompom:terminals    Show all running Pompom terminals\n` +
						`  /pompom-give-hat     Give Pompom a hat (also: umbrella, scarf, sunglasses)\n` +
						`  /pompom window       Toggle native floating window\n` +
						`  /pompom demo         Autonomous ~135s showcase\n` +
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
					await giveAccessoryWithPersistence({
						item,
						commandContext,
					});
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
							enablePompom(commandContext);
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

				if (sub === "demo") {
					if (demoRunning) { stopDemo(); commandContext.ui.notify("Demo stopped.", "info"); return; }

					// DEMO v8 — Storytelling narration with pre-cached voiceover.
					// Weather fires 2s BEFORE narration. Actions fire WITH narration.
					// allowTts=true so speech bubbles show + TTS plays from cache.
					const chatKeyName = process.platform === "darwin" ? "Option slash" : "Alt slash";
					const DL: [string, string][] = [
						["d01", "[excited] Hi there! I'm Pompom!"],
						["d02", "[happy] I'm your coding companion. I live right here in your terminal while you work!"],
						["d03", "[happy] When you've been coding for a while, I get hungry! You can feed me like this"],
						["d04", "[happy] And when things get tough, sometimes I just need a hug"],
						["d05", "[excited] But my favorite thing? Playing fetch! Throw me the ball!"],
						["d06", "[excited] I also love to dance when the code is flowing!"],
						["d07", "[sings] And sometimes I just can't help but sing a little song!"],
						["d08", "[curious] See those clouds? I react to real weather changes"],
						["d09", "[happy] And you can give me accessories! Like this umbrella for the rain"],
						["d10", "[concerned] When storms roll in, things get intense! Listen to that thunder"],
						["d11", "[excited] Oh! Snow! This is my absolute favorite weather!"],
						["d12", "[happy] And look, a cozy scarf to keep me warm in the cold"],
						["d13", "[happy] When the sky clears up, I put on my sunglasses and hat!"],
						["d14", "[excited] Want to play a game? Let's catch some stars!"],
						["d15", "[curious] I also come in different color themes, check this out"],
						["d16", "[whispers] And when you're done for the day, I curl up for a little nap"],
						["d17", "[sighs] Ahh, that was such a good nap!"],
						["d18", "[curious] But here's the thing. I'm not just a cute face"],
						["d19", "[happy] I actually watch your coding agent work. I track every tool call and catch errors"],
						["d20", "[happy] If your agent gets stuck, I'll let you know. Just ask me anything about your session"],
						["d21", `[excited] And press ${chatKeyName} to open my side chat anytime!`],
						["d22", "[happy] I run as a separate AI alongside your main agent. I won't interrupt anything"],
						["d23", "[happy] I can peek at what your agent is doing and explain it all to you"],
						["d24", "[excited] Three voice engines, twenty three sound effects, and six different personalities!"],
						["d25", "[excited] Try me! pi install at codexstar slash pi pompom"],
						["d26", "[happy] See you on the terminal super soon! Bye bye!"],
					];
					const demoKeys = DL.map(l => l[0]);


					const cached = isDemoCached(demoKeys);
					if (!companionActive) { enablePompom(commandContext); }
					demoAccessorySnapshot = pompomGetAccessories();
					pompomRestoreAccessories({ umbrella: false, scarf: false, sunglasses: false, hat: false });
					demoRunning = true;
					activeDemoTimers.length = 0;
					const q = (ms: number, fn: () => void) => {
						activeDemoTimers.push(setTimeout(() => { if (demoRunning) fn(); }, ms));
					};
					// Show bubble + play cached audio. allowTts=true so the speech system works normally.
					// The live TTS queue will try to synthesize but we stop it immediately after playing cached.
					const say = (key: string, text: string, dur = 3.0) => {
						// Clear transient particles (sparkles/notes) but keep weather
						pompomClearParticles("transient");
						if (cached) {
							pompomSay(text, dur, "system", 10, false);
							if (isPrimaryInstance()) { stopPlayback(); playDemoLine(key); }
						} else {
							pompomSay(text, dur, "system", 10, true);
						}
					};

					let t = 0;

					// ─── OPENING (0-7s) ──────────────────────────────────────
					q(t, () => { pompomKeypress("p"); say("d01", DL[0][1]); });
					t += 3500;
					q(t, () => { pompomKeypress("d"); say("d02", DL[1][1], 4.5); });

					// ─── INTERACTIONS (7-32s) ────────────────────────────────
					t += 5000;
					q(t, () => { pompomKeypress("f"); pompomKeypress("f"); say("d03", DL[2][1], 5.5); });
					t += 5500;
					q(t, () => { pompomKeypress("h"); say("d04", DL[3][1], 4.0); });
					t += 4500;
					q(t, () => { pompomKeypress("b"); say("d05", DL[4][1], 5.0); });
					t += 7000;
					q(t, () => { pompomKeypress("x"); say("d06", DL[5][1]); });
					t += 4000;
					q(t, () => { pompomKeypress("m"); say("d07", DL[6][1], 3.5); });

					const DEMO_WEATHER_PREROLL_MS = 2800;
					const DEMO_WEATHER_TRANSITION_MS = 900;

					// ─── WEATHER (32-65s) — weather changes early enough to be seen ─
					t += 4500;
					q(t, () => pompomSetWeatherOverride({ weather: "cloudy", transitionMs: DEMO_WEATHER_TRANSITION_MS }));
					q(t + DEMO_WEATHER_PREROLL_MS, () => say("d08", DL[7][1], 4.5));
					t += 6500;
					q(t, () => pompomSetWeatherOverride({ weather: "rain", transitionMs: DEMO_WEATHER_TRANSITION_MS }));
					q(t + DEMO_WEATHER_PREROLL_MS, () => { pompomGiveAccessory("umbrella"); say("d09", DL[8][1], 3.8); });
					t += 7000;
					q(t, () => pompomSetWeatherOverride({ weather: "storm", transitionMs: DEMO_WEATHER_TRANSITION_MS }));
					q(t + DEMO_WEATHER_PREROLL_MS, () => say("d10", DL[9][1], 5.5));
					t += 7600;
					q(t, () => pompomSetWeatherOverride({ weather: "snow", transitionMs: DEMO_WEATHER_TRANSITION_MS }));
					q(t + DEMO_WEATHER_PREROLL_MS, () => say("d11", DL[10][1], 5.0));
					t += 7800;
					q(t, () => { pompomGiveAccessory("scarf"); say("d12", DL[11][1], 3.5); });
					t += 5200;
					q(t, () => pompomSetWeatherOverride({ weather: "clear", transitionMs: DEMO_WEATHER_TRANSITION_MS }));
					q(t + 2200, () => { pompomGiveAccessory("sunglasses"); pompomGiveAccessory("hat"); say("d13", DL[12][1], 4.0); });

					// ─── GAME + COLORS (65-82s) ──────────────────────────────
					t += 5500;
					q(t, () => { pompomKeypress("g"); say("d14", DL[13][1], 3.5); });
					t += 10000;
					q(t, () => { pompomKeypress("c"); say("d15", DL[14][1], 3.0); });
					q(t + 1500, () => pompomKeypress("c"));
					q(t + 3000, () => pompomKeypress("c"));
					q(t + 4500, () => pompomKeypress("c"));

					// ─── SLEEP (82-93s) ──────────────────────────────────────
					t += 6000;
					q(t, () => { pompomSetWeatherOverride({ weather: null }); pompomKeypress("s"); });
					q(t + 1800, () => { say("d16", DL[15][1], 3.5); });
					t += 8000;
					q(t, () => { pompomKeypress("w"); say("d17", DL[16][1]); });

					// ─── INTELLIGENCE (93-110s) ──────────────────────────────
					t += 4000;
					q(t, () => {
						pompomSetAgentOverlay({ active: true });
						pompomSetAntennaGlow({ intensity: 0.9 });
						pompomSetAgentEarBoost({ amount: 0.7 });
						say("d18", DL[17][1], 3.5);
					});
					t += 4500;
					q(t, () => { say("d19", DL[18][1], 5.5); });
					t += 5000;
					q(t, () => {
						pompomSetAgentOverlay({ active: false });
						pompomSetAntennaGlow({ intensity: 0 });
						pompomSetAgentEarBoost({ amount: 0 });
						say("d20", DL[19][1], 5.0);
					});

					// ─── SIDE CHAT (110-125s) ───────────────────────────────
					t += 5000;
					q(t, () => say("d21", DL[20][1], 3.5));
					t += 5000;
					q(t, () => say("d22", DL[21][1], 5.0));
					t += 5000;
					q(t, () => say("d23", DL[22][1], 4.0));

					// ─── FINALE (125-135s) ───────────────────────────────────
					t += 5000;
					q(t, () => say("d24", DL[23][1], 5.5));
					t += 6200;
					q(t, () => { pompomKeypress("d"); say("d25", DL[24][1], 5.0); });
					t += 5500;
					q(t, () => { pompomKeypress("p"); say("d26", DL[25][1], 3.5); });
					t += 4500;
					q(t, () => stopDemo());

					commandContext.ui.notify(`Demo${cached ? " with voiceover" : ""} (~${Math.round(t / 1000)}s). /pompom demo to stop.`, "info");
					return;
				}

				if (sub === "") {
					if (companionActive) {
						disablePompom();
						commandContext.ui.notify("Pompom companion hidden.", "info");
					} else {
						enablePompom(commandContext);
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
					const val = parseInt(sub.replace(/^(volume|vol)\s+/, ""), 10);
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
		description: "Ambient weather sounds — on/off/volume/pregenerate/reset",
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
					const val = parseInt(sub.replace(/^(volume|vol)\s+/, ""), 10);
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
						`Deleted ${deleted} generated cache files. They'll regenerate on the next weather change.\n` +
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
					"  /pompom:ambient reset         Delete generated cache; regenerate on next weather change\n" +
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
				if (aiCommandInProgress) {
					commandContext.ui.notify("Pompom is already working on a request. Please wait.", "info");
					return;
				}
				const aiCommand = beginAiCommand();
				const { runId, signal } = aiCommand;
				ctx = commandContext;
				const model = resolvePompomModel(commandContext);
				if (!model) {
					commandContext.ui.notify("No model selected.", "error");
					finishAiCommand(runId);
					return;
				}
				let apiKey: string | undefined;
				try {
					apiKey = await commandContext.modelRegistry.getApiKey(model);
				} catch (err) {
					commandContext.ui.notify(`API key lookup failed: ${err instanceof Error ? err.message : err}`, "error");
					finishAiCommand(runId);
					return;
				}
				if (!apiKey) {
					commandContext.ui.notify("No API key for " + model.provider + "/" + model.id, "error");
					finishAiCommand(runId);
					return;
				}
				throwIfAiCommandCanceled(runId);

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
						{ apiKey, reasoning: "low", signal },
					);
					throwIfAiCommandCanceled(runId);
					const analysis = extractTextContent(response.content);
					if (analysis) {
						pompomSay(sanitizeAscii(analysis.slice(0, 120)), 6.0, "assistant", 3, true);
						commandContext.ui.notify("Session Analysis\n\n" + analysis, "info");
					} else {
						commandContext.ui.notify("Could not generate analysis.", "warning");
					}
				} catch (err) {
					if (err instanceof Error && err.name === "AbortError") {
						return;
					}
					const msg = err instanceof Error ? err.message : "Unknown error";
					pompomSay("Analysis hit a snag.", 3.0, "commentary", 2, true);
					commandContext.ui.notify("pompom:analyze error - " + msg, "error");
				} finally {
					finishAiCommand(runId);
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

	// ─── Standalone accessory commands ─────────────────────────────────────────
	// These show as top-level /pompom-give-hat etc. in the command palette

	const accessoryCommands: { name: string; item: string; desc: string }[] = [
		{ name: "pompom-give-hat", item: "hat", desc: "Give Pompom a cute hat" },
		{ name: "pompom-give-umbrella", item: "umbrella", desc: "Give Pompom an umbrella (shows in rain)" },
		{ name: "pompom-give-scarf", item: "scarf", desc: "Give Pompom a scarf (shows in snow)" },
		{ name: "pompom-give-sunglasses", item: "sunglasses", desc: "Give Pompom sunglasses (shows in clear weather)" },
	];
	for (const acc of accessoryCommands) {
		pi.registerCommand(acc.name, {
			description: acc.desc,
			handler: async (_args, commandContext) => {
				await runSafely(acc.name, async () => {
					ctx = commandContext;
					await giveAccessoryWithPersistence({
						item: acc.item,
						commandContext,
					});
				});
			},
		});
	}

	// ─── Standalone on/off commands ───────────────────────────────────────────
	// Top-level /pompom-on and /pompom-off in the command palette

	pi.registerCommand("pompom-on", {
		description: "Turn Pompom on — restore animation, voice, ambient, everything",
		handler: async (_args, commandContext) => {
			await runSafely("pompom-on", () => {
				ctx = commandContext;
				enablePompom(commandContext);
				commandContext.ui.notify("Pompom on — animation, voice, ambient, everything restored!", "info");
			});
		},
	});

	pi.registerCommand("pompom-off", {
		description: "Turn Pompom off — disable animation, voice, and sounds (chat stays)",
		handler: async (_args, commandContext) => {
			await runSafely("pompom-off", () => {
				ctx = commandContext;
				disablePompom();
				commandContext.ui.notify(
					"Pompom off — animation, voice, and sounds all disabled.\n" +
					`Side chat is still available: /pompom:chat or ${process.platform === "darwin" ? "\u2325/" : "Alt+/"}\n` +
					"To restore everything: /pompom on",
					"info"
				);
			});
		},
	});

	// ─── Multi-terminal awareness ──────────────────────────────────────────────

	pi.registerCommand("pompom:terminals", {
		description: "Show all running Pi terminals with Pompom instances",
		handler: async (_args, commandContext) => {
			await runSafely("pompom:terminals", () => {
				ctx = commandContext;
				const others = getOtherInstances();
				const total = getInstanceCount();
				const primary = isPrimaryInstance();
				const role = primary ? "primary (audio active)" : "secondary (visual only)";
				const lines = [
					`Pompom Terminals — ${total} instance${total !== 1 ? "s" : ""} running`,
					``,
					`This terminal: ${role}`,
					`  PID: ${process.pid}  CWD: ${commandContext.cwd}`,
				];
				if (others.length > 0) {
					lines.push("", "Other terminals:");
					for (const inst of others) {
						const age = Math.round((Date.now() - inst.startedAt) / 1000);
						lines.push(`  PID: ${inst.pid}  TTY: ${inst.tty}  CWD: ${inst.cwd}  (${age}s ago)`);
					}
				}
				if (primary) {
					lines.push("", "This terminal handles ambient audio, weather SFX, and greetings.");
				} else {
					lines.push("", "Audio is handled by the primary terminal. This one runs visual-only.");
					lines.push("User-triggered SFX (pet, feed, etc.) still play here.");
				}
				commandContext.ui.notify(lines.join("\n"), "info");
			});
		},
	});

	// ─── Demo Mode ──────────────────────────────────────────────────

	let demoTimer: ReturnType<typeof setTimeout> | null = null; // legacy ref for cleanup
	let demoRunning = false;

	const activeDemoTimers: ReturnType<typeof setTimeout>[] = [];

	function stopDemo() {
		demoRunning = false;
		for (const t of activeDemoTimers) clearTimeout(t);
		activeDemoTimers.length = 0;
		if (demoTimer) { clearTimeout(demoTimer); demoTimer = null; }
		if (demoAccessorySnapshot) {
			pompomRestoreAccessories(demoAccessorySnapshot);
			demoAccessorySnapshot = null;
		}
		pompomSetWeatherOverride({ weather: null });
		stopPlayback(); // kill any playing demo audio
		pompomSetAgentOverlay({ active: false });
		pompomSetAntennaGlow({ intensity: 0 });
		pompomSetAgentEarBoost({ amount: 0 });
	}

	pi.registerCommand("pompom:demo", {
		description: "Run an autonomous showcase of Pompom (~135s, social-media ready)",
		handler: async (_args, commandContext) => {
			await runSafely("pompom:demo", async () => {
				ctx = commandContext;
				// Delegate to the /pompom demo subcommand handler
				if (demoRunning) { stopDemo(); commandContext.ui.notify("Demo stopped.", "info"); return; }
				commandContext.ui.notify("Use /pompom demo instead.", "info");
			});
		},
	});

	// ─── Pompom Side Chat ───────────────────────────────────────────

	const CHAT_SHORTCUT = "alt+/";
	const CHAT_SHORTCUT_DISPLAY = process.platform === "darwin" ? "\u2325/" : "Alt+/";
	let chatOverlayHandle: { focus: () => void; unfocus: () => void; isFocused: () => boolean } | null = null;
	let chatOpenInProgress = false;
	let aiCommandInProgress = false;
	let aiCommandRunId = 0;
	let aiCommandAbortController: AbortController | null = null;

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
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[pompom] registerShortcut ${CHAT_SHORTCUT} failed: ${msg}`);
	}

	// ─── Pi Voice → Pompom Chat redirect ────────────────────────────────────
	// When Pompom chat is focused, intercept ctx.ui.setEditorText so pi-voice
	// (hold-to-talk) sends transcripts to Pompom's editor instead of the main one.
	let chatOverlayRef: {
		editor: { getText(): string; setText(t: string): void };
		dispose(): void;
	} | null = null;
	let originalSetEditorText: ((text: string) => void) | null = null;
	let originalGetEditorText: (() => string) | null = null;
	let editorInterceptActive = false;

	function installEditorIntercept(commandContext: ExtensionContext) {
		if (editorInterceptActive || !chatOverlayRef) return;
		const ui = commandContext.ui as any;
		if (!ui.setEditorText || !ui.getEditorText) return;
		originalSetEditorText = ui.setEditorText.bind(ui);
		originalGetEditorText = ui.getEditorText.bind(ui);
		editorInterceptActive = true;
		ui.setEditorText = (text: string) => {
			// When chat is focused, redirect voice transcript to Pompom's editor
			if (chatOverlayHandle && chatOverlayRef) {
				try { chatOverlayRef.editor.setText(text); } catch { /* fallback below */ }
				return;
			}
			originalSetEditorText!(text);
		};
		ui.getEditorText = () => {
			if (chatOverlayHandle && chatOverlayRef) {
				try { return chatOverlayRef.editor.getText(); } catch { /* fallback below */ }
			}
			return originalGetEditorText!();
		};
	}

	function restoreEditorIntercept() {
		if (!editorInterceptActive) return;
		editorInterceptActive = false;
		if (ctx?.hasUI) {
			const ui = ctx.ui as any;
			if (originalSetEditorText) ui.setEditorText = originalSetEditorText;
			if (originalGetEditorText) ui.getEditorText = originalGetEditorText;
		}
		originalSetEditorText = null;
		originalGetEditorText = null;
	}

	function closeChatOverlay() {
		const overlay = chatOverlayRef;
		restoreEditorIntercept();
		if (!overlay) {
			chatOverlayHandle = null;
			chatOverlayRef = null;
			return;
		}
		try {
			overlay.dispose();
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.error(`[pompom] closeChatOverlay failed: ${msg}`);
			chatOverlayRef = null;
			chatOverlayHandle = null;
		}
	}

	async function openPompomChat(commandContext: ExtensionContext) {
		if (chatOpenInProgress || chatOverlayHandle) return;
		if (!commandContext.hasUI) return;
		// Use the Pompom AI model if configured, otherwise fall back to session model
		const chatModel = resolvePompomModel(commandContext) || commandContext.model;
		if (!isModelLike(chatModel)) {
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
						model: chatModel as any,
						cwd: commandContext.cwd,
						thinkingLevel: (thinkingLevel === "off" ? "off" : thinkingLevel) as any,
						modelRegistry: commandContext.modelRegistry,
						sessionManager: commandContext.sessionManager as any,
						shortcut: CHAT_SHORTCUT_DISPLAY,
						onThinking: (active: boolean) => {
							// Trigger Pompom's visual thinking animation when chat is processing
							if (active) {
								pulseOverlay({ forceOverlay: true, lookX: 0.14, lookY: -0.08, glow: 0.9, earBoost: 0.7 }, 30000);
								pompomSay("[curious] Let me think about that...", 3.0, "commentary", 1, true);
							} else {
								overlayHint = null;
								overlayHintUntil = 0;
								applyAgentVisualState();
							}
						},
						onUnfocus: () => {
							chatOverlayHandle?.unfocus();
							// Restore main editor text interception when chat loses focus
							restoreEditorIntercept();
						},
						onClose: () => {
							restoreEditorIntercept();
							chatOverlayRef = null;
							chatOverlayHandle = null;
							done();
						},
					});
					// Intercept ctx.ui.setEditorText while chat is focused:
					// pi-voice writes transcripts here — redirect to Pompom's editor
					chatOverlayRef = overlay;
					installEditorIntercept(commandContext);
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
			restoreEditorIntercept();
			chatOverlayRef = null;
			chatOverlayHandle = null;
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[pompom] openPompomChat failed: ${msg}`);
		} finally {
			chatOpenInProgress = false;
		}
	}
}
