// @vitest-environment jsdom
// Vouchers are signed with a TEST key; the app is configured to trust that test key as "the signer".
import { bytesToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { merchant } from "../src/pages/merchant";
import { VOUCHER_TYPES, voucherIdOf } from "../src/voucher";
import { ADDR, CFG, flush, root, stubFetch } from "./pagehelpers";

const signer = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
const cfg = CFG({ voucherSigner: signer.address });
const PAY = ADDR(0x77);

async function voucher(n: number, expiry = 4_000_000_000n, acct = signer) {
  const secret = bytesToHex(new Uint8Array(32).fill(n));
  const message = { voucherId: voucherIdOf(secret), eventId: 3n, amount: 100_000_000n, expiry };
  const signature = await acct.signTypedData({ domain: { name: "FloodFirstVoucher", version: "1", chainId: 84532, verifyingContract: ADDR(3) }, types: VOUCHER_TYPES, primaryType: "Voucher", message });
  return JSON.stringify({ voucher: { secret, voucherId: message.voucherId.toString(), eventId: "3", amount: "100000000", expiry: expiry.toString() }, signature });
}
const setup = () => {
  const r = root();
  const stop = merchant(r, cfg);
  const q = <T extends HTMLElement>(s: string) => r.querySelector<T>(s)!;
  return { r, stop, q };
};
const accept = async (q: ReturnType<typeof setup>["q"], text: string, pay = PAY) => {
  q<HTMLInputElement>("#pay").value = pay;
  q<HTMLTextAreaElement>("#v").value = text;
  q<HTMLButtonElement>("#acc").click();
  await flush();
};

describe("merchant page", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("warns that offline checking needs a first online visit when no settings are saved", () => {
    const r = root();
    merchant(r, null)();
    expect(r.querySelector(".err")!.textContent).toMatch(/no saved settings/);
  });

  it("requires a valid payout address before accepting anything", async () => {
    const { q } = setup();
    await accept(q, await voucher(1), "0x123");
    expect(q("#res").textContent).toMatch(/valid payout address/);
    expect(localStorage.getItem("ff.merchant.queue")).toBeNull();
  });

  it("accepts a valid voucher entirely offline (no network call) and queues it unpaid", async () => {
    const f = stubFetch({});
    const { q, r } = setup();
    await accept(q, await voucher(1));
    expect(q("#res").textContent).toMatch(/Valid voucher for 100\.00 FFUSD/);
    expect(r.textContent).toMatch(/waiting to sync \(not paid yet\)/);
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects forged, expired and duplicate vouchers", async () => {
    const { q } = setup();
    const other = privateKeyToAccount("0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356");
    await accept(q, await voucher(2, 4_000_000_000n, other));
    expect(q("#res").textContent).toMatch(/not from the FloodFirst voucher signer/);
    await accept(q, await voucher(3, 100n));
    expect(q("#res").textContent).toMatch(/expired/);
    const good = await voucher(4);
    await accept(q, good);
    await accept(q, good);
    expect(q("#res").textContent).toMatch(/already accepted/);
  });

  it("sync marks a voucher paid only when the chain confirms, rejected on a contract error, queued if unreachable", async () => {
    const { q, r } = setup();
    await accept(q, await voucher(5));
    await accept(q, await voucher(6));
    await accept(q, await voucher(7));
    const secrets = [5, 6, 7].map((n) => bytesToHex(new Uint8Array(32).fill(n)));
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const s = JSON.parse(String(init.body)).voucherSecret;
      if (s === secrets[0]) return new Response(JSON.stringify({ status: "confirmed", txHash: "0x" + "12".repeat(32) }), { status: 200 });
      if (s === secrets[1]) return new Response(JSON.stringify({ error: "AlreadyRedeemed" }), { status: 422 });
      throw new TypeError("offline");
    }));
    q<HTMLButtonElement>("#sync").click();
    await flush(12);
    const text = r.textContent!;
    expect(text).toMatch(/Paid on chain/);
    expect(text).toMatch(/Rejected by chain: AlreadyRedeemed/);
    expect(text).toMatch(/waiting to sync/);
    expect(q("#syncRes").textContent).toMatch(/Paid on chain: 1\. Rejected: 1\. Still waiting.*: 1/);
    const stored = JSON.parse(localStorage.getItem("ff.merchant.queue")!);
    expect(stored.map((i: { status: string }) => i.status)).toEqual(["synced", "rejected", "queued"]);
  });

  it("explains when a household card is pasted instead of a voucher, and when nothing is pasted", async () => {
    const { q } = setup();
    await accept(q, "FF1-YDoggNn5wlqvNEl8XVivnudPg5Od1p0EB6m4Cot+8T4=");
    expect(q("#res").textContent).toMatch(/household card, not a voucher/);
    await accept(q, "");
    expect(q("#res").textContent).toMatch(/Paste the voucher text/);
    expect(localStorage.getItem("ff.merchant.queue")).toBeNull();
  });
});

