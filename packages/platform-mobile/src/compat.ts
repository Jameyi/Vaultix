// Runtime polyfills for old Android System WebViews that never update. Measured floor
// (2026-10-07, user device): Chromium 83. `build.target: "es2017"` in vite.config.ts
// lowers SYNTAX, but three APIs the bundle calls are RUNTIME features 83 lacks — each
// would throw only when its call site first runs, not at boot. This file is imported
// FIRST in main.tsx, before any other module can execute. Drop an entry when the
// project's WebView floor moves past the version noted on it.

// Array.prototype.at / String.prototype.at (Chromium 92). The bundle only ever calls
// `.at(-1)` on arrays.
function at<T>(this: ArrayLike<T>, index: number): T | undefined {
	const i = index < 0 ? this.length + index : index;
	return i >= 0 && i < this.length ? this[i] : undefined;
}
if (!Array.prototype.at) (Array.prototype as unknown as { at: typeof at }).at = at;
if (!String.prototype.at) (String.prototype as unknown as { at: typeof at }).at = at;

// String.prototype.replaceAll (Chromium 85). Route through a global regex so `$`
// replacement patterns behave like the native; a non-global RegExp throws, as specced.
if (!String.prototype.replaceAll) {
	(
		String.prototype as unknown as {
			replaceAll: (search: string | RegExp, replace: string) => string;
		}
	).replaceAll = function (this: string, search: string | RegExp, replace: string) {
		if (search instanceof RegExp) {
			if (!search.global) {
				throw new TypeError("String.prototype.replaceAll called with a non-global RegExp argument");
			}
			return this.replace(search, replace);
		}
		return this.replace(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), replace);
	};
}

// crypto.randomUUID (Chromium 92) — entry IDs, registry IDs, sync device IDs.
// getRandomValues itself is ancient, so a v4 built from it is sound.
if (typeof crypto !== "undefined" && !crypto.randomUUID) {
	(crypto as unknown as { randomUUID: () => string }).randomUUID = () => {
		const bytes = crypto.getRandomValues(new Uint8Array(16));
		bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
		bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10xx
		const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	};
}
