/**
 * Pompom Footer — Enterprise-polished status bar for Pi CLI.
 *
 * A meticulously crafted two-line footer with Powerline-style separators and
 * Nerd Font icons, designed for clarity, beauty, and utility.
 *
 * Features:
 *   - Line 1: Pompom's identity, vitals (health/energy), and current state.
 *   - Line 2: Developer context like location, token usage, cost, and model status.
 *   - Palette: Catppuccin Mocha for a comfortable, modern aesthetic.
 *   - Mood-Reactive: Pompom's name changes color to reflect its current mood.
 *   - Dynamic Bars: Vitals and context bars use color to indicate urgency (green → yellow → red).
 *   - Adaptive Layout: Gracefully hides less critical information on narrower terminals.
 *   - Polished Details: Subtle use of bolding, dimmed text, and icons for visual hierarchy.
 *
 * Designed by Gemini + Claude. Catppuccin Mocha palette throughout.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { pompomStatus, pompomGetWeather } from "./pompom";
import { getSessionStats } from "./pompom-agent";
import { getVoiceConfig } from "./pompom-voice";
import { getAmbientConfig, isAmbientPlaying } from "./pompom-ambient";

// ─── Palette & Style ─────────────────────────────────────────────────────────

function fg(r: number, g: number, b: number): string { return `\x1b[38;2;${r};${g};${b}m`; }

const C = {
	rosewater: fg(245, 224, 220),
	flamingo:  fg(242, 205, 205),
	pink:      fg(245, 194, 231),
	mauve:     fg(203, 166, 247),
	red:       fg(243, 139, 168),
	maroon:    fg(235, 160, 172),
	peach:     fg(250, 179, 135),
	yellow:    fg(249, 226, 175),
	green:     fg(166, 227, 161),
	teal:      fg(148, 226, 213),
	sky:       fg(137, 220, 235),
	sapphire:  fg(116, 199, 236),
	blue:      fg(137, 180, 250),
	lavender:  fg(180, 190, 254),
	text:      fg(205, 214, 244),
	subtext1:  fg(186, 194, 222),
	subtext0:  fg(166, 173, 200),
	overlay2:  fg(147, 153, 178),
	overlay1:  fg(127, 132, 156),
	overlay0:  fg(108, 112, 134),
	surface2:  fg(88, 91, 112),
	surface1:  fg(69, 71, 90),
	surface0:  fg(49, 50, 68),
	rst:       "\x1b[0m",
	bold:      "\x1b[1m",
};

// ─── Nerd Font Icons ─────────────────────────────────────────────────────────

const I = {
	heart:   "\uf004",   // nf-fa-heart
	bolt:    "\uf0e7",   // nf-fa-bolt
	sun:     "\ue30d",   // nf-weather-day_sunny
	cloud:   "\ue312",   // nf-weather-cloudy
	rain:    "\ue318",   // nf-weather-rain
	snow:    "\ue31a",   // nf-weather-snow
	storm:   "\ue31d",   // nf-weather-thunderstorm
	music:   "\uf001",   // nf-fa-music
	speaker: "\uf028",   // nf-fa-volume_up
	folder:  "\uf115",   // nf-fa-folder_open
	branch:  "\ue725",   // nf-dev-git_branch
	clock:   "\uf017",   // nf-fa-clock_o
	model:   "\uf2db",   // nf-fa-microchip
	tokens:  "\uf521",   // nf-mdi-database
	cost:    "\uf155",   // nf-fa-dollar
	paw:     "\uf1b0",   // nf-fa-paw
	bed:     "\uf236",   // nf-fa-bed
	gamepad: "\uf11b",   // nf-fa-gamepad
	code:    "\uf121",   // nf-fa-code
	sep:     "\ue0b0",   // Powerline right arrow (thick)
	sepThin: "\ue0b1",   // Powerline right arrow (thin)
};

// ─── Mood → Face + Color ─────────────────────────────────────────────────────

interface MoodStyle { face: string; nameColor: string; stateIcon: string }

const MOOD_STYLES: Record<string, MoodStyle> = {
	happy:    { face: "(◕ᴗ◕)",  nameColor: C.green,    stateIcon: I.paw },
	content:  { face: "(◕‿◕)",  nameColor: C.teal,     stateIcon: I.paw },
	hungry:   { face: "(◕︵◕)",  nameColor: C.peach,    stateIcon: I.heart },
	sleeping: { face: "(–‿–)",  nameColor: C.lavender,  stateIcon: I.bed },
	playful:  { face: "(◕ω◕)",  nameColor: C.pink,     stateIcon: I.gamepad },
	musical:  { face: "(◕∀◕)",  nameColor: C.mauve,    stateIcon: I.music },
	tired:    { face: "(◕⌓◕)",  nameColor: C.maroon,   stateIcon: I.bed },
	thinking: { face: "(◕¸.◕)", nameColor: C.sapphire, stateIcon: I.code },
};
const DEFAULT_MOOD: MoodStyle = MOOD_STYLES.content;

// ─── Weather → Icon + Color ──────────────────────────────────────────────────

const WEATHER_STYLES: Record<string, { icon: string; color: string }> = {
	clear:  { icon: I.sun,   color: C.yellow },
	cloudy: { icon: I.cloud, color: C.overlay1 },
	rain:   { icon: I.rain,  color: C.blue },
	snow:   { icon: I.snow,  color: C.sky },
	storm:  { icon: I.storm, color: C.mauve },
};

// ─── UI Components ───────────────────────────────────────────────────────────

function miniBar(value: number, width: number, colors: [string, string, string]): string {
	const pct = Math.max(0, Math.min(100, value));
	const filled = Math.round((pct / 100) * width);
	const empty = Math.max(0, width - filled);
	const barColor = pct <= 25 ? colors[2] : pct <= 50 ? colors[1] : colors[0];
	return `${barColor}${"\u25b0".repeat(filled)}${C.surface1}${"\u25b1".repeat(empty)}${C.rst}`;
}

function contextBar(ctx: ExtensionContext, width: number): string {
	const usage = (ctx as any).getContextUsage?.();
	if (!usage) return "";
	const total = Math.max(1, Number(usage.contextWindow) || 200000);
	const used = Math.max(0, Number(usage.tokens) || 0);
	const pct = Math.min(100, (used / total) * 100);
	const barWidth = Math.max(width - 8, 1);
	const filled = Math.round((pct / 100) * barWidth);
	const empty = Math.max(0, barWidth - filled);
	const barColor = pct > 85 ? C.red : pct > 65 ? C.peach : C.sapphire;
	const bar = `${barColor}${"\u25b0".repeat(filled)}${C.surface1}${"\u25b1".repeat(empty)}${C.rst}`;
	const pctStr = String(Math.round(pct)).padStart(3, " ");
	return `${C.overlay0}${I.tokens}${C.rst} ${bar} ${C.text}${pctStr}%${C.rst}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSessionCost(ctx: ExtensionContext): number {
	try {
		return (ctx.sessionManager.getBranch() as any[]).reduce((total: number, entry: any) => {
			return total + (Number(entry.message?.usage?.cost?.total) || 0);
		}, 0);
	} catch { return 0; }
}

function formatTime(startMs: number): string {
	if (startMs <= 0) return "0m";
	const mins = Math.round((Date.now() - startMs) / 60000);
	if (mins < 60) return `${mins}m`;
	const h = Math.floor(mins / 60);
	const rem = mins % 60;
	return rem > 0 ? `${h}h${rem}m` : `${h}h`;
}

function formatPath(cwd: string): string {
	const home = process.env.HOME || "";
	const p = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
	const parts = p.split("/").filter(Boolean);
	if (parts.length <= 2) return parts.join("/");
	return `\u2026/${parts.slice(-2).join("/")}`;
}

/** Join non-empty segments with a separator, dropping lowest-priority segments if too wide. */
function assembleLine(segments: (string | null | undefined)[], separator: string, width: number): string {
	const live = segments.filter((s): s is string => !!s);
	let line = live.join(separator);
	// Drop segments from the middle (lowest priority) until it fits
	while (visibleWidth(line) > width && live.length > 2) {
		live.splice(Math.floor(live.length / 2), 1);
		line = live.join(separator);
	}
	return truncateToWidth(line, width);
}

