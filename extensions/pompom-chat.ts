/**
 * Pompom Chat — side agent overlay with read-only tools.
 * Opens as a capturing overlay (takes keyboard focus for typing).
 */

import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
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
import { Editor, Key, matchesKey, truncateToWidth, visibleWidth, type Component, type Focusable, type TUI } from "@mariozechner/pi-tui";

const POMPOM_SYSTEM = `
---
## Pompom Side Chat

You are Pompom, a cute fluffy coding companion with an antenna.
You are in a SIDE CHAT parallel to the main agent. The main agent is working independently and cannot see this conversation.

Use \`peek_main\` to check what the main agent is doing when the user asks about progress.
Use \`peek_main({ since_last: true })\` for recent activity only.

Be concise, warm, and practical. This is for quick questions and status checks.
If the user wants something the main agent is handling, suggest waiting for it to finish.`;

const SPINNER = ["\u280b", "\u2819", "\u2839", "\u2838", "\u283c", "\u2834", "\u2826", "\u2827", "\u2807", "\u280f"];

interface PompomChatOptions {
	tui: TUI;
	theme: Theme;
	model: Model<any>;
	cwd: string;
	thinkingLevel: "off" | "low" | "medium" | "high";
	modelRegistry: ModelRegistry;
	sessionManager: SessionManager;
	shortcut: string;
	onUnfocus: () => void;
	onClose: () => void;
}

export class PompomChatOverlay implements Component, Focusable {
	private agent: Agent;
	private editor: Editor;
	private displayMessages: { role: string; text: string }[] = [];
	private isStreaming = false;
	private streamingText = "";
	private _focused = true;
	private disposed = false;
	private peekTool: AgentTool;
	private spinnerTimer: NodeJS.Timeout | null = null;
	private spinnerFrame = 0;
	private toolStatus = "";
	private errorText = "";
	private scrollOffset = 0;
	private cachedWidth?: number;
	private cachedLines?: string[];

	get focused() { return this._focused; }
	set focused(v: boolean) { this._focused = v; this.editor.focused = v; }

