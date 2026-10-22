import { describe, expect, it } from "vitest";
import { assertChain, assertHasCode, json, makeChain, makePublicClient, makeWallet } from "../src/chain.js";
import { ADDR, KEYS, testEnv } from "./helpers.js";

describe("chain module (client stubs are test doubles)", () => {
  it("builds a chain definition from the expected chain id and RPC url", () => {
    const c = makeChain(testEnv({ EXPECTED_CHAIN_ID: "84532", RPC_URL: "https://rpc.example" }));
    expect(c.id).toBe(84532);
    expect(c.rpcUrls.default.http[0]).toBe("https://rpc.example");
  });

  it("refuses to continue when the RPC reports a different chain id", async () => {
    const env = testEnv();
    await expect(assertChain(env, { getChainId: async () => 1 } as never)).rejects.toThrow(/expected 31337/);
    await expect(assertChain(env, { getChainId: async () => 31337 } as never)).resolves.toBeUndefined();
  });

  it("detects a missing contract (no bytecode) and accepts a deployed one", async () => {
    await expect(assertHasCode({ getCode: async () => "0x" } as never, "pool", ADDR(1))).rejects.toThrow(/no bytecode/);
    await expect(assertHasCode({ getCode: async () => undefined } as never, "pool", ADDR(1))).rejects.toThrow(/no bytecode/);
    await expect(assertHasCode({ getCode: async () => "0x6080" } as never, "pool", ADDR(1))).resolves.toBeUndefined();
  });

  it("derives the signer address from a key without exposing the key", () => {
    const w = makeWallet(testEnv(), KEYS.relayer);
    expect(w.account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(JSON.stringify(w.account)).not.toContain(KEYS.relayer.slice(2));
  });

  it("serialises bigint values to strings and creates a client without network access", () => {
    expect(JSON.parse(json({ a: 12345678901234567890n }))).toEqual({ a: "12345678901234567890" });
    expect(makePublicClient(testEnv())).toBeDefined();
  });
});
