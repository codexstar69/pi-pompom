type Weather = "clear" | "cloudy" | "rain" | "snow" | "storm";
type AgentMood = "idle" | "curious" | "focused" | "busy" | "concerned" | "celebrating" | "sleepy";
type MessageRole = "user" | "assistant" | "toolResult" | "unknown";
type CommentaryBucket =
	| "agent_start"
	| "agent_end"
	| "tool_call"
	| "tool_result"
	| "tool_error"
	| "message_start_user"
	| "message_start_assistant"
	| "message_end_user"
	| "message_end_assistant"
	| "message_end_tool";

interface ActiveToolCall {
	toolCallId: string;
	toolName: string;
	startedAt: number;
}

interface SessionCounters {
	agentStarts: number;
	agentEnds: number;
	toolCalls: number;
	toolSuccesses: number;
	toolFailures: number;
	messageStarts: number;
	messageEnds: number;
	userMessages: number;
	assistantMessages: number;
	toolMessages: number;
	commentaryShown: number;
	totalToolDurationMs: number;
	longestToolDurationMs: number;
}

export interface SessionStats extends SessionCounters {
	activeToolCount: number;
	isAgentActive: boolean;
	mood: AgentMood;
	averageToolDurationMs: number;
	lastEventAt: number;
	lastCommentaryAt: number;
	lastToolName: string;
}

export interface SerializedAgentState {
	version: 1;
	mood: AgentMood;
	isAgentActive: boolean;
	activeAgentRuns: number;
	lastEventAt: number;
	lastCommentaryAt: number;
	lastCommentaryText: string;
	lastCommentaryBucket: CommentaryBucket | "";
	lastAgentStartAt: number;
	lastAgentEndAt: number;
	lastToolName: string;
	lastToolSucceededAt: number;
	lastToolFailedAt: number;
	lastMessageRole: MessageRole;
	activeToolCalls: Record<string, ActiveToolCall>;
	sessionStartedAt: number;
	counters: SessionCounters;
}

interface CommentaryRequest {
	eventName: string;
	role?: MessageRole;
	toolName?: string;
	isError?: boolean;
}

interface ToolCallInput {
	toolCallId?: string;
	toolName: string;
	args?: unknown;
}

interface ToolResultInput {
	toolCallId?: string;
	toolName: string;
	isError: boolean;
	result?: unknown;
}

const MIN_COMMENTARY_GAP_MS = 30000;
const SAME_BUCKET_GAP_MS = 60000;
const RECENT_ACTIVITY_WINDOW_MS = 25000;

const COMMENTARY_CHANCE: Record<CommentaryBucket, number> = {
	agent_start: 0.12,
	agent_end: 0.18,
	tool_call: 0.06,
	tool_result: 0.04,
	tool_error: 0.50,
	message_start_user: 0.025,
	message_start_assistant: 0.04,
	message_end_user: 0.02,
	message_end_assistant: 0.08,
	message_end_tool: 0.03,
};

