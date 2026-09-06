import { ADDY_DEFAULT_BASE_URL, ADDY_FORMATS } from "./addy";
import { SIMPLELOGIN_DEFAULT_BASE_URL, SIMPLELOGIN_MODES } from "./simplelogin";
import type { AliasProviderId } from "./types";

// What the settings screen needs to know about a provider, declared rather than switched on.
// Adding a provider should be a descriptor plus a client, with no `if (id === ...)` anywhere in
// the UI. See docs/email-aliases.md.

/**
 * One provider-specific setting.
 *
 * `options: "domains"` means the choices are not known until the account is asked, so the screen
 * calls `client.domains()` after the key verifies. Addy is the reason this exists: it cannot
 * create anything until a domain is chosen, and only the account knows which are available.
 */
export interface AliasField {
	key: string;
	/** Shown as the field's label. Translated at the call site, not here. */
	label: string;
	options: readonly string[] | "domains";
	/** A create cannot be attempted until this has a value. */
	required: boolean;
	/** Why someone would change it, when the answer is not obvious from the label. */
	hint?: string;
}

export interface AliasProviderDescriptor {
	id: AliasProviderId;
	label: string;
	defaultBaseUrl: string;
	/** Whether to offer a base-URL field at all. Both current providers self-host. */
	selfHostable: boolean;
	/** Where the user creates an API key. Ours, fixed, and never provider-supplied text. */
	keyUrl: string;
	fields: readonly AliasField[];
}

export const ALIAS_PROVIDERS: readonly AliasProviderDescriptor[] = [
	{
		id: "addy",
		label: "Addy.io",
		defaultBaseUrl: ADDY_DEFAULT_BASE_URL,
		selfHostable: true,
		keyUrl: "https://app.addy.io/settings/api",
		fields: [
			{
				key: "domain",
				label: "Alias domain",
				options: "domains",
				required: true,
				hint: "Addy needs a domain before it can create an alias.",
			},
			{
				key: "format",
				label: "Alias format",
				options: ADDY_FORMATS,
				required: false,
				hint: "Leave unset to use your Addy account's own default.",
			},
		],
	},
	{
		id: "simplelogin",
		label: "SimpleLogin",
		defaultBaseUrl: SIMPLELOGIN_DEFAULT_BASE_URL,
		selfHostable: true,
		keyUrl: "https://app.simplelogin.io/dashboard/api_key",
		fields: [
			{
				key: "mode",
				label: "Alias style",
				options: SIMPLELOGIN_MODES,
				required: false,
				// The tradeoff is stated because it is a privacy choice, not a cosmetic one: a
				// `word` alias carries the site's name and so discloses where it is used.
				hint: "Word aliases include the site's name, which is easier to recognise but tells anyone who sees the address where you used it. UUID aliases reveal nothing.",
			},
		],
	},
];

export function describeProvider(id: AliasProviderId): AliasProviderDescriptor {
	const found = ALIAS_PROVIDERS.find((p) => p.id === id);
	if (!found) throw new Error(`unknown alias provider: ${id}`);
	return found;
}

/** Which of a provider's required fields have no value yet, so the UI can say what is missing
 * before a click spends a network call and, on some providers, an alias. */
export function missingRequiredFields(
	id: AliasProviderId,
	options: Record<string, string | undefined>,
): string[] {
	return describeProvider(id)
		.fields.filter((f) => f.required && !options[f.key])
		.map((f) => f.key);
}
