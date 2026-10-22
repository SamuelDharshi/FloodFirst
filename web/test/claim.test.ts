// @vitest-environment jsdom
// Network and QR rendering are test doubles. Proof generation itself is exercised against real contracts by the
// services end-to-end test; here we test the page's decisions and messages.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("qrcode", () => ({ default: { toDataURL: async () => "data:image/png;base64,AAAA" } }));
vi.mock("viem", async (orig) => ({ ...(await orig<typeof import("viem")>()), createPublicClient: () => ({ readContract: async () => 0n }) }));

import { Identity } from "@semaphore-protocol/identity";
import { claim } from "../src/pages/claim";
import { CFG, flush, root, stubFetch } from "./pagehelpers";

const future = String(Math.floor(Date.now() / 1000) + 3600);
const past = String(Math.floor(Date.now() / 1000) - 3600);
const openEvent = (id: string, expiry: string) => ({ name: "EventOpened", args: { eventId: id, claimAmount: "100000000", expiry } });

async function run(code: string, routes: Record<string, unknown>) {
  stubFetch(routes);
  const r = root();
  claim(r, CFG());
  await flush();
  r.querySelector<HTMLInputElement>("#code")!.value = code;
  r.querySelector<HTMLButtonElement>("#go")!.click();
  await flush(12);
  return r;
}

describe("claim page", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("lists only open (unexpired) trigger events with the per-household amount", async () => {
    stubFetch({ "/api/events": [openEvent("1", future), openEvent("2", past)] });
    const r = root();
    claim(r, CFG());
    await flush();
    const opts = [...r.querySelectorAll("#evt option")].map((o) => o.textContent);
    expect(opts).toHaveLength(1);
    expect(opts[0]).toMatch(/Event 1 · 100\.00 FFUSD each/);
  });

  it("says plainly when no trigger event is open and refuses to claim", async () => {
    const r = await run("FF1-whatever", { "/api/events": [] });
    expect(r.querySelector("#evt")!.textContent).toMatch(/No open trigger event/);
    expect(r.querySelector("#out")!.textContent).toMatch(/No open trigger event/);
  });

  it("rejects a card code with the wrong format", async () => {
    const r = await run("not-a-card", { "/api/events": [openEvent("1", future)] });
    expect(r.querySelector("#out .err")!.textContent).toMatch(/not valid/);
  });

  it("tells the user when the card is not enrolled with any registered NGO", async () => {
    const card = "FF1-" + new Identity().export();
    const r = await run(card, { "/api/events": [openEvent("1", future)], "/api/groups/5/members": { members: ["123"] }, "/api/groups": [{ groupId: "5" }] });
    expect(r.querySelector("#out .err")!.textContent).toMatch(/not enrolled in any participating NGO group/);
  });

  it("says the server is still syncing, instead of 'not enrolled', when the index is far behind the chain", async () => {
    const card = "FF1-" + new Identity().export();
    const r = await run(card, { "/api/events": [openEvent("1", future)], "/api/groups": [], "/api/health": { head: "1000000", indexedUpTo: 900000 } });
    expect(r.querySelector("#out .err")!.textContent).toMatch(/still syncing chain history/);
  });

  it("shows vouchers saved on this device with a working QR button and never shows secrets in plain text", async () => {
    localStorage.setItem("ff.vouchers", JSON.stringify([{ voucher: { secret: "0x" + "ee".repeat(32), voucherId: "1", eventId: "7", amount: "100000000", expiry: future }, signature: "0x12" }]));
    stubFetch({ "/api/events": [] });
    const r = root();
    claim(r, CFG());
    await flush();
    expect(r.textContent).toMatch(/Event 7 · 100\.00 FFUSD/);
    expect(r.textContent).not.toContain("ee".repeat(32));
    r.querySelector<HTMLButtonElement>("button[data-i]")!.click();
    await flush();
    expect(r.querySelector("img.qr")!.getAttribute("src")).toMatch(/^data:image\/png/);
  });

  it("copies the stored voucher as text for the Merchant page, with a manual-copy fallback", async () => {
    const v = { voucher: { secret: "0x" + "ee".repeat(32), voucherId: "1", eventId: "7", amount: "100000000", expiry: future }, signature: "0x12" };
    localStorage.setItem("ff.vouchers", JSON.stringify([v]));
    stubFetch({ "/api/events": [] });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const r = root();
    claim(r, CFG());
    await flush();
    r.querySelector<HTMLButtonElement>("button[data-copy]")!.click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(v));
    expect(r.textContent).toMatch(/Voucher text copied/);
    // clipboard blocked: the text is shown for manual copying
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("denied"); } }, configurable: true });
    r.querySelector<HTMLButtonElement>("button[data-copy]")!.click();
    await flush();
    expect(r.querySelector("textarea[readonly]")!.textContent).toContain("0x" + "ee".repeat(32));
  });
});

