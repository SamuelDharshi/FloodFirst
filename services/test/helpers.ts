// Test helpers. Everything here is TEST DATA / test doubles; none of it is used by production code.
import { loadEnv, type Deployment, type Env } from "../src/config.js";

export const KEYS = {
  forecast: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  gauge: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  fallback: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  relayer: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  voucher: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
} as const;

export const ADDR = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;

export const DEPLOYMENT: Deployment = {
  chainId: 31337,
  deployBlock: 10,
  semaphore: ADDR(1),
  token: ADDR(2),
  issuer: ADDR(3),
  pool: ADDR(4),
  registry: ADDR(5),
  oracle: ADDR(6),
  basin: `0x${"ab".repeat(32)}`,
};

export function testEnv(extra: Record<string, string> = {}): Env {
  return loadEnv({
    EXPECTED_CHAIN_ID: "31337",
    RPC_URL: "http://127.0.0.1:1",
    BASIN_LAT: "26.19",
    BASIN_LON: "91.70",
    CONFIRMATIONS: "2",
    INDEXER_CHUNK: "100",
    LOG_LEVEL: "silent",
    ...extra,
  } as NodeJS.ProcessEnv);
}

export const jsonResponse = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
