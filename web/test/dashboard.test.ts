// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { dashboard } from "../src/pages/dashboard";
import { CFG, flush, root, stubFetch } from "./pagehelpers";

const ev = (name: string, block: number, args: Record<string, string>) => ({ name, block_number: block, tx_hash: "0x" + String(block).padStart(64, "0"), args });
const routes = (events: unknown[] = [], oracle: unknown[] = []) => ({
  "/api/stats": { token: { symbol: "FFUSD", decimals: 6 }, live: { poolBalance: "700000000", heldByVoucherIssuer: "300000000" }, indexed: { totalDonated: "1000000000", triggers: 1, fallbackUses: 1, totalReleased: "300000000", claims: 2, redemptions: 1, totalRedeemed: "100000000", totalReturnedToPool: "200000000" }, indexedUpTo: 42 },
  "/api/events": events,
  "/api/oracle-log": oracle,
  "/api/thresholds": { forecast: "43161", gauge: "4968", maxReadingAgeSec: "86400", vetoWindowSec: "0" },
  "/api/groups": [{ groupId: "1" }],
});

describe("dashboard page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows live pool figures read from the API", async () => {
    stubFetch(routes());
    const r = root();
    const stop = dashboard(r, CFG());
    await flush();
    expect(r.textContent).toContain("700.00 FFUSD");
    expect(r.textContent).toContain("1,000.00 FFUSD".replace(",", (1000).toLocaleString().charAt(1) || ","));
    expect(r.textContent).toMatch(/Indexed up to block 42/);
    stop();
  });

  it("builds a per-event ledger so a false alarm's real cost is visible", async () => {
    stubFetch(routes([
      ev("Expired", 5, { eventId: "9", returnedToPool: "200000000" }),
      ev("Redeemed", 4, { eventId: "9", amount: "100000000" }),
      ev("VoucherRegistered", 3, { eventId: "9" }),
      ev("EventOpened", 2, { eventId: "9", tranche: "300000000", claimAmount: "100000000", expiry: "1800000000" }),
    ]));
    const r = root();
    const stop = dashboard(r, CFG());
    await flush();
    const row = [...r.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes("9"))!;
    expect(row.textContent).toContain("300.00 FFUSD");
    expect(row.textContent).toContain("1 (100.00 FFUSD)");
    expect(row.textContent).toContain("200.00 FFUSD");
    stop();
  });

  it("announces fallback (human-confirmed gauge) use", async () => {
    stubFetch(routes([ev("FallbackUsed", 6, { eventId: "9" })]));
    const r = root();
    const stop = dashboard(r, CFG());
    await flush();
    expect(r.textContent).toMatch(/confirmed by the designated human operator/);
    stop();
  });

  it("shows an unavailable state, not invented numbers, when the API fails", async () => {
    stubFetch({});
    const r = root();
    const stop = dashboard(r, CFG());
    await flush();
    expect(r.querySelector(".err")!.textContent).toMatch(/unavailable/);
    expect(r.textContent).not.toMatch(/FFUSD/);
    stop();
  });

  it("escapes oracle log text and links transactions to the explorer", async () => {
    stubFetch(routes([ev("Deposited", 7, {})], [{ ts: 1, source: "gauge", ok: 0, value: null, detail: "<img src=x onerror=1>" }]));
    const r = root();
    const stop = dashboard(r, CFG());
    await flush();
    expect(r.querySelector("img")).toBeNull();
    expect(r.querySelector('a[href*="/tx/"]')).not.toBeNull();
    expect(r.querySelector('a[href*="/address/"]')).not.toBeNull();
    stop();
  });
});