// ─── Line 1: Pompom Status ──────────────────────────────────────────────────

function renderLine1(width: number, sessionStartMs: number, thinkingLevel: string): string {
	const status = pompomStatus();
	const weather = pompomGetWeather();
	const agentStats = getSessionStats();

	const moodKey = agentStats.isAgentActive ? "thinking" : status.mood;
	const mood = MOOD_STYLES[moodKey] || DEFAULT_MOOD;
	const weatherStyle = WEATHER_STYLES[weather] || WEATHER_STYLES.clear;

	// Identity
	const pompomSec = `${C.pink}${mood.face}${C.rst} ${mood.nameColor}${C.bold}Pompom${C.rst}`;

	// Vitals (hidden on narrow terminals)
	const hungerBar = miniBar(status.hunger, 4, [C.peach, C.yellow, C.red]);
	const energyBar = miniBar(status.energy, 4, [C.green, C.yellow, C.red]);
	const vitalsSec = width >= 70
		? `${C.peach}${I.heart}${C.rst} ${hungerBar} ${C.subtext0}${status.hunger}%${C.rst}  ${C.green}${I.bolt}${C.rst}${energyBar} ${C.subtext0}${status.energy}%${C.rst}`
		: null;

	// Environment (hidden on very narrow terminals)
	const stateLabel = agentStats.isAgentActive
		? `${C.mauve}${I.code} working${C.rst}`
		: `${C.overlay1}${mood.stateIcon} ${status.mood}${C.rst}`;
	const musicIcon = getAmbientConfig().enabled && isAmbientPlaying() ? ` ${C.teal}${I.music}${C.rst}` : "";
	const envSec = width >= 100
		? `${weatherStyle.color}${weatherStyle.icon}${C.rst} ${C.subtext0}${weather}${C.rst}  ${stateLabel}${musicIcon}`
		: null;

	// Time + thinking
	const thinkingStr = thinkingLevel && thinkingLevel !== "off" ? ` ${C.overlay2}\u2022 ${thinkingLevel}${C.rst}` : "";
	const timeSec = `${C.overlay1}${I.clock} ${formatTime(sessionStartMs)}${C.rst}${thinkingStr}`;

	const sep = ` ${C.overlay0}${I.sepThin}${C.rst} `;
	return assembleLine([pompomSec, vitalsSec, envSec, timeSec], sep, width);
}

