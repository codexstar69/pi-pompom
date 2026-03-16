/**
 * Pompom Settings Panel — interactive TUI overlay with tab navigation.
 * LEFT/RIGHT switches tabs, UP/DOWN navigates rows, ENTER selects, ESC closes.
 * Fully responsive — adapts to any terminal width.
 */

import { matchesKey, Key, truncateToWidth } from "@mariozechner/pi-tui";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	getVoiceConfig, setVoiceEnabled, setVoiceEngine, setVoice, setVolume,
	setPersonality, getVoiceCatalog, speakTest, stopPlayback,
	setPompomModel, getPompomModel,
	type Personality, type VoiceConfig,
} from "./pompom-voice";
import { pompomKeypress, pompomStatus, pompomGiveAccessory, pompomGetAccessories } from "./pompom";
import { getSessionStats } from "./pompom-agent";

type SubMode = "main" | "voice-picker" | "engine-picker" | "personality-picker" | "model-picker";

const TABS = ["Voice", "Personality", "Model", "Theme", "Accessories", "About"];

const PERSONALITY_OPTIONS: { id: Personality; label: string; short: string }[] = [
	{ id: "quiet", label: "Quiet — user actions + errors only", short: "Quiet" },
	{ id: "normal", label: "Normal — moderate, casual", short: "Normal" },
	{ id: "chatty", label: "Chatty — frequent commentary", short: "Chatty" },
	{ id: "professional", label: "Professional — errors, milestones", short: "Pro" },
	{ id: "mentor", label: "Mentor — guides on errors", short: "Mentor" },
	{ id: "zen", label: "Zen — near-silent", short: "Zen" },
];

const ENGINE_OPTIONS: { id: VoiceConfig["engine"]; label: string }[] = [
	{ id: "elevenlabs", label: "ElevenLabs (cloud, best)" },
	{ id: "deepgram", label: "Deepgram (cloud)" },
	{ id: "kokoro", label: "Kokoro (local, free)" },
];

const THEMES = ["Cloud", "Cotton Candy", "Mint Drop", "Sunset Gold"];
const ACCESSORIES = ["umbrella", "scarf", "sunglasses", "hat"];

// ANSI helpers
const DIM = "\x1b[38;5;240m";
const BRT = "\x1b[38;5;255m";
const ACC = "\x1b[38;5;117m";
const SEL = "\x1b[38;5;214m";
const GRN = "\x1b[38;5;114m";
const RST = "\x1b[0m";

class PompomSettingsPanel {
	private tab = 0;
	private row = 0;
	private sub: SubMode = "main";
	private subRow = 0;
	private search = "";
	private filtered: { name: string; id: string }[] = [];
	public modelList: string[] = []; // populated from ctx before opening
	private cw?: number;
	private cl?: string[];
	public onClose?: () => void;

	private inv() { this.cw = undefined; this.cl = undefined; }

	handleInput(data: string): void {
		try {
			if (this.sub !== "main") return this.handleSub(data);
			if (matchesKey(data, Key.escape)) { this.onClose?.(); return; }
			if (matchesKey(data, Key.left)) { this.tab = (this.tab - 1 + TABS.length) % TABS.length; this.row = 0; this.inv(); return; }
			if (matchesKey(data, Key.right)) { this.tab = (this.tab + 1) % TABS.length; this.row = 0; this.inv(); return; }
			const max = this.rowCount();
			if (matchesKey(data, Key.up) && this.row > 0) { this.row--; this.inv(); return; }
			if (matchesKey(data, Key.down) && this.row < max - 1) { this.row++; this.inv(); return; }
			if (matchesKey(data, Key.enter)) { this.select(); this.inv(); return; }
			if (this.tab === 0 && this.row === 2) {
				if (data === "+" || data === "=") { setVolume(Math.min(100, getVoiceConfig().volume + 10)); this.inv(); return; }
				if (data === "-" || data === "_") { setVolume(Math.max(0, getVoiceConfig().volume - 10)); this.inv(); return; }
			}
		} catch { /* silent */ }
	}

