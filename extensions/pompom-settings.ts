/**
 * Pompom Settings Panel — interactive TUI overlay with tab navigation.
 * LEFT/RIGHT switches tabs, UP/DOWN navigates rows, ENTER selects, ESC closes.
 * Fully responsive — adapts to any terminal width.
 *
 * Tabs: Pompom · Voice · Ambient · Personality · Theme · Accessories · Model · Shortcuts · About
 */

import os from "node:os";
import { matchesKey, Key, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	getVoiceConfig, setVoiceEnabled, setVoiceEngine, setVoice, setVolume,
	setPersonality, getVoiceCatalog, speakTest, stopPlayback,
	setPompomModel, getPompomModel,
	type Personality, type VoiceConfig,
} from "./pompom-voice";
import {
	pompomKeypress,
	pompomStatus,
	pompomGiveAccessory,
	pompomGetAccessories,
	pompomGetWeather,
	pompomRestoreAccessories,
	type Accessories,
} from "./pompom";
import { getSessionStats } from "./pompom-agent";
import {
	getAmbientConfig, setAmbientEnabled, setAmbientVolume,
	getCachedWeathers, getCustomWeathers, isAmbientPlaying, pregenerateAll,
	getCustomAudioDir, pregenerateSfx, getSfxCacheStatus,
} from "./pompom-ambient";
import { getInstanceCount, isPrimaryInstance } from "./pompom-instance";
import { isWindowOpen, isWindowEnabled } from "./pompom-glimpse";

type SubMode = "main" | "voice-picker" | "engine-picker" | "personality-picker" | "model-picker";

// ─── Tab indices ──────────────────────────────────────────────────────────────
const TAB_POMPOM = 0;
const TAB_VOICE = 1;
const TAB_AMBIENT = 2;
const TAB_PERSONALITY = 3;
const TAB_THEME = 4;
const TAB_ACCESSORIES = 5;
const TAB_MODEL = 6;
const TAB_SHORTCUTS = 7;
const TAB_ABOUT = 8;

const TABS = ["Pompom", "Voice", "Sound", "Personality", "Theme", "Accessories", "Model", "Keys", "About"];

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
const ACCESSORY_KEYS: (keyof Accessories)[] = ["umbrella", "scarf", "sunglasses", "hat"];

// Pompom tab: actions a non-technical user can trigger with Enter
const POMPOM_ACTIONS: { key: string; label: string; description: string }[] = [
	{ key: "p", label: "Pet", description: "Stroke Pompom" },
	{ key: "f", label: "Feed", description: "Drop food" },
	{ key: "t", label: "Treat", description: "Special snack" },
	{ key: "h", label: "Hug", description: "Give a hug" },
	{ key: "b", label: "Ball", description: "Throw a ball" },
	{ key: "x", label: "Dance", description: "Bust some moves" },
	{ key: "m", label: "Music", description: "Sing a melody" },
	{ key: "g", label: "Game", description: "Catch the stars" },
	{ key: "d", label: "Flip", description: "Do a flip" },
	{ key: "s", label: "Sleep", description: "Nap time" },
	{ key: "w", label: "Wake", description: "Wake up" },
	{ key: "o", label: "Hide", description: "Wander off-screen" },
];

// Keyboard shortcuts reference
const SHORTCUT_GROUPS: { section: string; items: [string, string][] }[] = [
	{
		section: "Pet Actions",
		items: [
			["Alt+P", "Pet Pompom"],
			["Alt+E", "Feed Pompom"],
			["Alt+T", "Give treat"],
			["Alt+U", "Hug Pompom"],
			["Alt+R", "Throw ball"],
			["Alt+X", "Dance"],
			["Alt+M", "Play music"],
			["Alt+G", "Play game"],
			["Alt+Z", "Do a flip"],
			["Alt+S", "Sleep"],
			["Alt+A", "Wake up"],
			["Alt+O", "Hide"],
			["Alt+C", "Cycle theme"],
		],
	},
	{
		section: "Controls",
		items: [
			["Alt+V", "Toggle view (hide/show)"],
			["Alt+/", "Toggle side chat"],
		],
	},
	{
		section: "Commands",
		items: [
			["/pompom", "Toggle on/off or /pompom help"],
			["/pompom-on", "Turn everything on"],
			["/pompom-off", "Turn everything off"],
			["/pompom:ask", "Ask Pompom about the session"],
			["/pompom:recap", "Session summary"],
			["/pompom:analyze", "AI session analysis"],
			["/pompom:agents", "Agent status dashboard"],
			["/pompom:stuck", "Check if agent is stuck"],
			["/pompom:voice", "Voice settings (on/off/setup)"],
			["/pompom:ambient", "Ambient sound settings"],
			["/pompom:chat", "Open side chat overlay"],
			["/pompom:terminals", "Show all Pompom instances"],
			["/pompom-settings", "This settings panel"],
		],
	},
];

// ANSI helpers
const DIM = "\x1b[38;5;240m";
const BRT = "\x1b[38;5;255m";
const ACC = "\x1b[38;5;117m";
const SEL = "\x1b[38;5;214m";
const GRN = "\x1b[38;5;114m";
const YEL = "\x1b[38;5;220m";
const RST = "\x1b[0m";

function getCurrentVoiceId(cfg: VoiceConfig): string {
	if (cfg.engine === "kokoro") return cfg.kokoroVoice;
	if (cfg.engine === "elevenlabs") return cfg.elevenlabsVoice;
	return cfg.deepgramVoice;
}

function bar10(v: number): string {
	const f = Math.max(0, Math.min(10, Math.round(v / 10)));
	return "\u2588".repeat(f) + "\u2591".repeat(10 - f);
}

