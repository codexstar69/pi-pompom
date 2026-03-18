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
const GREETING_LOCK_FILE = path.join(POMPOM_DIR, "last-greeting.lock");

// ─── Config ───────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 5_000;
const LIVE_INSTANCES_CACHE_TTL_MS = 250;
const INSTANCE_STALE_MS = HEARTBEAT_INTERVAL_MS * 3;
const GREETING_COOLDOWN_MS = 1_800_000; // 30 minutes — one greeting per time-of-day period
const GREETING_LOCK_STALE_MS = 5_000;

// ─── State ────────────────────────────────────────────────────────────────────

const instanceId = crypto.randomUUID();
const pid = process.pid;
const tty = (() => {
	try { return process.stdout.isTTY ? (process.env.TTY || process.env.SSH_TTY || `pid-${pid}`) : `pid-${pid}`; }
	catch { return `pid-${pid}`; }
})();
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let startedAt = 0;
let liveInstancesCache: { expiresAt: number; data: InstanceInfo[] } | null = null;

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

/** Atomic write: write to tmp file then rename (prevents partial reads).
 *  Returns true if the write succeeded, false otherwise. */
function atomicWrite(filePath: string, data: string): boolean {
	const tmp = filePath + `.tmp-${pid}`;
	try {
		fs.writeFileSync(tmp, data, "utf-8");
		fs.renameSync(tmp, filePath);
		return true;
	} catch {
		try { fs.unlinkSync(tmp); } catch { /* cleanup best-effort */ }
		return false;
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

function isHeartbeatFresh(heartbeat: number, now: number): boolean {
	return heartbeat > 0 && now - heartbeat <= INSTANCE_STALE_MS;
}

function tryAcquireGreetingLock(): number | null {
	try {
		return fs.openSync(GREETING_LOCK_FILE, "wx");
	} catch (error) {
		const code = error instanceof Error && "code" in error
			? (error as NodeJS.ErrnoException).code
			: "";
		if (code !== "EEXIST") {
			return null;
		}
		try {
			const stat = fs.statSync(GREETING_LOCK_FILE);
			if (Date.now() - stat.mtimeMs <= GREETING_LOCK_STALE_MS) {
				return null;
			}
			fs.unlinkSync(GREETING_LOCK_FILE);
			return fs.openSync(GREETING_LOCK_FILE, "wx");
		} catch {
			return null;
		}
	}
}

function releaseGreetingLock(fd: number): void {
	try { fs.closeSync(fd); } catch { /* already closed */ }
	try { fs.unlinkSync(GREETING_LOCK_FILE); } catch { /* already removed */ }
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/** Register this instance and start heartbeat. Call on session_start.
 *  Preserves original startedAt on session_switch (cwd change only). */
export function registerInstance(cwd: string): void {
	if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
	ensureDir(INSTANCES_DIR);
	// Only set startedAt on first registration — preserve seniority across session switches
	if (!startedAt) startedAt = Date.now();
	writeHeartbeat(cwd);
	heartbeatTimer = setInterval(() => writeHeartbeat(cwd), HEARTBEAT_INTERVAL_MS);
}

/** Remove this instance file and stop heartbeat. Call on session_shutdown. */
export function deregisterInstance(): void {
	if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
	try { fs.unlinkSync(instancePath(instanceId)); } catch { /* may not exist */ }
	invalidateLiveInstancesCache();
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
	invalidateLiveInstancesCache();
}

/** Read all live instances. Cleans up crashed entries. */
export function getLiveInstances(): InstanceInfo[] {
	const now = Date.now();
	if (liveInstancesCache && now < liveInstancesCache.expiresAt) {
		return [...liveInstancesCache.data];
	}

	ensureDir(INSTANCES_DIR);
	const live: InstanceInfo[] = [];
	let entries: string[];
	try { entries = fs.readdirSync(INSTANCES_DIR); } catch { return []; }

	for (const file of entries) {
		if (!file.endsWith(".json")) continue;
		const filePath = path.join(INSTANCES_DIR, file);
		try {
			const raw = fs.readFileSync(filePath, "utf-8");
			const info = JSON.parse(raw) as InstanceInfo;
			const isAlive = processAlive(info.pid);
			const isFresh = isHeartbeatFresh(info.heartbeat, now);
			if (!isAlive || !isFresh) {
				try { fs.unlinkSync(filePath); } catch { /* race with other cleaner */ }
				continue;
			}
			live.push(info);
		} catch {
			// Corrupt or partially written — skip
		}
	}

	liveInstancesCache = {
		expiresAt: now + LIVE_INSTANCES_CACHE_TTL_MS,
		data: live,
	};
	return [...live];
}

/** Get instances other than this one. */
export function getOtherInstances(): InstanceInfo[] {
	return getLiveInstances().filter(i => i.instanceId !== instanceId);
}

/** Is this instance the elected primary (oldest live startedAt, tie-break by instanceId)? */
export function isPrimaryInstance(): boolean {
	const live = getLiveInstances();
	// Include self if heartbeat file hasn't been written yet AND heartbeat is active
	if (heartbeatTimer && !live.some(i => i.instanceId === instanceId)) {
		live.push({ instanceId, pid, tty, cwd: "", startedAt: startedAt || Date.now(), heartbeat: Date.now() });
	}
	if (live.length === 0) return false; // no live instances at all — don't self-elect from nothing
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
 * Uses a lock file so only one terminal can perform the cooldown check + write.
 * Callers should only speak if this returns true.
 */
export function claimGreeting(): boolean {
	ensureDir(POMPOM_DIR);
	const lockFd = tryAcquireGreetingLock();
	if (lockFd === null) return false;
	try {
		if (hasRecentGreeting()) return false;
		// Only claim if the greeting marker was actually written to disk
		const wrote = atomicWrite(GREETING_FILE, JSON.stringify({ timestamp: Date.now(), pid }));
		return wrote;
	} finally {
		releaseGreetingLock(lockFd);
	}
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
			const isAlive = processAlive(info.pid);
			const isFresh = isHeartbeatFresh(info.heartbeat, now);
			if (!isAlive || !isFresh) {
				fs.unlinkSync(filePath);
			}
		} catch { /* skip corrupt files */ }
	}
}

function invalidateLiveInstancesCache(): void {
	liveInstancesCache = null;
}

/** Get this instance's ID (useful for logging/display). */
export function getInstanceId(): string { return instanceId; }

/** Stable key for per-instance persistence files. */
export function getInstancePersistenceKey(): string { return instanceId; }

/** Get count of all live instances including this one. */
export function getInstanceCount(): number { return getLiveInstances().length; }
