// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression tests for the Chromium 83 WebView camera scanner (scan.ts). Two live
// device bugs are pinned here:
//  1. the overlay used the `inset` CSS shorthand (Chromium 87+), which 83 silently
//     drops — position:fixed then collapses the box to content size and the camera
//     preview renders as a broken partial frame instead of full-screen;
//  2. decode ran at full camera resolution (8MP+ on old devices), making each jsQR
//     attempt slow and focus-unforgiving — decode now downsamples to <=640px long edge.
//
// jsdom has no camera/media stack, so getUserMedia is stubbed to hand back a fake
// MediaStream and the <video> element is driven manually (readyState + play).

type Tick = (cb: FrameRequestCallback) => number;
type Cleanup = (cb: number) => void;

const { rafCbs, cancelRaf, mediaDevices, track } = vi.hoisted(() => {
	const rafCbs: Map<number, FrameRequestCallback> = new Map();
	return {
		rafCbs,
		cancelRaf: vi.fn(),
		mediaDevices: {
			getUserMedia: vi.fn(),
		},
		// One stable track so the stop() assertion sees the same instance scan.ts got.
		track: { stop: vi.fn() },
	};
});
const stream = { getTracks: () => [track] };

vi.mock("jsqr", () => ({
	default: vi.fn(() => null),
}));

function installDom() {
	document.body.innerHTML = "";

	let nextId = 1;
	vi.stubGlobal("requestAnimationFrame", ((cb: FrameRequestCallback) => {
		const id = nextId++;
		rafCbs.set(id, cb);
		return id;
	}) as Tick);
	vi.stubGlobal("cancelAnimationFrame", cancelRaf as Cleanup);

	vi.stubGlobal(
		"navigator",
		Object.create(Object.getPrototypeOf(navigator), {
			mediaDevices: { value: mediaDevices, configurable: true },
		}),
	);
}

/** Run one scheduled animation-frame tick (the decode loop). */
function runRaf() {
	for (const [id, cb] of [...rafCbs]) {
		rafCbs.delete(id);
		cb(performance.now());
	}
}

/** Flush the microtask chain (getUserMedia → promise body → play().then → raf schedule). */
async function flushSetup() {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

/**
 * Mount a <video> in the DOM whose canvas draws report controlled dimensions, so
 * the downsample math can be asserted via drawImage/getImageData call args.
 * jsdom's canvas has no 2d context, so it is stubbed.
 */
function stubVideo(videoWidth: number, videoHeight: number) {
	const drawImage = vi.fn();
	const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }));
	const ctx = { drawImage, getImageData } as unknown as CanvasRenderingContext2D;

	const origCreateElement = document.createElement.bind(document);
	vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
		const el = origCreateElement(tag);
		if (tag === "video") {
			const video = el as HTMLVideoElement;
			Object.defineProperty(video, "videoWidth", { value: videoWidth });
			Object.defineProperty(video, "videoHeight", { value: videoHeight });
			Object.defineProperty(video, "readyState", { value: 4 }); // HAVE_ENOUGH_DATA
			video.play = vi.fn(() => Promise.resolve());
		}
		if (tag === "canvas") {
			vi.spyOn(el as HTMLCanvasElement, "getContext").mockReturnValue(ctx);
		}
		return el;
	}) as typeof document.createElement);

	return { drawImage, getImageData };
}

beforeEach(() => {
	vi.clearAllMocks();
	rafCbs.clear();
	installDom();
	mediaDevices.getUserMedia.mockResolvedValue(stream);
});

afterEach(() => {
	// Restore createElement/getContext spies so they are never wrapped twice
	// (double-wrapping recurses into itself → stack overflow).
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.body.innerHTML = "";
});

describe("scanQrCode", () => {
	it("builds a FULL-SCREEN overlay with explicit top/left/width/height — not `inset`", async () => {
		// Chromium 83 drops `inset` (87+), collapsing the fixed overlay to content size.
		const { scanQrCode } = await import("./scan");
		stubVideo(640, 480);

		const p = scanQrCode();
		await flushSetup();

		const overlay = document.body.querySelector("div");
		expect(overlay).not.toBeNull();
		// Assert via style properties (jsdom normalizes cssText: spacing + units).
		const s = overlay!.style;
		expect(s.position).toBe("fixed");
		expect(s.top).toBe("0px");
		expect(s.left).toBe("0px");
		expect(s.width).toBe("100%");
		expect(s.height).toBe("100%");
		// The whole point: `inset` was silently dropped on Chromium 83 (87+ only).
		expect(s.getPropertyValue("inset")).toBe("");

		// Cleanup: cancel out of the loop.
		const cancel = overlay!.querySelector("button")!;
		cancel.click();
		await p;
	});

	it("downsamples the decode canvas to a 640px long edge (full-res decode is too slow on old devices)", async () => {
		const { scanQrCode } = await import("./scan");
		// 8MP-ish landscape camera frame, typical of old phone back cameras.
		const { drawImage, getImageData } = stubVideo(3264, 2448);

		const p = scanQrCode();
		await flushSetup();
		runRaf(); // one decode tick

		const expectedW = Math.round(3264 * (640 / 3264));
		const expectedH = Math.round(2448 * (640 / 3264));
		expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, expectedW, expectedH);
		expect(getImageData).toHaveBeenCalledWith(0, 0, expectedW, expectedH);

		// Cleanup.
		const overlay = document.body.querySelector("div")!;
		(overlay.querySelector("button") as HTMLButtonElement).click();
		await p;
	});

	it("never upscales small frames (long edge <= 640 passes through unchanged)", async () => {
		const { scanQrCode } = await import("./scan");
		const { drawImage } = stubVideo(320, 240);

		const p = scanQrCode();
		await flushSetup();
		runRaf();

		expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 320, 240);

		const overlay = document.body.querySelector("div")!;
		(overlay.querySelector("button") as HTMLButtonElement).click();
		await p;
	});

	it("resolves null and stops tracks when the user cancels", async () => {
		const { scanQrCode } = await import("./scan");
		stubVideo(640, 480); // jsdom's play() returns undefined; the stub provides a promise
		const p = scanQrCode();
		await flushSetup();

		const overlay = document.body.querySelector("div")!;
		(overlay.querySelector("button") as HTMLButtonElement).click();
		await expect(p).resolves.toBeNull();
		expect(track.stop).toHaveBeenCalled();
	});

	it("resolves null when getUserMedia is denied instead of throwing", async () => {
		const { scanQrCode } = await import("./scan");
		mediaDevices.getUserMedia.mockRejectedValue(new Error("denied"));
		await expect(scanQrCode()).resolves.toBeNull();
	});
});
