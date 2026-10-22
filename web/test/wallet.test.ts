// @vitest-environment jsdom
// The chain client and wallet provider are TEST DOUBLES; this verifies the transaction lifecycle logic.
import { beforeEach, describe, expect, it, vi } from "vitest";

const pubState = { receipt: { status: "success" } as { status: string } | Error };
vi.mock("viem", async (orig) => {
  const real = await orig<typeof import("viem")>();
  return {
    ...real,
    createPublicClient: () => ({
      waitForTransactionReceipt: async () => { if (pubState.receipt instanceof Error) throw pubState.receipt; return pubState.receipt; },
    }),
  };
});

import { connect, disconnect, phaseText, refresh, runTx, wallet, type TxProgress } from "../src/wallet";

const cfg = { chainId: 84532, rpcUrl: "http://rpc.invalid", deployment: {}, voucherSigner: null, gaugeMode: "operator", knownLimits: [], labels: {} } as never;
const HASH = ("0x" + "ab".repeat(32)) as `0x${string}`;
const phases = () => { const p: TxProgress[] = []; return { p, cb: (x: TxProgress) => p.push(x) }; };

beforeEach(() => {
  pubState.receipt = { status: "success" };
  wallet.address = "0x" + "1".repeat(40) as `0x${string}`;
  wallet.wrongChain = false;
  wallet.client = {} as never;
});

describe("wallet module", () => {
  it("walks wallet → submitted → pending → confirmed → verified only after the postcondition passes", async () => {
    const { p, cb } = phases();
    const verify = vi.fn(async () => {});
    await runTx(cfg, async () => HASH, verify, cb);
    expect(p.map((x) => x.phase)).toEqual(["wallet", "submitted", "pending", "confirmed", "verified"]);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("never reports success for a reverted transaction and skips verification", async () => {
    pubState.receipt = { status: "reverted" };
    const { p, cb } = phases();
    const verify = vi.fn();
    await runTx(cfg, async () => HASH, verify, cb);
    expect(p.at(-1)!.phase).toBe("reverted");
    expect(p.some((x) => x.phase === "verified")).toBe(false);
    expect(verify).not.toHaveBeenCalled();
  });

  it("a successful receipt with a failed postcondition is 'failed', not verified", async () => {
    const { p, cb } = phases();
    await runTx(cfg, async () => HASH, async () => { throw new Error("pool accounting mismatch"); }, cb);
    expect(p.at(-1)).toMatchObject({ phase: "failed", error: "pool accounting mismatch", hash: HASH });
    expect(p.some((x) => x.phase === "verified")).toBe(false);
  });

  it("reports a wallet rejection as 'rejected' and sends nothing", async () => {
    const { p, cb } = phases();
    await runTx(cfg, async () => { throw Object.assign(new Error("User rejected the request."), { code: 4001 }); }, vi.fn(), cb);
    expect(p.map((x) => x.phase)).toEqual(["wallet", "rejected"]);
    expect(p.at(-1)!.hash).toBeUndefined();
  });

  it("refuses without a connected wallet or on the wrong network", async () => {
    let r = phases();
    wallet.client = null;
    await runTx(cfg, async () => HASH, vi.fn(), r.cb);
    expect(r.p[0]).toMatchObject({ phase: "failed", error: "Connect a wallet first" });
    wallet.client = {} as never;
    wallet.wrongChain = true;
    r = phases();
    const send = vi.fn(async () => HASH);
    await runTx(cfg, send, vi.fn(), r.cb);
    expect(r.p[0]!.error).toMatch(/Wrong network/);
    expect(send).not.toHaveBeenCalled();
  });

  it("connect() explains when no browser wallet exists, and every phase has user text", async () => {
    await expect(connect(cfg)).rejects.toThrow(/No browser wallet/);
    for (const k of ["wallet", "submitted", "pending", "confirmed", "verified", "reverted", "rejected", "failed"] as const) {
      expect(phaseText[k].length).toBeGreaterThan(3);
    }
  });

  it("disconnect forgets the wallet, asks the wallet to revoke access, and stays disconnected after a refresh", async () => {
    const calls: string[] = [];
    window.ethereum = {
      request: async ({ method }: { method: string }) => {
        calls.push(method);
        if (method === "eth_accounts") return ["0x" + "1".repeat(40)];
        if (method === "eth_chainId") return "0x14a34";
        return null;
      },
    } as never;
    await disconnect();
    expect(calls).toContain("wallet_revokePermissions");
    expect(wallet.address).toBeNull();
    expect(wallet.client).toBeNull();
    await refresh(cfg); // the extension still lists the account, but the user chose to disconnect
    expect(wallet.address).toBeNull();
    await connect(cfg); // explicit Connect clears the choice
    expect(wallet.address).toBe("0x" + "1".repeat(40));
    delete (window as { ethereum?: unknown }).ethereum;
    localStorage.clear();
  });

  it("disconnect still works when the wallet cannot revoke permissions", async () => {
    window.ethereum = { request: async () => { throw new Error("method not supported"); } } as never;
    wallet.address = "0x" + "2".repeat(40) as `0x${string}`;
    await expect(disconnect()).resolves.toBeUndefined();
    expect(wallet.address).toBeNull();
    delete (window as { ethereum?: unknown }).ethereum;
    localStorage.clear();
  });
});