// ─── Line 2: Dev Info ────────────────────────────────────────────────────────

function renderLine2(width: number, ctx: ExtensionContext): string {
	const modelName = (ctx.model as any)?.name || (ctx.model as any)?.id || "Claude";
	const shortModel = modelName.replace(/^(claude|gemini)-/i, "").replace(/(-preview|-pro|@latest)/g, "");

	// Location
	const locationSec = `${C.blue}${I.folder} ${formatPath(ctx.cwd)}${C.rst}`;

	// Context bar (adaptive width, hidden if too narrow)
	const ctxBarWidth = width >= 100 ? 20 : width >= 80 ? 12 : 0;
	const ctxBar = ctxBarWidth > 0 ? contextBar(ctx, ctxBarWidth) : null;

	// Cost (color-coded thresholds)
	const cost = getSessionCost(ctx);
	const costColor = cost > 5 ? C.red : cost > 2 ? C.yellow : C.green;
	const costStr = cost > 0.005 ? `${costColor}${I.cost} ${cost.toFixed(2)}${C.rst}` : null;

	// Voice indicator
	const voiceStr = getVoiceConfig().enabled ? `${C.flamingo}${I.speaker}${C.rst}` : null;

	// Model (always shown, bold for emphasis)
	const modelSec = `${C.lavender}${C.bold}${I.model} ${shortModel}${C.rst}`;

	// Adaptive: try full → medium → small
	const sep = ` ${C.surface2}${I.sepThin}${C.rst} `;
	const full = [locationSec, ctxBar, costStr, voiceStr, modelSec].filter(Boolean);
	const fullLine = full.join(sep);
	if (visibleWidth(fullLine) <= width) return fullLine;

	const medium = [locationSec, ctxBar, modelSec].filter(Boolean);
	const mediumLine = medium.join(sep);
	if (visibleWidth(mediumLine) <= width) return mediumLine;

	const small = [locationSec, modelSec];
	return truncateToWidth(small.join(sep), width);
}

// ─── Public API ──────────────────────────────────────────────────────────────

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
					return [
						renderLine1(width, getSessionStartMs(), getThinkingLevel()),
						renderLine2(width, ctx),
					];
				} catch {
					return ["", ""];
				}
			},
		};
	});
}
