import { AliasError, aliasConfigKeyFor, clientForConfig, isAliasConfig } from "@core/aliases";
import { extensionStorage } from "../storage";
import { sendToOffscreen } from "./offscreen-client";
import { getActiveVaultId, unlockedVaultIds } from "./session";

// Creating an email alias for the in-page suggestion. The provider is reached from here rather
// than from the page: the API key is sealed under the vault key, and a content script is not a
// context that may hold either. See docs/email-aliases.md.

/** The active vault's alias configuration, or null when there is none to use. */
async function activeConfig() {
	const vaultId = getActiveVaultId();
	if (!vaultId) return null;
	const stored = await extensionStorage
		.getMeta<unknown>(aliasConfigKeyFor(vaultId))
		.catch(() => undefined);
	return isAliasConfig(stored) ? { vaultId, config: stored } : null;
}

/**
 * Whether an alias row may be offered at all, for the autofill query to carry.
 *
 * A config read and nothing more: no provider is contacted to answer this, so a page asking
 * whether the row exists cannot make Bramble talk to anyone. The row is only ever drawn on an
 * unlocked vault anyway, since a locked one replaces every row with the unlock prompt.
 */
export async function aliasAvailable(): Promise<boolean> {
	return (await activeConfig()) !== null;
}

/**
 * Create one alias for `site`, and return the address.
 *
 * The key is unwrapped against the vault that owns it and no other. Backup's credential path
 * tries every unlocked vault as a fallback, which is documented there as temporary; there is no
 * reason to inherit it, and a key that opens under a different vault's VEK would be a key that
 * vault was never given.
 */
export async function createAlias(site?: string): Promise<string> {
	const active = await activeConfig();
	if (!active) throw new AliasError("config", "No alias provider is set up for this vault.");
	if (!unlockedVaultIds().includes(active.vaultId)) {
		// Same answer the user already gets when saving a new item into a locked vault.
		throw new AliasError("auth", "Unlock Bramble to create an alias.");
	}
	const dec = await sendToOffscreen({
		type: "CRYPTO_DECRYPT_OUTER",
		vaultId: active.vaultId,
		payload: { iv: active.config.key.iv, ciphertext: active.config.key.ciphertext },
	});
	if (!dec.ok || typeof dec.data !== "string") {
		throw new AliasError("config", "Could not read the stored API key.");
	}
	const client = clientForConfig(active.config, dec.data);
	const { address } = await client.create({
		site,
		description: site ? `Bramble (${site})` : "Bramble",
	});
	return address;
}