const COMMENTARY_LINES: Record<CommentaryBucket, string[]> = {
	agent_start: [
		"Work mode on. I am watching the next move.",
		"New prompt spotted. Ears up.",
		"The coding run is starting.",
		"I can feel the tools warming up.",
		"Fresh task. Fresh focus.",
		"Time to shadow this turn.",
		"Another round. I am ready.",
		"Okay, brain gears are turning.",
	],
	agent_end: [
		"That turn is wrapped.",
		"Nice. The agent landed the reply.",
		"Done for now. I am still on watch.",
		"That cycle closed cleanly.",
		"Reply finished. Breathing room achieved.",
		"Task pulse is calming down.",
		"That was a full pass.",
		"Turn complete. Good pacing.",
	],
	tool_call: [
		"Tool call incoming: {tool}.",
		"Eyes on {tool}.",
		"Opening {tool} now.",
		"{tool} is up next.",
		"Small detour through {tool}.",
		"Tracking {tool}. Stay sharp.",
		"{tool} should move this forward.",
		"Focused on {tool}.",
		"Watching {tool} closely.",
		"{tool} is in motion.",
		"Tool lane engaged: {tool}.",
		"Here comes {tool}.",
	],
	tool_result: [
		"{tool} came back clean.",
		"Result received from {tool}.",
		"{tool} finished. Good signal.",
		"That {tool} run looks steady.",
		"{tool} just landed.",
		"Tool output ready from {tool}.",
		"{tool} paid off.",
		"Nice. {tool} returned data.",
		"{tool} is complete.",
		"Result locked in from {tool}.",
	],
	tool_error: [
		"{tool} hit a bump.",
		"That {tool} result looks rough.",
		"Okay, {tool} pushed back.",
		"I saw an error from {tool}.",
		"{tool} did not like that.",
		"This one needs a recovery move.",
		"{tool} tripped. We can re-route.",
		"Sharp turn here. {tool} failed.",
	],
	message_start_user: [
		"User message incoming.",
		"A new thought just arrived.",
		"Fresh context from the user.",
		"Input detected. Listening.",
		"The next instruction is here.",
		"User intent updated.",
	],
	message_start_assistant: [
		"Reply stream starting.",
		"The assistant is talking now.",
		"Output stream is waking up.",
		"Tokens are beginning to move.",
		"The answer is forming.",
		"Assistant voice is online.",
	],
	message_end_user: [
		"User message locked in.",
		"Input settled.",
		"Context stored.",
		"Got it. Message received.",
		"Prompt captured.",
		"That instruction is now in play.",
	],
	message_end_assistant: [
		"The answer just landed.",
		"Reply complete.",
		"Assistant message closed.",
		"That response is now settled.",
		"Output stream ended cleanly.",
		"Answer delivered.",
		"Message complete. Nice cadence.",
		"That wraps the spoken part.",
	],
	message_end_tool: [
		"Tool message recorded.",
		"Tool output joined the timeline.",
		"Another result is in the log.",
		"The tool message is closed.",
		"That tool result is now part of the run.",
		"Tool chatter settled down.",
	],
};

const state: SerializedAgentState = {
	version: 1,
	mood: "idle",
	isAgentActive: false,
	activeAgentRuns: 0,
	lastEventAt: 0,
	lastCommentaryAt: 0,
	lastCommentaryText: "",
	lastCommentaryBucket: "",
	lastAgentStartAt: 0,
	lastAgentEndAt: 0,
	lastToolName: "",
	lastToolSucceededAt: 0,
	lastToolFailedAt: 0,
	lastMessageRole: "unknown",
	activeToolCalls: {},
	sessionStartedAt: Date.now(),
	counters: {
		agentStarts: 0,
		agentEnds: 0,
		toolCalls: 0,
		toolSuccesses: 0,
		toolFailures: 0,
		messageStarts: 0,
		messageEnds: 0,
		userMessages: 0,
		assistantMessages: 0,
		toolMessages: 0,
		commentaryShown: 0,
		totalToolDurationMs: 0,
		longestToolDurationMs: 0,
	},
};

const lastBucketAt: Partial<Record<CommentaryBucket, number>> = {};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function sanitizeAscii(text: string): string {
	return text.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
}

function prettyToolName(toolName: string): string {
	return sanitizeAscii(toolName.replace(/[_-]+/g, " ")) || "tool";
}

function setEventNow(): number {
	const now = Date.now();
	state.lastEventAt = now;
	return now;
}

function resolveMood(now = Date.now()): AgentMood {
	const activeToolCount = Object.keys(state.activeToolCalls).length;
	if (state.lastToolFailedAt > 0 && now - state.lastToolFailedAt < 45000) {
		return "concerned";
	}
	if (state.lastAgentEndAt > 0 && now - state.lastAgentEndAt < 18000 && state.lastToolSucceededAt >= state.lastToolFailedAt) {
		return "celebrating";
	}
	if (activeToolCount >= 2) {
		return "busy";
	}
	if (activeToolCount === 1 || state.isAgentActive) {
		return "focused";
	}
	if (state.lastEventAt > 0 && now - state.lastEventAt > 8 * 60 * 1000) {
		return "sleepy";
	}
	if (state.lastEventAt > 0 && now - state.lastEventAt < RECENT_ACTIVITY_WINDOW_MS) {
		return "curious";
	}
	return "idle";
}

