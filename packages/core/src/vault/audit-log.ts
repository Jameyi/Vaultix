import type { CryptoAdapter, VekEncrypted } from "../adapters/crypto";
import type { StorageAdapter } from "../adapters/storage";

/**
 * Local audit log (docs/audit-log.md). Best-effort, fire-and-forget records of
 * sensitive vault operations, each encrypted under the VEK via the existing
 * encryptWithVek mapping, stored vault-scoped in adapter metadata. Never
 * business-critical: every failure is swallowed and counted.
 */

export type AuditEventKind =
	| "vault.unlock"
	| "vault.unlockFailed"
	| "vault.lock"
	| "secret.reveal"
	| "secret.copy"
	| "entry.export"
	| "autofill.fill"
	| "backup.run"
	| "vault.vekRotate"
	| "device.enroll"
	| "device.revoke";

export interface AuditEvent {
	kind: AuditEventKind;
	at: number;
	/** For secret.* events: which entry was touched. Never a name or secret. */
	entryId?: string;
	/** For autofill.fill: hostname only, never a path. */
	host?: string;
	/** For vault.unlock: password | biometric | recovery. */
	method?: string;
	/** For backup.run and vault.unlockFailed. */
	outcome?: "ok" | "fail";
	/** For unlockFailed: coarse reason category, never the attempted input. */
	reason?: string;
}

/** Hard FIFO cap so a chatty surface can never grow metadata unbounded. */
export const AUDIT_MAX_EVENTS = 1000;

const AUDIT_META_PREFIX = "audit.log:";

export function auditLogKey(vaultId: string): string {
	return `${AUDIT_META_PREFIX}${vaultId}`;
}

/**
 * Append one event. Await-less by contract (`void appendAuditEvent(...)` at call
 * sites): it must never delay or break the operation it observes. When the VEK is
 * unavailable (locked vault) the event is DROPPED, not buffered in plaintext, and
 * the drop counter advances so the next unlocked read can report the gap.
 */
export async function appendAuditEvent(
	storage: StorageAdapter,
	crypto: CryptoAdapter,
	event: AuditEvent,
	vaultId?: string,
): Promise<void> {
	try {
		const key = auditLogKey(vaultId ?? "primary");
		const sealed = await readSealedLog(storage, key);
		const entry = { event, sealed: await crypto.encryptWithVek(JSON.stringify(event)) };
		const next = [...sealed, entry].slice(-AUDIT_MAX_EVENTS);
		await storage.setMeta(key, next);
	} catch {
		// Audit must never break the operation it observes. Count the drop only.
		await bumpDropCounter(storage, vaultId).catch(() => {});
	}
}

/** Decrypt and return the log, oldest first. Throws when the vault is locked. */
export async function readAuditEvents(
	storage: StorageAdapter,
	crypto: CryptoAdapter,
	vaultId?: string,
): Promise<AuditEvent[]> {
	const key = auditLogKey(vaultId ?? "primary");
	const sealed = await readSealedLog(storage, key);
	const events: AuditEvent[] = [];
	for (const entry of sealed) {
		try {
			events.push(
				JSON.parse(await crypto.decryptWithVek(entry.sealed.iv, entry.sealed.ciphertext)),
			);
		} catch {
			// A single undecryptable entry (e.g. written under a rotated key) is skipped.
		}
	}
	return events;
}

/** Number of events dropped while the vault was locked, since the last report. */
export async function takeDroppedCount(storage: StorageAdapter, vaultId?: string): Promise<number> {
	const key = dropKey(vaultId);
	const count = (await storage.getMeta<number>(key)) ?? 0;
	if (count > 0) await storage.removeMeta(key);
	return count;
}

export async function clearAuditLog(storage: StorageAdapter, vaultId?: string): Promise<void> {
	await storage.removeMeta(auditLogKey(vaultId ?? "primary"));
	await storage.removeMeta(dropKey(vaultId));
}

interface SealedEntry {
	event: AuditEvent["kind"];
	sealed: VekEncrypted;
}

async function readSealedLog(storage: StorageAdapter, key: string): Promise<SealedEntry[]> {
	return (await storage.getMeta<SealedEntry[]>(key)) ?? [];
}

function dropKey(vaultId?: string): string {
	return `audit.dropped:${vaultId ?? "primary"}`;
}

async function bumpDropCounter(storage: StorageAdapter, vaultId?: string): Promise<void> {
	const key = dropKey(vaultId);
	const count = (await storage.getMeta<number>(key)) ?? 0;
	await storage.setMeta(key, count + 1);
}
