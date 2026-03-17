/**
 * pompom-instance — Multi-terminal instance coordination.
 *
 * Uses filesystem heartbeat files at ~/.pi/pompom/instances/<instanceId>.json
 * to detect other running Pi terminals. Elects the oldest live instance as
 * "primary" — only the primary plays ambient audio, weather SFX, and greetings.
 * Secondary instances run visual-only + user-triggered SFX.
 *
 * Race-safe: atomic writes via tmp+rename, UUID instanceId (handles PID reuse),
 * and process-exists checks for stale cleanup.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// ─── Paths ────────────────────────────────────────────────────────────────────

const POMPOM_DIR = path.join(os.homedir(), ".pi", "pompom");
const INSTANCES_DIR = path.join(POMPOM_DIR, "instances");
const GREETING_FILE = path.join(POMPOM_DIR, "last-greeting.json");

// ─── Config ───────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 5_000;
const STALE_THRESHOLD_MS = 15_000;
const GREETING_COOLDOWN_MS = 60_000;

// ─── State ────────────────────────────────────────────────────────────────────

const instanceId = crypto.randomUUID();
const pid = process.pid;
const tty = (() => {
	try { return process.stdout.isTTY ? (process.env.TTY || process.env.SSH_TTY || `pid-${pid}`) : `pid-${pid}`; }
	catch { return `pid-${pid}`; }
})();
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let startedAt = 0;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InstanceInfo {
	instanceId: string;
	pid: number;
	tty: string;
	cwd: string;
	startedAt: number;
	heartbeat: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
	try { fs.mkdirSync(dir, { recursive: true }); } catch { /* already exists */ }
}

/** Atomic write: write to tmp file then rename (prevents partial reads). */
function atomicWrite(filePath: string, data: string): void {
	const tmp = filePath + `.tmp-${pid}`;
	try {
		fs.writeFileSync(tmp, data, "utf-8");
		fs.renameSync(tmp, filePath);
	} catch {
		try { fs.unlinkSync(tmp); } catch { /* cleanup best-effort */ }
	}
}

/** Check if a process is still alive. EPERM means alive (different user), ESRCH means dead. */
function processAlive(checkPid: number): boolean {
	try {
		process.kill(checkPid, 0);
		return true;
	} catch (err: unknown) {
		// EPERM = process exists but we can't signal it (different user) — still alive
		if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "EPERM") return true;
		return false; // ESRCH = no such process
	}
}

function instancePath(id: string): string {
	return path.join(INSTANCES_DIR, `${id}.json`);
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/** Register this instance and start heartbeat. Call on session_start. */
export function registerInstance(cwd: string): void {
	if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
	ensureDir(INSTANCES_DIR);
	startedAt = Date.now();
	writeHeartbeat(cwd);
	heartbeatTimer = setInterval(() => writeHeartbeat(cwd), HEARTBEAT_INTERVAL_MS);
}

/** Remove this instance file and stop heartbeat. Call on session_shutdown. */
export function deregisterInstance(): void {
	if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
	try { fs.unlinkSync(instancePath(instanceId)); } catch { /* may not exist */ }
}

function writeHeartbeat(cwd: string): void {
	const info: InstanceInfo = {
		instanceId,
		pid,
		tty,
		cwd,
		startedAt,
		heartbeat: Date.now(),
	};
	atomicWrite(instancePath(instanceId), JSON.stringify(info));
	cleanStaleInstances();
}

/** Read all live (non-stale) instances. Cleans up stale/crashed entries. */
export function getLiveInstances(): InstanceInfo[] {
	ensureDir(INSTANCES_DIR);
	const now = Date.now();
	const live: InstanceInfo[] = [];
	let entries: string[];
	try { entries = fs.readdirSync(INSTANCES_DIR); } catch { return []; }

	for (const file of entries) {
		if (!file.endsWith(".json")) continue;
		const filePath = path.join(INSTANCES_DIR, file);
		try {
			const raw = fs.readFileSync(filePath, "utf-8");
			const info = JSON.parse(raw) as InstanceInfo;
			if (now - info.heartbeat > STALE_THRESHOLD_MS || !processAlive(info.pid)) {
				try { fs.unlinkSync(filePath); } catch { /* race with other cleaner */ }
				continue;
			}
			live.push(info);
		} catch {
			// Corrupt or partially written — skip
		}
	}
	return live;
}

/** Get instances other than this one. */
export function getOtherInstances(): InstanceInfo[] {
	return getLiveInstances().filter(i => i.instanceId !== instanceId);
}

/** Is this instance the elected primary (oldest live startedAt, tie-break by instanceId)? */
export function isPrimaryInstance(): boolean {
	const live = getLiveInstances();
	if (live.length === 0) return true; // no peers = we're primary
	live.sort((a, b) => a.startedAt - b.startedAt || a.instanceId.localeCompare(b.instanceId));
	return live[0].instanceId === instanceId;
}

/** Check if any instance fired a greeting within the cooldown window. */
export function hasRecentGreeting(): boolean {
	try {
		const raw = fs.readFileSync(GREETING_FILE, "utf-8");
		const data = JSON.parse(raw) as { timestamp: number; pid?: number };
		return Date.now() - data.timestamp < GREETING_COOLDOWN_MS;
	} catch {
		return false;
	}
}

/**
 * Atomically claim the greeting slot — returns true if this instance won the race.
 * Uses read-check-write with PID stamp to minimize (not eliminate) split-brain.
 * Callers should only speak if this returns true.
 */
export function claimGreeting(): boolean {
	ensureDir(POMPOM_DIR);
	// Re-check freshness right before writing to shrink the race window
	if (hasRecentGreeting()) return false;
	atomicWrite(GREETING_FILE, JSON.stringify({ timestamp: Date.now(), pid }));
	return true;
}

/** Mark that a greeting was just spoken (shared across all instances). */
export function markGreeting(): void {
	ensureDir(POMPOM_DIR);
	atomicWrite(GREETING_FILE, JSON.stringify({ timestamp: Date.now(), pid }));
}

/** Remove stale/crashed instance files opportunistically. */
function cleanStaleInstances(): void {
	const now = Date.now();
	let entries: string[];
	try { entries = fs.readdirSync(INSTANCES_DIR); } catch { return; }
	for (const file of entries) {
		if (!file.endsWith(".json")) continue;
		const filePath = path.join(INSTANCES_DIR, file);
		try {
			const raw = fs.readFileSync(filePath, "utf-8");
			const info = JSON.parse(raw) as InstanceInfo;
			if (now - info.heartbeat > STALE_THRESHOLD_MS || !processAlive(info.pid)) {
				fs.unlinkSync(filePath);
			}
		} catch { /* skip corrupt files */ }
	}
}

/** Get this instance's ID (useful for logging/display). */
export function getInstanceId(): string { return instanceId; }

/** Get count of all live instances including this one. */
export function getInstanceCount(): number { return getLiveInstances().length; }
