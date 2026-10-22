/**
 * Deploys the contracts to the configured TESTNET using `forge script` and writes deployments/<chainId>.json.
 * Attester addresses are derived from their private keys so they cannot be mismatched. Refuses mainnets.
 *   npm run preflight && npm run deploy
 * Set BASESCAN_API_KEY to also verify the source on the explorer during the same run.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { loadEnv, loadEnvFile } from "./config.js";

loadEnvFile();
const env = loadEnv();
const MAINNETS = new Set([1, 10, 56, 137, 8453, 42161, 43114, 59144, 534352]);
if (MAINNETS.has(env.EXPECTED_CHAIN_ID)) {
  console.error(`Refusing: chain ${env.EXPECTED_CHAIN_ID} is a mainnet. This project is testnet-only.`);
  process.exit(1);
}
const need = (v: string | undefined, name: string): string => {
  if (!v) { console.error(`${name} is required. Run: npm run preflight`); process.exit(1); }
  return v;
};
const addr = (k?: string) => (k ? privateKeyToAccount(k as `0x${string}`).address : "0x0000000000000000000000000000000000000000");
const gaugeKey = env.GAUGE_ATTESTER_PRIVATE_KEY ?? env.FALLBACK_ATTESTER_PRIVATE_KEY;

/** Contracts store whole numbers: threshold 49.68 with GAUGE_SCALE=100 becomes 4968 (the oracle scales readings the same way). */
function scaledGaugeThreshold(): string {
  const raw = Number(need(process.env.GAUGE_THRESHOLD, "GAUGE_THRESHOLD"));
  if (!Number.isFinite(raw) || raw <= 0) { console.error("GAUGE_THRESHOLD must be a positive number"); process.exit(1); }
  const scaled = Math.round(raw * env.GAUGE_SCALE);
  if (scaled <= 0) { console.error("GAUGE_THRESHOLD * GAUGE_SCALE rounds to 0; raise GAUGE_SCALE"); process.exit(1); }
  console.log(`Gauge threshold ${raw} x scale ${env.GAUGE_SCALE} = ${scaled} stored on chain`);
  return String(scaled);
}

const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  FOUNDRY_DISABLE_NIGHTLY_WARNING: "1",
  DEPLOYER_PRIVATE_KEY: need(env.DEPLOYER_PRIVATE_KEY, "DEPLOYER_PRIVATE_KEY"),
  EXPECTED_CHAIN_ID: String(env.EXPECTED_CHAIN_ID),
  SEMAPHORE_ADDRESS: need(process.env.SEMAPHORE_ADDRESS, "SEMAPHORE_ADDRESS"),
  BASIN_NAME: process.env.BASIN_NAME || "brahmaputra",
  FORECAST_ATTESTER: addr(need(env.FORECAST_ATTESTER_PRIVATE_KEY, "FORECAST_ATTESTER_PRIVATE_KEY")),
  GAUGE_ATTESTER: addr(need(gaugeKey, "GAUGE_ATTESTER_PRIVATE_KEY")),
  FALLBACK_ATTESTER: addr(env.FALLBACK_ATTESTER_PRIVATE_KEY),
  REPORTER: process.env.REPORTER || "0x0000000000000000000000000000000000000000",
  FORECAST_THRESHOLD: need(process.env.FORECAST_THRESHOLD, "FORECAST_THRESHOLD"),
  GAUGE_THRESHOLD: scaledGaugeThreshold(),
  DEPLOYMENT_OUT_DIR: "../deployments",
};

const args = ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", env.RPC_URL, "--broadcast"];
if (process.env.BASESCAN_API_KEY) args.push("--verify", "--etherscan-api-key", process.env.BASESCAN_API_KEY);

console.log(`Deploying to chain ${env.EXPECTED_CHAIN_ID} via ${env.RPC_URL}`);
console.log(`  forecast attester ${childEnv.FORECAST_ATTESTER}\n  gauge attester    ${childEnv.GAUGE_ATTESTER}\n  fallback operator ${childEnv.FALLBACK_ATTESTER}`);
const r = spawnSync("forge", args, { cwd: resolve(import.meta.dirname, "../../contracts"), env: childEnv, stdio: "inherit" });
if (r.status !== 0) {
  console.error("forge script failed; nothing was recorded.");
  process.exit(r.status ?? 1);
}
console.log("\nDeployment record written to deployments/" + env.EXPECTED_CHAIN_ID + ".json. Now run: npm run verify-deployment");
