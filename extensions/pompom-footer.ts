/**
 * Pompom Footer — Billion-dollar single-line status bar for Pi CLI.
 *
 * Designed by Gemini 3.1 Pro Preview. Catppuccin Mocha palette.
 * Nerd Font icons. Parallelogram bars (▰▱). Progressive disclosure.
 *
 * Layout:  (◕ᴗ◕) Pompom   ▰▰▱ 72%  󱐋▰▰▰▱ 85%  󰖨 clear  󰋜 working 5m  ▰▰▰▱▱34% $0.42   opus·med
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { pompomStatus, pompomGetWeather } from "./pompom";
import { getSessionStats } from "./pompom-agent";
import { getVoiceConfig } from "./pompom-voice";
import { getAmbientConfig, isAmbientPlaying } from "./pompom-ambient";

// ─── Catppuccin Mocha (hex → ANSI) ──────────────────────────────────────────

function rgb(hex: string): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `\x1b[38;2;${r};${g};${b}m`;
}

function c(hex: string, text: string): string { return `${rgb(hex)}${text}\x1b[0m`; }
function bold(hex: string, text: string): string { return `\x1b[1m${rgb(hex)}${text}\x1b[0m`; }
function dim(text: string): string { return c("#6c7086", text); }  // Overlay0
function txt(text: string): string { return c("#cdd6f4", text); }  // Text
function soft(text: string): string { return c("#a6adc8", text); } // Subtext0

// ─── Palette Hex ─────────────────────────────────────────────────────────────

const PAL = {
	rosewater: "#f5e0dc", flamingo: "#f2cdcd", pink: "#f5c2e7",
	mauve: "#cba6f7", red: "#f38ba8", maroon: "#eba0ac",
	peach: "#fab387", yellow: "#f9e2af", green: "#a6e3a1",
	teal: "#94e2d5", sky: "#89dceb", sapphire: "#74c7ec",
	blue: "#89b4fa", lavender: "#b4befe",
};

const SEP = dim(" \ue0b1 ");  // Thin Powerline

// ─── Mood → Face + Color ─────────────────────────────────────────────────────

const MOOD: Record<string, { face: string; hex: string }> = {
	happy:    { face: "(\u25d5\u1d17\u25d5)",  hex: PAL.green },
	content:  { face: "(\u25d5\u203f\u25d5)",  hex: PAL.teal },
	hungry:   { face: "(\u25d5\ufe35\u25d5)",  hex: PAL.peach },
	sleeping: { face: "(\u2013\u203f\u2013)",  hex: PAL.lavender },
	playful:  { face: "(\u25d5\u03c9\u25d5)",  hex: PAL.pink },
	musical:  { face: "(\u25d5\u2200\u25d5)",  hex: PAL.mauve },
	tired:    { face: "(\u25d5\u2313\u25d5)",  hex: PAL.maroon },
};

const WEATHER_ICON: Record<string, string> = {
	clear: "\u{f0599}", cloudy: "\u{e312}", rain: "\u{e318}", snow: "\u{e31a}", storm: "\u{e31d}",
};

// ─── Bar Renderer ────────────────────────────────────────────────────────────

function barColor(val: number): string {
	return val > 50 ? PAL.green : val > 20 ? PAL.yellow : PAL.red;
}

function bar(icon: string, val: number): string {
	const hex = barColor(val);
	const filled = Math.round(Math.max(0, Math.min(100, val)) / 20); // 5 blocks
	const empty = 5 - filled;
	const valStr = txt(`${val}%`.padStart(4, " "));
	return `${c(hex, icon)} ${c(hex, "\u25b0".repeat(filled))}${dim("\u25b1".repeat(empty))}${valStr}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function ctxPct(ctx: ExtensionContext): number {
	const u = (ctx as any).getContextUsage?.();
	if (!u) return 0;
	const total = Math.max(1, Number(u.contextWindow) || 200000);
	const used = Math.max(0, Number(u.tokens) || 0);
	return Math.min(100, Math.round((used / total) * 100));
}

function stripAnsi(s: string): number { return visibleWidth(s); }

// ─── Render ──────────────────────────────────────────────────────────────────

function renderFooter(width: number, sessionMs: number, thinkingLevel: string, ctx: ExtensionContext): string {
	if (width <= 0) return "";

	const status = pompomStatus();
	const weather = pompomGetWeather();
	const stats = getSessionStats();
	const mood = MOOD[status.mood] || MOOD.content;

	// ─ Left: Identity
	const left = `${c(mood.hex, mood.face)} ${bold(mood.hex, "Pompom")}`;

	// ─ Right: Model + thinking (keep full name for clarity)
	const rawModel = (ctx.model as any)?.name || (ctx.model as any)?.id || "Claude";
	const thinkStr = thinkingLevel && thinkingLevel !== "off" ? ` ${dim("\u2022")} ${c(PAL.mauve, thinkingLevel)}` : "";
	const right = `${c(PAL.lavender, rawModel)}${thinkStr}`;

	// ─ Middle: Progressive segments
	const midParts: string[] = [];

	// Priority 1: Vitals (60+ cols)
	if (width >= 60) {
		const showHunger = status.hunger <= status.energy;
		if (showHunger) midParts.push(bar("\uf004", status.hunger));
		else midParts.push(bar("\u{f0e7b}", status.energy));
	}
	// Both vitals (80+ cols)
	if (width >= 80) {
		const showHunger = status.hunger <= status.energy;
		if (showHunger) midParts.push(bar("\u{f0e7b}", status.energy));
		else midParts.push(bar("\uf004", status.hunger));
	}
	// Weather (90+ cols)
	if (width >= 90) {
		const wIcon = WEATHER_ICON[weather] || "\ue30d";
		midParts.push(`${c(PAL.yellow, wIcon)} ${txt(weather)}`);
	}
	// Activity + time (100+ cols)
	if (width >= 100) {
		const activity = stats.isAgentActive ? "working" : status.mood;
		midParts.push(`${c(PAL.sapphire, "\u{f015b}")} ${txt(activity)} ${dim(fmtTime(sessionMs))}`);
	}
	// Context bar + token counts (110+ cols)
	if (width >= 110) {
		const usage = (ctx as any).getContextUsage?.();
		const total = Math.max(1, Number(usage?.contextWindow) || 200000);
		const used = Math.max(0, Number(usage?.tokens) || 0);
		const pct = Math.min(100, Math.round((used / total) * 100));
		const usedK = Math.round(used / 1000);
		const totalK = Math.round(total / 1000);
		const ctxHex = pct > 85 ? PAL.red : pct > 65 ? PAL.peach : PAL.sapphire;
		const filled = Math.round(pct / 20);
		const empty = 5 - filled;
		midParts.push(`${c(ctxHex, "\u25b0".repeat(filled))}${dim("\u25b1".repeat(empty))} ${txt(`${usedK}k`)}${dim("/")}${dim(`${totalK}k`)}`);
	}
	// Path (118+ cols)
	if (width >= 118) {
		const home = process.env.HOME || "";
		let cwd = ctx.cwd || "";
		if (home && cwd.startsWith(home)) cwd = "~" + cwd.slice(home.length);
		const parts = cwd.split("/").filter(Boolean);
		const short = parts.length > 2 ? parts[parts.length - 1] : parts.join("/");
		midParts.push(`${c(PAL.blue, "\uf115")} ${dim(short)}`);
	}
	// Cost (125+ cols)
	if (width >= 125) {
		const cost = getCost(ctx);
		if (cost > 0.005) {
			const costHex = cost > 5 ? PAL.red : cost > 2 ? PAL.yellow : PAL.green;
			midParts.push(c(costHex, `$${cost.toFixed(2)}`));
		}
	}
	// Voice (125+ cols)
	if (width >= 125 && getVoiceConfig().enabled) {
		midParts.push(c(PAL.flamingo, "\uf028"));
	}
	// Ambient (130+ cols)
	if (width >= 130 && getAmbientConfig().enabled && isAmbientPlaying()) {
		midParts.push(c(PAL.teal, "\uf001"));
	}

	const middle = midParts.join(SEP);

	// ─ Compose: left ... middle ... right (centered middle, right-aligned right)
	const lW = stripAnsi(left);
	const mW = stripAnsi(middle);
	const rW = stripAnsi(right);

	let line: string;
	if (midParts.length === 0) {
		const gap = Math.max(1, width - lW - rW);
		line = `${left}${" ".repeat(gap)}${right}`;
	} else {
		const totalContent = lW + mW + rW;
		const totalPad = Math.max(0, width - totalContent);
		const padL = Math.max(1, Math.floor(totalPad / 2));
		const padR = Math.max(1, totalPad - padL);
		line = `${left}${" ".repeat(padL)}${middle}${" ".repeat(padR)}${right}`;
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
