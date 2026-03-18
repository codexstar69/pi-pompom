/**
 * Pompom Chat — side agent overlay with read-only tools.
 * Opens as a capturing overlay (takes keyboard focus for typing).
 *
 * Rendering approach matches Pi's reference SideChatOverlay exactly:
 * - frameLine() wraps each content line with │ borders using truncateToWidth(line, width, "...", true)
 * - Editor renders raw lines, frameLine adds borders
 * - Total line count is not artificially capped — the overlay's maxHeight handles clipping
 */

import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from "@mariozechner/pi-agent-core";
import type { Model, TextContent, ToolCall, ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
import {
	buildSessionContext,
	convertToLlm,
	createReadOnlyTools,
	getSelectListTheme,
	type ModelRegistry,
	type SessionManager,
	type Theme,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Editor, Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type Focusable, type TUI } from "@mariozechner/pi-tui";

const POMPOM_SYSTEM = `
---
## Pompom Side Chat

You are Pompom, a cute fluffy coding companion with an antenna.
You are in a SIDE CHAT parallel to the main agent. The main agent is working independently and cannot see this conversation.

Use \`peek_main\` to check what the main agent is doing when the user asks about progress.
Use \`peek_main({ since_last: true })\` for recent activity only.

You understand these shortcut intents from the user:
- "analyze" / "what's happening" → use peek_main and give a detailed analysis of the agent's work
- "stuck" / "why is it stuck" / "is it stuck" → use peek_main({ since_last: true }) and check for stuck patterns
- "recap" / "summary" → use peek_main and summarize the session concisely
- "status" → report main agent status, tool calls, mood
- "help" → list available commands and what you can do

Be concise, warm, and practical. This is for quick questions and status checks.
If the user wants something the main agent is handling, suggest waiting for it to finish.`;

const SPINNER = ["\u280b", "\u2819", "\u2839", "\u2838", "\u283c", "\u2834", "\u2826", "\u2827", "\u2807", "\u280f"];

const THINKING_LINES = [
	"(o'o) Hmm, let me think...",
	"(o'o) Processing those brain gears...",
	"(o'o) Thinking really hard right now...",
	"(o'o) Give me a sec...",
	"(o'o) Working on it!",
	"(o'o) My antenna is glowing...",
	"(o'o) Crunching the numbers...",
	"(o'o) Almost there...",
];

// Chat history is per-session only — each session starts fresh.

const INITIAL_POMPOM_MESSAGE = "Hi! Try: analyze, stuck, recap, status, help — or just ask me anything!";

type DisplayMessage = { role: "user" | "pompom" | "tool" | "error"; text: string };

function isTextContent(block: unknown): block is TextContent {
	return block !== null && typeof block === "object" && "type" in block && "text" in block
		&& (block as { type?: unknown }).type === "text"
		&& typeof (block as { text?: unknown }).text === "string";
}

function isToolCallContent(block: unknown): block is ToolCall {
	return block !== null && typeof block === "object" && "type" in block && "name" in block
		&& (block as { type?: unknown }).type === "toolCall"
		&& typeof (block as { name?: unknown }).name === "string";
}

function extractUserText(message: UserMessage): string {
	if (typeof message.content === "string") {
		return message.content;
	}
	return message.content.filter(isTextContent).map((block) => {
		return block.text;
	}).join("");
}

function redactToolText(text: string, maxLen: number): string {
	const patterns: Array<{ pattern: RegExp; replacement: string }> = [
		{ pattern: /Bearer\s+[A-Za-z0-9._\-+/=]{16,}/gi, replacement: "Bearer [redacted]" },
		{ pattern: /data:[^;\s]+;base64,[A-Za-z0-9+/=]+/gi, replacement: "data:[redacted]" },
		{ pattern: /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|xox[baprs]|api[_-]?key|token|sess)[-_A-Za-z0-9]{12,}\b/gi, replacement: "[redacted-secret]" },
		{ pattern: /\b[A-Fa-f0-9]{32,}\b/g, replacement: "[redacted-token]" },
		{ pattern: /\b[A-Za-z0-9+/_=-]{40,}\b/g, replacement: "[redacted-token]" },
	];
	let safeText = text.replace(/\s+/g, " ").trim();
	for (const { pattern, replacement } of patterns) {
		safeText = safeText.replace(pattern, replacement);
	}
	return safeText.slice(0, maxLen);
}

