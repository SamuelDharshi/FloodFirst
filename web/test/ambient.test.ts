// @vitest-environment jsdom
// jsdom has no WebGL, so these verify the safe-degradation paths; the rendered scene is verified in a real browser.
import { afterEach, describe, expect, it, vi } from "vitest";
import { startAmbient } from "../src/ambient";
import { logoHtml, logoMark } from "../src/logo";

describe("ambient background", () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

  it("does nothing, and leaves no canvas behind, when WebGL is unavailable", () => {
    const stop = startAmbient();
    expect(document.getElementById("ambient")).toBeNull();
    expect(() => stop()).not.toThrow();
  });

  it("is skipped entirely for users who prefer reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const stop = startAmbient();
    expect(document.getElementById("ambient")).toBeNull();
    stop();
  });

  it("cleanup can be called more than once safely", () => {
    const stop = startAmbient();
    stop();
    expect(() => stop()).not.toThrow();
  });
});

describe("logo", () => {
  it("the standalone mark is an accessible image of the supplied artwork in a square box", () => {
    document.body.innerHTML = logoMark(40);
    const img = document.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("FloodFirst logo");
    expect(img.getAttribute("src")).toMatch(/logo-mark/);
    expect(Number(img.getAttribute("height"))).toBe(40);
    expect(Number(img.getAttribute("width"))).toBe(40); // square box
  });

  it("the lockup shows the wordmark once and hides the decorative mark from screen readers", () => {
    document.body.innerHTML = logoHtml(30);
    expect((document.body.textContent!.match(/FloodFirst/g) ?? []).length).toBe(1);
    const img = document.querySelector("img")!;
    expect(img.getAttribute("aria-hidden")).toBe("true");
    expect(img.getAttribute("alt")).toBe("");
  });

  it("scales the mark with the requested height", () => {
    const w = (h: number) => { document.body.innerHTML = logoMark(h); return Number(document.querySelector("img")!.getAttribute("width")); };
    expect(w(20)).toBeLessThan(w(60));
  });
});
