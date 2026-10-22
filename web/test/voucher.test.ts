// Tests the offline voucher check with a voucher signed locally by a TEST key (test data, not a real signer).
import { bytesToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { VOUCHER_TYPES, verifyVoucherOffline, voucherIdOf } from "../src/voucher";

const signer = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
const other = privateKeyToAccount("0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356");
const issuer = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Hex;
const cfg = { chainId: 31337, issuer, voucherSigner: signer.address };
const secret = bytesToHex(new Uint8Array(32).fill(7));

async function make(acct = signer, expiry = 2_000_000_000n, id = voucherIdOf(secret)) {
  const message = { voucherId: id, eventId: 5n, amount: 100_000_000n, expiry };
  const signature = await acct.signTypedData({ domain: { name: "FloodFirstVoucher", version: "1", chainId: 31337, verifyingContract: issuer }, types: VOUCHER_TYPES, primaryType: "Voucher", message });
  return JSON.stringify({ voucher: { secret, voucherId: id.toString(), eventId: "5", amount: "100000000", expiry: expiry.toString() }, signature });
}

describe("offline voucher verification", () => {
  it("accepts a valid voucher without any network access", async () => {
    expect((await verifyVoucherOffline(await make(), cfg, 1_900_000_000)).ok).toBe(true);
  });
  it("rejects a voucher signed by someone else", async () => {
    const r = await verifyVoucherOffline(await make(other), cfg, 1);
    expect(r).toEqual({ ok: false, reason: "signature is not from the FloodFirst voucher signer" });
  });
  it("rejects expired vouchers", async () => {
    const r = await verifyVoucherOffline(await make(signer, 100n), cfg, 200);
    expect(r).toEqual({ ok: false, reason: "voucher has expired" });
  });
  it("rejects a secret that does not match the signed id", async () => {
    const r = await verifyVoucherOffline(await make(signer, 2_000_000_000n, 123n), cfg, 1);
    expect(r.ok).toBe(false);
  });
  it("rejects tampered amounts and garbage", async () => {
    const t = JSON.parse(await make());
    t.voucher.amount = "999999999999";
    expect((await verifyVoucherOffline(JSON.stringify(t), cfg, 1)).ok).toBe(false);
    expect((await verifyVoucherOffline("nonsense", cfg, 1)).ok).toBe(false);
  });
});
