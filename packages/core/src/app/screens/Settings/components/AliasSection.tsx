import { Trans, useLingui } from "@lingui/react/macro";
import { AtSign, Check, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
	ALIAS_PROVIDERS,
	type AliasAccount,
	type AliasDomainOption,
	AliasError,
	type AliasProviderId,
	describeProvider,
} from "../../../../aliases";
import { type SaveAliasInput, useAliasProvider } from "../../../../hooks/useAliasProvider";
import { Button } from "../../../components/ui/button";
import { SelectField } from "../../../components/ui/select-field";
import { TextField } from "../../../components/ui/text-field";
import { Section } from "./primitives";

/**
 * What to show for a failure: our sentence, then the provider's own if it gave one.
 *
 * The provider's half is rendered as text and never linked. It is remote-controlled string data,
 * and a measured provider answers a free plan with an upgrade URL inside the message; a clickable
 * link chosen by a remote server, on the screen where an API key was just typed, is a phishing
 * surface. See docs/email-aliases.md.
 */
function messageFor(e: unknown): string {
	if (e instanceof AliasError) {
		return e.providerMessage ? `${e.message} ${e.providerMessage}` : e.message;
	}
	return e instanceof Error ? e.message : String(e);
}

type Status =
	| { kind: "idle" }
	| { kind: "busy" }
	| { kind: "ok"; account: AliasAccount }
	| { kind: "error"; message: string };

/**
 * Email alias provider: the account Bramble asks for a fresh address per site.
 *
 * Configuring a provider is the opt-in for this network egress, so there is no separate master
 * switch. Nothing is contacted until a key is saved, and the host contacted is the one named on
 * screen. See docs/email-aliases.md.
 */
