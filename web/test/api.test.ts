// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getJson, loadConfig, normalizeBase, postJson } from "../src/api";

const cfg = { chainId: 84532, rpcUrl: "https://rpc", deployment: {}, voucherSigner: "0x" + "1".repeat(40), gaugeMode: "operator", knownLimits: ["a"], labels: {} };
const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("api module (fetch is a test double)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("loads config online and caches it for offline use", async () => {
    vi.stubGlobal("fetch", ok(cfg));
    const r = await loadConfig();
    expect(r.fromCache).toBe(false);
    expect(r.cfg?.chainId).toBe(84532);
    expect(localStorage.getItem("ff.config")).toContain("84532");
  });

  it("falls back to the cached config when the network is down", async () => {
    vi.stubGlobal("fetch", ok(cfg));
    await loadConfig();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    const r = await loadConfig();
    expect(r.fromCache).toBe(true);
    expect(r.cfg?.voucherSigner).toBe(cfg.voucherSigner);
    expect(r.error).toMatch(/offline/);
  });

  it("returns null config and an error when offline with nothing cached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    const r = await loadConfig();
    expect(r.cfg).toBeNull();
    expect(r.fromCache).toBe(false);
  });

  it("getJson throws on HTTP errors rather than returning fake data", async () => {
    vi.stubGlobal("fetch", ok({}, 500));
    await expect(getJson("/api/stats")).rejects.toThrow(/HTTP 500/);
  });

  it("postJson sends JSON and returns status and body for non-200 too", async () => {
    const f = ok({ error: "NullifierAlreadyUsed" }, 422);
    vi.stubGlobal("fetch", f);
    const r = await postJson<{ error: string }>("/api/claim", { a: 1 });
    expect(r).toEqual({ status: 422, data: { error: "NullifierAlreadyUsed" } });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
  });

  it("normalises the API base URL: trailing slashes and spaces are removed, empty means same origin", () => {
    expect(normalizeBase("https://floodfirst-api.onrender.com/")).toBe("https://floodfirst-api.onrender.com");
    expect(normalizeBase("  https://x.example///  ")).toBe("https://x.example");
    expect(normalizeBase("https://x.example")).toBe("https://x.example");
    expect(normalizeBase(undefined)).toBe("");
    expect(normalizeBase("")).toBe("");
  });
});

