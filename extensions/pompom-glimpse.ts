/**
 * Pompom Native Window — renders Pompom in a floating native window via glimpseui.
 *
 * Uses WKWebView on macOS (or platform equivalent) to show a pixel-art canvas
 * of the raymarched scene. Reads from the same buffers as the terminal widget.
 */

import { getFrameData, pompomKeypress, type FrameData } from "./pompom";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─── glimpseui lazy import (follows kokoro-js pattern) ───────────────────────

interface GlimpseWindow {
	send(channel: string, data: string): void;
	on(channel: string, cb: (data: string) => void): void;
	close(): void;
	show(): void;
	hide(): void;
}

interface GlimpseModule {
	createWindow(opts: {
		title?: string;
		width?: number;
		height?: number;
		frameless?: boolean;
		transparent?: boolean;
		alwaysOnTop?: boolean;
		html?: string;
	}): GlimpseWindow;
}

let glimpseModule: GlimpseModule | null = null;
let glimpsePromise: Promise<GlimpseModule | null> | null = null;

async function loadGlimpse(): Promise<GlimpseModule | null> {
	if (glimpseModule) return glimpseModule;
	if (!glimpsePromise) {
		glimpsePromise = (async () => {
			try {
				const moduleName = "glimpseui";
				glimpseModule = await import(moduleName) as GlimpseModule;
				return glimpseModule;
			} catch {
				glimpsePromise = null; // allow retry on next call
				return null;
			}
		})();
	}
	return glimpsePromise;
}

export async function isGlimpseAvailable(): Promise<boolean> {
	const mod = await loadGlimpse();
	return mod !== null;
}

// ─── Window state ────────────────────────────────────────────────────────────

let win: GlimpseWindow | null = null;
let frameTimer: ReturnType<typeof setInterval> | null = null;
let windowEnabled: boolean | null = null; // null = not loaded yet

const CONFIG_DIR = path.join(os.homedir(), ".pi", "pompom");
const CONFIG_FILE = path.join(CONFIG_DIR, "window-config.json");

function loadWindowConfig(): boolean {
	try {
		if (fs.existsSync(CONFIG_FILE)) {
			const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
			return data.enabled !== false; // default true
		}
	} catch { /* non-fatal */ }
	return true; // default enabled
}

function saveWindowConfig(enabled: boolean): void {
	try {
		fs.mkdirSync(CONFIG_DIR, { recursive: true });
		fs.writeFileSync(CONFIG_FILE, JSON.stringify({ enabled }, null, 2));
	} catch { /* non-fatal */ }
}

export function isWindowEnabled(): boolean {
	if (windowEnabled === null) {
		windowEnabled = loadWindowConfig();
	}
	return windowEnabled;
}

export function isWindowOpen(): boolean {
	return win !== null;
}

// ─── HTML template ───────────────────────────────────────────────────────────

function buildHtml(): string {
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
	background: transparent;
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	overflow: hidden;
	user-select: none;
	-webkit-user-select: none;
	-webkit-app-region: drag;
}
#canvas-wrap {
	position: relative;
	width: 100%;
}
canvas {
	display: block;
	width: 100%;
	image-rendering: pixelated;
	image-rendering: crisp-edges;
	border-radius: 12px;
}
#speech {
	position: absolute;
	top: 8px;
	left: 50%;
	transform: translateX(-50%);
	background: rgba(30, 30, 46, 0.85);
	color: #cdd6f4;
	padding: 6px 14px;
	border-radius: 10px;
	font-size: 13px;
	max-width: 80%;
	text-align: center;
	opacity: 0;
	transition: opacity 0.3s ease;
	pointer-events: none;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
#speech.visible { opacity: 1; }
#bar {
	display: flex;
	gap: 6px;
	padding: 6px 10px;
	background: rgba(30, 30, 46, 0.8);
	border-radius: 0 0 12px 12px;
	-webkit-app-region: no-drag;
	justify-content: center;
	align-items: center;
}
.btn {
	background: rgba(205, 214, 244, 0.1);
	border: 1px solid rgba(205, 214, 244, 0.15);
	color: #cdd6f4;
	padding: 4px 10px;
	border-radius: 6px;
	font-size: 11px;
	cursor: pointer;
	transition: background 0.15s;
}
.btn:hover { background: rgba(205, 214, 244, 0.2); }
.btn:active { background: rgba(205, 214, 244, 0.3); }
#status {
	color: #a6adc8;
	font-size: 10px;
	margin-left: auto;
	white-space: nowrap;
}
#close-btn {
	background: rgba(243, 139, 168, 0.2);
	border-color: rgba(243, 139, 168, 0.3);
	color: #f38ba8;
	margin-left: 4px;
}
#close-btn:hover { background: rgba(243, 139, 168, 0.35); }
</style>
</head>
<body>
<div id="canvas-wrap">
	<canvas id="c"></canvas>
	<div id="speech"></div>