function formatAssistantMessage(message: Extract<AgentMessage, { role: "assistant" }>): string {
	const texts = message.content.filter(isTextContent).map((block) => {
		return block.text;
	}).join(" ");
	return texts.trim();
}

function extractContentType(block: unknown): string | null {
	if (block === null || typeof block !== "object") {
		return null;
	}
	if (!("type" in block)) {
		return null;
	}
	const type = (block as { type?: unknown }).type;
	return typeof type === "string" ? type : null;
}

function summarizeNonTextContent(message: ToolResultMessage): string {
	const typeCounts = message.content
		.map((block) => {
			return extractContentType(block);
		})
		.filter((type): type is string => {
			return Boolean(type) && type !== "text";
		})
		.reduce<Record<string, number>>((acc, type) => {
			const current = acc[type] || 0;
			return { ...acc, [type]: current + 1 };
		}, {});
	const parts = Object.entries(typeCounts).map(([type, count]) => {
		return count > 1 ? `${type}x${count}` : type;
	});
	return parts.join(", ");
}

function summarizeToolDetails(message: ToolResultMessage, maxLen: number): string {
	const maybeDetails = message as ToolResultMessage & { details?: unknown };
	const details = maybeDetails.details;
	if (typeof details === "string") {
		return redactToolText(details, Math.max(20, Math.floor(maxLen / 2)));
	}
	if (details === null || typeof details !== "object") {
		return "";
	}
	const keys = Object.keys(details as Record<string, unknown>).slice(0, 4);
	if (keys.length === 0) {
		return "";
	}
	return `details:${keys.join("|")}`;
}

function formatToolSummary(message: ToolResultMessage, maxLen: number): string {
	const rawText = message.content.filter(isTextContent).map((block) => {
		return block.text;
	}).join(" ");
	const safeText = redactToolText(rawText, maxLen);
	const nonTextSummary = summarizeNonTextContent(message);
	const detailsSummary = summarizeToolDetails(message, maxLen);
	const metadataSummary = [nonTextSummary, detailsSummary].filter(Boolean).join(", ");
	const state = message.isError ? "failed" : "ok";
	const prefix = `[${message.toolName || "tool"} ${state}]`;
	if (safeText && metadataSummary) {
		return `${prefix}: ${safeText} (${metadataSummary})`;
	}
	if (safeText) {
		return `${prefix}: ${safeText}`;
	}
	if (metadataSummary) {
		return `${prefix}: (${metadataSummary})`;
	}
	return message.isError
		? `${prefix}: (failed without text output)`
		: `${prefix}: (completed without text output)`;
}

interface PompomChatOptions {
	tui: TUI;
	theme: Theme;
	model: Model<any>;
	cwd: string;
	thinkingLevel: string;
	modelRegistry: ModelRegistry;
	sessionManager: SessionManager;
	shortcut: string;
	onUnfocus: () => void;
	onClose: () => void;
	onThinking?: (active: boolean) => void;
}

export class PompomChatOverlay implements Component, Focusable {
	private agent: Agent;
	public editor: Editor;
	private displayMessages: DisplayMessage[] = [];
	private localMessages: DisplayMessage[] = [];
	private isStreaming = false;
	private streamingText = "";
	private _focused = true;
	private disposed = false;
	private agentUnsub: (() => void) | null = null;
	private userInputTexts: Map<number, string> = new Map();
	private peekTool: AgentTool;
	private spinnerTimer: NodeJS.Timeout | null = null;
	private spinnerFrame = 0;
	private thinkingLineIdx = 0;
	private toolStatus = "";
	private errorText = "";
	private scrollOffset = 0;
	private lastTotalMsgLines = 0;
	private lastMaxLines = 20;
	private displayVersion = 0;
	private wrappedMessagesCache: { version: number; width: number; lines: string[] } | null = null;

	get focused() { return this._focused; }
	set focused(v: boolean) { this._focused = v; this.editor.focused = v; }

