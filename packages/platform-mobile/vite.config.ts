import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { linguiMacroPlugin } from "../../scripts/vite-lingui.mjs";

// Chromium 83 (the measured Android System WebView floor) silently discards the entire
// contents of any cascade `@layer` block — which strips Tailwind v4's whole stylesheet
// on old devices: bare inputs, no borders, no colors. lightningcss (css.target below)
// downlevels colors and syntax but KEEPS @layer, so unwrap the layer shells here.
// The layer order is declared once up front and blocks appear in declaration order, so
// concatenating contents in source order preserves the cascade exactly.
function unwrapCssLayers(): Plugin {
	const unwrap = (css: string): string => {
		let out = "";
		let i = 0;
		for (;;) {
			const m = /@layer\s+[\w-]+\s*\{/.exec(css.slice(i));
			if (!m) return out + css.slice(i);
			const start = i + m.index;
			out += css.slice(i, start);
			let depth = 0;
			let j = start + m[0].length - 1;
			for (; j < css.length; j++) {
				if (css[j] === "{") depth++;
				else if (css[j] === "}") {
					depth--;
					if (depth === 0) break;
				}
			}
			out += css.slice(start + m[0].length, j); // drop the shell, keep the contents
			i = j + 1;
		}
	};
	return {
		name: "unwrap-css-layers",
		generateBundle(_, bundle) {
			for (const file of Object.values(bundle)) {
				if (file.type === "asset" && file.fileName.endsWith(".css")) {
					let css = String(file.source);
					css = css.replace(/@layer\s+[\w-]+(?:\s*,\s*[\w-]+)*\s*;/g, ""); // bare order statements
					const once = unwrap(css);
					file.source = unwrap(once); // second pass: layers nested in layers
				}
			}
		},
	};
}

// Single-page app that mounts @core's App with the mobile (Capacitor) adapters.
// webDir for Capacitor is the build output (dist).
export default defineConfig({
	plugins: [linguiMacroPlugin(), react(), tailwindcss(), unwrapCssLayers()],
	resolve: {
		alias: {
			"@core": resolve(import.meta.dirname, "../core/src"),
		},
	},
	css: {
		// lightningcss downlevels the emitted CSS to the same floor as the JS target
		// below. Tailwind v4's output relies on cascade `@layer` blocks (Chromium 99+),
		// oklch()/color-mix() colors (111+) and other modern features; an old Android
		// System WebView (measured floor: Chromium 83) silently DROPS the whole @layer
		// tree, leaving the app unstyled — bare inputs, no borders, "no" password field.
		// chrome83 unwraps the layers and compiles the colors down so every WebView that
		// can parse the JS bundle also gets full styling.
		transformer: "lightningcss",
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
		// Android System WebView on long-tail devices (HarmonyOS ships a never-updated
		// kernel, ~Chromium 70) fails to PARSE the syntax Vite's default target emits —
		// class fields land as bare `x = ...` inside class bodies — so the whole bundle
		// dies at parse time before a single line runs ("Unexpected token '='" under the
		// splash). es2017 makes esbuild transpile class fields / `?.` / `??` down while
		// keeping async/await native; every WebView Capacitor can run parses es2017.
		target: "es2017",
		cssTarget: "chrome83",
	},
});
