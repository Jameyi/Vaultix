import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
	appId: "app.vautix.mobile",
	appName: "Vautix",
	webDir: "dist",
	// Default schemes serve from a secure-context localhost origin (capacitor://localhost
	// on iOS, https://localhost on Android), so WebCrypto and WASM work.
	plugins: {
		// Boot is async (storage -> version -> locale before the first render), so let the
		// native splash stay up until main.tsx calls SplashScreen.hide() after first paint.
		// Without this, the launch screen vanishes the instant the WebView attaches and a
		// blank white WebView shows during boot (the "white flash"). Background is the
		// splash image's black so the fade is seamless.
		SplashScreen: {
			// launchAutoHide + a long launchShowDuration is the native fallback: a healthy
			// web bundle still hides the splash at first paint via the explicit hide() in
			// main.tsx (that call works regardless of this setting), but a boot that dies
			// clears the splash after 10s instead of sticking forever — revealing the
			// index.html error overlay or, at worst, a dead WebView rather than a frozen
			// launch screen. Keep the duration long enough that slow devices never flash.
			launchAutoHide: true,
			launchShowDuration: 10000,
			backgroundColor: "#000000",
			androidScaleType: "CENTER_CROP",
			splashFullScreen: true,
			splashImmersive: true,
		},
	},
};

export default config;
