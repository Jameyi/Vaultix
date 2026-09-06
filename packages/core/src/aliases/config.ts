import type { AliasProviderId } from "./types";

// Where an alias provider's configuration and API key live. See docs/email-aliases.md.

/**
 * Per vault, at `alias.config:<vaultId>`, mirroring the sync and backup keys.
 *
 * Vault-scoped rather than device-scoped because the key grants a capability: it can spend the
 * user's alias allowance, and on both current providers it can also list and delete the aliases
 * already made. CONTEXT.md settles the arguable cases in this direction, and this one is not
 * especially arguable.
 */
export const ALIAS_CONFIG_KEY = "alias.config";

export function aliasConfigKeyFor(vaultId: string): string {
	return `${ALIAS_CONFIG_KEY}:${vaultId}`;
}

/** True for any vault's alias-config key, for watchers that cannot name the id. */
export function isAliasConfigKey(key: string): boolean {
	return key.startsWith(`${ALIAS_CONFIG_KEY}:`);
}

/**
 * The API key, sealed under the VEK.
 *
 * Deliberately not backup's `TargetCreds`, which carries a `wrap` discriminant for credentials
 * the desktop hands to the OS credential store. That tier exists so a backup schedule can run
 * unattended while a vault is locked; alias creation is always a user gesture in a foreground
 * window, so there is nothing here to keep working while locked and no reason to put a key
 * anywhere weaker than the vault.
 */
export interface WrappedApiKey {
	iv: string;
	ciphertext: string;
}

/** One vault's alias provider. At most one: the feature is "generate an alias", not "choose a
 * provider each time", and a second configured provider would make every generate a question. */
export interface AliasConfig {
	provider: AliasProviderId;
	/** Set only when self-hosting; absent means the provider's own default. */
	baseUrl?: string;
	/** The provider's own settings, keyed by `AliasField.key` (domain, format, mode). */
	options: Record<string, string>;
	key: WrappedApiKey;
}

/** Whether a stored value is still shaped like a config. Storage is not a trusted input: this
 * may have been written by another build or hand-edited. */
export function isAliasConfig(v: unknown): v is AliasConfig {
	if (!v || typeof v !== "object") return false;
	const c = v as Partial<AliasConfig>;
	if (c.provider !== "addy" && c.provider !== "simplelogin") return false;
	if (c.baseUrl !== undefined && typeof c.baseUrl !== "string") return false;
	if (!c.options || typeof c.options !== "object") return false;
	if (!c.key || typeof c.key !== "object") return false;
	return typeof c.key.iv === "string" && typeof c.key.ciphertext === "string";
}
