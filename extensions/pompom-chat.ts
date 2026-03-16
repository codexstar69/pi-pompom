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

You understand these shortcut intents from the user:
- "analyze" / "what's happening" → use peek_main and give a detailed analysis of the agent's work
- "stuck" / "why is it stuck" / "is it stuck" → use peek_main({ since_last: true }) and check for stuck patterns
- "recap" / "summary" → use peek_main and summarize the session concisely
- "status" → report main agent status, tool calls, mood
- "help" → list available commands and what you can do

Be concise, warm, and practical. This is for quick questions and status checks.
If the user wants something the main agent is handling, suggest waiting for it to finish.`;

const SPINNER = ["\u280b", "\u2819", "\u2839", "\u2838", "\u283c", "\u2834", "\u2826", "\u2827", "\u2807", "\u280f"];

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
}

export class PompomChatOverlay implements Component, Focusable {
	private agent: Agent;
	private editor: Editor;
	private displayMessages: { role: "user" | "pompom" | "tool" | "error"; text: string }[] = [];
	private isStreaming = false;
	private streamingText = "";
	private _focused = true;
	private disposed = false;
	private agentUnsub: (() => void) | null = null;
	private peekTool: AgentTool;
	private spinnerTimer: NodeJS.Timeout | null = null;
	private spinnerFrame = 0;
	private toolStatus = "";
	private errorText = "";
	private scrollOffset = 0;

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
		this.editor.onSubmit = (text) => this.onSubmit(text);

		this.displayMessages.push({ role: "pompom", text: "Hi! Try: analyze, stuck, recap, status, help — or just ask me anything!" });
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
		if (lower === "voice on") return ""; // handled below
		if (lower === "voice off") return ""; // handled below
		return input;
	}

	private handleLocalCommand(input: string): boolean {
		const lower = input.toLowerCase().trim();
		if (lower === "help" || lower === "/help" || lower === "commands") {
			this.displayMessages.push({ role: "pompom", text: "Commands you can type here:" });
			this.displayMessages.push({ role: "tool", text: "analyze — detailed analysis of main agent work" });
			this.displayMessages.push({ role: "tool", text: "stuck — check if main agent is stuck" });
			this.displayMessages.push({ role: "tool", text: "recap — session summary" });
			this.displayMessages.push({ role: "tool", text: "status — quick status check" });
			this.displayMessages.push({ role: "tool", text: "help — show this list" });
			this.displayMessages.push({ role: "pompom", text: "Or just ask me anything in plain English!" });
			this.opts.tui.requestRender();
			return true;
		}
		return false;
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

		this.displayMessages.push({ role: "user", text: trimmed });
		this.isStreaming = true;
		this.streamingText = "";
		this.errorText = "";
		this.scrollOffset = 0;
		this.startSpinner();
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
			if (!this.disposed) {
				this.syncMessages();
				this.scrollOffset = 0;
				this.opts.tui.requestRender();
			}
		}
	}

	private syncMessages() {
		this.displayMessages = [
			{ role: "pompom", text: "Hi! Try: analyze, stuck, recap, status, help — or just ask me anything!" },
		];
		for (const m of this.agent.state.messages) {
			if (m.role === "user") {
				const c = typeof m.content === "string" ? m.content : m.content.map(b => b.type === "text" ? b.text : "").join("");
				if (c) this.displayMessages.push({ role: "user", text: c });
			} else if (m.role === "assistant") {
				const t = m.content.filter(b => b.type === "text").map(b => (b as any).text).join(" ");
				if (t) this.displayMessages.push({ role: "pompom", text: t });
			} else if (m.role === "toolResult") {
				const t = m.content[0]?.type === "text" ? (m.content[0] as any).text : "";
				const toolName = (m as any).toolName || "tool";
				if (t) this.displayMessages.push({ role: "tool", text: `[${toolName}]: ${t.slice(0, 200)}` });
			}
		}
		if (this.errorText) {
			this.displayMessages.push({ role: "error", text: this.errorText });
		}
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
		this.spinnerTimer = setInterval(() => {
			if (this.disposed) { this.stopSpinner(); return; }
			this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER.length;
			this.opts.tui.requestRender();
		}, 80);
	}

	private stopSpinner() {
		if (this.spinnerTimer) { clearInterval(this.spinnerTimer); this.spinnerTimer = null; }
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
				if (this.isStreaming) this.agent.abort();
				else this.dispose();
				return;
			}
			if (matchesKey(data, this.opts.shortcut as any)) { this.opts.onUnfocus(); return; }
			if (matchesKey(data, Key.alt("up")) || matchesKey(data, "pageUp" as any)) {
				this.scrollOffset = Math.min(this.scrollOffset + 3, 200);
				this.opts.tui.requestRender(); return;
			}
			if (matchesKey(data, Key.alt("down")) || matchesKey(data, "pageDown" as any)) {
				this.scrollOffset = Math.max(0, this.scrollOffset - 3);
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

		// Header
		const pompomFace = theme.fg("success", "(o") + theme.fg("warning", "'") + theme.fg("success", "o)");
		const title = this._focused ? pompomFace + " " + theme.fg("accent", "Pompom Chat") : theme.fg("dim", "(o'o) Pompom Chat");
		const stream = this.isStreaming ? theme.fg("warning", " " + SPINNER[this.spinnerFrame]) : "";
		const status = this.toolStatus ? theme.fg("dim", " [" + this.toolStatus + "]") : "";
		lines.push(theme.fg(bc, "\u250c" + "\u2500".repeat(bw) + "\u2510"));
		lines.push(this.frameLine(title + stream + status, innerWidth));
		lines.push(theme.fg(bc, "\u251c" + "\u2500".repeat(bw) + "\u2524"));

		// Messages — fixed height region (cap to ~40% of terminal, minimum 5 lines)
		const maxLines = Math.max(5, Math.floor(this.opts.tui.terminal.rows * 0.4) - 8);

		// Build wrapped message lines
		const allMsgLines: string[] = [];
		for (const msg of this.displayMessages) {
			const prefix = msg.role === "user" ? theme.fg("accent", "You: ")
				: msg.role === "pompom" ? theme.fg("success", "(o'o) ")
				: msg.role === "tool" ? theme.fg("dim", "")
				: theme.fg("error", "Error: ");
			const prefixW = msg.role === "user" ? 5 : msg.role === "pompom" ? 6 : msg.role === "tool" ? 0 : 7;
			this.wrapInto(allMsgLines, prefix, prefixW, msg.text, innerWidth);
		}
		if (this.streamingText) {
			this.wrapInto(allMsgLines, theme.fg("success", "(o'o) "), 6, this.streamingText, innerWidth);
		}

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

		// Footer
		lines.push(theme.fg(bc, "\u251c" + "\u2500".repeat(bw) + "\u2524"));
		const hints = this._focused
			? theme.fg("dim", "Esc " + (this.isStreaming ? "stop" : "close") + " \u00b7 Enter send \u00b7 " + this.opts.shortcut + " unfocus \u00b7 help for commands")
			: theme.fg("dim", this.opts.shortcut + " \u2192 focus");
		lines.push(this.frameLine(hints, innerWidth));
		lines.push(theme.fg(bc, "\u2514" + "\u2500".repeat(bw) + "\u2518"));

		return lines.map(l => visibleWidth(l) > width ? truncateToWidth(l, width) : l);
	}

	private wrapInto(out: string[], prefix: string, prefixW: number, text: string, maxW: number) {
		if (maxW < 4) maxW = 4;
		const words = text.split(" ");
		let curLine = prefix;
		let curW = prefixW;
		const indent = "  ";
		const indentW = 2;

		for (const word of words) {
			const ww = visibleWidth(word);

			// If the word fits on the current line, append it
			const spaceNeeded = curW > prefixW ? 1 : 0;
			if (curW + spaceNeeded + ww <= maxW) {
				curLine += (spaceNeeded ? " " : "") + word;
				curW += spaceNeeded + ww;
				continue;
			}

			// Word doesn't fit — flush current line if it has content
			if (curW > prefixW || curW > indentW) {
				out.push(curLine);
				curLine = indent;
				curW = indentW;
			}

			// If the word itself fits on a fresh line, just add it
			if (indentW + ww <= maxW) {
				curLine = indent + word;
				curW = indentW + ww;
				continue;
			}

			// Word is wider than maxW — break it character by character
			let remaining = word;
			while (remaining.length > 0) {
				const available = maxW - curW;
				if (available <= 0) {
					out.push(curLine);
					curLine = indent;
					curW = indentW;
					continue;
				}
				// Take as many characters as fit
				let take = 0;
				let takeW = 0;
				for (const ch of remaining) {
					const cw = visibleWidth(ch);
					if (takeW + cw > available) break;
					take++;
					takeW += cw;
				}
				if (take === 0) take = 1; // always consume at least 1 char to avoid infinite loop
				curLine += remaining.slice(0, take);
				curW += visibleWidth(remaining.slice(0, take));
				remaining = remaining.slice(take);
				if (remaining.length > 0) {
					out.push(curLine);
					curLine = indent;
					curW = indentW;
				}
			}
		}
		if (curW > 0) out.push(curLine);
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
