/**
 * Pompom Settings Panel — interactive TUI overlay with tab navigation.
 * LEFT/RIGHT switches tabs, UP/DOWN navigates rows, ENTER selects, ESC closes.
 */

import { matchesKey, Key, truncateToWidth } from "@mariozechner/pi-tui";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	getVoiceConfig, setVoiceEnabled, setVoiceEngine, setVoice, setVolume,
	setPersonality, getVoiceCatalog, speakTest, stopPlayback,
	type Personality, type VoiceConfig,
} from "./pompom-voice";
import { pompomKeypress, pompomStatus, pompomGiveAccessory, pompomGetAccessories } from "./pompom";
import { getSessionStats } from "./pompom-agent";

type SubMode = "main" | "voice-picker" | "engine-picker" | "personality-picker";

const TABS = ["Voice", "Personality", "Theme", "Accessories", "About"];

const PERSONALITY_OPTIONS: { id: Personality; label: string }[] = [
	{ id: "quiet", label: "Quiet — user actions + errors only" },
	{ id: "normal", label: "Normal — moderate, casual" },
	{ id: "chatty", label: "Chatty — frequent commentary" },
	{ id: "professional", label: "Professional — errors, milestones, direct actions" },
	{ id: "mentor", label: "Mentor — guides on errors and completions" },
	{ id: "zen", label: "Zen — near-silent, speaks only when addressed" },
];

const ENGINE_OPTIONS: { id: VoiceConfig["engine"]; label: string }[] = [
	{ id: "elevenlabs", label: "ElevenLabs (cloud, best quality)" },
	{ id: "deepgram", label: "Deepgram (cloud)" },
	{ id: "kokoro", label: "Kokoro (local, free)" },
];

const ACCESSORY_ITEMS = ["umbrella", "scarf", "sunglasses", "hat"];

class PompomSettingsPanel {
	private tab = 0;
	private row = 0;
	private sub: SubMode = "main";
	private subRow = 0;
	private search = "";
	private filteredList: { name: string; id: string }[] = [];

	private cw?: number;
	private cl?: string[];

	public onClose?: () => void;

	private rerender() {
		this.cw = undefined;
		this.cl = undefined;
	}

	handleInput(data: string): void {
		try {
			if (this.sub !== "main") {
				this.handleSubInput(data);
				return;
			}

			if (matchesKey(data, Key.escape)) {
				this.onClose?.();
				return;
			}
			if (matchesKey(data, Key.left)) {
				this.tab = (this.tab - 1 + TABS.length) % TABS.length;
				this.row = 0;
				this.rerender();
				return;
			}
			if (matchesKey(data, Key.right)) {
				this.tab = (this.tab + 1) % TABS.length;
				this.row = 0;
				this.rerender();
				return;
			}

			const rows = this.getRowCount();
			if (matchesKey(data, Key.up) && this.row > 0) {
				this.row--;
				this.rerender();
				return;
			}
			if (matchesKey(data, Key.down) && this.row < rows - 1) {
				this.row++;
				this.rerender();
				return;
			}
			if (matchesKey(data, Key.enter)) {
				this.handleSelect();
				this.rerender();
				return;
			}
			// +/- for volume on Voice tab
			if (this.tab === 0 && this.row === 2) {
				if (data === "+" || data === "=") {
					setVolume(Math.min(100, getVoiceConfig().volume + 10));
					this.rerender();
					return;
				}
				if (data === "-" || data === "_") {
					setVolume(Math.max(0, getVoiceConfig().volume - 10));
					this.rerender();
					return;
				}
			}
		} catch { /* silent */ }
	}

