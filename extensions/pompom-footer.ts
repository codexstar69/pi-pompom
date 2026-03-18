/**
 * Pompom Footer — Single-line status bar for Pi CLI.
 *
 * Catppuccin Mocha. Nerd Font icons only — zero emoji.
 * Parallelogram bars (▰▱). Thin Powerline separators ().
 * Deliberate spacing. Progressive disclosure by terminal width.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { pompomStatus, pompomGetWeather } from "./pompom";
import { getSessionStats } from "./pompom-agent";
import { getVoiceConfig } from "./pompom-voice";
import { getAmbientConfig, isAmbientPlaying } from "./pompom-ambient";

// ─── Color System (Catppuccin Mocha hex → ANSI true-color) ──────────────────

function fg(hex: string): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `\x1b[38;2;${r};${g};${b}m`;
}
const RST = "\x1b[0m";
const BOLD = "\x1b[1m";

function paint(hex: string, text: string): string { return `${fg(hex)}${text}${RST}`; }
function strong(hex: string, text: string): string { return `${BOLD}${fg(hex)}${text}${RST}`; }
function muted(text: string): string { return paint("#585b70", text); }   // Surface2
function subdued(text: string): string { return paint("#6c7086", text); } // Overlay0
function subtle(text: string): string { return paint("#a6adc8", text); }  // Subtext0
function bright(text: string): string { return paint("#cdd6f4", text); }  // Text

// ─── Palette ─────────────────────────────────────────────────────────────────

const P = {
	pink:     "#f5c2e7",  mauve:    "#cba6f7",  red:      "#f38ba8",
	maroon:   "#eba0ac",  peach:    "#fab387",  yellow:   "#f9e2af",
	green:    "#a6e3a1",  teal:     "#94e2d5",  sky:      "#89dceb",
	sapphire: "#74c7ec",  blue:     "#89b4fa",  lavender: "#b4befe",
	flamingo: "#f2cdcd",
};

// ─── Nerd Font Icons (no emoji anywhere) ─────────────────────────────────────

const IC = {
	heart:    "\uf004",   // nf-fa-heart
	bolt:     "\uf0e7",   // nf-fa-bolt
	sun:      "\ue30d",   // nf-weather-day_sunny
	cloud:    "\ue312",   // nf-weather-cloudy
	rain:     "\ue318",   // nf-weather-rain
	snow:     "\ue31a",   // nf-weather-snow
	storm:    "\ue31d",   // nf-weather-thunderstorm
	music:    "\uf001",   // nf-fa-music
	volume:   "\uf028",   // nf-fa-volume_up
	folder:   "\uf07c",   // nf-fa-folder_open
	clock:    "\uf017",   // nf-fa-clock_o
	chip:     "\uf2db",   // nf-fa-microchip
	database: "\uf1c0",   // nf-fa-database
	dollar:   "\uf155",   // nf-fa-dollar
	paw:      "\uf1b0",   // nf-fa-paw
	code:     "\uf121",   // nf-fa-code
	sep:      "\ue0b1",   // Powerline thin right
};

// ─── Separator ───────────────────────────────────────────────────────────────

const SEP = `  ${subdued(IC.sep)}  `; // 2-space breathing room each side

// ─── Mood ────────────────────────────────────────────────────────────────────

const MOOD: Record<string, { face: string; hex: string }> = {
	happy:    { face: "(\u25d5\u1d17\u25d5)",  hex: P.green },
	content:  { face: "(\u25d5\u203f\u25d5)",  hex: P.teal },
	hungry:   { face: "(\u25d5\ufe35\u25d5)",  hex: P.peach },
	sleeping: { face: "(\u2013\u203f\u2013)",  hex: P.lavender },
	playful:  { face: "(\u25d5\u03c9\u25d5)",  hex: P.pink },
	musical:  { face: "(\u25d5\u2200\u25d5)",  hex: P.mauve },
	tired:    { face: "(\u25d5\u2313\u25d5)",  hex: P.maroon },
};

const WEATHER: Record<string, { icon: string; hex: string }> = {
	clear:  { icon: IC.sun,   hex: P.yellow },
	cloudy: { icon: IC.cloud, hex: "#7f849c" },  // Overlay1
	rain:   { icon: IC.rain,  hex: P.blue },
	snow:   { icon: IC.snow,  hex: P.sky },
	storm:  { icon: IC.storm, hex: P.mauve },
};

// ─── Components ──────────────────────────────────────────────────────────────

function miniBar(icon: string, iconHex: string, val: number): string {
	const v = Math.max(0, Math.min(100, val));
	const hex = v > 50 ? P.green : v > 25 ? P.yellow : P.red;
	const filled = Math.round(v / 20);
	const empty = 5 - filled;
	return `${paint(iconHex, icon)} ${paint(hex, "\u25b0".repeat(filled))}${muted("\u25b1".repeat(empty))} ${bright(String(v).padStart(3) + "%")}`;
}

function fmtTime(ms: number): string {
	if (ms <= 0) return "0m";
	const m = Math.round((Date.now() - ms) / 60000);
	return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? (m % 60) + "m" : ""}`;
}

function getCost(ctx: ExtensionContext): number {
	try {
		return (ctx.sessionManager.getBranch() as any[]).reduce((t: number, e: any) =>
			t + (Number(e.message?.usage?.cost?.total) || 0), 0);
	} catch { return 0; }
}

function shortPath(cwd: string): string {
	const home = process.env.HOME || "";
	let p = cwd;
	if (home && p.startsWith(home)) p = "~" + p.slice(home.length);
	const parts = p.split("/").filter(Boolean);
	return parts.length > 2 ? parts[parts.length - 1] : parts.join("/");
}

// ─── Footer Render ───────────────────────────────────────────────────────────

function renderFooter(width: number, sessionMs: number, thinkingLevel: string, ctx: ExtensionContext): string {
	if (width <= 0) return "";

	const status = pompomStatus();
	const weather = pompomGetWeather();
	const stats = getSessionStats();
	const mood = MOOD[status.mood] || MOOD.content;
	const wx = WEATHER[weather] || WEATHER.clear;

	// ── Left anchor: Pompom identity (always visible)
	const left = `${paint(mood.hex, mood.face)}  ${strong(mood.hex, "Pompom")}`;

	// ── Right anchor: Model + thinking (always visible)
	const rawModel = (ctx.model as any)?.name || (ctx.model as any)?.id || "Claude";
	const thinkSuffix = thinkingLevel && thinkingLevel !== "off"
		? `  ${subdued("\u2022")}  ${paint(P.mauve, thinkingLevel)}`
		: "";
	const right = `${paint(P.lavender, IC.chip)}  ${bright(rawModel)}${thinkSuffix}`;

	// ── Middle segments (progressive, ordered by importance)
	const mid: string[] = [];

	// 1. Critical vital (60+)
	if (width >= 60) {
		if (status.hunger <= status.energy) {
			mid.push(miniBar(IC.heart, P.peach, status.hunger));
		} else {
			mid.push(miniBar(IC.bolt, P.green, status.energy));
		}
	}

	// 2. Second vital (80+)
	if (width >= 80) {
		if (status.hunger <= status.energy) {
			mid.push(miniBar(IC.bolt, P.green, status.energy));
		} else {
			mid.push(miniBar(IC.heart, P.peach, status.hunger));
		}
	}

	// 3. Weather (92+)
	if (width >= 92) {
		mid.push(`${paint(wx.hex, wx.icon)}  ${subtle(weather)}`);
	}

	// 4. State + time (104+)
	if (width >= 104) {
		const stateIcon = stats.isAgentActive ? IC.code : IC.paw;
		const stateHex = stats.isAgentActive ? P.sapphire : "#7f849c";
		const stateLabel = stats.isAgentActive ? "working" : status.mood;
		mid.push(`${paint(stateHex, stateIcon)}  ${subtle(stateLabel)}  ${subdued(IC.clock)} ${subdued(fmtTime(sessionMs))}`);
	}

	// 5. Context usage (120+)
	if (width >= 120) {
		const usage = (ctx as any).getContextUsage?.();
		const total = Math.max(1, Number(usage?.contextWindow) || 200000);
		const used = Math.max(0, Number(usage?.tokens) || 0);
		const pct = Math.min(100, Math.round((used / total) * 100));
		const usedK = Math.round(used / 1000);
		const totalK = Math.round(total / 1000);
		const ctxHex = pct > 85 ? P.red : pct > 60 ? P.peach : P.sapphire;
		const filled = Math.round(pct / 20);
		const empty = 5 - filled;
		mid.push(`${paint(ctxHex, IC.database)}  ${paint(ctxHex, "\u25b0".repeat(filled))}${muted("\u25b1".repeat(empty))} ${bright(`${usedK}k`)}${subdued("/")}${subdued(`${totalK}k`)}`);
	}

	// 6. Path (134+)
	if (width >= 134) {
		mid.push(`${paint(P.blue, IC.folder)}  ${subdued(shortPath(ctx.cwd))}`);
	}

	// 7. Cost (144+)
	if (width >= 144) {
		const cost = getCost(ctx);
		if (cost > 0.005) {
			const costHex = cost > 5 ? P.red : cost > 2 ? P.yellow : P.green;
			mid.push(`${paint(costHex, IC.dollar)}${bright(cost.toFixed(2))}`);
		}
	}

	// 8. Voice (152+)
	if (width >= 152 && getVoiceConfig().enabled) {
		mid.push(paint(P.flamingo, IC.volume));
	}

	// 9. Ambient (156+)
	if (width >= 156 && getAmbientConfig().enabled && isAmbientPlaying()) {
		mid.push(paint(P.teal, IC.music));
	}

	// ── Compose with balanced spacing
	const middle = mid.join(SEP);
	const lW = visibleWidth(left);
	const mW = visibleWidth(middle);
	const rW = visibleWidth(right);

	let line: string;
	if (mid.length === 0) {
		// Narrow: left ... right
		const gap = Math.max(1, width - lW - rW);
		line = `${left}${" ".repeat(gap)}${right}`;
	} else {
		// Wide: left  SEP  middle  ...  right
		const leftSection = `${left}${SEP}${middle}`;
		const lsW = visibleWidth(leftSection);
		const gap = Math.max(2, width - lsW - rW);
		line = `${leftSection}${" ".repeat(gap)}${right}`;
	}

	return truncateToWidth(line, width);
}

// ─── API ─────────────────────────────────────────────────────────────────────

export function installPompomFooter(
	ctx: ExtensionContext,
	getSessionStartMs: () => number,
	getThinkingLevel: () => string,
): void {
	if (!ctx.hasUI) return;

	ctx.ui.setFooter((_tui, _theme, _footerData) => {
		let disposed = false;
		return {
			invalidate() {},
			dispose() { disposed = true; },
			render(width: number): string[] {
				if (disposed || width <= 0) return ["", ""];
				try {
					return [truncateToWidth(renderFooter(width, getSessionStartMs(), getThinkingLevel(), ctx), width), ""];
				} catch {
					return ["", ""];
				}
			},
		};
	});
}