</div>
<div id="bar">
	<button class="btn" data-action="p">Pet</button>
	<button class="btn" data-action="f">Feed</button>
	<button class="btn" data-action="b">Ball</button>
	<button class="btn" data-action="x">Dance</button>
	<span id="status"></span>
	<button class="btn" id="close-btn" data-action="__close">\u2715</button>
</div>
<script>
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const speech = document.getElementById("speech");
const status = document.getElementById("status");

// IPC: receive frames from Node
if (window.__glimpse) {
	window.__glimpse.on("frame", (json) => {
		try { renderFrame(JSON.parse(json)); } catch {}
	});
}

function renderFrame(f) {
	const w = f.width;
	const h = f.height;
	if (canvas.width !== w || canvas.height !== h * 2) {
		canvas.width = w;
		canvas.height = h * 2;
	}
	const img = ctx.createImageData(w, h * 2);
	const d = img.data;
	for (let cy = 0; cy < h; cy++) {
		for (let cx = 0; cx < w; cx++) {
			const idx = cy * w + cx;
			const fgR = f.fg[idx * 3], fgG = f.fg[idx * 3 + 1], fgB = f.fg[idx * 3 + 2];
			const bgR = f.bg[idx * 3], bgG = f.bg[idx * 3 + 1], bgB = f.bg[idx * 3 + 2];
			// Top half-row: foreground color
			const topOff = ((cy * 2) * w + cx) * 4;
			d[topOff] = fgR; d[topOff + 1] = fgG; d[topOff + 2] = fgB; d[topOff + 3] = 255;
			// Bottom half-row: background color
			const botOff = ((cy * 2 + 1) * w + cx) * 4;
			d[botOff] = bgR; d[botOff + 1] = bgG; d[botOff + 2] = bgB; d[botOff + 3] = 255;
		}
	}
	ctx.putImageData(img, 0, 0);

	// Speech bubble
	if (f.speechText) {
		speech.textContent = f.speechText;
		speech.classList.add("visible");
	} else {
		speech.classList.remove("visible");
	}

	// Status
	if (f.status) {
		const s = f.status;
		status.textContent = s.mood + " | " + s.hunger + "% fed | " + s.energy + "% energy";
	}
}

// Button clicks -> IPC -> pompomKeypress
document.getElementById("bar").addEventListener("click", (e) => {
	const btn = e.target.closest("[data-action]");
	if (!btn) return;
	const action = btn.dataset.action;
	if (window.__glimpse) {
		window.__glimpse.send("action", action);
	}
});
</script>
</body>
</html>`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function openNativeWindow(): Promise<boolean> {
	const mod = await loadGlimpse();
	if (!mod) return false;

	if (win) return true; // already open

	try {
		win = mod.createWindow({
			title: "Pompom",
			width: 420,
			height: 320,
			frameless: true,
			transparent: true,
			alwaysOnTop: true,
			html: buildHtml(),
		});

		// IPC: button clicks from the window
		win.on("action", (data: string) => {
			if (data === "__close") {
				closeNativeWindow();
				windowEnabled = false;
				saveWindowConfig(false);
				return;
			}
			pompomKeypress(data);
		});

		// Start frame push loop at ~10fps
		frameTimer = setInterval(() => {
			if (!win) return;
			try {
				const frame = getFrameData();
				const payload = serializeFrame(frame);
				win.send("frame", payload);
			} catch { /* non-fatal */ }
		}, 100);

		windowEnabled = true;
		saveWindowConfig(true);
		return true;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[pompom-glimpse] Failed to open native window: ${msg}`);
		win = null;
		return false;
	}
}

export function closeNativeWindow(): void {
	if (frameTimer) {
		clearInterval(frameTimer);
		frameTimer = null;
	}
	if (win) {
		try { win.close(); } catch { /* non-fatal */ }
		win = null;
	}
}

export async function toggleNativeWindow(): Promise<boolean> {
	if (win) {
		closeNativeWindow();
		windowEnabled = false;
		saveWindowConfig(false);
		return false;
	} else {
		windowEnabled = true;
		saveWindowConfig(true);
		return openNativeWindow();
	}
}

// ─── Frame serialization ─────────────────────────────────────────────────────

function serializeFrame(frame: FrameData): string {
	// Convert typed arrays to regular arrays for JSON serialization
	return JSON.stringify({
		width: frame.width,
		height: frame.height,
		fg: Array.from(frame.fg),
		bg: Array.from(frame.bg),
		chars: Array.from(frame.chars),
		speechText: frame.speechText,
		status: frame.status,
	});
}
