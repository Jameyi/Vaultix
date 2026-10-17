import jsQR from "jsqr";

// In-webview camera QR scanning via getUserMedia + jsQR (no native plugin, so it
// works with the Capacitor 8 SPM iOS project). Used for sync pairing codes and TOTP
// otpauth:// URIs. Builds a full-screen overlay imperatively so it can be driven
// from the shell adapter (which returns a Promise, not React UI). Camera is
// unavailable on the iOS simulator and on the web, so getUserMedia rejects there
// and we resolve null.

/** Open the camera and decode one QR code; returns its text, or null if denied/cancelled/unsupported. */
export async function scanQrCode(): Promise<string | null> {
	if (!navigator.mediaDevices?.getUserMedia) return null;

	let stream: MediaStream;
	try {
		stream = await navigator.mediaDevices.getUserMedia({
			video: { facingMode: "environment" },
			audio: false,
		});
	} catch {
		return null; // permission denied or no camera (e.g. simulator)
	}

	return new Promise<string | null>((resolve) => {
		const overlay = document.createElement("div");
		// Chromium 83 WebView doesn't support the `inset` shorthand (87+): use explicit
		// top/left/width/height or the overlay collapses to content size and the camera
		// preview is a broken partial frame.
		overlay.style.cssText =
			"position:fixed;top:0;left:0;width:100%;height:100%;z-index:100000;background:#000;display:flex;flex-direction:column";
		const video = document.createElement("video");
		video.playsInline = true;
		video.muted = true;
		video.autoplay = true;
		video.style.cssText = "flex:1;width:100%;min-height:0;object-fit:cover";
		video.srcObject = stream;
		const cancel = document.createElement("button");
		cancel.type = "button";
		cancel.textContent = "Cancel";
		cancel.style.cssText =
			"border:0;background:#111;color:#fff;font:600 16px system-ui;padding:16px;padding-bottom:calc(16px + env(safe-area-inset-bottom))";
		overlay.append(video, cancel);
		document.body.appendChild(overlay);

		const canvas = document.createElement("canvas");
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		let raf = 0;
		let done = false;

		const cleanup = (result: string | null) => {
			if (done) return;
			done = true;
			cancelAnimationFrame(raf);
			for (const t of stream.getTracks()) t.stop();
			overlay.remove();
			resolve(result);
		};

		cancel.onclick = () => cleanup(null);

		const tick = () => {
			if (done) return;
			if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
				// Decode at a downscaled resolution: jsQR cost scales with pixel count and
				// full-res frames from old phone cameras (8MP+) are slow to decode per frame.
				// The scale keeps long edge <= 640px, never upscales.
				const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight, 1));
				const w = Math.max(1, Math.round(video.videoWidth * scale));
				const h = Math.max(1, Math.round(video.videoHeight * scale));
				canvas.width = w;
				canvas.height = h;
				ctx.drawImage(video, 0, 0, w, h);
				const { data, width, height } = ctx.getImageData(0, 0, w, h);
				const code = jsQR(data, width, height);
				if (code?.data) {
					cleanup(code.data);
					return;
				}
			}
			raf = requestAnimationFrame(tick);
		};

		video
			.play()
			.then(() => {
				raf = requestAnimationFrame(tick);
			})
			.catch(() => cleanup(null));
	});
}