	private handleSub(data: string): void {
		if (matchesKey(data, Key.escape)) { this.sub = "main"; this.search = ""; this.inv(); return; }
		if (matchesKey(data, Key.up) && this.subRow > 0) { this.subRow--; this.inv(); return; }
		if (matchesKey(data, Key.down) && this.subRow < this.filtered.length - 1) { this.subRow++; this.inv(); return; }
		if (matchesKey(data, Key.enter)) {
			if (this.sub === "model-picker") {
				// Model picker: use the search text directly as model ID, or selected item
				const modelId = this.search.trim() || (this.filtered[this.subRow]?.id || "");
				if (modelId) setPompomModel(modelId);
				this.sub = "main"; this.search = ""; this.inv(); return;
			}
			if (!this.filtered[this.subRow]) { return; }
			const p = this.filtered[this.subRow];
			if (this.sub === "voice-picker") { setVoice(p.id); speakTest(); }
			else if (this.sub === "engine-picker") setVoiceEngine(p.id as VoiceConfig["engine"]);
			else if (this.sub === "personality-picker") setPersonality(p.id as Personality);
			this.sub = "main"; this.search = ""; this.inv(); return;
		}
		if (matchesKey(data, Key.backspace)) { this.search = this.search.slice(0, -1); this.filter(); this.inv(); return; }
		if (data.length === 1 && data >= " " && data <= "~") { this.search += data; this.filter(); this.inv(); }
	}

	private filter() {
		const q = this.search.toLowerCase();
		const cfg = getVoiceConfig();
		let all: { name: string; id: string }[] = [];
		if (this.sub === "voice-picker") all = getVoiceCatalog()[cfg.engine] || [];
		else if (this.sub === "engine-picker") all = ENGINE_OPTIONS.map(e => ({ name: e.label, id: e.id }));
		else if (this.sub === "personality-picker") all = PERSONALITY_OPTIONS.map(p => ({ name: p.label, id: p.id }));
		this.filtered = q ? all.filter(v => v.name.toLowerCase().includes(q)) : all;
		this.subRow = Math.min(this.subRow, Math.max(0, this.filtered.length - 1));
	}

	private openSub(mode: SubMode) {
		this.sub = mode; this.subRow = 0; this.search = ""; this.filter();
	}

	private rowCount(): number {
		if (this.tab === 0) return 5; // Voice
		if (this.tab === 1) return PERSONALITY_OPTIONS.length;
		if (this.tab === 2) return 2; // Model: "use main" or "set custom"
		if (this.tab === 3) return THEMES.length;
		if (this.tab === 4) return ACCESSORIES.length;
		return 0; // About is read-only
	}

	private select() {
		const cfg = getVoiceConfig();
		if (this.tab === 0) {
			if (this.row === 0) this.openSub("engine-picker");
			else if (this.row === 1) this.openSub("voice-picker");
			else if (this.row === 3) { cfg.enabled ? (setVoiceEnabled(false), stopPlayback()) : setVoiceEnabled(true); }
			else if (this.row === 4) speakTest();
		} else if (this.tab === 1) {
			const p = PERSONALITY_OPTIONS[this.row]; if (p) setPersonality(p.id);
		} else if (this.tab === 2) {
			if (this.row === 0) { setPompomModel(""); }
			else if (this.row === 1) {
				this.sub = "model-picker";
				this.subRow = 0;
				this.search = getPompomModel(); // pre-fill with current model
				this.filtered = this.modelList.map(m => ({ name: m, id: m }));
			}
		} else if (this.tab === 3) {
			pompomKeypress("c");
		} else if (this.tab === 4) {
			const item = ACCESSORIES[this.row]; const acc = pompomGetAccessories();
			if (item && !(acc as any)[item]) pompomGiveAccessory(item);
		}
	}

