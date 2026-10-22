import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { Address, Hex } from "viem";

const root = resolve(import.meta.dirname, "../..");

const hex = (len: number, what = "value") => z.string().regex(new RegExp(`^0x[0-9a-fA-F]{${len}}$`), `${what} must be 0x followed by ${len} hexadecimal characters`);
const address = hex(40).transform((v) => v as Address);
const privateKey = hex(64, "a private key (32 bytes)").transform((v) => v as Hex);

const schema = z.object({
  EXPECTED_CHAIN_ID: z.coerce.number().int().positive(),
  RPC_URL: z.string().url(),
  DEPLOYER_PRIVATE_KEY: privateKey.optional(),
  FORECAST_ATTESTER_PRIVATE_KEY: privateKey.optional(),
  GAUGE_ATTESTER_PRIVATE_KEY: privateKey.optional(),
  FALLBACK_ATTESTER_PRIVATE_KEY: privateKey.optional(),
  VOUCHER_SIGNER_PRIVATE_KEY: privateKey.optional(),
  RELAYER_PRIVATE_KEY: privateKey.optional(),
  BASIN_LAT: z.coerce.number().min(-90).max(90).optional(),
  BASIN_LON: z.coerce.number().min(-180).max(180).optional(),
  GAUGE_MODE: z.enum(["operator", "http-json"]).default("operator"),
  GAUGE_SOURCE_URL: z.string().default(""),
  GAUGE_JSON_PATH: z.string().default(""),
  GAUGE_SCALE: z.coerce.number().positive().default(1),
  GAUGE_OUTAGE_WINDOW_SEC: z.coerce.number().int().positive().default(6 * 3600),
  ORACLE_ENABLED: z.enum(["true", "false"]).default("false"),
  ORACLE_INTERVAL_SEC: z.coerce.number().int().positive().default(900),
  ORACLE_FORECAST_HORIZON_DAYS: z.coerce.number().int().min(1).max(30).default(3),
  ADMIN_API_TOKEN: z.string().min(24).optional(),
  API_PORT: z.coerce.number().int().default(8787),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  DATABASE_PATH: z.string().default("./data/floodfirst.sqlite"),
  CONFIRMATIONS: z.coerce.number().int().min(0).default(5),
  INDEXER_CHUNK: z.coerce.number().int().min(50).default(200), // public RPCs (e.g. sepolia.base.org) cap eth_getLogs at 200 blocks
  DEPLOYMENTS_FILE: z.string().optional(),
  SMS_PROVIDER: z.string().default(""),
  SMS_ACCOUNT_SID: z.string().default(""),
  SMS_AUTH_TOKEN: z.string().default(""),
  SMS_FROM_NUMBER: z.string().default(""),
});

export type Env = z.infer<typeof schema>;

export interface Deployment {
  chainId: number;
  deployBlock: number;
  semaphore: Address;
  token: Address;
  issuer: Address;
  pool: Address;
  registry: Address;
  oracle: Address;
  basin: Hex;
}

export interface Config {
  env: Env;
  deployment: Deployment;
}

const deploymentSchema = z.object({
  chainId: z.number(),
  deployBlock: z.number(),
  semaphore: address,
  token: address,
  issuer: address,
  pool: address,
  registry: address,
  oracle: address,
  basin: hex(64).transform((v) => v as Hex),
});

export function loadEnvFile(): void {
  const f = resolve(root, ".env");
  if (existsSync(f)) process.loadEnvFile(f);
}

/** Parse environment (does not require deployment). */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Treat empty strings (unfilled .env lines) as unset.
  const cleaned: Record<string, string | undefined> = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ""));
  // Values pasted into a hosting dashboard often carry stray spaces, newlines or quotes. Clean them up, and add the
  // "0x" prefix to a bare 64-character hex private key. (Malformed values are still rejected, and never echoed.)
  for (const [k, v] of Object.entries(cleaned)) {
    if (typeof v !== "string") continue;
    let t = v.trim().replace(/^(["'])(.*)\1$/s, "$2").trim();
    if (k.endsWith("_PRIVATE_KEY") && /^[0-9a-fA-F]{64}$/.test(t)) t = "0x" + t;
    cleaned[k] = t;
  }
  // Hosting platforms (Render, Heroku, ...) tell the server which port to use through PORT.
  if (!cleaned.API_PORT && cleaned.PORT) cleaned.API_PORT = cleaned.PORT;
  return schema.parse(cleaned);
}

export function loadDeployment(env: Env): Deployment {
  const file = env.DEPLOYMENTS_FILE ?? resolve(root, "deployments", `${env.EXPECTED_CHAIN_ID}.json`);
  if (!existsSync(file)) {
    throw new Error(
      `No deployment record at ${file}. Deploy the contracts first (see docs/DEPLOYMENT.md); contract addresses are never guessed.`,
    );
  }
  const d = deploymentSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  if (d.chainId !== env.EXPECTED_CHAIN_ID) {
    throw new Error(`Deployment chainId ${d.chainId} does not match EXPECTED_CHAIN_ID ${env.EXPECTED_CHAIN_ID}`);
  }
  return d;
}

export function loadConfig(): Config {
  loadEnvFile();
  const env = loadEnv();
  return { env, deployment: loadDeployment(env) };
}
