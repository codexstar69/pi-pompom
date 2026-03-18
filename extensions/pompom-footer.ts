/**
 * Pompom Footer — Enterprise-polished status bar for Pi CLI.
 *
 * Two-line footer with Powerline arrows and Nerd Font icons:
 *   Line 1: Pompom face + mood │ health/energy bars │ weather + state │ session time
 *   Line 2: Location  branch │ context bar + usage │ cost │ model • thinking
 *
 * Colors: Catppuccin Mocha palette. Mood-reactive name color.
 * Dynamic bar colors: bars shift red when low. Cost alerts at thresholds.
 * Powerline separators between logical sections.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { pompomStatus, pompomGetWeather } from "./pompom";
import { getSessionStats } from "./pompom-agent";
import { getVoiceConfig } from "./pompom-voice";
import { getAmbientConfig, isAmbientPlaying } from "./pompom-ambient";

// ─── Catppuccin Mocha (ANSI true-color) ──────────────────────────────────────

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
	subtext0:  fg(166, 173, 200),
	overlay0:  fg(108, 112, 134),
	surface0:  fg(49, 50, 68),
	base:      fg(30, 30, 46),
	rst:       "\x1b[0m",
	bold:      "\x1b[1m",
};

// ─── Nerd Font Icons ─────────────────────────────────────────────────────────

const I = {
	heart:    "\uf004",   //  nf-fa-heart
	bolt:     "\uf0e7",   //  nf-fa-bolt
	sun:      "\ue30d",   //  nf-weather-day_sunny
	cloud:    "\ue312",   //  nf-weather-cloudy
	rain:     "\ue318",   //  nf-weather-rain
	snow:     "\ue31a",   //  nf-weather-snow
	storm:    "\ue31d",   //  nf-weather-thunderstorm
	music:    "\uf001",   //  nf-fa-music
	speaker:  "\uf028",   //  nf-fa-volume_up
	folder:   "\uf07c",   //  nf-fa-folder_open
	branch:   "\ue725",   //  nf-dev-git_branch
	clock:    "\uf017",   //  nf-fa-clock_o
	model:    "\uf2db",   //  nf-fa-microchip
	paw:      "\uf1b0",   //  nf-fa-paw
	bed:      "\uf236",   //  nf-fa-bed
	gamepad:  "\uf11b",   //  nf-fa-gamepad
	code:     "\uf121",   //  nf-fa-code
	sep:      "\ue0b0",   //  Powerline right arrow
	sepThin:  "\ue0b1",   //  Powerline right thin arrow
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
};
const DEFAULT_MOOD: MoodStyle = { face: "(◕‿◕)", nameColor: C.teal, stateIcon: I.paw };

// ─── Weather → Icon + Color ──────────────────────────────────────────────────

const WEATHER: Record<string, { icon: string; color: string }> = {
	clear:  { icon: I.sun,   color: C.yellow },
	cloudy: { icon: I.cloud, color: C.overlay0 },
	rain:   { icon: I.rain,  color: C.blue },
	snow:   { icon: I.snow,  color: C.sky },
	storm:  { icon: I.storm, color: C.mauve },
};

// ─── Mini Bar (color-reactive) ───────────────────────────────────────────────

function miniBar(value: number, width: number, goodColor: string, warnColor: string): string {
	const pct = Math.max(0, Math.min(100, value));
	const filled = Math.round((pct / 100) * width);
	const empty = width - filled;
	const color = pct <= 25 ? C.red : pct <= 50 ? warnColor : goodColor;
	return `${color}${"█".repeat(filled)}${C.surface0}${"░".repeat(empty)}${C.rst}`;
}

// ─── Context Bar ─────────────────────────────────────────────────────────────

function contextBar(ctx: ExtensionContext, width: number): string {
	const usage = (ctx as any).getContextUsage?.();
	if (!usage) return "";
	const total = Math.max(1, Number(usage.contextWindow) || 200000);
	const used = Math.max(0, Number(usage.tokens) || 0);
	const pct = Math.min(100, Math.round((used / total) * 100));
	const usedK = Math.round(used / 1000);
	const totalK = Math.round(total / 1000);
	const filled = Math.round((pct / 100) * width);
	const empty = width - filled;
	const barColor = pct > 80 ? C.red : pct > 60 ? C.yellow : C.sapphire;
	return `${barColor}${"■".repeat(filled)}${C.overlay0}${"□".repeat(empty)}${C.rst} ${C.subtext0}${usedK}k/${totalK}k${C.rst}`;
}

// ─── Session Cost ────────────────────────────────────────────────────────────

function sessionCost(ctx: ExtensionContext): number {
	try {
		let total = 0;
		for (const entry of ctx.sessionManager.getBranch() as any[]) {
			if (entry?.type === "message" && entry.message?.role === "assistant" && entry.message?.usage?.cost?.total) {
				total += Number(entry.message.usage.cost.total) || 0;
			}
		}
		return total;
	} catch { return 0; }
}

// ─── Time ────────────────────────────────────────────────────────────────────

function fmtTime(startMs: number): string {
	if (startMs <= 0) return "0m";
	const mins = Math.round((Date.now() - startMs) / 60000);
	if (mins < 60) return `${mins}m`;
	const h = Math.floor(mins / 60);
	const r = mins % 60;
	return r > 0 ? `${h}h${r}m` : `${h}h`;
}

// ─── Location ────────────────────────────────────────────────────────────────

function shortCwd(cwd: string): string {
	const home = process.env.HOME || "";
	let p = cwd;
	if (home && p.startsWith(home)) p = "~" + p.slice(home.length);
	const parts = p.split("/");
	return parts.length > 2 ? parts.slice(-2).join("/") : p;
}

// ─── Powerline Section Builder ───────────────────────────────────────────────

function section(...parts: string[]): string {
	return parts.filter(Boolean).join(" ");
}

// ─── Footer Line 1: Pompom Status ────────────────────────────────────────────

function renderLine1(width: number, sessionStartMs: number): string {
	const status = pompomStatus();
	const weather = pompomGetWeather();
	const stats = getSessionStats();
	const mood = MOOD_STYLES[status.mood] || DEFAULT_MOOD;
	const weatherInfo = WEATHER[weather] || WEATHER.clear;

	// Pompom identity section
	const pompomSec = section(
		`${C.pink}${mood.face}${C.rst}`,
		`${mood.nameColor}${C.bold}Pompom${C.rst}`,
	);

	// Vitals section
	const hungerBar = miniBar(status.hunger, 4, C.peach, C.yellow);
	const energyBar = miniBar(status.energy, 4, C.green, C.yellow);
	const vitalsSec = section(
		`${C.peach}${I.heart}${C.rst} ${hungerBar}${C.subtext0}${status.hunger}%${C.rst}`,
		`${C.green}${I.bolt}${C.rst}${energyBar}${C.subtext0}${status.energy}%${C.rst}`,
	);

	// Environment section
	const stateLabel = stats.isAgentActive
		? `${C.mauve}${I.code} working${C.rst}`
		: `${C.overlay0}${mood.stateIcon} ${status.mood}${C.rst}`;
	const ambientCfg = getAmbientConfig();
	const musicIcon = ambientCfg.enabled && isAmbientPlaying() ? `${C.teal}${I.music}${C.rst}` : "";
	const envSec = section(
		`${weatherInfo.color}${weatherInfo.icon}${C.rst}${C.subtext0}${weather}${C.rst}`,
		stateLabel,
		musicIcon,
	);

	// Time section
	const timeSec = `${C.overlay0}${I.clock} ${fmtTime(sessionStartMs)}${C.rst}`;

	// Compose with powerline thin separators
	const sep = `${C.overlay0} ${I.sepThin} ${C.rst}`;
	const line = [pompomSec, vitalsSec, envSec, timeSec].join(sep);
	return truncateToWidth(line, width);
}

// ─── Footer Line 2: Dev Info ─────────────────────────────────────────────────

function renderLine2(width: number, ctx: ExtensionContext, thinkingLevel: string): string {
	const model = (ctx.model as any)?.name || (ctx.model as any)?.id || "Claude";
	const shortModel = model.replace(/^Claude\s*/i, "").replace(/^claude-/i, "") || "Claude";

	// Location
	const locationSec = `${C.blue}${I.folder} ${shortCwd(ctx.cwd)}${C.rst}`;

	// Context bar
	const barWidth = width >= 100 ? 12 : width >= 70 ? 8 : 4;
	const ctxBar = contextBar(ctx, barWidth);

	// Cost (color-coded thresholds)
	const cost = sessionCost(ctx);
	let costStr = "";
	if (cost > 0) {
		const costColor = cost > 5 ? C.red : cost > 2 ? C.yellow : C.green;
		costStr = `${costColor}$${cost.toFixed(2)}${C.rst}`;
	}

	// Voice indicator
	const voiceCfg = getVoiceConfig();
	const voiceStr = voiceCfg.enabled ? `${C.flamingo}${I.speaker}${C.rst}` : "";

	// Model + thinking
	const thinkingStr = thinkingLevel && thinkingLevel !== "off" ? `${C.overlay0} • ${thinkingLevel}${C.rst}` : "";
	const modelSec = `${C.lavender}${I.model} ${shortModel}${C.rst}${thinkingStr}`;

	// Compose with powerline thin separators
	const sep = `${C.overlay0} ${I.sepThin} ${C.rst}`;
	const segments = [locationSec, ctxBar, costStr, voiceStr, modelSec].filter(Boolean);
	return truncateToWidth(segments.join(sep), width);
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
					const line1 = renderLine1(width, getSessionStartMs());
					const line2 = renderLine2(width, ctx, getThinkingLevel());
					return [line1, line2];
				} catch {
					return ["", ""];
				}
			},
		};
	});
}
