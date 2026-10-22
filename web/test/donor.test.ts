// @vitest-environment jsdom
// The chain client is a test double returning controlled balances/allowances.
import { beforeEach, describe, expect, it, vi } from "vitest";

const chain = { balanceOf: 10_000_000n, allowance: 0n, donated: 0n };
vi.mock("viem", async (orig) => ({
  ...(await orig<typeof import("viem")>()),
  createPublicClient: () => ({ readContract: async ({ functionName }: { functionName: keyof typeof chain }) => chain[functionName] }),
}));

import { donor } from "../src/pages/donor";
import { wallet } from "../src/wallet";
import { ADDR, CFG, flush, root } from "./pagehelpers";

const setup = async () => {
  const r = root();
  donor(r, CFG());
  await flush();
  const q = <T extends HTMLElement>(s: string) => r.querySelector<T>(s)!;
  return { r, q };
};

describe("donor page", () => {
  beforeEach(() => {
    Object.assign(chain, { balanceOf: 10_000_000n, allowance: 0n, donated: 0n });
    wallet.address = ADDR(0xabc);
    wallet.wrongChain = false;
    wallet.client = {} as never;
  });

  it("shows the connected wallet's real balance, allowance and donations", async () => {
    chain.balanceOf = 25_500_000n;
    const { q } = await setup();
    expect(q("#bal").textContent).toMatch(/Your balance: 25\.50 FFUSD/);
    expect(q("#bal").textContent).toMatch(/approved to pool: 0\.00/);
  });

  it("blocks a deposit that would exceed the balance and tells the user to get test tokens", async () => {
    chain.balanceOf = 1_000_000n; // 1 FFUSD, default amount is 10
    const { q } = await setup();
    q<HTMLButtonElement>("#dep").click();
    await flush();
    expect(q("#tx").textContent).toMatch(/You only have 1\.00 FFUSD/);
    expect(q("#tx").textContent).toMatch(/mint test tokens/);
  });

  it("blocks a deposit that has not been approved and points at the Approve button", async () => {
    const { q } = await setup();
    q<HTMLButtonElement>("#dep").click();
    await flush();
    expect(q("#tx").textContent).toMatch(/Not approved yet/);
  });

  it("rejects empty, zero and invalid amounts before touching the wallet", async () => {
    const { q } = await setup();
    for (const v of ["", "0", "abc", "-5"]) {
      q<HTMLInputElement>("#amt").value = v;
      q<HTMLButtonElement>("#dep").click();
      await flush();
      expect(q("#tx").textContent).toMatch(/Enter a positive amount/);
    }
  });

  it("asks to connect a wallet when none is connected, and shows an error without configuration", async () => {
    wallet.address = null;
    const { q, r } = await setup();
    expect(r.textContent).toMatch(/Connect your wallet/);
    q<HTMLButtonElement>("#appr").click();
    await flush();
    expect(q("#tx").textContent).toMatch(/Connect your wallet first/);
    const r2 = root();
    donor(r2, null);
    expect(r2.querySelector(".err")).not.toBeNull();
  });
});