	constructor(private opts: PompomChatOptions) {
		const tools = createReadOnlyTools(opts.cwd);
		this.peekTool = this.createPeekMain(opts.sessionManager);

		this.agent = new Agent({
			initialState: {
				systemPrompt: POMPOM_SYSTEM,
				model: opts.model,
				thinkingLevel: opts.thinkingLevel === "off" ? undefined : opts.thinkingLevel as any,
				tools: [...tools, this.peekTool],
				messages: [],
			},
			convertToLlm,
			getApiKey: async (provider) => {
				const key = await opts.modelRegistry.getApiKeyForProvider(provider);
				if (!key) throw new Error("No API key");
				return key;
			},
		});

		this.agentUnsub = this.agent.subscribe((e) => this.onAgentEvent(e));
		this.editor = new Editor(opts.tui, { borderColor: (t: string) => opts.theme.fg("borderMuted", t), selectList: getSelectListTheme() }, { paddingX: 0 });
		this.editor.focused = true;
		this.editor.onSubmit = (text) => { this.onSubmit(text).catch(err => console.error("[pompom-chat] onSubmit error:", err instanceof Error ? err.message : err)); };

		this.displayMessages.push({ role: "pompom", text: INITIAL_POMPOM_MESSAGE });
		this.markDisplayDirty();
	}

	private createPeekMain(sm: SessionManager): AgentTool {
		return {
			name: "peek_main",
			label: "peek_main",
			description: "View main agent recent activity. Use when user asks about progress.",
			parameters: Type.Object({
				lines: Type.Optional(Type.Integer({ description: "Max items (default: 15)", minimum: 1, maximum: 30 })),
				since_last: Type.Optional(Type.Boolean({ description: "Only recent activity" })),
			}),
			execute: async (_id, args: unknown) => {
				const params = (args && typeof args === "object" ? args : {}) as { lines?: number; since_last?: boolean };
				try {
					const entries = sm.getEntries();
					const ctx = buildSessionContext(entries, sm.getLeafId());
					let msgs = ctx.messages;
					if (params.since_last) msgs = msgs.slice(-5);
					else msgs = msgs.slice(-(params.lines ?? 15));

					if (!msgs.length) {
						return { content: [{ type: "text" as const, text: "No recent activity from main agent." }], details: {} };
					}

					const formatted = msgs.map(m => {
						if (m.role === "user") {
							return "[User]: " + extractUserText(m as UserMessage).slice(0, 200);
						}
						if (m.role === "assistant") {
							const texts = formatAssistantMessage(m).slice(0, 300);
							const tools = m.content.filter(isToolCallContent).map((block) => {
								return block.name;
							});
							const parts = [texts.slice(0, 300), tools.length ? "[Tools: " + tools.join(", ") + "]" : ""].filter(Boolean);
							return "[Agent]: " + parts.join(" ");
						}
						if (m.role === "toolResult") {
							return formatToolSummary(m, 80);
						}
						return "";
					}).filter(Boolean).join("\n\n");

					return { content: [{ type: "text" as const, text: "Main agent activity:\n\n" + formatted }], details: {} };
				} catch {
					return { content: [{ type: "text" as const, text: "Could not read main agent state." }], details: {} };
				}
			},
		};
	}

	private expandShortcut(input: string): string {
		const lower = input.toLowerCase().trim();
		// "help" — show inline help, don't send to agent
		if (lower === "help" || lower === "/help" || lower === "commands") {
			return "";
		}
		// Expand shortcut keywords into richer prompts
		if (lower === "analyze" || lower === "analysis" || lower === "what's happening" || lower === "whats happening") {
			return "Use peek_main to check on the main agent's recent activity, then give me a detailed analysis of what it's doing, any issues, and what's next.";
		}
		if (lower === "stuck" || lower === "is it stuck" || lower === "why is it stuck" || lower === "stuck?") {
			return "Use peek_main({ since_last: true }) to check the main agent's recent activity. Is it stuck? Look for repeated errors, lack of progress, or looping behavior. Give me a clear assessment.";
		}
		if (lower === "recap" || lower === "summary" || lower === "summarize") {
			return "Use peek_main to see the full session activity, then give me a concise recap: what was done, what's in progress, any issues.";
		}
		if (lower === "status" || lower === "how's it going" || lower === "hows it going") {
			return "Use peek_main({ since_last: true }) and briefly report: what is the main agent doing right now? Any active tool calls?";
		}
		return input;
	}