	constructor(private opts: PompomChatOptions) {
		const tools = createReadOnlyTools(opts.cwd);
		this.peekTool = this.createPeekMain(opts.sessionManager);

		this.agent = new Agent({
			initialState: {
				systemPrompt: POMPOM_SYSTEM,
				model: opts.model,
				thinkingLevel: opts.thinkingLevel === "off" ? undefined : opts.thinkingLevel,
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

		this.agent.subscribe((e) => this.onAgentEvent(e));
		this.editor = new Editor(opts.tui, { borderColor: (t: string) => opts.theme.fg("borderMuted", t), selectList: getSelectListTheme() }, { paddingX: 0 });
		this.editor.focused = true;
		this.editor.onSubmit = (text) => this.onSubmit(text);

		this.displayMessages.push({ role: "pompom", text: "Hi! Ask me anything or use peek_main to check." });
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
							const c = typeof m.content === "string" ? m.content : m.content.map(b => b.type === "text" ? b.text : "").join("");
							return "[User]: " + c.slice(0, 200);
						}
						if (m.role === "assistant") {
							const texts = m.content.filter(b => b.type === "text").map(b => (b as any).text).join(" ");
							const tools = m.content.filter(b => b.type === "toolCall").map(b => (b as any).toolName);
							const parts = [texts.slice(0, 300), tools.length ? "[Tools: " + tools.join(", ") + "]" : ""].filter(Boolean);
							return "[Agent]: " + parts.join(" ");
						}
						if (m.role === "toolResult") {
							const t = m.content[0]?.type === "text" ? (m.content[0] as any).text : "";
							return "[" + (m as any).toolName + "]: " + t.slice(0, 100);
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

	private async onSubmit(text: string) {
		const trimmed = text.trim();
		if (!trimmed || this.isStreaming || this.disposed) return;

		this.editor.setText("");
		this.displayMessages.push({ role: "user", text: trimmed });
		this.isStreaming = true;
		this.streamingText = "";
		this.errorText = "";
		this.startSpinner();
		this.invalidate();

		try {
			await this.agent.prompt(trimmed);
		} catch (e) {
			if (!this.disposed) {
				this.errorText = e instanceof Error ? e.message : "Unknown error";
			}
		} finally {
			this.isStreaming = false;
			this.streamingText = "";
			this.stopSpinner();
			this.toolStatus = "";
			// Sync display from agent messages
			this.syncMessages();
			if (!this.disposed) this.invalidate();
			this.opts.tui.requestRender();
		}
	}

	private syncMessages() {
		this.displayMessages = [
			{ role: "pompom", text: "Hi! Ask me anything or use peek_main to check on the main agent." },
		];
		for (const m of this.agent.state.messages) {
			if (m.role === "user") {
				const c = typeof m.content === "string" ? m.content : m.content.map(b => b.type === "text" ? b.text : "").join("");
				if (c) this.displayMessages.push({ role: "user", text: c });
			} else if (m.role === "assistant") {
				const t = m.content.filter(b => b.type === "text").map(b => (b as any).text).join(" ");
				if (t) this.displayMessages.push({ role: "pompom", text: t });
			}
		}
		if (this.errorText) {
			this.displayMessages.push({ role: "error", text: this.errorText });
		}
	}

	private onAgentEvent(event: AgentEvent) {
		if (this.disposed) return;
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
		this.invalidate();
		this.opts.tui.requestRender();
	}

	private startSpinner() {
		this.stopSpinner();
		this.spinnerFrame = 0;
		this.spinnerTimer = setInterval(() => {
			this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER.length;
			this.invalidate();
			this.opts.tui.requestRender();
		}, 80);
	}

	private stopSpinner() {
		if (this.spinnerTimer) { clearInterval(this.spinnerTimer); this.spinnerTimer = null; }
	}

	handleInput(data: string): void {
		try {
			if (matchesKey(data, Key.escape)) {
				if (this.isStreaming) this.agent.abort();
				else this.dispose();
				return;
			}
			if (matchesKey(data, this.opts.shortcut as any)) { this.opts.onUnfocus(); return; }
			// Scroll
			if (matchesKey(data, Key.alt("up")) || matchesKey(data, "pageUp" as any)) {
				this.scrollOffset = Math.min(this.scrollOffset + 3, Math.max(0, this.displayMessages.length - 3));
				this.invalidate(); this.opts.tui.requestRender(); return;
			}
			if (matchesKey(data, Key.alt("down")) || matchesKey(data, "pageDown" as any)) {
				this.scrollOffset = Math.max(0, this.scrollOffset - 3);
				this.invalidate(); this.opts.tui.requestRender(); return;
			}
			this.editor.handleInput(data);
			this.opts.tui.requestRender();
		} catch { /* silent */ }
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		if (width < 10) return [" ".repeat(width)];

		const { theme } = this.opts;
		const iw = width - 4;
		const bc = this._focused ? "border" : "borderMuted";
		const frame = (content: string) => {
			const cw = visibleWidth(content);
			const pad = Math.max(0, iw - cw);
			return theme.fg(bc, "\u2502 ") + truncateToWidth(content, iw) + " ".repeat(pad) + theme.fg(bc, " \u2502");
		};

		const lines: string[] = [];

		// Header
		const title = this._focused ? theme.fg("accent", "Pompom Chat") : theme.fg("dim", "Pompom Chat (unfocused)");
		const streaming = this.isStreaming ? theme.fg("warning", " " + SPINNER[this.spinnerFrame]) : "";
		const status = this.toolStatus ? theme.fg("dim", " [" + this.toolStatus + "]") : "";
		lines.push(theme.fg(bc, "\u250c" + "\u2500".repeat(width - 2) + "\u2510"));
		lines.push(frame(title + streaming + status));
		lines.push(theme.fg(bc, "\u251c" + "\u2500".repeat(width - 2) + "\u2524"));

		// Messages
		const maxMsgLines = Math.max(6, Math.floor(this.opts.tui.terminal.rows * 0.35) - 4);
		const allMsgLines: string[] = [];

		for (const msg of this.displayMessages) {
			const prefix = msg.role === "user" ? theme.fg("accent", "You: ")
				: msg.role === "pompom" ? theme.fg("success", "Pompom: ")
				: theme.fg("error", "Error: ");
			const wrapped = truncateToWidth(prefix + msg.text, iw);
			allMsgLines.push(wrapped);
		}

		if (this.streamingText) {
			allMsgLines.push(theme.fg("success", "Pompom: ") + truncateToWidth(this.streamingText, iw - 8));
		}

		// Scroll: show last N lines
		const startIdx = Math.max(0, allMsgLines.length - maxMsgLines - this.scrollOffset);
		const visible = allMsgLines.slice(startIdx, startIdx + maxMsgLines);
		for (const ml of visible) lines.push(frame(ml));
		for (let i = visible.length; i < maxMsgLines; i++) lines.push(frame(""));

		// Editor
		lines.push(theme.fg(bc, "\u251c" + "\u2500".repeat(width - 2) + "\u2524"));
		for (const el of this.editor.render(iw)) lines.push(frame(el));

		// Footer
		const hints = this._focused
			? theme.fg("dim", "Esc " + (this.isStreaming ? "stop" : "close") + " \u00b7 Enter send \u00b7 " + this.opts.shortcut + " unfocus")
			: theme.fg("dim", this.opts.shortcut + " \u2192 focus");
		lines.push(theme.fg(bc, "\u251c" + "\u2500".repeat(width - 2) + "\u2524"));
		lines.push(frame(hints));
		lines.push(theme.fg(bc, "\u2514" + "\u2500".repeat(width - 2) + "\u2518"));

		this.cachedLines = lines.map(l => visibleWidth(l) > width ? truncateToWidth(l, width) : l);
		this.cachedWidth = width;
		return this.cachedLines;
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.stopSpinner();
		this.agent.abort();
		this.opts.onClose();
	}

	invalidate() {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

export interface OpenChatOptions {
	model: Model<any>;
	cwd: string;
	thinkingLevel: string;
	modelRegistry: ModelRegistry;
	sessionManager: SessionManager;
}
