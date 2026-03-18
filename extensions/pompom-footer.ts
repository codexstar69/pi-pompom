/**
 * Pompom Footer — Single-line enterprise status bar for Pi CLI.
 *
 * One line. Every character earns its place. Information hierarchy through
 * color intensity — bright for critical, dim for context.
 *
 * Layout (wide 100+ cols):
 *   (◕ᴗ◕) Pompom  ♥▰▰▱▱ 52%  ☀ clear  working  12m     ▰▰▰▱▱ 34%  $0.42  opus • med
 *
 * Layout (medium 60-100 cols):
 *   (◕ᴗ◕) Pompom  ♥▰▰▱▱ 52%  ☀ clear     ▰▰▰▱▱ 34%  opus • med
 *
 * Layout (narrow <60 cols):
 *   (◕ᴗ◕) Pompom     opus • med
 *
 * Catppuccin Mocha palette. Nerd Font icons. Parallelogram bars (▰▱).
 * Thin Powerline separators (). Mood-reactive name color.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { pompomStatus, pompomGetWeather } from "./pompom";
import { getSessionStats } from "./pompom-agent";
import { getVoiceConfig } from "./pompom-voice";
import { getAmbientConfig, isAmbientPlaying } from "./pompom-ambient";

// ─── Catppuccin Mocha ────────────────────────────────────────────────────────

function fg(r: number, g: number, b: number): string { return `\x1b[38;2;${r};${g};${b}m`; }

const C = {
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
	flamingo:  fg(242, 205, 205),
	text:      fg(205, 214, 244),
	subtext0:  fg(166, 173, 200),
	overlay1:  fg(127, 132, 156),
	overlay0:  fg(108, 112, 134),
	surface1:  fg(69, 71, 90),
	rst:       "\x1b[0m",
	bold:      "\x1b[1m",
};

// ─── Icons ───────────────────────────────────────────────────────────────────

const SEP = `${C.overlay0}\ue0b1${C.rst}`; // Thin Powerline

const MOOD: Record<string, { face: string; color: string; icon: string }> = {
	happy:    { face: "(\u25d5\u1d17\u25d5)",  color: C.green,    icon: "\uf1b0" },
	content:  { face: "(\u25d5\u203f\u25d5)",  color: C.teal,     icon: "\uf1b0" },
	hungry:   { face: "(\u25d5\ufe35\u25d5)",  color: C.peach,    icon: "\uf004" },
	sleeping: { face: "(\u2013\u203f\u2013)",  color: C.lavender, icon: "\uf236" },
	playful:  { face: "(\u25d5\u03c9\u25d5)",  color: C.pink,     icon: "\uf11b" },
	musical:  { face: "(\u25d5\u2200\u25d5)",  color: C.mauve,    icon: "\uf001" },
	tired:    { face: "(\u25d5\u2313\u25d5)",  color: C.maroon,   icon: "\uf236" },
};
const MOOD_DEFAULT = MOOD.content;

const WEATHER_ICON: Record<string, { i: string; c: string }> = {
	clear:  { i: "\ue30d", c: C.yellow },
	cloudy: { i: "\ue312", c: C.overlay1 },
	rain:   { i: "\ue318", c: C.blue },
	snow:   { i: "\ue31a", c: C.sky },
	storm:  { i: "\ue31d", c: C.mauve },
};

// ─── Components ──────────────────────────────────────────────────────────────

function bar(val: number, w: number, good: string, warn: string, bad: string): string {
	const pct = Math.max(0, Math.min(100, val));
	const f = Math.round((pct / 100) * w);
	const e = Math.max(0, w - f);
	const color = pct <= 25 ? bad : pct <= 50 ? warn : good;
	return `${color}${"\u25b0".repeat(f)}${C.surface1}${"\u25b1".repeat(e)}${C.rst}`;
}

function fmtTime(ms: number): string {
	if (ms <= 0) return "0m";
	const m = Math.round((Date.now() - ms) / 60000);
	return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? (m % 60) + "m" : ""}`;
}

function shortPath(cwd: string): string {
	const home = process.env.HOME || "";
	const p = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
	const parts = p.split("/").filter(Boolean);
	return parts.length > 2 ? parts[parts.length - 1] : parts.join("/");
}

function getCost(ctx: ExtensionContext): number {
	try {
		return (ctx.sessionManager.getBranch() as any[]).reduce((t: number, e: any) =>
			t + (Number(e.message?.usage?.cost?.total) || 0), 0);
	} catch { return 0; }
}

function ctxPct(ctx: ExtensionContext): number {
	const u = (ctx as any).getContextUsage?.();
	if (!u) return 0;
	const total = Math.max(1, Number(u.contextWindow) || 200000);
	const used = Math.max(0, Number(u.tokens) || 0);
	return Math.min(100, Math.round((used / total) * 100));
}

// ─── Render ──────────────────────────────────────────────────────────────────

function renderFooter(width: number, sessionMs: number, thinkingLevel: string, ctx: ExtensionContext): string {
	if (width <= 0) return "";

	const status = pompomStatus();
	const weather = pompomGetWeather();
	const stats = getSessionStats();
	const mood = MOOD[stats.isAgentActive ? "content" : status.mood] || MOOD_DEFAULT;
	const wx = WEATHER_ICON[weather] || WEATHER_ICON.clear;

	// ─ Left: Identity (always shown)
	const face = `${C.pink}${mood.face}${C.rst}`;
	const name = `${mood.color}${C.bold}Pompom${C.rst}`;
	const left = `${face} ${name}`;

	// ─ Right: Model + thinking (always shown)
	const modelName = ((ctx.model as any)?.name || (ctx.model as any)?.id || "Claude")
		.replace(/^(claude|gemini)-/i, "").replace(/(-preview|-pro|@latest)/g, "") || "Claude";
	const thinking = thinkingLevel && thinkingLevel !== "off" ? ` ${C.overlay0}\u2022 ${thinkingLevel}${C.rst}` : "";
	const right = `${C.lavender}\uf2db ${modelName}${C.rst}${thinking}`;

	// ─ Available space for middle content
	const leftW = visibleWidth(left);
	const rightW = visibleWidth(right);
	const sepW = 3; // " SEP "
	const minGap = leftW + rightW + sepW * 2;

	if (width < minGap + 4) {
		// Ultra-narrow: just face + model, right-aligned
		const gap = Math.max(1, width - leftW - rightW);
		return truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width);
	}

	// ─ Build middle segments by priority
	const mid: string[] = [];
	const available = width - leftW - rightW - sepW * 2;

	// Priority 1: Critical vital (whichever is lower)
	if (available >= 12) {
		const showHunger = status.hunger <= status.energy;
		const val = showHunger ? status.hunger : status.energy;
		const icon = showHunger ? `${C.peach}\uf004${C.rst}` : `${C.green}\uf0e7${C.rst}`;
		const b = bar(val, 4, showHunger ? C.peach : C.green, C.yellow, C.red);
		mid.push(`${icon}${b}${C.subtext0}${val}%${C.rst}`);
	}

	// Priority 2: Weather
	if (available >= 22) {
		mid.push(`${wx.c}${wx.i}${C.rst}${C.subtext0}${weather}${C.rst}`);
	}

	// Priority 3: Agent state
	if (available >= 32) {
		if (stats.isAgentActive) {
			mid.push(`${C.mauve}\uf121 working${C.rst}`);
		} else {
			const ambient = getAmbientConfig().enabled && isAmbientPlaying();
			mid.push(`${C.overlay1}${mood.icon}${C.rst}${ambient ? ` ${C.teal}\uf001${C.rst}` : ""}`);
		}
	}

	// Priority 4: Session time
	if (available >= 38) {
		mid.push(`${C.overlay0}\uf017 ${fmtTime(sessionMs)}${C.rst}`);
	}

	// Priority 5: Context %
	if (available >= 52) {
		const pct = ctxPct(ctx);
		const ctxColor = pct > 85 ? C.red : pct > 65 ? C.peach : C.sapphire;
		const ctxBar = bar(pct, 6, C.sapphire, C.peach, C.red);
		mid.push(`${ctxBar}${ctxColor}${pct}%${C.rst}`);
	}

	// Priority 6: Cost
	if (available >= 62) {
		const cost = getCost(ctx);
		if (cost > 0.005) {
			const cc = cost > 5 ? C.red : cost > 2 ? C.yellow : C.green;
			mid.push(`${cc}\uf155${cost.toFixed(2)}${C.rst}`);
		}
	}

	// Priority 7: Voice indicator
	if (available >= 66 && getVoiceConfig().enabled) {
		mid.push(`${C.flamingo}\uf028${C.rst}`);
	}

	// ─ Compose: left SEP mid... SEP right
	const midStr = mid.length > 0 ? mid.join(` ${SEP} `) : "";
	const leftPart = midStr ? `${left} ${SEP} ${midStr}` : left;
	const totalUsed = visibleWidth(leftPart) + visibleWidth(right);
	const gap = Math.max(1, width - totalUsed);
	const line = `${leftPart}${" ".repeat(gap)}${right}`;
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
					const line = renderFooter(width, getSessionStartMs(), getThinkingLevel(), ctx);
					return [truncateToWidth(line, width), ""];
				} catch {
					return ["", ""];
				}
			},
		};
	});
}
