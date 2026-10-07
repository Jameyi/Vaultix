import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { linguiMacroPlugin } from "../../scripts/vite-lingui.mjs";

// Single-page app that mounts @core's App with the mobile (Capacitor) adapters.
// webDir for Capacitor is the build output (dist).
export default defineConfig({
	plugins: [linguiMacroPlugin(), react(), tailwindcss()],
	resolve: {
		alias: {
			"@core": resolve(import.meta.dirname, "../core/src"),
		},
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
	},
});
