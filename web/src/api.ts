import { store } from "./util";

/** Same origin by default (the API serves the web app on one port). Set VITE_API_URL to use a separate API host. */
/** Trims spaces and trailing slashes so "https://host/" and "https://host" behave the same. */
export const normalizeBase = (v?: string): string => (v ?? "").trim().replace(/\/+$/, "");
export const API = normalizeBase(import.meta.env.VITE_API_URL as string | undefined);
export const EXPLORER = (import.meta.env.VITE_EXPLORER_URL as string | undefined) ?? "https://sepolia.basescan.org";

export interface Deployment {
  chainId: number; deployBlock: number; semaphore: `0x${string}`; token: `0x${string}`; issuer: `0x${string}`;
  pool: `0x${string}`; registry: `0x${string}`; oracle: `0x${string}`; basin: `0x${string}`;
}
export interface AppConfig {
  chainId: number; rpcUrl: string; deployment: Deployment; voucherSigner: `0x${string}` | null;
  gaugeMode: string; knownLimits: string[]; labels: Record<string, string | boolean>;
}

const cache = store<AppConfig | null>("ff.config", null);

export async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

export async function postJson<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
  const r = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: (await r.json()) as T };
}

/** Loads config online and caches it so the merchant page can verify vouchers offline later. */
export async function loadConfig(): Promise<{ cfg: AppConfig | null; fromCache: boolean; error?: string }> {
  try {
    const cfg = await getJson<AppConfig>("/api/config");
    cache.set(cfg);
    return { cfg, fromCache: false };
  } catch (e) {
    const c = cache.get();
    return { cfg: c, fromCache: !!c, error: (e as Error).message };
  }
}