function refreshMood(): void {
	state.mood = resolveMood();
}

let syntheticIdCounter = 0;

function getToolCallId(input: { toolCallId?: string; toolName: string }): string {
	if (input.toolCallId && input.toolCallId.trim()) {
		return input.toolCallId;
	}
	syntheticIdCounter++;
	return `${input.toolName}-synth-${syntheticIdCounter}`;
}

function resolveTrackedToolCallId(input: { toolCallId?: string; toolName: string }): string {
	if (input.toolCallId && state.activeToolCalls[input.toolCallId]) {
		return input.toolCallId;
	}
	const matchingCalls = Object.entries(state.activeToolCalls)
		.filter(([, value]) => {
			return value.toolName === input.toolName;
		})
		.sort((left, right) => {
			return right[1].startedAt - left[1].startedAt;
		});
	if (matchingCalls.length > 0) {
		return matchingCalls[0][0];
	}
	return getToolCallId(input);
}

function pickLine(bucket: CommentaryBucket, toolName?: string): string {
	const lines = COMMENTARY_LINES[bucket];
	if (lines.length === 0) {
		return "";
	}
	let index = Math.floor(Math.random() * lines.length);
	if (lines.length > 1 && lines[index] === state.lastCommentaryText) {
		index = (index + 1) % lines.length;
	}
	return lines[index].replace(/\{tool\}/g, prettyToolName(toolName || "tool"));
}

function resolveBucket(request: CommentaryRequest): CommentaryBucket | null {
	if (request.eventName === "agent_start") {
		return "agent_start";
	}
	if (request.eventName === "agent_end") {
		return "agent_end";
	}
	if (request.eventName === "tool_call") {
		return "tool_call";
	}
	if (request.eventName === "tool_result") {
		return request.isError ? "tool_error" : "tool_result";
	}
	if (request.eventName === "message_start") {
		if (request.role === "assistant") {
			return "message_start_assistant";
		}
		if (request.role === "user") {
			return "message_start_user";
		}
		return null;
	}
	if (request.eventName === "message_end") {
		if (request.role === "assistant") {
			return "message_end_assistant";
		}
		if (request.role === "user") {
			return "message_end_user";
		}
		if (request.role === "toolResult") {
			return "message_end_tool";
		}
	}
	return null;
}

function noteMessageEvent(request: CommentaryRequest): void {
	if (request.eventName === "message_start") {
		state.counters.messageStarts += 1;
		if (request.role === "user") {
			state.counters.userMessages += 1;
		}
		if (request.role === "assistant") {
			state.counters.assistantMessages += 1;
		}
		if (request.role === "toolResult") {
			state.counters.toolMessages += 1;
		}
		state.lastMessageRole = request.role || "unknown";
		setEventNow();
		refreshMood();
		return;
	}
	if (request.eventName === "message_end") {
		state.counters.messageEnds += 1;
		state.lastMessageRole = request.role || "unknown";
		setEventNow();
		refreshMood();
	}
}

export function onToolCall({ toolCallId, toolName }: ToolCallInput): void {
	const now = setEventNow();
	const id = getToolCallId({ toolCallId, toolName });
	state.activeToolCalls[id] = {
		toolCallId: id,
		toolName,
		startedAt: now,
	};
	state.counters.toolCalls += 1;
	state.lastToolName = toolName;
	refreshMood();
}

export function onToolResult({ toolCallId, toolName, isError }: ToolResultInput): void {
	const now = setEventNow();
	const id = resolveTrackedToolCallId({ toolCallId, toolName });
	const exists = id in state.activeToolCalls;
	const startedAt = state.activeToolCalls[id]?.startedAt || now;
	const durationMs = Math.max(0, now - startedAt);
	delete state.activeToolCalls[id];
	if (!exists) {
		// Fallback: sweep oldest entry for this tool name to prevent leaks
		const match = Object.entries(state.activeToolCalls)
			.filter(([, v]) => v.toolName === toolName)
			.sort((a, b) => a[1].startedAt - b[1].startedAt);
		if (match.length > 0) delete state.activeToolCalls[match[0][0]];
	}
	state.counters.totalToolDurationMs += durationMs;
	state.counters.longestToolDurationMs = Math.max(state.counters.longestToolDurationMs, durationMs);
	state.lastToolName = toolName;
	if (isError) {
		state.counters.toolFailures += 1;
		state.lastToolFailedAt = now;
	} else {
		state.counters.toolSuccesses += 1;
		state.lastToolSucceededAt = now;
	}
	refreshMood();
}