	private handleLocalCommand(input: string): boolean {
		const lower = input.toLowerCase().trim();
		if (lower === "help" || lower === "/help" || lower === "commands") {
			this.localMessages = []; // clear previous help output
			this.localMessages.push({ role: "pompom", text: "Commands you can type here:" });
			this.localMessages.push({ role: "tool", text: "analyze — detailed analysis of main agent work" });
			this.localMessages.push({ role: "tool", text: "stuck — check if main agent is stuck" });
			this.localMessages.push({ role: "tool", text: "recap — session summary" });
			this.localMessages.push({ role: "tool", text: "status — quick status check" });
			this.localMessages.push({ role: "tool", text: "This is a read-only side chat \u2014 file edits happen in the main agent." });
			this.localMessages.push({ role: "tool", text: "help — show this list" });
			this.localMessages.push({ role: "pompom", text: "Or just ask me anything in plain English!" });
			this.syncMessages();
			this.opts.tui.requestRender();
			return true;
		}
		if (lower === "/write" || lower.startsWith("/write ")) {
			this.localMessages = [];
			this.localMessages.push({ role: "pompom", text: "Write mode is disabled \u2014 Pompom's side chat is read-only for safety. Use the main agent for file edits." });
			this.syncMessages();
			this.opts.tui.requestRender();
			return true;
		}
		return false;
	}

	private markDisplayDirty(): void {
		this.displayVersion++;
		this.wrappedMessagesCache = null;
	}

	private async onSubmit(text: string) {
		const trimmed = text.trim();
		if (!trimmed || this.isStreaming || this.disposed) return;

		this.editor.setText("");

		// Handle local commands (don't send to agent)
		if (this.handleLocalCommand(trimmed)) {
			return;
		}

		// Expand shortcuts into richer prompts
		const expanded = this.expandShortcut(trimmed);
		if (!expanded) return; // empty = handled locally

		const promptIndex = this.agent.state.messages.length; // index where user msg will appear
		this.userInputTexts.set(promptIndex, trimmed);
		const wasAtBottom = this.scrollOffset === 0;
		this.displayMessages.push({ role: "user", text: trimmed });
		this.markDisplayDirty();
		this.isStreaming = true;
		this.streamingText = "";
		this.errorText = "";
		if (wasAtBottom) this.scrollOffset = 0;
		this.startSpinner();
		this.opts.onThinking?.(true);
		this.opts.tui.requestRender();

		try {
			await this.agent.prompt(expanded);
		} catch (e) {
			if (!this.disposed) {
				this.errorText = e instanceof Error ? e.message : "Unknown error";
			}
		} finally {
			this.isStreaming = false;
			this.streamingText = "";
			this.stopSpinner();
			this.toolStatus = "";
			this.opts.onThinking?.(false);
			if (!this.disposed) {
				this.syncMessages();
				if (wasAtBottom) this.scrollOffset = 0;
				this.opts.tui.requestRender();
			}
		}
	}

	private syncMessages() {
		const nextMessages: DisplayMessage[] = [
			{ role: "pompom", text: INITIAL_POMPOM_MESSAGE },
		];
		let msgIndex = 0;
		for (const m of this.agent.state.messages) {
			if (m.role === "user") {
				const displayText = this.userInputTexts.get(msgIndex) || extractUserText(m as UserMessage);
				if (displayText) nextMessages.push({ role: "user", text: displayText });
			} else if (m.role === "assistant") {
				const text = formatAssistantMessage(m);
				if (text) nextMessages.push({ role: "pompom", text });
			} else if (m.role === "toolResult") {
				const summary = formatToolSummary(m, 200);
				nextMessages.push({ role: m.isError ? "error" : "tool", text: summary });
			}
			msgIndex++;
		}
		const maxKey = this.agent.state.messages.length;
		for (const key of this.userInputTexts.keys()) {
			if (key < maxKey - 50) this.userInputTexts.delete(key);
		}
		// Append locally-injected messages (help output, etc.) — they survive agent syncs
		for (const lm of this.localMessages) {
			nextMessages.push(lm);
		}
		if (this.errorText) {
			nextMessages.push({ role: "error", text: this.errorText });
		}
		this.displayMessages = nextMessages;
		this.markDisplayDirty();
	}

