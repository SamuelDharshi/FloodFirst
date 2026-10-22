// Test helpers (test doubles / test data only).
import { vi } from "vitest";

export const ADDR = (n: number) => ("0x" + n.toString(16).padStart(40, "0")) as `0x${string}`;
export const DEPLOYMENT = { chainId: 84532, deployBlock: 1, semaphore: ADDR(1), token: ADDR(2), issuer: ADDR(3), pool: ADDR(4), registry: ADDR(5), oracle: ADDR(6), basin: ("0x" + "ab".repeat(32)) as `0x${string}` };
export const CFG = (over: Record<string, unknown> = {}) =>
  ({ chainId: 84532, rpcUrl: "http://rpc.invalid", deployment: DEPLOYMENT, voucherSigner: ADDR(9), gaugeMode: "operator", knownLimits: ["Known limit <one>"], labels: {}, ...over }) as never;

export const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
export const root = () => { document.body.innerHTML = `<div id="r"></div>`; return document.getElementById("r")!; };

/** fetch double routed by URL substring → body (or [status, body]). Unmatched URLs fail like a network error. */
export function stubFetch(routes: Record<string, unknown | [number, unknown]>) {
  const f = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const key = Object.keys(routes).find((k) => u.includes(k));
    if (!key) throw new TypeError(`network unreachable: ${u}`);
    const v = routes[key];
    const [status, body] = Array.isArray(v) && typeof v[0] === "number" ? (v as [number, unknown]) : [200, v];
    void init;
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", f);
  return f;
}
