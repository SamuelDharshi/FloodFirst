// @vitest-environment jsdom
// Wallet/chain/network are test doubles. The Semaphore identity generation is the real library.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("qrcode", () => ({ default: { toDataURL: async () => "data:image/png;base64,AAAA" } }));
vi.mock("viem", async (orig) => ({ ...(await orig<typeof import("viem")>()), createPublicClient: () => ({}) }));

import { agent } from "../src/pages/agent";
import { wallet } from "../src/wallet";
import { ADDR, CFG, flush, root, stubFetch } from "./pagehelpers";

const setup = async (groups: unknown[] = []) => {
  stubFetch({ "/api/groups": groups });
  const r = root();
  agent(r, CFG());
  await flush();
  return { r, q: <T extends HTMLElement>(s: string) => r.querySelector<T>(s)! };
};

describe("agent page", () => {
  beforeEach(() => {
    localStorage.clear();
    wallet.address = ADDR(0xabc);
    wallet.wrongChain = false;
    wallet.client = {} as never;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows an error when configuration is unavailable", () => {
    const r = root();
    agent(r, null);
    expect(r.querySelector(".err")).not.toBeNull();
  });

  it("explains that no personal data is stored and warns about the one-person-one-household limit", async () => {
    const { r } = await setup();
    expect(r.textContent).toMatch(/No name, phone number or location/);
    expect(r.textContent).toMatch(/cannot prove one-person-one-household/);
  });

  it("generates a household card on the device and does not persist the secret", async () => {
    const { q } = await setup();
    q<HTMLButtonElement>("#gen").click();
    await flush(10);
    const code = q("#code").textContent!;
    expect(code).toMatch(/^FF1-/);
    expect(q("img.qr").getAttribute("src")).toMatch(/^data:image/);
    expect(JSON.stringify({ ...localStorage })).not.toContain(code.slice(4, 20));
  });

  it("each generated card is different (fresh randomness)", async () => {
    const { q } = await setup();
    q<HTMLButtonElement>("#gen").click();
    await flush(10);
    const a = q("#code").textContent;
    q<HTMLButtonElement>("#gen").click();
    await flush(10);
    expect(q("#code").textContent).not.toBe(a);
  });

  it("refuses to enroll a household before the NGO group exists", async () => {
    const { q } = await setup();
    q<HTMLButtonElement>("#gen").click();
    await flush(10);
    q<HTMLButtonElement>("#add").click();
    await flush();
    expect(q("#addTx").textContent).toMatch(/Create your NGO group first/);
  });

  it("tells the NGO exactly how to get its group admitted to the registry", async () => {
    localStorage.setItem("ff.myGroup", JSON.stringify("7"));
    const { q } = await setup([{ groupId: "1" }]);
    expect(q("#reg").textContent).toMatch(/register-group 7 0x/);
    const ok = await setup([{ groupId: "7" }]);
    expect(ok.q("#reg").textContent).toMatch(/admitted to the shared registry/);
  });
});