export function onAgentStart(): void {
	state.activeAgentRuns += 1;
	state.isAgentActive = true;
	state.lastAgentStartAt = setEventNow();
	state.counters.agentStarts += 1;
	refreshMood();
}

export function onAgentEnd(): void {
	state.activeAgentRuns = Math.max(0, state.activeAgentRuns - 1);
	state.isAgentActive = state.activeAgentRuns > 0;
	state.lastAgentEndAt = setEventNow();
	state.counters.agentEnds += 1;
	refreshMood();
}

export function getCommentary(request: CommentaryRequest): string | null {
	noteMessageEvent(request);
	const bucket = resolveBucket(request);
	if (!bucket) {
		return null;
	}

	const now = Date.now();
	const lastForBucket = lastBucketAt[bucket] || 0;
	const gapSinceAny = now - state.lastCommentaryAt;
	const gapSinceBucket = now - lastForBucket;
	if (gapSinceAny < MIN_COMMENTARY_GAP_MS || gapSinceBucket < SAME_BUCKET_GAP_MS) {
		return null;
	}

	let chance = COMMENTARY_CHANCE[bucket];
	if (state.mood === "busy" && bucket === "tool_call") {
		chance += 0.18;
	}
	if (state.mood === "concerned" && bucket === "tool_error") {
		chance = 1;
	}
	if (state.mood === "celebrating" && bucket === "agent_end") {
		chance += 0.1;
	}
	chance = clamp(chance, 0, 1);
	if (Math.random() > chance) {
		return null;
	}

	const line = sanitizeAscii(pickLine(bucket, request.toolName));
	if (!line) {
		return null;
	}

	state.lastCommentaryAt = now;
	state.lastCommentaryText = line;
	state.lastCommentaryBucket = bucket;
	state.counters.commentaryShown += 1;
	lastBucketAt[bucket] = now;
	return line;
}

export function getAgentWeather(): Weather {
	refreshMood();
	const moodToWeather: Record<AgentMood, Weather> = {
		idle: "clear",
		curious: "cloudy",
		focused: "clear",
		busy: "rain",
		concerned: "storm",
		celebrating: "snow",
		sleepy: "cloudy",
	};
	return moodToWeather[state.mood];
}

export function shouldUseAgentWeather(): boolean {
	refreshMood();
	const now = Date.now();
	if (Object.keys(state.activeToolCalls).length > 0 || state.isAgentActive) {
		return true;
	}
	if (state.mood === "concerned" && now - state.lastToolFailedAt < RECENT_ACTIVITY_WINDOW_MS) {
		return true;
	}
	if (state.mood === "celebrating" && now - state.lastAgentEndAt < RECENT_ACTIVITY_WINDOW_MS) {
		return true;
	}
	return false;
}

export function getSessionStats(): SessionStats {
	refreshMood();
	const completedTools = state.counters.toolSuccesses + state.counters.toolFailures;
	return {
		...state.counters,
		activeToolCount: Object.keys(state.activeToolCalls).length,
		isAgentActive: state.isAgentActive,
		mood: state.mood,
		averageToolDurationMs: completedTools === 0 ? 0 : Math.round(state.counters.totalToolDurationMs / completedTools),
		lastEventAt: state.lastEventAt,
		lastCommentaryAt: state.lastCommentaryAt,
		lastToolName: state.lastToolName,
	};
}

export function getAgentState(): SerializedAgentState {
	refreshMood();
	return serializeState();
}

