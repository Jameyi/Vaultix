import { useCallback, useEffect, useState } from "react";
import {
	type AliasAccount,
	type AliasConfig,
	AliasError,
	type AliasProviderId,
	aliasConfigKeyFor,
	createAliasClient,
	isAliasConfig,
	missingRequiredFields,
} from "../aliases";
import { usePlatform } from "../context/PlatformContext";
import { useVaultRegistry } from "./useVaultRegistry";

/** What the settings screen saves. The key is plaintext here and nowhere else: it is wrapped
 * before it is written, and never kept in state. */
export interface SaveAliasInput {
	provider: AliasProviderId;
	baseUrl?: string;
	options: Record<string, string>;
	/** Omitted on edit, which keeps the stored key rather than re-asking for it. */
	apiKey?: string;
}

/**
 * The active vault's email alias provider: its configuration, and the calls that use it.
 *
 * One provider per vault, VEK-wrapped at `alias.config:<vaultId>`, so configuring one in a vault
 * leaves the others alone and a locked vault cannot generate at all. Everything runs in this UI
 * context: the providers grant CORS to every origin the app runs at, so no platform needs a
 * transport of its own. See docs/email-aliases.md.
 */
export function useAliasProvider() {
	const { storage, crypto } = usePlatform();
	const { activeId, vaults } = useVaultRegistry();
	const vaultId = activeId ?? vaults[0]?.id;
	// undefined = still loading, or no vault resolved yet. null = no provider set up.
	const [config, setConfig] = useState<AliasConfig | undefined | null>(undefined);

	const reload = useCallback(async () => {
		if (!vaultId) return;
		const stored = await storage
			.getMeta<unknown>(aliasConfigKeyFor(vaultId))
			.catch(() => undefined);
		setConfig(isAliasConfig(stored) ? stored : null);
	}, [storage, vaultId]);

	useEffect(() => {
		// Reset first: until the read lands, the previous vault's provider would otherwise still be
		// on screen, and its key is not this vault's to spend.
		setConfig(undefined);
		void reload();
	}, [reload]);

	/**
	 * The key to authenticate with: the one being typed, else the one already stored.
	 *
	 * Both callers need this, and the order matters. Preferring the typed key is what lets the
	 * settings screen verify a replacement before committing it, rather than testing the key it
	 * is about to overwrite.
	 */
	const resolveKey = useCallback(
		async (typed: string | undefined): Promise<string> => {
			if (typed) return typed;
			if (config) return crypto.decryptWithVek(config.key.iv, config.key.ciphertext);
			throw new AliasError("config", "Enter your API key.");
		},
		[crypto, config],
	);

	const clientFrom = useCallback(
		async (input: SaveAliasInput) =>
			createAliasClient(
				input.provider,
				input.options,
				input.baseUrl,
				await resolveKey(input.apiKey),
			),
		[resolveKey],
	);

	const save = useCallback(
		async (input: SaveAliasInput): Promise<void> => {
			if (!vaultId) throw new AliasError("config", "No vault is open.");
			// An edit that does not restate the key keeps the wrapped one, because the screen never
			// holds the plaintext to re-wrap.
			let key = config?.key;
			if (input.apiKey) {
				const sealed = await crypto.encryptWithVek(input.apiKey);
				key = { iv: sealed.iv, ciphertext: sealed.ciphertext };
			}
			if (!key) throw new AliasError("config", "Enter your API key.");
			const next: AliasConfig = {
				provider: input.provider,
				baseUrl: input.baseUrl || undefined,
				options: input.options,
				key,
			};
			await storage.setMeta(aliasConfigKeyFor(vaultId), next);
			setConfig(next);
		},
		[storage, crypto, vaultId, config],
	);

	const disconnect = useCallback(async () => {
		if (!vaultId) return;
		await storage.removeMeta(aliasConfigKeyFor(vaultId)).catch(() => {});
		setConfig(null);
	}, [storage, vaultId]);

	/** Check a key and report what the account allows. Read-only on every provider, so pressing
	 * it costs nothing and can be offered freely. */
	const verify = useCallback(
		async (input: SaveAliasInput): Promise<AliasAccount> => (await clientFrom(input)).verify(),
		[clientFrom],
	);

	/** The domains this account may create under, for a provider that requires a choice. */
	const domains = useCallback(
		async (input: SaveAliasInput): Promise<string[]> =>
			(await (await clientFrom(input)).domains?.()) ?? [],
		[clientFrom],
	);

	/**
	 * Create one alias, for `site` when the caller knows it.
	 *
	 * The call that spends the user's allowance, so it is only ever reached from an explicit
	 * gesture. Missing required settings fail here without a request: a create that can only be
	 * rejected still costs a round trip and tells the user nothing they can act on.
	 */
	const generate = useCallback(
		async (site?: string): Promise<string> => {
			if (!config) throw new AliasError("config", "No alias provider is set up.");
			if (missingRequiredFields(config.provider, config.options).length > 0) {
				throw new AliasError("config", "This provider needs more setup in Settings.");
			}
			const client = createAliasClient(
				config.provider,
				config.options,
				config.baseUrl,
				await crypto.decryptWithVek(config.key.iv, config.key.ciphertext),
			);
			const { address } = await client.create({
				site,
				description: site ? `Bramble (${site})` : "Bramble",
			});
			return address;
		},
		[config, crypto],
	);

	return {
		/** undefined while loading, null when no provider is set up. */
		config,
		/** Whether a generate button should appear at all. */
		enabled: Boolean(config),
		save,
		disconnect,
		verify,
		domains,
		generate,
		reload,
	};
}