	private handleSubInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.sub = "main";
			this.search = "";
			this.rerender();
			return;
		}
		if (matchesKey(data, Key.up) && this.subRow > 0) {
			this.subRow--;
			this.rerender();
			return;
		}
		if (matchesKey(data, Key.down) && this.subRow < this.filteredList.length - 1) {
			this.subRow++;
			this.rerender();
			return;
		}
		if (matchesKey(data, Key.enter) && this.filteredList.length > 0) {
			const picked = this.filteredList[this.subRow];
			if (picked) {
				if (this.sub === "voice-picker") setVoice(picked.id);
				else if (this.sub === "engine-picker") setVoiceEngine(picked.id as VoiceConfig["engine"]);
				else if (this.sub === "personality-picker") setPersonality(picked.id as Personality);
			}
			this.sub = "main";
			this.search = "";
			this.rerender();
			return;
		}
		if (matchesKey(data, Key.backspace)) {
			this.search = this.search.slice(0, -1);
			this.applyFilter();
			this.rerender();
			return;
		}
		// Typing for fuzzy search
		if (data.length === 1 && data >= " " && data <= "~") {
			this.search += data;
			this.applyFilter();
			this.rerender();
		}
	}

	private applyFilter() {
		const q = this.search.toLowerCase();
		if (this.sub === "voice-picker") {
			const cfg = getVoiceConfig();
			const catalog = getVoiceCatalog();
			const all = catalog[cfg.engine] || [];
			this.filteredList = q ? all.filter(v => v.name.toLowerCase().includes(q)) : all;
		} else if (this.sub === "engine-picker") {
			this.filteredList = q
				? ENGINE_OPTIONS.filter(e => e.label.toLowerCase().includes(q)).map(e => ({ name: e.label, id: e.id }))
				: ENGINE_OPTIONS.map(e => ({ name: e.label, id: e.id }));
		} else if (this.sub === "personality-picker") {
			this.filteredList = q
				? PERSONALITY_OPTIONS.filter(p => p.label.toLowerCase().includes(q)).map(p => ({ name: p.label, id: p.id }))
				: PERSONALITY_OPTIONS.map(p => ({ name: p.label, id: p.id }));
		}
		this.subRow = Math.min(this.subRow, Math.max(0, this.filteredList.length - 1));
	}

	private getRowCount(): number {
		if (this.tab === 0) return 5; // Voice: engine, voice, volume, status, test
		if (this.tab === 1) return PERSONALITY_OPTIONS.length;
		if (this.tab === 2) return 4; // 4 themes
		if (this.tab === 3) return ACCESSORY_ITEMS.length;
		if (this.tab === 4) return 1; // About is read-only
		return 0;
	}

	private handleSelect() {
		const cfg = getVoiceConfig();
		if (this.tab === 0) {
			if (this.row === 0) { // Engine
				this.sub = "engine-picker";
				this.subRow = 0;
				this.search = "";
				this.filteredList = ENGINE_OPTIONS.map(e => ({ name: e.label, id: e.id }));
			} else if (this.row === 1) { // Voice model
				this.sub = "voice-picker";
				this.subRow = 0;
				this.search = "";
				const catalog = getVoiceCatalog();
				this.filteredList = catalog[cfg.engine] || [];
			} else if (this.row === 3) { // Toggle status
				if (cfg.enabled) { setVoiceEnabled(false); stopPlayback(); }
				else setVoiceEnabled(true);
			} else if (this.row === 4) { // Test
				speakTest();
			}
		} else if (this.tab === 1) {
			const p = PERSONALITY_OPTIONS[this.row];
			if (p) setPersonality(p.id);
		} else if (this.tab === 2) {
			pompomKeypress("c"); // Cycle theme
		} else if (this.tab === 3) {
			const item = ACCESSORY_ITEMS[this.row];
			const acc = pompomGetAccessories();
			if (item && !(acc as any)[item]) pompomGiveAccessory(item);
		}
	}

	render(width: number): string[] {
		if (this.cl && this.cw === width) return this.cl;

		const dim = "\x1b[38;5;240m";
		const bright = "\x1b[38;5;255m";
		const accent = "\x1b[38;5;117m";
		const sel = "\x1b[38;5;214m";
		const green = "\x1b[38;5;114m";
		const r = "\x1b[0m";
		const w = Math.min(width, 60);
		const pad = (s: string) => truncateToWidth(s, w);

		const lines: string[] = [];
		const hr = dim + "─".repeat(w) + r;

		// Title
		lines.push(pad(`${dim}╭${"─".repeat(w - 2)}╮${r}`));
		lines.push(pad(`${dim}│${r} ${accent}Pompom Settings${r}${" ".repeat(Math.max(0, w - 19))}${dim}│${r}`));
		lines.push(pad(`${dim}├${"─".repeat(w - 2)}┤${r}`));

		// Tabs
		let tabLine = `${dim}│${r} `;
		for (let i = 0; i < TABS.length; i++) {
			if (i === this.tab) tabLine += `${accent}[${TABS[i]}]${r} `;
			else tabLine += `${dim}${TABS[i]}${r} `;
		}
		lines.push(pad(tabLine));
		lines.push(pad(hr));

		if (this.sub !== "main") {
			// Sub-selector with fuzzy search
			lines.push(pad(`${dim}│${r} ${bright}Search: ${this.search}|${r}`));
			lines.push(pad(`${dim}│${r}`));
			const maxShow = 8;
			const start = Math.max(0, this.subRow - Math.floor(maxShow / 2));
			const end = Math.min(this.filteredList.length, start + maxShow);
			for (let i = start; i < end; i++) {
				const v = this.filteredList[i];
				const prefix = i === this.subRow ? `${sel}> ` : `${dim}  `;
				lines.push(pad(`${dim}│${r} ${prefix}${v.name}${r}`));
			}
			if (this.filteredList.length === 0) {
				lines.push(pad(`${dim}│${r}   No matches`));
			}
			lines.push(pad(`${dim}│${r}`));
			lines.push(pad(`${dim}│${r} ${dim}[ESC] Back  [Type] Filter  [Enter] Select${r}`));
		} else if (this.tab === 0) {
			// Voice tab
			const cfg = getVoiceConfig();
			const voiceName = cfg.engine === "kokoro" ? cfg.kokoroVoice
				: cfg.engine === "elevenlabs" ? cfg.elevenlabsVoice : cfg.deepgramVoice;
			const volBar = "█".repeat(Math.round(cfg.volume / 10)) + "░".repeat(10 - Math.round(cfg.volume / 10));
			const voiceRows = [
				`Engine:  ${cfg.engine}`,
				`Voice:   ${voiceName}`,
				`Volume:  ${volBar} ${cfg.volume}%`,
				`Status:  ${cfg.enabled ? green + "ON" : dim + "OFF"}${r}`,
				`Test voice`,
			];
			for (let i = 0; i < voiceRows.length; i++) {
				const prefix = i === this.row ? `${sel}> ` : `${dim}  `;
				lines.push(pad(`${dim}│${r} ${prefix}${bright}${voiceRows[i]}${r}`));
			}
		} else if (this.tab === 1) {
			// Personality tab
			const cfg = getVoiceConfig();
			for (let i = 0; i < PERSONALITY_OPTIONS.length; i++) {
				const p = PERSONALITY_OPTIONS[i];
				const isCurrent = cfg.personality === p.id;
				const prefix = i === this.row ? `${sel}> ` : `${dim}  `;
				const mark = isCurrent ? ` ${green}(active)${r}` : "";
				lines.push(pad(`${dim}│${r} ${prefix}${bright}${p.label}${r}${mark}`));
			}
		} else if (this.tab === 2) {
			// Theme tab
			const st = pompomStatus();
			const themes = ["Cloud", "Cotton Candy", "Mint Drop", "Sunset Gold"];
			for (let i = 0; i < themes.length; i++) {
				const isCurrent = st.theme === themes[i];
				const prefix = i === this.row ? `${sel}> ` : `${dim}  `;
				const mark = isCurrent ? ` ${green}(active)${r}` : "";
				lines.push(pad(`${dim}│${r} ${prefix}${bright}${themes[i]}${r}${mark}`));
			}
		} else if (this.tab === 3) {
			// Accessories tab
			const acc = pompomGetAccessories();
			for (let i = 0; i < ACCESSORY_ITEMS.length; i++) {
				const item = ACCESSORY_ITEMS[i];
				const owned = (acc as any)[item];
				const prefix = i === this.row ? `${sel}> ` : `${dim}  `;
				const mark = owned ? ` ${green}(owned)${r}` : ` ${dim}[Enter to give]${r}`;
				lines.push(pad(`${dim}│${r} ${prefix}${bright}${item}${r}${mark}`));
			}
		} else if (this.tab === 4) {
			// About tab
			const s = pompomStatus();
			const stats = getSessionStats();
			const cfg = getVoiceConfig();
			lines.push(pad(`${dim}│${r}  ${bright}Mood:${r}   ${s.mood}`));
			lines.push(pad(`${dim}│${r}  ${bright}Hunger:${r} ${"█".repeat(Math.round(s.hunger / 10))}${"░".repeat(10 - Math.round(s.hunger / 10))} ${s.hunger}%`));
			lines.push(pad(`${dim}│${r}  ${bright}Energy:${r} ${"█".repeat(Math.round(s.energy / 10))}${"░".repeat(10 - Math.round(s.energy / 10))} ${s.energy}%`));
			lines.push(pad(`${dim}│${r}  ${bright}Theme:${r}  ${s.theme}`));
			lines.push(pad(`${dim}│${r}  ${bright}Voice:${r}  ${cfg.enabled ? cfg.engine : "off"}`));
			lines.push(pad(`${dim}│${r}  ${bright}Tools:${r}  ${stats.toolCalls} calls`));
		}

		// Footer
		lines.push(pad(`${dim}├${"─".repeat(w - 2)}┤${r}`));
		if (this.tab === 0 && this.row === 2 && this.sub === "main") {
			lines.push(pad(`${dim}│${r} ${dim}[ESC] Close  [+/-] Volume  [←→] Tabs${r}`));
		} else {
			lines.push(pad(`${dim}│${r} ${dim}[ESC] Close  [←→] Tabs  [↑↓] Select  [Enter] Choose${r}`));
		}
		lines.push(pad(`${dim}╰${"─".repeat(w - 2)}╯${r}`));

		this.cl = lines;
		this.cw = width;
		return lines;
	}

	invalidate(): void {
		this.cw = undefined;
		this.cl = undefined;
	}
}

export async function openPompomSettings(ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;
	const panel = new PompomSettingsPanel();
	await ctx.ui.custom(
		(_tui: any, _theme: any, _kb: any, done: (v?: any) => void) => {
			panel.onClose = () => done();
			// requestRender not available in factory — panel uses invalidate() cache busting
			return panel;
		},
		{
			overlay: true,
			overlayOptions: {
				width: "60%" as any,
				minWidth: 50,
				maxHeight: "80%" as any,
				anchor: "center" as any,
			},
		},
	);
}
