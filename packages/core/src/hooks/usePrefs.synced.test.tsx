// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SyncedSettings } from "../sync";
import { SyncedSettingsContext } from "./synced-settings";

// Step 3 of docs/synced-settings.md: PREF_SCOPE gains "synced", and usePrefs routes reads and
// writes through the vault's settings map for anything marked that way.
//
// What is provable HERE is only that adding the machinery changed nothing: the table has no
// synced pref yet, so the routing itself has no subject. These two guard the regression that
// would matter most if the wiring were wrong, since usePrefs backs every setting in the app.
// The routing is proven in step 4, when the alias provider becomes the first synced pref.

const PLATFORM = {
	storage: {
		getMeta: vi.fn(async () => undefined),
		setMeta: vi.fn(async () => {}),
		removeMeta: vi.fn(async () => {}),
	},
};
vi.mock("../context/PlatformContext", () => ({ usePlatform: () => PLATFORM }));
vi.mock("./useVaultRegistry", () => ({
	useVaultRegistry: () => ({ activeId: "v1", vaults: [{ id: "v1" }], ready: true }),
}));

const { PrefsProvider, usePrefs } = await import("./usePrefs");

function Harness({ prefKey }: { prefKey: "statsCollapsed" }) {
	const { prefs, update } = usePrefs();
	return (
		<button type="button" onClick={() => void update(prefKey, !prefs[prefKey])}>
			{String(prefs[prefKey])}
		</button>
	);
}

function mount(settings: SyncedSettings | undefined, set = vi.fn(async () => {})) {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<SyncedSettingsContext.Provider value={{ settings, ready: true, set }}>
			<PrefsProvider>{children}</PrefsProvider>
		</SyncedSettingsContext.Provider>
	);
	render(<Harness prefKey="statsCollapsed" />, { wrapper });
	return { set };
}

describe("usePrefs routing by scope", () => {
	// The default table has no synced prefs yet, so a device-scoped pref must be completely
	// unaffected by the machinery: it still writes to storage and ignores the vault entirely.
	it("leaves a device-scoped pref writing to storage", async () => {
		PLATFORM.storage.setMeta.mockClear();
		const { set } = mount(undefined);
		await act(async () => {
			screen.getByRole("button").click();
		});
		expect(PLATFORM.storage.setMeta).toHaveBeenCalled();
		expect(set).not.toHaveBeenCalled();
	});

	// A missing vault must not break prefs. usePrefs is mounted in hosts and tests that have no
	// vault at all, so the context falls back to a not-ready value rather than throwing.
	it("works with no synced-settings provider at all", async () => {
		PLATFORM.storage.setMeta.mockClear();
		render(
			<PrefsProvider>
				<Harness prefKey="statsCollapsed" />
			</PrefsProvider>,
		);
		await act(async () => {
			screen.getAllByRole("button")[0]?.click();
		});
		expect(PLATFORM.storage.setMeta).toHaveBeenCalled();
	});
});