export function resetAgentState(): void {
	for (const key of Object.keys(lastBucketAt)) {
		delete lastBucketAt[key as CommentaryBucket];
	}
	state.mood = "idle";
	state.isAgentActive = false;
	state.activeAgentRuns = 0;
	state.lastEventAt = 0;
	state.lastCommentaryAt = 0;
	state.lastCommentaryText = "";
	state.lastCommentaryBucket = "";
	state.lastAgentStartAt = 0;
	state.lastAgentEndAt = 0;
	state.lastToolName = "";
	state.lastToolSucceededAt = 0;
	state.lastToolFailedAt = 0;
	state.lastMessageRole = "unknown";
	state.activeToolCalls = {};
	state.sessionStartedAt = Date.now();
	state.counters = {
		agentStarts: 0,
		agentEnds: 0,
		toolCalls: 0,
		toolSuccesses: 0,
		toolFailures: 0,
		messageStarts: 0,
		messageEnds: 0,
		userMessages: 0,
		assistantMessages: 0,
		toolMessages: 0,
		commentaryShown: 0,
		totalToolDurationMs: 0,
		longestToolDurationMs: 0,
	};
}

export function serializeState(): SerializedAgentState {
	return {
		version: 1,
		mood: state.mood,
		isAgentActive: state.isAgentActive,
		activeAgentRuns: state.activeAgentRuns,
		lastEventAt: state.lastEventAt,
		lastCommentaryAt: state.lastCommentaryAt,
		lastCommentaryText: state.lastCommentaryText,
		lastCommentaryBucket: state.lastCommentaryBucket,
		lastAgentStartAt: state.lastAgentStartAt,
		lastAgentEndAt: state.lastAgentEndAt,
		lastToolName: state.lastToolName,
		lastToolSucceededAt: state.lastToolSucceededAt,
		lastToolFailedAt: state.lastToolFailedAt,
		lastMessageRole: state.lastMessageRole,
		activeToolCalls: JSON.parse(JSON.stringify(state.activeToolCalls)),
		sessionStartedAt: state.sessionStartedAt,
		counters: { ...state.counters },
	};
}

export function restoreState(serializedState: SerializedAgentState | null | undefined): void {
	resetAgentState();
	if (!serializedState || serializedState.version !== 1) {
		return;
	}

	state.mood = serializedState.mood;
	state.isAgentActive = serializedState.isAgentActive;
	state.activeAgentRuns = serializedState.activeAgentRuns;
	state.lastEventAt = serializedState.lastEventAt;
	state.lastCommentaryAt = serializedState.lastCommentaryAt;
	state.lastCommentaryText = serializedState.lastCommentaryText;
	state.lastCommentaryBucket = serializedState.lastCommentaryBucket;
	state.lastAgentStartAt = serializedState.lastAgentStartAt;
	state.lastAgentEndAt = serializedState.lastAgentEndAt;
	state.lastToolName = serializedState.lastToolName;
	state.lastToolSucceededAt = serializedState.lastToolSucceededAt;
	state.lastToolFailedAt = serializedState.lastToolFailedAt;
	state.lastMessageRole = serializedState.lastMessageRole;
	state.sessionStartedAt = serializedState.sessionStartedAt;
	state.counters = { ...serializedState.counters };

	const restoredCalls: Record<string, ActiveToolCall> = {};
	for (const [key, value] of Object.entries(serializedState.activeToolCalls || {})) {
		if (!isRecord(value)) {
			continue;
		}
		const toolName = typeof value.toolName === "string" ? value.toolName : "";
		const startedAt = typeof value.startedAt === "number" ? value.startedAt : 0;
		const toolCallId = typeof value.toolCallId === "string" ? value.toolCallId : key;
		if (!toolName || startedAt <= 0) {
			continue;
		}
		restoredCalls[key] = { toolCallId, toolName, startedAt };
	}
	state.activeToolCalls = restoredCalls;
	refreshMood();
}

// ─── Stuck Detection & Agent Intelligence ───────────────────────────────────

export interface StuckSignal {
	isStuck: boolean;
	confidence: number;
	reasons: string[];
	suggestion: string;
}

