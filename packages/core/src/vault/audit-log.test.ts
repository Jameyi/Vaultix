import { describe, expect, it } from "vitest";
import type { CryptoAdapter, VekEncrypted } from "../adapters/crypto";
import type { StorageAdapter } from "../adapters/storage";
import {
	AUDIT_MAX_EVENTS,
	type AuditEvent,
	appendAuditEvent,
	auditLogKey,
	clearAuditLog,
	readAuditEvents,
	takeDroppedCount,
} from "./audit-log";

/** VEK-scoped AEAD fake: "iv" is a counter so every ciphertext is unique. */
function fakeCrypto(opts: { locked?: boolean } = {}): CryptoAdapter & { lockNow(): void } {
	let seq = 0;
	let locked = opts.locked ?? false;
	const log = new Map<string, { plain: string; sealed: VekEncrypted }>();
	return {
		lockNow() {
			locked = true;
			log.clear();
		},
		async encryptWithVek(plaintext: string): Promise<VekEncrypted> {
			if (locked) throw new Error("locked");
			const iv = String(seq++);
			log.set(iv, { plain: plaintext, sealed: { iv, ciphertext: `sealed-${iv}` } });
			return { iv, ciphertext: `sealed-${iv}` };
		},
		async decryptWithVek(iv: string): Promise<string> {
			const hit = log.get(iv);
			if (!hit || locked) throw new Error("locked");
			return hit.plain;
		},
	} as never;
}

function fakeStorage(): StorageAdapter {
	const meta = new Map<string, unknown>();
	return {
		async hasVaultHandle() {
			return true;
		},
		async readVaultBlob() {
			return new Uint8Array();
		},
		async writeVaultBlob() {},
		async restoreVaultFromBackup() {
			return false;
		},
		async deleteVaultBlob() {},
		async getMeta<T>(key: string) {
			return meta.get(key) as T | undefined;
		},
		async setMeta<T>(key: string, value: T) {
			meta.set(key, value);
		},
		async removeMeta(key: string) {
			meta.delete(key);
		},
	};
}

const evt = (over: Partial<AuditEvent> = {}): AuditEvent => ({
	kind: "secret.reveal",
	at: 1,
	...over,
});

describe("audit log", () => {
	it("round-trips events encrypted under the VEK", async () => {
		const storage = fakeStorage();
		const crypto = fakeCrypto();
		await appendAuditEvent(storage, crypto, evt({ entryId: "e1" }));
		await appendAuditEvent(
			storage,
			crypto,
			evt({ kind: "vault.unlock", method: "password", at: 2 }),
		);
		const events = await readAuditEvents(storage, crypto);
		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({ kind: "secret.reveal", entryId: "e1" });
		expect(events[1]).toMatchObject({ kind: "vault.unlock", method: "password" });
		// Stored ciphertext, never plaintext, under a vault-scoped key.
		const raw = await storage.getMeta<{ sealed: VekEncrypted }[]>(auditLogKey("primary"));
		expect(raw?.[0]?.sealed.ciphertext).not.toContain("secret.reveal");
	});

	it("drops (never buffers plaintext) while locked and counts the gap", async () => {
		const storage = fakeStorage();
		const crypto = fakeCrypto();
		crypto.lockNow();
		await appendAuditEvent(storage, crypto, evt({ at: 1 }));
		expect(await readAuditEvents(storage, crypto)).toEqual([]);
		expect(await takeDroppedCount(storage)).toBe(1);
		// Reported once, then reset.
		expect(await takeDroppedCount(storage)).toBe(0);
	});

	it("caps the log at AUDIT_MAX_EVENTS, oldest first out", async () => {
		const storage = fakeStorage();
		const crypto = fakeCrypto();
		for (let i = 0; i < AUDIT_MAX_EVENTS + 10; i++) {
			await appendAuditEvent(storage, crypto, evt({ at: i }));
		}
		const events = await readAuditEvents(storage, crypto);
		expect(events).toHaveLength(AUDIT_MAX_EVENTS);
		expect(events[0]?.at).toBe(10);
		expect(events.at(-1)?.at).toBe(AUDIT_MAX_EVENTS + 9);
	});

	it("clear removes both the log and the drop counter", async () => {
		const storage = fakeStorage();
		const crypto = fakeCrypto();
		await appendAuditEvent(storage, crypto, evt());
		crypto.lockNow();
		await appendAuditEvent(storage, crypto, evt({ at: 2 }));
		await clearAuditLog(storage);
		crypto.lockNow = () => {};
		expect(await readAuditEvents(storage, fakeCrypto())).toEqual([]);
		expect(await takeDroppedCount(storage)).toBe(0);
	});
});