export function AliasSection() {
	const { t } = useLingui();
	const { config, save, disconnect, verify, domains } = useAliasProvider();

	const [provider, setProvider] = useState<AliasProviderId>("addy");
	const [baseUrl, setBaseUrl] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [options, setOptions] = useState<Record<string, string>>({});
	const [domainList, setDomainList] = useState<AliasDomainOption[]>([]);
	const [status, setStatus] = useState<Status>({ kind: "idle" });

	const descriptor = describeProvider(provider);

	// The copy for each provider-specific field. Here rather than in the descriptor so Lingui can
	// extract it; the descriptor decides which fields exist, this decides what they say.
	const fieldLabel = (key: string): string => {
		if (key === "domain") return t`Alias domain`;
		if (key === "format") return t`Alias format`;
		if (key === "mode") return t`Alias style`;
		return key;
	};
	const fieldHint = (key: string): string | undefined => {
		if (key === "domain") return t`Addy needs a domain before it can create an alias.`;
		if (key === "format") return t`Leave unset to use your provider account's own default.`;
		// Stated because it is a privacy choice rather than a cosmetic one: a word alias carries
		// the site's name, so the address itself discloses where it is used.
		if (key === "mode")
			return t`Word aliases include the site's name, which is easier to recognise but tells anyone who sees the address where you used it. UUID aliases reveal nothing.`;
		return undefined;
	};

	// Adopt the saved provider once it loads. The key is deliberately not restored: it is wrapped
	// under the vault key and this screen has no reason to hold the plaintext, so the field stays
	// empty and saving with it empty keeps what is already stored.
	useEffect(() => {
		if (!config) return;
		setProvider(config.provider);
		setBaseUrl(config.baseUrl ?? "");
		setOptions(config.options);
	}, [config]);

	const input = useCallback(
		(): SaveAliasInput => ({
			provider,
			baseUrl: baseUrl.trim() || undefined,
			options,
			apiKey: apiKey.trim() || undefined,
		}),
		[provider, baseUrl, options, apiKey],
	);

	/** Verify the key, and load the choices for any field the account has to answer. Read-only on
	 * every provider, so pressing it costs nothing. */
	const onVerify = useCallback(async () => {
		setStatus({ kind: "busy" });
		try {
			const account = await verify(input());
			if (descriptor.fields.some((f) => f.options === "domains")) {
				const d = await domains(input());
				setDomainList(d.options);
				// Preselect the account's own default rather than making someone choose again what
				// they already chose at the provider. Only when nothing is set: an existing choice,
				// including a custom domain, is never overwritten.
				if (d.default) {
					setOptions((o) => (o.domain ? o : { ...o, domain: d.default as string }));
				}
			}
			setStatus({ kind: "ok", account });
		} catch (e) {
			setStatus({ kind: "error", message: messageFor(e) });
		}
	}, [verify, domains, input, descriptor]);

	const onSave = useCallback(async () => {
		setStatus({ kind: "busy" });
		try {
			await save(input());
			setApiKey("");
			setStatus({ kind: "idle" });
		} catch (e) {
			setStatus({ kind: "error", message: messageFor(e) });
		}
	}, [save, input]);

	const onDisconnect = useCallback(async () => {
		await disconnect();
		setApiKey("");
		setOptions({});
		setDomainList([]);
		setStatus({ kind: "idle" });
	}, [disconnect]);

	const busy = status.kind === "busy";
	const missing = descriptor.fields.filter((f) => f.required && !options[f.key]);
	const canSave = !busy && Boolean(apiKey.trim() || config) && missing.length === 0;

	const connected = status.kind === "ok" ? status.account : undefined;
	// Whether the chosen domain is one of the provider's shared ones, which is what decides
	// whether an allowance applies at all. Unknown domain (nothing chosen yet) reads as shared,
	// since that is what a provider default is.
	const selectedIsShared = domainList.find((d) => d.domain === options.domain)?.shared ?? true;

	return (
		<Section icon={<AtSign className="w-4 h-4 text-primary" />} title={t`Email aliases`}>
			<p className="text-xs text-muted-foreground">
				<Trans>
					Generate a different email address for every site, from an account you already have.
					Bramble only asks your provider for an address; it never handles the mail.
				</Trans>
			</p>

			<SelectField
				label={t`Provider`}
				value={provider}
				disabled={busy}
				onChange={(e) => {
					setProvider(e.target.value as AliasProviderId);
					// Options belong to the provider that declared them, so a switch drops them rather
					// than carrying an Addy domain into a SimpleLogin config.
					setOptions({});
					setDomainList([]);
					setStatus({ kind: "idle" });
				}}
			>
				{ALIAS_PROVIDERS.map((p) => (
					<option key={p.id} value={p.id}>
						{p.label}
					</option>
				))}
			</SelectField>

			<div>
				<TextField
					label={config ? t`API key (leave blank to keep the saved one)` : t`API key`}
					type="password"
					autoComplete="off"
					value={apiKey}
					disabled={busy}
					onChange={(e) => setApiKey(e.target.value)}
				/>
				<a
					href={descriptor.keyUrl}
					target="_blank"
					rel="noreferrer"
					className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
				>
					<Trans>Create an API key at {descriptor.label}</Trans>
					<ExternalLink className="w-3 h-3" />
				</a>
			</div>

			{descriptor.selfHostable && (
				<TextField
					label={t`Server URL (self-hosted only)`}
					type="url"
					autoComplete="off"
					value={baseUrl}
					disabled={busy}
					onChange={(e) => setBaseUrl(e.target.value)}
				/>
			)}

			{descriptor.fields.map((field) => {
				const fromAccount = field.options === "domains";
				const choices: string[] = fromAccount
					? domainList.map((d) => d.domain)
					: [...field.options];
				const hint = fieldHint(field.key);
				return (
					<div key={field.key}>
						<SelectField
							label={fieldLabel(field.key)}
							value={options[field.key] ?? ""}
							disabled={busy || choices.length === 0}
							onChange={(e) => setOptions((o) => ({ ...o, [field.key]: e.target.value }))}
						>
							{/* An optional field offers "no choice", which is what lets the account's own
							    default apply rather than one we impose. */}
							<option value="">{field.required ? t`Choose...` : t`Provider default`}</option>
							{fromAccount
								? domainList.map((d) => (
										<option key={d.domain} value={d.domain}>
											{/* A domain the user brought is worth marking: it is usually the one
											    with no allowance attached. */}
											{d.shared ? d.domain : t`${d.domain} (your domain)`}
										</option>
									))
								: choices.map((c) => (
										<option key={c} value={c}>
											{c}
										</option>
									))}
						</SelectField>
						{hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
					</div>
				);
			})}

			{missing.length > 0 && domainList.length === 0 && (
				<p className="text-xs text-muted-foreground">
					<Trans>Check the key first, to load the choices this provider needs.</Trans>
				</p>
			)}

			<div className="flex items-center gap-2">
				<Button variant="secondary" onClick={onVerify} disabled={busy}>
					{busy ? (
						<Loader2 className="w-3.5 h-3.5 animate-spin" />
					) : (
						<RefreshCw className="w-3.5 h-3.5" />
					)}
					<Trans>Check key</Trans>
				</Button>
				<Button onClick={onSave} disabled={!canSave}>
					<Trans>Save</Trans>
				</Button>
				{config && (
					<Button variant="ghost" onClick={onDisconnect} disabled={busy}>
						<Trans>Disconnect</Trans>
					</Button>
				)}
			</div>

			{connected && (
				<p className="text-xs text-primary flex items-center gap-1.5">
					<Check className="w-3.5 h-3.5 shrink-0" />
					{/* The allowance is counted over the provider's shared domains only, so quoting it
					    beside a domain of the user's own would claim a limit that does not apply. */}
					{connected.quota && selectedIsShared
						? t`Connected. ${connected.quota.used} of ${connected.quota.limit} aliases used.`
						: t`Connected.`}
				</p>
			)}
			{status.kind === "error" && (
				// Plain text, deliberately: part of this string can come from the provider.
				<p className="text-xs text-destructive">{status.message}</p>
			)}
		</Section>
	);
}