	render(width: number): string[] {
		if (this.cl && this.cw === width) return this.cl;
		// Responsive: use full width minus margin, min 30, max 65
		const w = Math.max(30, Math.min(width - 2, 65));
		const iw = w - 4; // inner content width
		const t = (s: string) => truncateToWidth(s, w);
		const line = (content: string) => t(`${DIM}\u2502${RST} ${content}${"".padEnd(Math.max(0, iw - stripAnsi(content).length))} ${DIM}\u2502${RST}`);
		const border = (l: string, fill: string, r: string) => t(`${DIM}${l}${fill.repeat(w - 2)}${r}${RST}`);

		const lines: string[] = [];

		// Header
		lines.push(border("\u256d", "\u2500", "\u256e"));
		lines.push(line(`${ACC}Pompom Settings${RST}`));
		lines.push(border("\u251c", "\u2500", "\u2524"));

		// Tab bar — responsive: show short names on narrow terminals
		const useShort = w < 45;
		let tabStr = "";
		for (let i = 0; i < TABS.length; i++) {
			const name = useShort ? TABS[i].slice(0, 3) : TABS[i];
			tabStr += i === this.tab ? `${ACC}[${name}]${RST} ` : `${DIM}${name}${RST} `;
		}
		lines.push(line(tabStr));
		lines.push(border("\u251c", "\u2500", "\u2524"));

		// Content
		if (this.sub !== "main") {
			const cfg = getVoiceConfig();
			const currentId = this.sub === "voice-picker"
				? (cfg.engine === "kokoro" ? cfg.kokoroVoice : cfg.engine === "elevenlabs" ? cfg.elevenlabsVoice : cfg.deepgramVoice)
				: this.sub === "engine-picker" ? cfg.engine : cfg.personality;
			lines.push(line(`${BRT}Search: ${this.search}\u2502${RST}  ${DIM}${this.filtered.length} results${RST}`));
			lines.push(line(""));
			const maxShow = Math.min(10, Math.max(3, Math.floor((w - 10) / 3)));
			const start = Math.max(0, this.subRow - Math.floor(maxShow / 2));
			const end = Math.min(this.filtered.length, start + maxShow);
			for (let i = start; i < end; i++) {
				const v = this.filtered[i];
				const isCurrent = v.id === currentId;
				const pre = i === this.subRow ? `${SEL}\u25b8 ` : `${DIM}  `;
				const mark = isCurrent ? ` ${GRN}\u2713${RST}` : "";
				lines.push(line(`${pre}${v.name}${RST}${mark}`));
			}
			if (this.filtered.length === 0) lines.push(line(`${DIM}No matches${RST}`));
			lines.push(line(""));
			const hint = this.sub === "voice-picker" ? "[Enter] Select + Preview" : "[Enter] Select";
			lines.push(line(`${DIM}[Esc] Back  [Type] Filter  ${hint}${RST}`));
		} else if (this.tab === 0) {
			const cfg = getVoiceConfig();
			const vname = cfg.engine === "kokoro" ? cfg.kokoroVoice : cfg.engine === "elevenlabs" ? cfg.elevenlabsVoice : cfg.deepgramVoice;
			const vShort = vname.length > iw - 12 ? vname.slice(0, iw - 15) + "..." : vname;
			const vol = cfg.volume;
			const volBar = "\u2588".repeat(Math.round(vol / 10)) + "\u2591".repeat(10 - Math.round(vol / 10));
			const rows = [
				`Engine:  ${cfg.engine}`,
				`Voice:   ${vShort}`,
				`Volume:  ${volBar} ${vol}%  [+/-]`,
				`Status:  ${cfg.enabled ? GRN + "ON" : DIM + "OFF"}${RST}`,
				`Test voice`,
			];
			for (let i = 0; i < rows.length; i++) {
				const pre = i === this.row ? `${SEL}\u25b8 ` : `  `;
				lines.push(line(`${pre}${BRT}${rows[i]}${RST}`));
			}
		} else if (this.tab === 1) {
			const cfg = getVoiceConfig();
			for (let i = 0; i < PERSONALITY_OPTIONS.length; i++) {
				const p = PERSONALITY_OPTIONS[i];
				const active = cfg.personality === p.id ? ` ${GRN}\u2713${RST}` : "";
				const label = w < 45 ? p.short : p.label;
				const pre = i === this.row ? `${SEL}\u25b8 ` : `  `;
				lines.push(line(`${pre}${BRT}${label}${RST}${active}`));
			}
		} else if (this.tab === 2) {
			const current = getPompomModel();
			const mainActive = current === "" ? ` ${GRN}\u2713${RST}` : "";
			const customActive = current !== "" ? ` ${GRN}\u2713 ${current}${RST}` : "";
			const pre0 = this.row === 0 ? `${SEL}\u25b8 ` : `  `;
			const pre1 = this.row === 1 ? `${SEL}\u25b8 ` : `  `;
			lines.push(line(`${pre0}${BRT}Use main agent's model (default)${RST}${mainActive}`));
			lines.push(line(`${pre1}${BRT}Set custom model...${RST}${customActive}`));
			lines.push(line(""));
			lines.push(line(`${DIM}Pompom uses this for /pompom:ask, /pompom:analyze, /pompom:chat${RST}`));
			lines.push(line(`${DIM}Tip: use a fast/cheap model to save costs${RST}`));
		} else if (this.tab === 3) {
			const st = pompomStatus();
			for (let i = 0; i < THEMES.length; i++) {
				const active = st.theme === THEMES[i] ? ` ${GRN}\u2713${RST}` : "";
				const pre = i === this.row ? `${SEL}\u25b8 ` : `  `;
				lines.push(line(`${pre}${BRT}${THEMES[i]}${RST}${active}`));
			}
		} else if (this.tab === 4) {
			const acc = pompomGetAccessories();
			for (let i = 0; i < ACCESSORIES.length; i++) {
				const owned = (acc as any)[ACCESSORIES[i]];
				const mark = owned ? ` ${GRN}\u2713 owned${RST}` : ` ${DIM}[Enter]${RST}`;
				const pre = i === this.row ? `${SEL}\u25b8 ` : `  `;
				lines.push(line(`${pre}${BRT}${ACCESSORIES[i]}${RST}${mark}`));
			}
		} else {
			const s = pompomStatus();
			const stats = getSessionStats();
			const cfg = getVoiceConfig();
			const bar = (v: number) => "\u2588".repeat(Math.round(v / 10)) + "\u2591".repeat(10 - Math.round(v / 10));
			lines.push(line(`${BRT}Mood:${RST}   ${s.mood}`));
			lines.push(line(`${BRT}Hunger:${RST} ${bar(s.hunger)} ${s.hunger}%`));
			lines.push(line(`${BRT}Energy:${RST} ${bar(s.energy)} ${s.energy}%`));
			lines.push(line(`${BRT}Theme:${RST}  ${s.theme}`));
			lines.push(line(`${BRT}Voice:${RST}  ${cfg.enabled ? cfg.engine : "off"} (${cfg.personality})`));
			lines.push(line(`${BRT}Tools:${RST}  ${stats.toolCalls} calls, ${stats.toolFailures} fails`));
			lines.push(line(`${BRT}Vol:${RST}    ${cfg.volume}%`));
		}

		// Footer
		lines.push(border("\u251c", "\u2500", "\u2524"));
		const footerText = this.tab === 0 && this.row === 2 && this.sub === "main"
			? `[Esc] Close  [+/-] Volume  [\u2190\u2192] Tabs`
			: `[Esc] Close  [\u2190\u2192] Tabs  [\u2191\u2193] Nav  [Enter] Select`;
		lines.push(line(`${DIM}${footerText}${RST}`));
		lines.push(border("\u2570", "\u2500", "\u256f"));

		this.cl = lines; this.cw = width;
		return lines;
	}

	invalidate(): void { this.cw = undefined; this.cl = undefined; }
}

function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export async function openPompomSettings(ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;
	const panel = new PompomSettingsPanel();
	// Populate available models from Pi's model registry
	try {
		const models = (ctx as any).modelRegistry?.getModels?.() || [];
		panel.modelList = models.map((m: any) => typeof m === "string" ? m : (m?.id ? `${m.provider || ""}/${m.id}` : "")).filter(Boolean);
	} catch { panel.modelList = []; }
	await ctx.ui.custom(
		(_tui: any, _theme: any, _kb: any, done: (v?: any) => void) => {
			panel.onClose = () => done();
			return panel;
		},
		{
			overlay: true,
			overlayOptions: {
				width: "60%" as any,
				minWidth: 40,
				maxHeight: "80%" as any,
				anchor: "center" as any,
			},
		},
	);
}