export function getActiveToolDetails(): { toolName: string; durationMs: number; toolCallId: string }[] {
	const now = Date.now();
	return Object.values(state.activeToolCalls).map(t => ({
		toolName: t.toolName,
		durationMs: Math.max(0, now - t.startedAt),
		toolCallId: t.toolCallId,
	}));
}

export function detectStuck(): StuckSignal {
	const reasons: string[] = [];
	let confidence = 0;
	const now = Date.now();

	// Rule 1: Recent error pattern
	const lifetimeFails = state.counters.toolFailures;
	if (lifetimeFails >= 3 && state.lastToolFailedAt > state.lastToolSucceededAt) {
		const failStreak = Math.min(lifetimeFails, 10);
		if (failStreak >= 3) {
			reasons.push(`${failStreak} recent tool failures`);
			confidence += 0.35;
		}
	}

	// Rule 2: Agent running long without progress
	if (state.isAgentActive && state.lastAgentStartAt > 0) {
		const agentRunMs = now - state.lastAgentStartAt;
		const lastProgress = Math.max(state.lastToolSucceededAt, state.lastAgentEndAt);
		const timeSinceProgress = lastProgress > 0 ? now - lastProgress : agentRunMs;
		if (timeSinceProgress > 300_000) { // 5 minutes
			reasons.push(`No progress for ${Math.round(timeSinceProgress / 60000)}min`);
			confidence += 0.25;
		}
	}

	// Rule 3: High error rate
	const total = state.counters.toolSuccesses + state.counters.toolFailures;
	if (total >= 6) {
		const errorRate = state.counters.toolFailures / total;
		if (errorRate > 0.5) {
			reasons.push(`Error rate ${Math.round(errorRate * 100)}% across ${total} tool calls`);
			confidence += 0.2;
		}
	}

	// Rule 4: Low tool diversity (same tool repeatedly)
	const activeCount = Object.keys(state.activeToolCalls).length;
	if (state.counters.toolCalls > 10 && activeCount === 0 && state.lastToolName) {
		// Can't check diversity without history, but check if only using one tool type
		if (state.counters.toolCalls > 15) {
			reasons.push("High tool call count may indicate repetitive behavior");
			confidence += 0.1;
		}
	}

	// Build suggestion
	let suggestion = "Try providing more specific instructions.";
	if (confidence >= 0.35 && reasons.some(r => r.includes("failures"))) {
		suggestion = "The agent keeps hitting errors. Try a different approach or simplify the task.";
	} else if (reasons.some(r => r.includes("progress"))) {
		suggestion = "The agent has been running a while without results. Consider breaking the task into smaller steps.";
	} else if (reasons.some(r => r.includes("Error rate"))) {
		suggestion = "High failure rate. Consider switching models or giving the agent more context.";
	}

	return {
		isStuck: confidence >= 0.3,
		confidence: Math.min(1, confidence),
		reasons,
		suggestion,
	};
}

export function getAgentDashboard(): string {
	const stats = getSessionStats();
	const active = getActiveToolDetails();
	const now = Date.now();
	const mins = Math.round((now - state.sessionStartedAt) / 60000);
	const total = stats.toolSuccesses + stats.toolFailures;
	const rate = total > 0 ? Math.round((stats.toolSuccesses / total) * 100) : 100;

	const lines: string[] = [
		`Agent: ${stats.isAgentActive ? "ACTIVE" : "idle"}  Mood: ${stats.mood}  Session: ${mins}min`,
		"",
	];

	if (active.length > 0) {
		lines.push("Running now:");
		for (const t of active) {
			lines.push(`  ${t.toolName} — ${Math.round(t.durationMs / 1000)}s`);
		}
		lines.push("");
	}

	lines.push(`Tools: ${stats.toolCalls} calls (${stats.toolSuccesses} ok, ${stats.toolFailures} fail, ${rate}% success)`);
	if (stats.averageToolDurationMs > 0) {
		lines.push(`Speed: avg ${Math.round(stats.averageToolDurationMs)}ms, max ${stats.longestToolDurationMs}ms`);
	}
	lines.push(`Last tool: ${stats.lastToolName || "none"}`);

	return lines.join("\n");
}