class PompomSettingsPanel {
	private tab = TAB_POMPOM;
	private row = 0;
	private sub: SubMode = "main";
	private subRow = 0;
	private search = "";
	private filtered: { name: string; id: string }[] = [];
	public modelList: string[] = [];
	public pompomEnabled = true;
	public onTogglePompom?: (enabled: boolean) => void;
	private cw?: number;
	private cl?: string[];
	private lastIw = 60; // inner width, updated each render
	private statusMsg = "";
	private statusTimer: ReturnType<typeof setTimeout> | null = null;
	public onClose?: () => void;
	public onPregenerate?: () => Promise<number>;
	public onAmbientToggle?: (enabled: boolean) => void;
	public onAccessoryChange?: (change: AccessoryChange) => void | Promise<void>;
	public onWindowToggle?: () => Promise<boolean>;

	private inv() { this.cw = undefined; this.cl = undefined; }

	private showStatus(msg: string, durationMs = 2000) {
		this.statusMsg = msg;
		if (this.statusTimer) clearTimeout(this.statusTimer);
		this.statusTimer = setTimeout(() => { this.statusMsg = ""; this.inv(); }, durationMs);
		this.inv();
	}

	handleInput(data: string): void {
		try {
			if (this.sub !== "main") return this.handleSub(data);
			if (matchesKey(data, Key.escape)) { this.cleanup(); this.onClose?.(); return; }
			if (matchesKey(data, Key.left)) { this.tab = (this.tab - 1 + TABS.length) % TABS.length; this.row = 0; this.inv(); return; }
			if (matchesKey(data, Key.right)) { this.tab = (this.tab + 1) % TABS.length; this.row = 0; this.inv(); return; }
			const max = this.rowCount();
			if (matchesKey(data, Key.up) && this.row > 0) { this.row--; this.inv(); return; }
			if (matchesKey(data, Key.down) && this.row < max - 1) { this.row++; this.inv(); return; }
			if (matchesKey(data, Key.enter)) { this.select(); this.inv(); return; }

			// Volume +/- handlers for specific rows
			if (this.isVolumeRow()) {
				if (data === "+" || data === "=") { this.adjustVolume(10); return; }
				if (data === "-" || data === "_") { this.adjustVolume(-10); return; }
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.error(`[pompom-settings] handleInput error: ${msg}`);
		}
	}

	private isVolumeRow(): boolean {
		return (this.tab === TAB_VOICE && this.row === 2) ||
			(this.tab === TAB_AMBIENT && this.row === 1);
	}

	private adjustVolume(delta: number): void {
		if (this.tab === TAB_VOICE) {
			const newVol = Math.max(0, Math.min(100, getVoiceConfig().volume + delta));
			setVolume(newVol);
			this.showStatus(`Voice volume: ${newVol}%`);
		} else if (this.tab === TAB_AMBIENT) {
			const newVol = Math.max(0, Math.min(100, getAmbientConfig().volume + delta));
			setAmbientVolume(newVol);
			this.showStatus(`Ambient volume: ${newVol}%`);
		}
		this.inv();
	}

	private handleSub(data: string): void {
		if (matchesKey(data, Key.escape)) { this.sub = "main"; this.search = ""; this.inv(); return; }
		if (matchesKey(data, Key.up) && this.subRow > 0) { this.subRow--; this.inv(); return; }
		if (matchesKey(data, Key.down) && this.subRow < this.filtered.length - 1) { this.subRow++; this.inv(); return; }
		if (matchesKey(data, Key.enter)) {
			if (this.sub === "model-picker") {
				const modelId = this.search.trim() || (this.filtered[this.subRow]?.id || "");
				if (modelId) {
					setPompomModel(modelId);
					this.showStatus(`Model: ${modelId}`);
				}
				this.sub = "main"; this.search = ""; this.inv(); return;
			}
			if (!this.filtered[this.subRow]) return;
			const p = this.filtered[this.subRow];
			if (this.sub === "voice-picker") {
				setVoice(p.id);
				stopPlayback();
				speakTest();
				this.showStatus(`Voice: ${p.name}`);
			} else if (this.sub === "engine-picker") {
				setVoiceEngine(p.id as VoiceConfig["engine"]);
				this.showStatus(`Engine: ${p.name}`);
			} else if (this.sub === "personality-picker") {
				setPersonality(p.id as Personality);
				this.showStatus(`Personality: ${p.name}`);
			}
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
		else if (this.sub === "model-picker") all = this.modelList.map(m => ({ name: m, id: m }));
		this.filtered = q ? all.filter(v => v.name.toLowerCase().includes(q)) : all;
		this.subRow = Math.min(this.subRow, Math.max(0, this.filtered.length - 1));
	}

	private openSub(mode: SubMode) {
		this.sub = mode; this.subRow = 0; this.search = ""; this.filter();
	}

	private rowCount(): number {
		if (this.tab === TAB_POMPOM) return POMPOM_ACTIONS.length + 2; // +1 on/off toggle, +1 window toggle
		if (this.tab === TAB_VOICE) return 5; // engine, voice, volume, status, test
		if (this.tab === TAB_AMBIENT) return 6; // ambient on/off, volume, pregenerate ambient, cache, pregenerate SFX, SFX cache
		if (this.tab === TAB_PERSONALITY) return PERSONALITY_OPTIONS.length;
		if (this.tab === TAB_THEME) return THEMES.length;
		if (this.tab === TAB_ACCESSORIES) return ACCESSORY_KEYS.length;
		if (this.tab === TAB_MODEL) return 2; // use main / set custom
		if (this.tab === TAB_SHORTCUTS) return 0; // read-only
		return 0; // About — read-only
	}

	private select() {
		if (this.tab === TAB_POMPOM) {
			if (this.row === 0) {
				// On/off toggle — first row
				this.pompomEnabled = !this.pompomEnabled;
				if (this.onTogglePompom) this.onTogglePompom(this.pompomEnabled);
				this.showStatus(this.pompomEnabled ? "Pompom ON" : "Pompom OFF (chat stays)");
			} else if (this.row === 1) {
				// Native window toggle — second row
				if (this.onWindowToggle) {
					void Promise.resolve(this.onWindowToggle()).then((opened) => {
						this.showStatus(opened ? "Native window opened" : "Native window closed");
						this.inv();
					}).catch(() => {
						this.showStatus("glimpseui not installed");
						this.inv();
					});
				} else {
					this.showStatus("Window toggle not available");
				}
			} else {
				const action = POMPOM_ACTIONS[this.row - 2]; // offset by 2 for toggle rows
				if (action) {
					pompomKeypress(action.key);
					this.showStatus(action.label);
				}
			}
		} else if (this.tab === TAB_VOICE) {
			const cfg = getVoiceConfig();
			if (this.row === 0) this.openSub("engine-picker");
			else if (this.row === 1) this.openSub("voice-picker");
			else if (this.row === 3) {
				const newState = !cfg.enabled;
				setVoiceEnabled(newState);
				this.showStatus(newState ? "Voice ON" : "Voice OFF");
			}
			else if (this.row === 4) {
				speakTest();
				this.showStatus("Testing voice...");
			}
		} else if (this.tab === TAB_AMBIENT) {
			if (this.row === 0) {
				const ambientCfg = getAmbientConfig();
				const newState = !ambientCfg.enabled;
				setAmbientEnabled(newState);
				this.onAmbientToggle?.(newState);
				this.showStatus(newState ? "Ambient ON" : "Ambient OFF");
			}
			// row 1 = volume (handled by +/-)
			if (this.row === 2) {
				this.showStatus("Generating ambient sounds...", 30000);
				if (this.onPregenerate) {
					void this.onPregenerate().then((count) => {
						this.showStatus(`Generated ${count} new ambient tracks`);
					}).catch(err => console.error("[pompom] pregenerateAll failed:", err instanceof Error ? err.message : err));
				}
			}
			// row 3 = ambient cache info (read-only)
			if (this.row === 4) {
				this.showStatus("Generating SFX variants...", 60000);
				void pregenerateSfx().then((count) => {
					this.showStatus(`Generated ${count} new SFX variants`);
				}).catch(err => console.error("[pompom] pregenerateSfx failed:", err instanceof Error ? err.message : err));
			}
			// row 5 = SFX cache info (read-only)
		} else if (this.tab === TAB_PERSONALITY) {
			const p = PERSONALITY_OPTIONS[this.row];
			if (p) {
				setPersonality(p.id);
				this.showStatus(`Personality: ${p.short}`);
			}
		} else if (this.tab === TAB_THEME) {
			const st = pompomStatus();
			const currentIdx = THEMES.indexOf(st.theme);
			if (currentIdx < 0) {
				for (let i = 0; i <= this.row; i++) pompomKeypress("c");
			} else if (currentIdx !== this.row) {
				const steps = (this.row - currentIdx + THEMES.length) % THEMES.length;
				for (let i = 0; i < steps; i++) pompomKeypress("c");
			}
			this.showStatus(`Theme: ${THEMES[this.row]}`);
		} else if (this.tab === TAB_ACCESSORIES) {
			const key = ACCESSORY_KEYS[this.row];
			if (key) {
				const acc = pompomGetAccessories();
				if (!acc[key]) {
					const previousAccessories: Accessories = { ...acc };
					pompomGiveAccessory(key);
					const accessoryChange: AccessoryChange = {
						accessory: key,
						accessories: pompomGetAccessories(),
					};
					if (!this.onAccessoryChange) {
						this.showStatus(`Gave Pompom a ${key}!`);
						return;
					}
					this.showStatus(`Saving ${key}...`, 5000);
					void Promise.resolve(this.onAccessoryChange(accessoryChange)).then(() => {
						this.showStatus(`Gave Pompom a ${key}!`);
						this.inv();
					}).catch((error) => {
						const message = error instanceof Error ? error.message : String(error);
						console.error(`[pompom-settings] Failed to persist accessory change for ${key}: ${message}`);
						pompomRestoreAccessories(previousAccessories);
						this.showStatus(`Save failed for ${key}. Try again.`, 5000);
						this.inv();
					});
				} else {
					this.showStatus(`Already has ${key}`);
				}
			}
		} else if (this.tab === TAB_MODEL) {
			if (this.row === 0) {
				setPompomModel("");
				this.showStatus("Using main agent's model");
			} else if (this.row === 1) {
				this.sub = "model-picker";
				this.subRow = 0;
				this.search = getPompomModel();
				this.filter();
			}
		}
	}

	cleanup() {
		if (this.statusTimer) { clearTimeout(this.statusTimer); this.statusTimer = null; }
	}

	render(width: number): string[] {
		const liveTab = this.tab === TAB_POMPOM || this.tab === TAB_AMBIENT || this.tab === TAB_ABOUT;
		if (this.cl && this.cw === width && !liveTab) return this.cl;
		// Fully responsive — no fixed max width, use all available space
		const w = Math.max(30, width - 2);
		const iw = w - 4;
		this.lastIw = iw;

		const pad = (content: string) => {
			const cw = visibleWidth(content);
			const gap = Math.max(0, iw - cw);
			return content + " ".repeat(gap);
		};
		const line = (content: string) => truncateToWidth(`${DIM}\u2502${RST} ${pad(content)} ${DIM}\u2502${RST}`, w);
		const border = (l: string, fill: string, r: string) => truncateToWidth(`${DIM}${l}${fill.repeat(Math.max(0, w - 2))}${r}${RST}`, w);

		const lines: string[] = [];

		// Header
		lines.push(border("\u256d", "\u2500", "\u256e"));
		const headerRight = this.statusMsg ? ` ${YEL}${this.statusMsg}${RST}` : "";
		lines.push(line(`${ACC}Pompom Settings${RST}${headerRight}`));
		lines.push(border("\u251c", "\u2500", "\u2524"));

		// Tab bar — responsive: full names → short names → scrolling window
		const tabNames = iw < 40 ? TABS.map(t => t.slice(0, 3))
			: iw < 55 ? TABS.map(t => t.length > 5 ? t.slice(0, 4) : t)
			: TABS;
		// Build tab string, truncating to fit width with scroll indicators
		let tabParts: string[] = [];
		for (let i = 0; i < tabNames.length; i++) {
			const name = tabNames[i];
			tabParts.push(i === this.tab ? `${ACC}[${name}]${RST}` : `${DIM}${name}${RST}`);
		}
		let tabStr = tabParts.join(" ");
		// If tab bar overflows, show a scrolling window centered on active tab
		if (visibleWidth(tabStr) > iw) {
			const window = Math.max(3, Math.floor(iw / 10));
			const start = Math.max(0, Math.min(this.tab - Math.floor(window / 2), TABS.length - window));
			const end = Math.min(TABS.length, start + window);
			tabParts = [];
			if (start > 0) tabParts.push(`${DIM}\u2039${RST}`);
			for (let i = start; i < end; i++) {
				const name = tabNames[i];
				tabParts.push(i === this.tab ? `${ACC}[${name}]${RST}` : `${DIM}${name}${RST}`);
			}
			if (end < TABS.length) tabParts.push(`${DIM}\u203a${RST}`);
			tabStr = tabParts.join(" ");
		}
		lines.push(line(tabStr));
		lines.push(border("\u251c", "\u2500", "\u2524"));

		// Content
		if (this.sub !== "main") {
			this.renderSubPicker(lines, line, iw, w);
		} else if (this.tab === TAB_POMPOM) {
			this.renderPompomTab(lines, line, iw);
		} else if (this.tab === TAB_VOICE) {
			this.renderVoiceTab(lines, line, iw);
		} else if (this.tab === TAB_AMBIENT) {
			this.renderAmbientTab(lines, line);
		} else if (this.tab === TAB_PERSONALITY) {
			this.renderPersonalityTab(lines, line, w);
		} else if (this.tab === TAB_THEME) {
			this.renderThemeTab(lines, line);
		} else if (this.tab === TAB_ACCESSORIES) {
			this.renderAccessoriesTab(lines, line);
		} else if (this.tab === TAB_MODEL) {
			this.renderModelTab(lines, line);
		} else if (this.tab === TAB_SHORTCUTS) {
			this.renderShortcutsTab(lines, line, iw);
		} else {
			this.renderAboutTab(lines, line);
		}

		// Footer
		lines.push(border("\u251c", "\u2500", "\u2524"));
		lines.push(line(`${DIM}${this.getFooterHint()}${RST}`));
		lines.push(border("\u2570", "\u2500", "\u256f"));

		this.cl = lines; this.cw = width;
		return lines;
	}

	// ─── Tab renderers ────────────────────────────────────────────────────────

	private renderPompomTab(lines: string[], line: (s: string) => string, iw: number) {
		const s = pompomStatus();
		const weather = pompomGetWeather();

		// On/off toggle — first row
		const togglePre = this.row === 0 ? `${SEL}\u25b8 ` : `  `;
		const toggleLabel = this.pompomEnabled
			? `${GRN}ON${RST}` + (iw >= 40 ? `  ${DIM}animation, voice, ambient active${RST}` : "")
			: `${YEL}OFF${RST}` + (iw >= 40 ? ` ${DIM}muted \u2014 chat still works${RST}` : "");
		lines.push(line(`${togglePre}${BRT}Pompom: ${toggleLabel}`));

		// Native window toggle — second row
		const winPre = this.row === 1 ? `${SEL}\u25b8 ` : `  `;
		const winState = isWindowOpen() ? `${GRN}ON${RST}` : `${DIM}OFF${RST}`;
		const winHint = iw >= 45 ? `  ${DIM}floating pixel-art window${RST}` : "";
		lines.push(line(`${winPre}${BRT}Native Window: ${winState}${winHint}`));
		lines.push(line(""));

		// Status section — responsive layout
		const barSize = iw >= 50 ? 10 : iw >= 35 ? 6 : 4;
		const barFn = (v: number) => {
			const f = Math.max(0, Math.min(barSize, Math.round(v / (100 / barSize))));
			return "\u2588".repeat(f) + "\u2591".repeat(barSize - f);
		};
		if (iw >= 55) {
			// Wide: mood + weather on same line, bars with labels
			lines.push(line(`${BRT}Mood:${RST} ${s.mood}    ${BRT}Weather:${RST} ${weather}`));
			lines.push(line(`${BRT}Hunger:${RST} ${barFn(s.hunger)} ${s.hunger}%    ${BRT}Energy:${RST} ${barFn(s.energy)} ${s.energy}%`));
		} else if (iw >= 35) {
			// Medium: stacked but compact
			lines.push(line(`${BRT}Mood:${RST} ${s.mood}  ${BRT}Wx:${RST} ${weather}`));
			lines.push(line(`${BRT}Hnger:${RST} ${barFn(s.hunger)} ${s.hunger}%  ${BRT}Enrgy:${RST} ${barFn(s.energy)} ${s.energy}%`));
		} else {
			// Narrow: minimal
			lines.push(line(`${s.mood} ${barFn(s.hunger)}${s.hunger}% ${barFn(s.energy)}${s.energy}%`));
		}
		lines.push(line(""));

		// Actions header
		if (iw >= 40) lines.push(line(`${ACC}Actions${RST}  ${DIM}(Enter to activate)${RST}`));
		else lines.push(line(`${ACC}Actions${RST}`));

		// Actions — 2-column layout for wide terminals, single column otherwise
		if (iw >= 60) {
			const colW = Math.floor((iw - 2) / 2);
			for (let i = 0; i < POMPOM_ACTIONS.length; i += 2) {
				const a1 = POMPOM_ACTIONS[i];
				const a2 = i + 1 < POMPOM_ACTIONS.length ? POMPOM_ACTIONS[i + 1] : null;
				const pre1 = (i + 2) === this.row ? `${SEL}\u25b8` : ` `;
				const desc1 = truncateToWidth(a1.description, Math.max(4, colW - a1.label.length - 5));
				let col1 = `${pre1} ${BRT}${a1.label}${RST} ${DIM}${desc1}${RST}`;
				const col1W = visibleWidth(col1);
				const gap = Math.max(1, colW - col1W);
				col1 += " ".repeat(gap);
				if (a2) {
					const pre2 = (i + 3) === this.row ? `${SEL}\u25b8` : ` `;
					const desc2 = truncateToWidth(a2.description, Math.max(4, colW - a2.label.length - 5));
					lines.push(line(`${col1}${pre2} ${BRT}${a2.label}${RST} ${DIM}${desc2}${RST}`));
				} else {
					lines.push(line(col1));
				}
			}
		} else {
			// Single column — truncate descriptions to fit
			for (let i = 0; i < POMPOM_ACTIONS.length; i++) {
				const a = POMPOM_ACTIONS[i];
				const pre = (i + 2) === this.row ? `${SEL}\u25b8 ` : `  `;
				if (iw >= 30) {
					const desc = truncateToWidth(a.description, Math.max(4, iw - a.label.length - 6));
					lines.push(line(`${pre}${BRT}${a.label}${RST} ${DIM}${desc}${RST}`));
				} else {
					lines.push(line(`${pre}${BRT}${a.label}${RST}`));
				}
			}
		}
	}

	private renderVoiceTab(lines: string[], line: (s: string) => string, iw: number) {
		const cfg = getVoiceConfig();
		const voiceId = getCurrentVoiceId(cfg);
		const catalog = getVoiceCatalog()[cfg.engine] || [];
		const voiceName = catalog.find(v => v.id === voiceId)?.name || voiceId;
		const maxVoiceW = Math.max(8, iw - 14);
		const vShort = visibleWidth(voiceName) > maxVoiceW
			? truncateToWidth(voiceName, maxVoiceW - 3) + "..."
			: voiceName;
		const vol = cfg.volume;
		const barSize = iw >= 40 ? 10 : iw >= 30 ? 6 : 4;
		const volBar = (() => { const f = Math.max(0, Math.min(barSize, Math.round(vol / (100 / barSize)))); return "\u2588".repeat(f) + "\u2591".repeat(barSize - f); })();
		// Adaptive label width
		const lbl = iw >= 40 ? (s: string) => s.padEnd(14) : (s: string) => s.padEnd(8);
		const rows = [
			`${lbl("Engine:")}${cfg.engine}`,
			`${lbl("Voice:")}${vShort}`,
			`${lbl("Volume:")}${volBar} ${vol}%` + (iw >= 35 ? "  [+/-]" : ""),
			`${lbl("Status:")}${cfg.enabled ? GRN + "ON" : DIM + "OFF"}${RST}`,
			`Test voice`,
		];
		for (let i = 0; i < rows.length; i++) {
			const pre = i === this.row ? `${SEL}\u25b8 ` : `  `;
			lines.push(line(`${pre}${BRT}${rows[i]}${RST}`));
		}
		if (iw >= 40) {
			lines.push(line(""));
			lines.push(line(`${DIM}Pompom speaks reactions and commentary aloud.${RST}`));
			lines.push(line(`${DIM}Personality:  ${cfg.personality}  (change in Personality tab)${RST}`));
		}
	}

	private renderAmbientTab(lines: string[], line: (s: string) => string) {
		const cfg = getAmbientConfig();
		const cached = getCachedWeathers();
		const sfxStatus = getSfxCacheStatus();
		const vol = cfg.volume;
		const iw = this.lastIw;
		const barSize = iw >= 40 ? 10 : iw >= 30 ? 6 : 4;
		const volBar = (() => { const f = Math.max(0, Math.min(barSize, Math.round(vol / (100 / barSize)))); return "\u2588".repeat(f) + "\u2591".repeat(barSize - f); })();
		const hasKey = Boolean(process.env.ELEVENLABS_API_KEY);
		const lbl = iw >= 40 ? (s: string) => s.padEnd(14) : (s: string) => s.padEnd(8);

		// Section: Ambient
		lines.push(line(`${ACC}Ambient Loops${RST}  ${isAmbientPlaying() ? GRN + "playing" + RST : ""}`));
		const ambientRows = [
			`${lbl("Status:")}${cfg.enabled ? GRN + "ON" : DIM + "OFF"}${RST}`,
			`${lbl("Volume:")}${volBar} ${vol}%` + (iw >= 35 ? "  [+/-]" : ""),
			`Pregenerate` + (iw >= 45 ? `   ${DIM}Generate 5 weather sounds${RST}` : ""),
			`${lbl("Cached:")}${cached.length > 0 ? cached.join(", ") : "none"} ${DIM}(${cached.length}/5)${RST}`,
		];
		for (let i = 0; i < ambientRows.length; i++) {
			const pre = i === this.row ? `${SEL}\u25b8 ` : `  `;
			lines.push(line(`${pre}${BRT}${ambientRows[i]}${RST}`));
		}

		lines.push(line(""));

		// Section: SFX
		lines.push(line(`${ACC}Sound Effects${RST}  ${DIM}(${sfxStatus.cached}/${sfxStatus.total}, ${sfxStatus.variants} var)${RST}`));
		const sfxRows = [
			`Pregenerate` + (iw >= 45 ? `   ${DIM}Generate SFX + 3 variants${RST}` : ""),
			`${lbl("Cached:")}${sfxStatus.cached}/${sfxStatus.total} sounds, ${sfxStatus.variants} variants`,
		];
		for (let i = 0; i < sfxRows.length; i++) {
			const rowIdx = i + 4;
			const pre = rowIdx === this.row ? `${SEL}\u25b8 ` : `  `;
			lines.push(line(`${pre}${BRT}${sfxRows[i]}${RST}`));
		}

		if (iw >= 45) {
			lines.push(line(""));
			lines.push(line(`${DIM}Features: sleep ducking, crossfade, jitter,${RST}`));
			lines.push(line(`${DIM}time-of-day SFX, mood layers, micro-variations${RST}`));
		}
		lines.push(line(""));
		const custom = getCustomWeathers();
		if (custom.length > 0) lines.push(line(`${ACC}Custom:${RST} ${custom.join(", ")}`));
		const audioDir = getCustomAudioDir();
		const homeDir = os.homedir();
		const shortDir = iw >= 55 || !homeDir ? audioDir : audioDir.replace(homeDir, "~");
		lines.push(line(`${DIM}Custom loops: ${truncateToWidth(shortDir, Math.max(8, iw - 16))}${RST}`));
		if (!hasKey && (custom.length < 5 || sfxStatus.cached < sfxStatus.total)) {
			lines.push(line(`${YEL}Set ELEVENLABS_API_KEY for AI generation.${RST}`));
		}
	}

	private renderPersonalityTab(lines: string[], line: (s: string) => string, _w: number) {
		const cfg = getVoiceConfig();
		const iw = this.lastIw;
		if (iw >= 40) lines.push(line(`${DIM}Controls how often Pompom speaks during work.${RST}`));
		lines.push(line(""));
		for (let i = 0; i < PERSONALITY_OPTIONS.length; i++) {
			const p = PERSONALITY_OPTIONS[i];
			const active = cfg.personality === p.id ? ` ${GRN}\u2713${RST}` : "";
			const label = iw < 35 ? p.short : iw < 50 ? p.id : p.label;
			const pre = i === this.row ? `${SEL}\u25b8 ` : `  `;
			lines.push(line(`${pre}${BRT}${truncateToWidth(label, Math.max(8, iw - 6))}${RST}${active}`));
		}
	}

	private renderThemeTab(lines: string[], line: (s: string) => string) {
		const st = pompomStatus();
		lines.push(line(`${DIM}Change Pompom's color palette.${RST}`));
		lines.push(line(""));
		for (let i = 0; i < THEMES.length; i++) {
			const active = st.theme === THEMES[i] ? ` ${GRN}\u2713${RST}` : "";
			const pre = i === this.row ? `${SEL}\u25b8 ` : `  `;
			lines.push(line(`${pre}${BRT}${THEMES[i]}${RST}${active}`));
		}
	}

	private renderAccessoriesTab(lines: string[], line: (s: string) => string) {
		const acc = pompomGetAccessories();
		const iw = this.lastIw;
		if (iw >= 40) lines.push(line(`${DIM}Give Pompom items. They appear based on weather.${RST}`));
		lines.push(line(""));
		for (let i = 0; i < ACCESSORY_KEYS.length; i++) {
			const key = ACCESSORY_KEYS[i];
			const owned = acc[key];
			const mark = owned ? ` ${GRN}\u2713${RST}` + (iw >= 35 ? ` ${DIM}owned${RST}` : "") : ` ${DIM}[Enter]${RST}`;
			const pre = i === this.row ? `${SEL}\u25b8 ` : `  `;
			const descriptions: Record<string, string> = {
				umbrella: "rain/storm",
				scarf: "snow",
				sunglasses: "clear",
				hat: "collectible",
			};
			const desc = iw >= 35 ? `  ${DIM}${descriptions[key] || ""}${RST}` : "";
			lines.push(line(`${pre}${BRT}${key}${RST}${mark}${desc}`));
		}
	}

	private renderModelTab(lines: string[], line: (s: string) => string) {
		const current = getPompomModel();
		const iw = this.lastIw;
		const mainActive = current === "" ? ` ${GRN}\u2713${RST}` : "";
		const customModel = current !== "" ? truncateToWidth(current, Math.max(8, iw - 20)) : "";
		const customActive = current !== "" ? ` ${GRN}\u2713 ${customModel}${RST}` : "";
		const pre0 = this.row === 0 ? `${SEL}\u25b8 ` : `  `;
		const pre1 = this.row === 1 ? `${SEL}\u25b8 ` : `  `;
		if (iw >= 45) lines.push(line(`${DIM}AI model for /pompom:ask, :analyze, :chat${RST}`));
		lines.push(line(""));
		lines.push(line(`${pre0}${BRT}Use main model (default)${RST}${mainActive}`));
		lines.push(line(`${pre1}${BRT}Set custom model...${RST}${customActive}`));
		lines.push(line(""));
		const modelCount = this.modelList.length;
		lines.push(line(`${DIM}${modelCount > 0 ? modelCount + " models available" : "Type a model ID manually"}${RST}`));
	}

	private renderShortcutsTab(lines: string[], line: (s: string) => string, iw: number) {
		const modifier = process.platform === "darwin" ? "\u2325" : "Alt+";
		for (const group of SHORTCUT_GROUPS) {
			lines.push(line(`${ACC}${group.section}${RST}`));
			const items = group.items;
			// 2-column layout for wide terminals
			if (iw >= 60 && group.section !== "Commands") {
				const colW = Math.floor((iw - 2) / 2);
				for (let i = 0; i < items.length; i += 2) {
					const [k1, d1] = items[i];
					const dk1 = k1.replace("Alt+", modifier);
					const keyW = 7;
					const pad1 = dk1 + " ".repeat(Math.max(1, keyW - visibleWidth(dk1)));
					const desc1 = truncateToWidth(d1, Math.max(4, colW - keyW - 3));
					let col1 = `${BRT}${pad1}${RST}${DIM}${desc1}${RST}`;
					const col1Vis = visibleWidth(col1);
					const gap = Math.max(1, colW - col1Vis);
					col1 += " ".repeat(gap);
					if (i + 1 < items.length) {
						const [k2, d2] = items[i + 1];
						const dk2 = k2.replace("Alt+", modifier);
						const pad2 = dk2 + " ".repeat(Math.max(1, keyW - visibleWidth(dk2)));
						const desc2 = truncateToWidth(d2, Math.max(4, colW - keyW - 3));
						lines.push(line(`  ${col1}${BRT}${pad2}${RST}${DIM}${desc2}${RST}`));
					} else {
						lines.push(line(`  ${col1}`));
					}
				}
			} else {
				const keyW = iw >= 35 ? 8 : 6;
				for (const [key, desc] of items) {
					const displayKey = key.replace("Alt+", modifier);
					const padded = displayKey + " ".repeat(Math.max(1, keyW - visibleWidth(displayKey)));
					lines.push(line(`  ${BRT}${padded}${RST}${DIM}${truncateToWidth(desc, Math.max(4, iw - keyW - 4))}${RST}`));
				}
			}
			lines.push(line(""));
		}
		if (iw >= 45) lines.push(line(`${DIM}/pompom help  |  /pompom-settings${RST}`));
	}

	private renderAboutTab(lines: string[], line: (s: string) => string) {
		const s = pompomStatus();
		const stats = getSessionStats();
		const cfg = getVoiceConfig();
		const ambientCfg = getAmbientConfig();
		const weather = pompomGetWeather();
		const iw = this.lastIw;
		const barSize = iw >= 45 ? 10 : iw >= 30 ? 6 : 4;
		const barFn = (v: number) => { const f = Math.max(0, Math.min(barSize, Math.round(v / (100 / barSize)))); return "\u2588".repeat(f) + "\u2591".repeat(barSize - f); };
		const lbl = iw >= 45 ? (s: string) => s.padEnd(13) : (s: string) => s.padEnd(8);

		lines.push(line(`${ACC}Pompom${RST}`));
		if (iw >= 55) {
			// Wide: 2-column status
			lines.push(line(`  ${BRT}${lbl("Mood:")}${RST}${s.mood}    ${BRT}Weather:${RST} ${weather}`));
			lines.push(line(`  ${BRT}${lbl("Hunger:")}${RST}${barFn(s.hunger)} ${s.hunger}%    ${BRT}Energy:${RST} ${barFn(s.energy)} ${s.energy}%`));
			lines.push(line(`  ${BRT}${lbl("Theme:")}${RST}${s.theme}`));
		} else {
			lines.push(line(`  ${BRT}${lbl("Mood:")}${RST}${s.mood}  ${BRT}Wx:${RST} ${weather}`));
			lines.push(line(`  ${BRT}${lbl("Hunger:")}${RST}${barFn(s.hunger)} ${s.hunger}%`));
			lines.push(line(`  ${BRT}${lbl("Energy:")}${RST}${barFn(s.energy)} ${s.energy}%`));
		}
		lines.push(line(""));
		const sfxInfo = getSfxCacheStatus();
		lines.push(line(`${ACC}Audio${RST}`));
		lines.push(line(`  ${BRT}${lbl("Voice:")}${RST}${cfg.enabled ? cfg.engine : "off"} (${cfg.personality})`));
		if (iw >= 55) {
			lines.push(line(`  ${BRT}${lbl("Vol:")}${RST}voice ${cfg.volume}%  ambient ${ambientCfg.enabled ? ambientCfg.volume + "%" : "off"}`));
		} else {
			lines.push(line(`  ${BRT}${lbl("Voice vol:")}${RST}${cfg.volume}%`));
			lines.push(line(`  ${BRT}${lbl("Ambient:")}${RST}${ambientCfg.enabled ? "on " + ambientCfg.volume + "%" : "off"}`));
		}
		lines.push(line(`  ${BRT}${lbl("SFX:")}${RST}${sfxInfo.cached}/${sfxInfo.total} sounds, ${sfxInfo.variants} var`));
		lines.push(line(""));
		lines.push(line(`${ACC}Agent${RST}`));
		lines.push(line(`  ${BRT}${lbl("Status:")}${RST}${stats.isAgentActive ? "active" : "idle"} (${stats.mood})`));
		lines.push(line(`  ${BRT}${lbl("Tools:")}${RST}${stats.toolCalls} calls, ${stats.toolFailures} fails`));
		const model = getPompomModel() || "(main)";
		lines.push(line(`  ${BRT}${lbl("Model:")}${RST}${truncateToWidth(model, Math.max(8, iw - 16))}`));
		lines.push(line(""));
		const termCount = getInstanceCount();
		const role = isPrimaryInstance() ? `${GRN}primary${RST}` + (iw >= 40 ? " (audio)" : "") : `${DIM}secondary${RST}`;
		lines.push(line(`${ACC}Terminals${RST}  ${termCount} instance${termCount !== 1 ? "s" : ""}, ${role}`));
	}

	private renderSubPicker(lines: string[], line: (s: string) => string, iw: number, w: number) {
		const cfg = getVoiceConfig();
		const currentId = this.sub === "voice-picker" ? getCurrentVoiceId(cfg)
			: this.sub === "engine-picker" ? cfg.engine
			: this.sub === "model-picker" ? getPompomModel()
			: cfg.personality;

		const subLabel = this.sub === "voice-picker" ? "Voice"
			: this.sub === "engine-picker" ? "Engine"
			: this.sub === "model-picker" ? "Model"
			: "Personality";

		lines.push(line(`${BRT}${subLabel}: ${RST}${this.search}\u2502  ${DIM}${this.filtered.length} results${RST}`));
		lines.push(line(""));

		const maxShow = Math.min(10, Math.max(3, Math.floor((w - 10) / 3)));
		const start = Math.max(0, this.subRow - Math.floor(maxShow / 2));
		const end = Math.min(this.filtered.length, start + maxShow);
		for (let i = start; i < end; i++) {
			const v = this.filtered[i];
			const isCurrent = v.id === currentId;
			const pre = i === this.subRow ? `${SEL}\u25b8 ` : `${DIM}  `;
			const mark = isCurrent ? ` ${GRN}\u2713${RST}` : "";
			const nameDisplay = truncateToWidth(v.name, Math.max(10, iw - 6));
			lines.push(line(`${pre}${nameDisplay}${RST}${mark}`));
		}
		if (this.filtered.length === 0) lines.push(line(`${DIM}No matches${RST}`));
		lines.push(line(""));

		const hint = this.sub === "voice-picker" ? "[Enter] Select + Preview" : "[Enter] Select";
		lines.push(line(`${DIM}[Esc] Back  [Type] Filter  ${hint}${RST}`));
	}

	// ─── Footer hints ─────────────────────────────────────────────────────────

	private getFooterHint(): string {
		const iw = this.lastIw;
		if (this.sub !== "main") {
			return iw >= 40 ? "[Esc] Back  [Type] Filter  [\u2191\u2193] Nav" : "Esc:Back  \u2191\u2193:Nav";
		}
		if (iw < 35) {
			return "Esc:Close \u2190\u2192:Tabs \u2191\u2193:Nav";
		}
		if (this.isVolumeRow()) return "[Esc] Close  [+/-] Vol  [\u2190\u2192] Tabs";
		if (this.tab === TAB_SHORTCUTS || this.tab === TAB_ABOUT) return "[Esc] Close  [\u2190\u2192] Tabs";
		if (this.tab === TAB_POMPOM) {
			return iw >= 50 ? "[Esc] Close  [\u2190\u2192] Tabs  [\u2191\u2193] Nav  [Enter] Do it!" : "[Esc] Close  [\u2190\u2192] Tabs  [Enter] Act";
		}
		return iw >= 50 ? "[Esc] Close  [\u2190\u2192] Tabs  [\u2191\u2193] Nav  [Enter] Select" : "[Esc] Close  [\u2190\u2192] Tabs  [Enter] Sel";
	}

	invalidate(): void { this.cw = undefined; this.cl = undefined; }
}

export interface PompomSettingsOptions {
	pompomEnabled?: boolean;
	onTogglePompom?: (enabled: boolean) => void;
	onAmbientToggle?: (enabled: boolean) => void;
	onAccessoryChange?: (change: AccessoryChange) => void | Promise<void>;
	onWindowToggle?: () => Promise<boolean>;
}

export interface AccessoryChange {
	accessory: keyof Accessories;
	accessories: Accessories;
}

export async function openPompomSettings(ctx: ExtensionContext, opts?: PompomSettingsOptions): Promise<void> {
	if (!ctx.hasUI) return;
	const panel = new PompomSettingsPanel();
	panel.pompomEnabled = opts?.pompomEnabled ?? true;
	panel.onTogglePompom = opts?.onTogglePompom;
	panel.onAmbientToggle = opts?.onAmbientToggle;
	panel.onAccessoryChange = opts?.onAccessoryChange;
	panel.onWindowToggle = opts?.onWindowToggle;

	// Wire pregenerate callback
	panel.onPregenerate = async () => {
		return await pregenerateAll();
	};

	// Populate available models from Pi's model registry
	try {
		const registry = ctx.modelRegistry;
		const models = (registry as any)?.getAvailable?.() || (registry as any)?.getAll?.() || [];
		panel.modelList = models.map((m: any) => {
			if (typeof m === "string") return m;
			if (m?.provider && m?.id) return `${m.provider}/${m.id}`;
			if (m?.id) return String(m.id);
			return "";
		}).filter(Boolean);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[pompom-settings] Failed to load model list: ${msg}`);
		panel.modelList = [];
	}

	await ctx.ui.custom(
		(_tui: any, _theme: any, _kb: any, done: (v?: any) => void) => {
			panel.onClose = () => { panel.cleanup(); done(); };
			return panel;
		},
		{
			overlay: true,
			overlayOptions: {
				width: "75%" as any,
				minWidth: 36,
				maxHeight: "85%" as any,
				anchor: "center" as any,
			},
		},
	);
}
