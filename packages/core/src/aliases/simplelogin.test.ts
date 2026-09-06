import { afterEach, describe, expect, it, vi } from "vitest";
import { createSimpleLoginClient } from "./simplelogin";

afterEach(() => vi.unstubAllGlobals());

function route(handler: () => Response): { url: string; init: RequestInit }[] {
	const calls: { url: string; init: RequestInit }[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string | URL, init?: RequestInit) => {
			calls.push({ url: String(url), init: init ?? {} });
			return handler();
		}),
	);
	return calls;
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The single request the call under test made. Throws rather than returning undefined, so a
 * test that expected a request and got none fails saying so. */
function only(calls: { url: string; init: RequestInit }[]): { url: string; init: RequestInit } {
	if (calls.length !== 1) throw new Error(`expected exactly 1 request, saw ${calls.length}`);
	return calls[0] as { url: string; init: RequestInit };
}

const CREATED = { email: "example.reentry351@simplelogin.com" };

describe("createSimpleLoginClient", () => {
	it("creates an alias and returns the address", async () => {
		route(() => json(CREATED, 201));
		await expect(createSimpleLoginClient({}, "key").create({})).resolves.toEqual({
			address: "example.reentry351@simplelogin.com",
		});
	});

	// `Authentication`, not `Authorization`, and no Bearer prefix. Wrong either way, it fails as a
	// 401 indistinguishable from a bad key.
	it("authenticates with the Authentication header and a bare key", async () => {
		const calls = route(() => json(CREATED, 201));
		await createSimpleLoginClient({}, "key").create({});
		const h = only(calls).init.headers as Record<string, string>;
		expect(h.Authentication).toBe("key");
		expect(h.Authorization).toBeUndefined();
	});

	it("never sends ambient cookies and never follows redirects", async () => {
		const calls = route(() => json(CREATED, 201));
		await createSimpleLoginClient({}, "key").create({});
		expect(only(calls).init.credentials).toBe("omit");
		expect(only(calls).init.redirect).toBe("manual");
	});

	// A query parameter, not a body field, and it shapes the visible local part in word mode.
	it("passes the site as a hostname query parameter", async () => {
		const calls = route(() => json(CREATED, 201));
		await createSimpleLoginClient({}, "key").create({ site: "example.com" });
		expect(only(calls).url).toContain("hostname=example.com");
	});

	// The site is passed as given: SimpleLogin does its own reduction server-side, so doing it
	// here would need a public-suffix list in core to reach the same answer.
	it("does not reduce the hostname it is given", async () => {
		const calls = route(() => json(CREATED, 201));
		await createSimpleLoginClient({}, "key").create({ site: "accounts.example.co.uk" });
		expect(only(calls).url).toContain("hostname=accounts.example.co.uk");
	});

	it("omits mode unless one was chosen, and sends it when it was", async () => {
		const bare = route(() => json(CREATED, 201));
		await createSimpleLoginClient({}, "key").create({});
		expect(only(bare).url).not.toContain("mode=");

		const uuid = route(() => json(CREATED, 201));
		await createSimpleLoginClient({ mode: "uuid" }, "key").create({});
		expect(only(uuid).url).toContain("mode=uuid");
	});

	it("sends a description as the note", async () => {
		const calls = route(() => json(CREATED, 201));
		await createSimpleLoginClient({}, "key").create({ description: "Bramble" });
		expect(JSON.parse(only(calls).init.body as string)).toEqual({ note: "Bramble" });
	});

	// No allowance is reported anywhere in this API, and the premium flag is a different question.
	it("reports no quota, because the provider does not give one", async () => {
		route(() => json({ email: "someone@pm.me", is_premium: true }));
		await expect(createSimpleLoginClient({}, "key").verify()).resolves.toEqual({
			label: "someone@pm.me",
		});
	});
});