	private onAgentEvent(event: AgentEvent) {
		if (this.disposed || !this.isStreaming) return;
		if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
			this.stopSpinner();
			this.streamingText += event.assistantMessageEvent.delta;
		} else if (event.type === "tool_execution_start") {
			this.stopSpinner();
			this.toolStatus = "Running " + event.toolName + "...";
		} else if (event.type === "tool_execution_end") {
			this.startSpinner();
			this.toolStatus = "";
		}
		this.opts.tui.requestRender();
	}

	private startSpinner() {
		this.stopSpinner();
		this.spinnerFrame = 0;
		this.thinkingLineIdx = Math.floor(Math.random() * THINKING_LINES.length);
		let tickCount = 0;
		this.spinnerTimer = setInterval(() => {
			if (this.disposed) { this.stopSpinner(); return; }
			this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER.length;
			tickCount++;
			// Cycle thinking line every ~2.5s (30 ticks at 80ms)
			if (tickCount % 30 === 0) {
				this.thinkingLineIdx = (this.thinkingLineIdx + 1) % THINKING_LINES.length;
			}
			this.opts.tui.requestRender();
		}, 80);
	}

	private stopSpinner() {
		if (this.spinnerTimer) { clearInterval(this.spinnerTimer); this.spinnerTimer = null; }
	}

	private getWrappedDisplayLines(innerWidth: number): string[] {
		if (
			this.wrappedMessagesCache
			&& this.wrappedMessagesCache.version === this.displayVersion
			&& this.wrappedMessagesCache.width === innerWidth
		) {
			return this.wrappedMessagesCache.lines;
		}
		const wrappedLines: string[] = [];
		for (const msg of this.displayMessages) {
			const prefix = msg.role === "user" ? this.opts.theme.fg("accent", "You: ")
				: msg.role === "pompom" ? this.opts.theme.fg("success", "(o'o) ")
				: msg.role === "tool" ? this.opts.theme.fg("dim", "")
				: this.opts.theme.fg("error", "Error: ");
			const prefixW = msg.role === "user" ? 5 : msg.role === "pompom" ? 6 : msg.role === "tool" ? 0 : 7;
			this.wrapInto(wrappedLines, prefix, prefixW, msg.text, innerWidth);
		}
		this.wrappedMessagesCache = {
			version: this.displayVersion,
			width: innerWidth,
			lines: wrappedLines,
		};
		return wrappedLines;
	}

	// Match Pi's reference implementation exactly: │ + content padded to width + │
	private frameLine(line: string, innerWidth: number): string {
		const { theme } = this.opts;
		const bc = this._focused ? "border" : "borderMuted";
		return theme.fg(bc, "\u2502 ") + truncateToWidth(line, innerWidth, "...", true) + theme.fg(bc, " \u2502");
	}

	handleInput(data: string): void {
		try {
			if (matchesKey(data, Key.escape)) {
				if (this.isStreaming) {
					this.agent.abort();
					this.isStreaming = false;
					this.streamingText = "";
					this.toolStatus = "";
					this.errorText = "";
					this.stopSpinner();
				} else this.dispose();
				return;
			}
			if (matchesKey(data, this.opts.shortcut as any)) { this.opts.onUnfocus(); return; }
			if (matchesKey(data, Key.alt("up")) || matchesKey(data, "pageUp" as any)) {
				this.scrollOffset = Math.min(this.scrollOffset + 5, Math.max(0, this.lastTotalMsgLines - this.lastMaxLines));
				this.opts.tui.requestRender(); return;
			}
			if (matchesKey(data, Key.alt("down")) || matchesKey(data, "pageDown" as any)) {
				this.scrollOffset = Math.max(0, this.scrollOffset - 5);
				this.opts.tui.requestRender(); return;
			}
			this.editor.handleInput(data);
			this.opts.tui.requestRender();
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.error(`[pompom-chat] handleInput error: ${msg}`);
		}
	}

	render(width: number): string[] {
		if (width < 4) return [" ".repeat(Math.max(0, width))];

		const { theme } = this.opts;
		const innerWidth = width - 4;
		const lines: string[] = [];
		const bc = this._focused ? "border" : "borderMuted";
		const bw = Math.max(0, width - 2);

		// Themed header — rounded corners, kawaii face, sparkle when streaming
		const pompomFace = theme.fg("success", "(o") + theme.fg("warning", "'") + theme.fg("success", "o)");
		const sparkle = this.isStreaming ? theme.fg("warning", " " + SPINNER[this.spinnerFrame]) : theme.fg("dim", " \u2727");
		const modeTag = theme.fg("dim", " [Read-only]");
		const title = this._focused
			? pompomFace + " " + theme.fg("accent", "Pompom Chat") + modeTag + sparkle
			: theme.fg("dim", "(o'o) Pompom Chat") + modeTag;
		const status = this.toolStatus ? theme.fg("dim", " \u2022 " + this.toolStatus) : "";
		lines.push(theme.fg(bc, "\u256d" + "\u2500".repeat(bw) + "\u256e"));
		lines.push(this.frameLine(title + status, innerWidth));
		lines.push(this.frameLine("", innerWidth));
		lines.push(theme.fg(bc, "\u251c" + "\u2500".repeat(bw) + "\u2524"));

		// Messages — responsive: use 55% of terminal height, minimum 6 lines
		const maxLines = Math.max(6, Math.floor(this.opts.tui.terminal.rows * 0.55) - 8);

		// Build wrapped message lines
		const allMsgLines: string[] = [...this.getWrappedDisplayLines(innerWidth)];
		if (this.isStreaming && !this.streamingText) {
			// Animated thinking indicator — shows while model is processing before any output
			const dots = ".".repeat((this.spinnerFrame % 3) + 1);
			const thinkText = THINKING_LINES[this.thinkingLineIdx % THINKING_LINES.length] + dots;
			const thinkPrefix = theme.fg("warning", SPINNER[this.spinnerFrame] + " ");
			allMsgLines.push(thinkPrefix + theme.fg("dim", thinkText));
		}
		if (this.streamingText) {
			this.wrapInto(allMsgLines, theme.fg("success", "(o'o) "), 6, this.streamingText, innerWidth);
		}

		this.lastTotalMsgLines = allMsgLines.length;
		this.lastMaxLines = maxLines;

		// Scroll and display
		const startIdx = Math.max(0, allMsgLines.length - maxLines - this.scrollOffset);
		const visible = allMsgLines.slice(startIdx, startIdx + maxLines);
		for (const ml of visible) lines.push(this.frameLine(ml, innerWidth));
		for (let i = visible.length; i < maxLines; i++) lines.push(this.frameLine("", innerWidth));

		// Editor — render raw lines from Editor, wrap each in frameLine
		lines.push(theme.fg(bc, "\u251c" + "\u2500".repeat(bw) + "\u2524"));
		for (const editorLine of this.editor.render(innerWidth)) {
			lines.push(this.frameLine(editorLine, innerWidth));
		}

		// Footer — rounded bottom corners, kawaii hints
		lines.push(theme.fg(bc, "\u251c" + "\u2500".repeat(bw) + "\u2524"));
		const newIndicator = this.scrollOffset > 0 ? theme.fg("warning", "  \u2022  \u2193 new") : "";
		const hints = this._focused
			? theme.fg("dim", "Esc " + (this.isStreaming ? "stop" : "close") + "  \u2022  Enter send  \u2022  Alt+\u2191\u2193 scroll  \u2022  " + this.opts.shortcut + " unfocus  \u2022  type help") + newIndicator
			: theme.fg("dim", this.opts.shortcut + " \u2192 focus");
		lines.push(this.frameLine(hints, innerWidth));
		lines.push(theme.fg(bc, "\u2570" + "\u2500".repeat(bw) + "\u256f"));

		return lines.map(l => visibleWidth(l) > width ? truncateToWidth(l, width) : l);
	}

	/** Wrap text using Pi's built-in ANSI-aware word wrapper, prepending a prefix to the first line. */
	private wrapInto(out: string[], prefix: string, _prefixW: number, text: string, maxW: number) {
		const fullText = prefix + text;
		const wrapped = wrapTextWithAnsi(fullText, Math.max(4, maxW));
		for (const line of wrapped) out.push(line);
	}


	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.stopSpinner();
		if (this.agentUnsub) { this.agentUnsub(); this.agentUnsub = null; }
		this.agent.abort();
		this.opts.onClose();
	}

	invalidate() {
		this.editor.invalidate();
	}
}

export interface OpenChatOptions {
	model: Model<any>;
	cwd: string;
	thinkingLevel: string;
	modelRegistry: ModelRegistry;
	sessionManager: SessionManager;
}
