import { z } from "zod";
import { request } from "./http";
import type { AliasAccount, AliasClient, AliasRequest, AliasResult } from "./types";

// SimpleLogin. Self-hostable, so the base URL is configuration.
// See docs/email-aliases.md.

export const SIMPLELOGIN_DEFAULT_BASE_URL = "https://app.simplelogin.io";

/**
 * How the local part is built.
 *
 * Not a cosmetic choice. Measured, `word` lifts the site name into the address: a create for
 * `bramble-spike.example.com` returned `example.reentry351@simplelogin.com`. That is legible in
 * your own inbox and it also tells anyone who sees the address where it is used, which is a real
 * loss for a feature whose purpose is compartmentalization. `uuid` reveals nothing.
 */
export const SIMPLELOGIN_MODES = ["word", "uuid"] as const;

export type SimpleLoginMode = (typeof SIMPLELOGIN_MODES)[number];

export interface SimpleLoginConfig {
	baseUrl?: string;
	/** Omitted by default, which lets the account's own setting apply. */
	mode?: SimpleLoginMode;
}

const CreateSchema = z.object({ email: z.string() });
const UserSchema = z.object({
	email: z.string().optional(),
	is_premium: z.boolean().optional(),
});

/** `Authentication`, not `Authorization`, and the bare key with no `Bearer` prefix. Getting this
 * wrong fails as a 401 that looks exactly like a bad key. */
function headers(key: string): Record<string, string> {
	return { Authentication: key, "Content-Type": "application/json" };
}

const trimBase = (url: string) => url.replace(/\/+$/, "");

export function createSimpleLoginClient(cfg: SimpleLoginConfig, apiKey: string): AliasClient {
	const base = trimBase(cfg.baseUrl || SIMPLELOGIN_DEFAULT_BASE_URL);
	const h = headers(apiKey);

	return {
		async verify(): Promise<AliasAccount> {
			// No allowance is reported anywhere in this API, so `quota` stays undefined rather than
			// being inferred from the premium flag, which is not the same question.
			const res = await request(`${base}/api/user_info`, { headers: h }, UserSchema);
			return { label: res.email };
		},

		async create(req: AliasRequest): Promise<AliasResult> {
			const params = new URLSearchParams();
			// A query parameter, not a body field. It annotates the alias in the user's dashboard
			// and, in `word` mode, shapes the visible local part.
			if (req.site) params.set("hostname", req.site);
			if (cfg.mode) params.set("mode", cfg.mode);
			const query = params.toString();
			const res = await request(
				`${base}/api/alias/random/new${query ? `?${query}` : ""}`,
				{
					method: "POST",
					headers: h,
					body: { ...(req.description ? { note: req.description } : {}) },
				},
				CreateSchema,
			);
			return { address: res.email };
		},
	};
}
