/**
 * Pompom Settings Panel — interactive TUI overlay with tab navigation.
 * LEFT/RIGHT switches tabs, UP/DOWN navigates rows, ENTER selects, ESC closes.
 * Fully responsive — adapts to any terminal width.
 *
 * Tabs: Pompom · Voice · Ambient · Personality · Theme · Accessories · Model · Shortcuts · About
 */

import { matchesKey, Key, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	getVoiceConfig, setVoiceEnabled, setVoiceEngine, setVoice, setVolume,
	setPersonality, getVoiceCatalog, speakTest, stopPlayback,
	setPompomModel, getPompomModel,
	type Personality, type VoiceConfig,
} from "./pompom-voice";
import { pompomKeypress, pompomStatus, pompomGiveAccessory, pompomGetAccessories, pompomGetWeather, type Accessories } from "./pompom";
import { getSessionStats } from "./pompom-agent";
import {
	getAmbientConfig, setAmbientEnabled, setAmbientVolume,
	getCachedWeathers, getCustomWeathers, isAmbientPlaying, pregenerateAll,
	getCustomAudioDir,
} from "./pompom-ambient";

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

const TABS = ["Pompom", "Voice", "Ambient", "Personality", "Theme", "Accessories", "Model", "Keys", "About"];

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
	private statusMsg = "";
	private statusTimer: ReturnType<typeof setTimeout> | null = null;
	public onClose?: () => void;
	public onPregenerate?: () => Promise<number>;

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
		if (this.tab === TAB_POMPOM) return POMPOM_ACTIONS.length + 1; // +1 for on/off toggle
		if (this.tab === TAB_VOICE) return 5; // engine, voice, volume, status, test
		if (this.tab === TAB_AMBIENT) return 4; // status, volume, pregenerate, cache info
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
			} else {
				const action = POMPOM_ACTIONS[this.row - 1]; // offset by 1 for toggle row
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
				this.showStatus(newState ? "Ambient ON" : "Ambient OFF");
			}
			// row 1 = volume (handled by +/-)
			if (this.row === 2) {
				// Pregenerate all sounds
				this.showStatus("Generating sounds...", 30000);
				if (this.onPregenerate) {
					void this.onPregenerate().then((count) => {
						this.showStatus(`Generated ${count} new tracks`);
					});
				}
			}
			// row 3 = cache info (read-only)
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
					pompomGiveAccessory(key);
					this.showStatus(`Gave Pompom a ${key}!`);
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

	private cleanup() {
		if (this.statusTimer) { clearTimeout(this.statusTimer); this.statusTimer = null; }
	}

	render(width: number): string[] {
		const liveTab = this.tab === TAB_POMPOM || this.tab === TAB_AMBIENT || this.tab === TAB_ABOUT;
		if (this.cl && this.cw === width && !liveTab) return this.cl;
		const w = Math.max(30, Math.min(width - 2, 68));
		const iw = w - 4;

		const pad = (content: string) => {
			const cw = visibleWidth(content);
			const gap = Math.max(0, iw - cw);
			return content + " ".repeat(gap);
		};
		const line = (content: string) => truncateToWidth(`${DIM}\u2502${RST} ${pad(content)} ${DIM}\u2502${RST}`, w);
		const border = (l: string, fill: string, r: string) => truncateToWidth(`${DIM}${l}${fill.repeat(w - 2)}${r}${RST}`, w);

		const lines: string[] = [];

		// Header
		lines.push(border("\u256d", "\u2500", "\u256e"));
		const headerRight = this.statusMsg ? ` ${YEL}${this.statusMsg}${RST}` : "";
		lines.push(line(`${ACC}Pompom Settings${RST}${headerRight}`));
		lines.push(border("\u251c", "\u2500", "\u2524"));

		// Tab bar — two-line for narrow terminals
		const useShort = w < 50;
		let tabStr = "";
		for (let i = 0; i < TABS.length; i++) {
			const name = useShort ? TABS[i].slice(0, 3) : TABS[i];
			tabStr += i === this.tab ? `${ACC}[${name}]${RST} ` : `${DIM}${name}${RST} `;
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
			? `${GRN}ON${RST}  ${DIM}animation, voice, ambient all active${RST}`
			: `${YEL}OFF${RST} ${DIM}everything muted — side chat still works${RST}`;
		lines.push(line(`${togglePre}${BRT}Pompom: ${toggleLabel}`));
		lines.push(line(""));

		// Status section
		lines.push(line(`${BRT}Mood:${RST}   ${s.mood}    ${BRT}Weather:${RST} ${weather}`));
		lines.push(line(`${BRT}Hunger:${RST} ${bar10(s.hunger)} ${s.hunger}%`));
		lines.push(line(`${BRT}Energy:${RST} ${bar10(s.energy)} ${s.energy}%`));
		lines.push(line(""));
		lines.push(line(`${ACC}Actions${RST}  ${DIM}(press Enter to activate)${RST}`));

		// Action rows — offset by 1 for the toggle row
		for (let i = 0; i < POMPOM_ACTIONS.length; i++) {
			const a = POMPOM_ACTIONS[i];
			const pre = (i + 1) === this.row ? `${SEL}\u25b8 ` : `  `;
			const desc = truncateToWidth(a.description, Math.max(8, iw - a.label.length - 8));
			lines.push(line(`${pre}${BRT}${a.label}${RST}  ${DIM}${desc}${RST}`));
		}
	}

	private renderVoiceTab(lines: string[], line: (s: string) => string, iw: number) {
		const cfg = getVoiceConfig();
		const voiceId = getCurrentVoiceId(cfg);
		const catalog = getVoiceCatalog()[cfg.engine] || [];
		const voiceName = catalog.find(v => v.id === voiceId)?.name || voiceId;
		const vShort = visibleWidth(voiceName) > iw - 12
			? truncateToWidth(voiceName, Math.max(8, iw - 15)) + "..."
			: voiceName;
		const vol = cfg.volume;
		const volBar = bar10(vol);
		const rows = [
			`Engine:       ${cfg.engine}`,
			`Voice:        ${vShort}`,
			`Volume:       ${volBar} ${vol}%  [+/-]`,
			`Status:       ${cfg.enabled ? GRN + "ON" : DIM + "OFF"}${RST}`,
			`Test voice`,
		];
		for (let i = 0; i < rows.length; i++) {
			const pre = i === this.row ? `${SEL}\u25b8 ` : `  `;
			lines.push(line(`${pre}${BRT}${rows[i]}${RST}`));
		}
		lines.push(line(""));
		lines.push(line(`${DIM}Pompom speaks reactions and commentary aloud.${RST}`));
		lines.push(line(`${DIM}Personality:  ${cfg.personality}  (change in Personality tab)${RST}`));
	}

	private renderAmbientTab(lines: string[], line: (s: string) => string) {
		const cfg = getAmbientConfig();
		const cached = getCachedWeathers();
		const vol = cfg.volume;
		const volBar = bar10(vol);
		const hasKey = Boolean(process.env.ELEVENLABS_API_KEY);
		const rows = [
			`Status:       ${cfg.enabled ? GRN + "ON" : DIM + "OFF"}${RST}`,
			`Volume:       ${volBar} ${vol}%  [+/-]`,
			`Pregenerate   ${DIM}Generate all 5 weather sounds now${RST}`,
			`Cached:       ${cached.length > 0 ? cached.join(", ") : "none"} ${DIM}(${cached.length}/5)${RST}`,
		];
		for (let i = 0; i < rows.length; i++) {
			const pre = i === this.row ? `${SEL}\u25b8 ` : `  `;
			lines.push(line(`${pre}${BRT}${rows[i]}${RST}`));
		}
		lines.push(line(""));
		if (isAmbientPlaying()) {
			lines.push(line(`${GRN}Now playing${RST}`));
		}
		const custom = getCustomWeathers();
		if (custom.length > 0) {
			lines.push(line(`${ACC}Custom:${RST} ${custom.join(", ")}`));
		}
		lines.push(line(`${DIM}Drop your own loops in:${RST}`));
		lines.push(line(`${DIM}  ${getCustomAudioDir()}${RST}`));
		lines.push(line(`${DIM}  Files: clear.mp3 cloudy.mp3 rain.mp3 snow.mp3 storm.mp3${RST}`));
		if (!hasKey && custom.length < 5) {
			lines.push(line(`${YEL}Set ELEVENLABS_API_KEY for AI generation fallback.${RST}`));
		}
	}

	private renderPersonalityTab(lines: string[], line: (s: string) => string, w: number) {
		const cfg = getVoiceConfig();
		lines.push(line(`${DIM}Controls how often Pompom speaks during work.${RST}`));
		lines.push(line(""));
		for (let i = 0; i < PERSONALITY_OPTIONS.length; i++) {
			const p = PERSONALITY_OPTIONS[i];
			const active = cfg.personality === p.id ? ` ${GRN}\u2713${RST}` : "";
			const label = w < 45 ? p.short : p.label;
			const pre = i === this.row ? `${SEL}\u25b8 ` : `  `;
			lines.push(line(`${pre}${BRT}${label}${RST}${active}`));
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
		lines.push(line(`${DIM}Give Pompom items. They appear based on weather.${RST}`));
		lines.push(line(""));
		for (let i = 0; i < ACCESSORY_KEYS.length; i++) {
			const key = ACCESSORY_KEYS[i];
			const owned = acc[key];
			const mark = owned ? ` ${GRN}\u2713 owned${RST}` : ` ${DIM}[Enter] give${RST}`;
			const pre = i === this.row ? `${SEL}\u25b8 ` : `  `;
			const descriptions: Record<string, string> = {
				umbrella: "Shows in rain/storm",
				scarf: "Shows in snow",
				sunglasses: "Shows in clear weather",
				hat: "A cute collectible",
			};
			const desc = descriptions[key] || "";
			lines.push(line(`${pre}${BRT}${key}${RST}${mark}  ${DIM}${desc}${RST}`));
		}
	}

	private renderModelTab(lines: string[], line: (s: string) => string) {
		const current = getPompomModel();
		const mainActive = current === "" ? ` ${GRN}\u2713${RST}` : "";
		const customActive = current !== "" ? ` ${GRN}\u2713 ${current}${RST}` : "";
		const pre0 = this.row === 0 ? `${SEL}\u25b8 ` : `  `;
		const pre1 = this.row === 1 ? `${SEL}\u25b8 ` : `  `;
		lines.push(line(`${DIM}AI model for /pompom:ask, /pompom:analyze, /pompom:chat${RST}`));
		lines.push(line(""));
		lines.push(line(`${pre0}${BRT}Use main agent's model (default)${RST}${mainActive}`));
		lines.push(line(`${pre1}${BRT}Set custom model...${RST}${customActive}`));
		lines.push(line(""));
		if (this.modelList.length === 0) {
			lines.push(line(`${DIM}No models loaded — type a model ID manually${RST}`));
		} else {
			lines.push(line(`${DIM}${this.modelList.length} models available${RST}`));
		}
	}

	private renderShortcutsTab(lines: string[], line: (s: string) => string, iw: number) {
		const modifier = process.platform === "darwin" ? "\u2325" : "Alt+";
		for (const group of SHORTCUT_GROUPS) {
			lines.push(line(`${ACC}${group.section}${RST}`));
			for (const [key, desc] of group.items) {
				const displayKey = key.replace("Alt+", modifier);
				const keyW = 8;
				const padded = displayKey + " ".repeat(Math.max(1, keyW - visibleWidth(displayKey)));
				lines.push(line(`  ${BRT}${padded}${RST}${DIM}${truncateToWidth(desc, Math.max(8, iw - keyW - 4))}${RST}`));
			}
			lines.push(line(""));
		}
		lines.push(line(`${DIM}Commands: /pompom help  |  Settings: /pompom-settings${RST}`));
	}

	private renderAboutTab(lines: string[], line: (s: string) => string) {
		const s = pompomStatus();
		const stats = getSessionStats();
		const cfg = getVoiceConfig();
		const ambientCfg = getAmbientConfig();
		const weather = pompomGetWeather();

		lines.push(line(`${ACC}Pompom${RST}`));
		lines.push(line(`  ${BRT}Mood:${RST}        ${s.mood}`));
		lines.push(line(`  ${BRT}Hunger:${RST}      ${bar10(s.hunger)} ${s.hunger}%`));
		lines.push(line(`  ${BRT}Energy:${RST}      ${bar10(s.energy)} ${s.energy}%`));
		lines.push(line(`  ${BRT}Theme:${RST}       ${s.theme}`));
		lines.push(line(`  ${BRT}Weather:${RST}     ${weather}`));
		lines.push(line(""));
		lines.push(line(`${ACC}Audio${RST}`));
		lines.push(line(`  ${BRT}Voice:${RST}       ${cfg.enabled ? cfg.engine : "off"} (${cfg.personality})`));
		lines.push(line(`  ${BRT}Voice vol:${RST}   ${cfg.volume}%`));
		lines.push(line(`  ${BRT}Ambient:${RST}     ${ambientCfg.enabled ? "on" : "off"} (${ambientCfg.volume}%)`));
		lines.push(line(""));
		lines.push(line(`${ACC}Agent Session${RST}`));
		lines.push(line(`  ${BRT}Agent:${RST}       ${stats.isAgentActive ? "active" : "idle"} (${stats.mood})`));
		lines.push(line(`  ${BRT}Tools:${RST}       ${stats.toolCalls} calls, ${stats.toolFailures} fails`));
		lines.push(line(`  ${BRT}Model:${RST}       ${getPompomModel() || "(main agent)"}`));
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
		if (this.sub !== "main") return "[Esc] Back  [Type] Filter  [\u2191\u2193] Nav";
		if (this.isVolumeRow()) return "[Esc] Close  [+/-] Volume  [\u2190\u2192] Tabs";
		if (this.tab === TAB_SHORTCUTS || this.tab === TAB_ABOUT) return "[Esc] Close  [\u2190\u2192] Tabs";
		if (this.tab === TAB_POMPOM) return "[Esc] Close  [\u2190\u2192] Tabs  [\u2191\u2193] Nav  [Enter] Do it!";
		return "[Esc] Close  [\u2190\u2192] Tabs  [\u2191\u2193] Nav  [Enter] Select";
	}

	invalidate(): void { this.cw = undefined; this.cl = undefined; }
}

export interface PompomSettingsOptions {
	pompomEnabled?: boolean;
	onTogglePompom?: (enabled: boolean) => void;
}

export async function openPompomSettings(ctx: ExtensionContext, opts?: PompomSettingsOptions): Promise<void> {
	if (!ctx.hasUI) return;
	const panel = new PompomSettingsPanel();
	panel.pompomEnabled = opts?.pompomEnabled ?? true;
	panel.onTogglePompom = opts?.onTogglePompom;

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
