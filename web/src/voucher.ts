import { keccak256, recoverTypedDataAddress, type Hex } from "viem";

export interface Voucher {
  secret: Hex;
  voucherId: string;
  eventId: string;
  amount: string;
  expiry: string;
}
export interface SignedVoucher {
  voucher: Voucher;
  signature: Hex;
}

export const VOUCHER_TYPES = {
  Voucher: [
    { name: "voucherId", type: "uint256" },
    { name: "eventId", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

export const voucherIdOf = (secret: Hex): bigint => BigInt(keccak256(secret)) >> 8n;

export type VerifyResult = { ok: true; voucher: Voucher } | { ok: false; reason: string };

/**
 * Fully offline voucher check. Uses only the voucher data and the config cached from an earlier online visit:
 *  1. the secret hashes to the signed voucher id,
 *  2. the EIP-712 signature recovers to the CACHED voucher-signer address (never the address inside the voucher),
 *  3. the voucher has not expired by the local clock.
 * It cannot know if the voucher was already redeemed elsewhere; the chain decides that at sync time.
 */
export async function verifyVoucherOffline(
  raw: string,
  cfg: { chainId: number; issuer: Hex; voucherSigner: Hex },
  nowSec = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  let sv: SignedVoucher;
  try {
    sv = JSON.parse(raw) as SignedVoucher;
  } catch {
    return { ok: false, reason: "not valid voucher data" };
  }
  const v = sv?.voucher;
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v.secret) || !/^0x[0-9a-fA-F]+$/.test(sv.signature ?? "")) {
    return { ok: false, reason: "malformed voucher" };
  }
  try {
    if (voucherIdOf(v.secret).toString() !== v.voucherId) return { ok: false, reason: "secret does not match the signed voucher id" };
    const signer = await recoverTypedDataAddress({
      domain: { name: "FloodFirstVoucher", version: "1", chainId: cfg.chainId, verifyingContract: cfg.issuer },
      types: VOUCHER_TYPES,
      primaryType: "Voucher",
      message: { voucherId: BigInt(v.voucherId), eventId: BigInt(v.eventId), amount: BigInt(v.amount), expiry: BigInt(v.expiry) },
      signature: sv.signature,
    });
    if (signer.toLowerCase() !== cfg.voucherSigner.toLowerCase()) return { ok: false, reason: "signature is not from the FloodFirst voucher signer" };
  } catch {
    return { ok: false, reason: "signature could not be verified" };
  }
  if (BigInt(v.expiry) < BigInt(nowSec)) return { ok: false, reason: "voucher has expired" };
  return { ok: true, voucher: v };
}
