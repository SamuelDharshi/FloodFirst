// @vitest-environment jsdom
// The WebGL/GSAP effects layer is mocked out here (jsdom has no WebGL); it is verified in a real browser separately.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fxUpdate = vi.hoisted(() => vi.fn());
vi.mock("../src/pages/landing-fx", () => ({ startFx: () => ({ stop: () => {}, update: fxUpdate }) }));

import { landing } from "../src/pages/landing";
import { CFG, flush, root, stubFetch } from "./pagehelpers";

const stats = { token: { symbol: "FFUSD", decimals: 6 }, live: { poolBalance: "700000000", heldByVoucherIssuer: "300000000" }, indexed: { totalDonated: "1000000000", triggers: 1, claims: 2, redemptions: 1, totalReturnedToPool: "200000000" } };

describe("landing page", () => {
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); fxUpdate.mockClear(); });
  afterEach(() => vi.unstubAllGlobals());

  it("has the sections of the one-pager: nav, hero, how it works, demo, benefits, highlights, roadmap, FAQ, footer", async () => {
    stubFetch({ "/api/stats": stats });
    const r = root();
    const stop = landing(r, CFG());
    await flush();
    for (const sel of [".lp-nav", ".lp-hero", "#why", ".lp-prob", "#how", "#demo", "#benefits", "#highlights", "#roadmap", "#faq", ".lp-foot", ".lp-marquee"]) {
      expect(r.querySelector(sel), sel).not.toBeNull();
    }
    expect(r.querySelectorAll(".step")).toHaveLength(4);
    expect(r.querySelectorAll(".benefit")).toHaveLength(6);
    expect(r.querySelectorAll(".scene")).toHaveLength(5);
    stop();
  });

  it("splits the headline into per-character spans yet keeps it readable to assistive tech", async () => {
    stubFetch({ "/api/stats": stats });
    const r = root();
    const stop = landing(r, CFG());
    await flush();
    const h1 = r.querySelector("h1")!;
    expect(h1.getAttribute("aria-label")).toBe("We pay before the flood");
    expect(h1.querySelectorAll(".ch").length).toBeGreaterThan(15);
    expect(h1.textContent!.replace(/\s/g, "").toLowerCase()).toBe("wepaybeforetheflood");
    stop();
  });

  it("shows live numbers read from the API, and an unavailable state (no invented figures) when it is down", async () => {
    stubFetch({ "/api/stats": stats });
    let r = root();
    let stop = landing(r, CFG());
    await flush();
    expect(r.querySelector("#lp-live")!.textContent).toMatch(/pool holds 700\.00 FFUSD/);
    expect(r.querySelector("#lp-stats")!.textContent).toMatch(/Held as live vouchers/);
    stop();
    stubFetch({});
    r = root();
    stop = landing(r, CFG());
    await flush();
    expect(r.querySelector("#lp-live")!.textContent).toMatch(/unavailable/);
    expect(r.querySelector("#lp-stats")!.textContent).not.toMatch(/FFUSD/);
    stop();
  });

  it("is honest about limits and status, labels the demo as an illustration, and has no fake sign-up form", async () => {
    stubFetch({ "/api/stats": stats });
    const r = root();
    const stop = landing(r, CFG());
    await flush();
    const text = r.textContent!;
    expect(text).toMatch(/does not prove one person, one household/);
    expect(text).toMatch(/Testnet only/);
    expect(text).toMatch(/No NGO partner exists yet/i);
    expect(text).toMatch(/illustration of the real flow, not live data/i);
    expect(r.querySelector("input, form")).toBeNull();
    stop();
  });

  it("FAQ is an accessible accordion that opens and closes", async () => {
    stubFetch({ "/api/stats": stats });
    const r = root();
    const stop = landing(r, CFG());
    await flush();
    const q = r.querySelector<HTMLButtonElement>(".faq-q")!;
    expect(q.getAttribute("aria-expanded")).toBe("false");
    q.click();
    expect(q.getAttribute("aria-expanded")).toBe("true");
    expect(q.closest(".faq-item")!.classList.contains("open")).toBe(true);
    expect(document.getElementById(q.getAttribute("aria-controls")!)).not.toBeNull();
    q.click();
    expect(q.getAttribute("aria-expanded")).toBe("false");
    stop();
  });

  it("nav buttons scroll to sections, CTAs link into the app, and contract links come from the deployment", async () => {
    stubFetch({ "/api/stats": stats });
    const r = root();
    const stop = landing(r, CFG());
    await flush();
    r.querySelector<HTMLButtonElement>('button[data-scroll="faq"]')!.click();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    const hrefs = [...r.querySelectorAll("a.lp-pill, a.lp-ghost")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["#/dashboard", "#/agent", "#/donate", "#/merchant"]));
    expect(r.querySelectorAll('a[href*="/address/"]')).toHaveLength(5);
    stop();
    const r2 = root();
    const stop2 = landing(r2, null);
    await flush();
    expect(r2.querySelector('a[href*="/address/"]')).toBeNull();
    stop2();
  });

  it("feeds the 3D scene only real values: pool share and signal-to-threshold ratios", async () => {
    stubFetch({
      "/api/stats": stats,
      "/api/thresholds": { forecast: "40000", gauge: "5000" },
      "/api/oracle-log": [{ source: "gauge-operator", ok: 1, value: "4000" }, { source: "forecast", ok: 1, value: "50000" }, { source: "forecast", ok: 0, value: null }],
    });
    const r = root();
    const stop = landing(r, CFG());
    await flush(12);
    const last = fxUpdate.mock.calls.at(-1)![0];
    expect(last.poolFraction).toBeCloseTo(0.7); // 700 pool / (700 + 300 held)
    expect(last.forecastRatio).toBeCloseTo(1.25);
    expect(last.gaugeRatio).toBeCloseTo(0.8);
    stop();
  });

  it("with no data the scene gets no invented values and no readout panel exists", async () => {
    stubFetch({});
    const r = root();
    const stop = landing(r, CFG());
    await flush(12);
    expect(r.querySelector(".lp-hud, #hud-pool")).toBeNull();
    for (const c of fxUpdate.mock.calls) expect(c[0]).toEqual({});
    stop();
  });

  it("uses the supplied images with real alt text in a duotone frame and no captions on the large ones", async () => {
    stubFetch({ "/api/stats": stats });
    const r = root();
    const stop = landing(r, CFG());
    await flush();
    const imgs = [...r.querySelectorAll<HTMLImageElement>(".duo img")];
    expect(imgs).toHaveLength(5); // 2 in Why, 3 in Problems
    expect(r.querySelectorAll(".prob figcaption")).toHaveLength(0); // no captions on the problem cards
    for (const i of imgs) {
      expect(i.getAttribute("alt")!.length).toBeGreaterThan(15);
      expect(i.getAttribute("loading")).toBe("lazy");
      expect(i.closest(".duo-frame")).not.toBeNull();
    }
    // the two large images in the Why section carry no caption text
    expect(r.querySelectorAll(".why-art figcaption")).toHaveLength(0);
    expect(r.querySelector('button[data-scroll="why"]')).not.toBeNull();
    stop();
  });
});
