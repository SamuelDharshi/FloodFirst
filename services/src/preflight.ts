/**
 * Preflight: checks that .env is complete and that the real chain is reachable BEFORE deploying.
 * Prints addresses derived from the keys (never the keys). Read-only; sends nothing.
 *   npm run preflight
 */
import { formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { assertChain, makePublicClient } from "./chain.js";
import { loadEnv, loadEnvFile } from "./config.js";

loadEnvFile();
const raw = process.env;
const problems: string[] = [];
const need = (k: string, why: string) => {
  if (!raw[k]) problems.push(`${k} is empty: ${why}`);
};

need("DEPLOYER_PRIVATE_KEY", "pays gas and becomes the contract owner");
need("FORECAST_ATTESTER_PRIVATE_KEY", "signs the forecast leg of a trigger");
need("GAUGE_ATTESTER_PRIVATE_KEY", "signs the gauge leg when GAUGE_MODE=http-json");
need("RELAYER_PRIVATE_KEY", "submits claim/redeem/trigger transactions");
need("VOUCHER_SIGNER_PRIVATE_KEY", "signs vouchers so merchants can verify offline");
need("FORECAST_THRESHOLD", "trigger threshold for forecast discharge (m3/s)");
need("GAUGE_THRESHOLD", "trigger threshold for the gauge reading, in the units you will enter (BLOCKERS B2)");
need("ADMIN_API_TOKEN", "protects the admin API (>= 24 random characters)");
if ((raw.GAUGE_MODE ?? "operator") === "operator") need("FALLBACK_ATTESTER_PRIVATE_KEY", "signs operator-confirmed gauge readings (GAUGE_MODE=operator)");
if (raw.GAUGE_MODE === "http-json") { need("GAUGE_SOURCE_URL", "real gauge endpoint"); need("GAUGE_JSON_PATH", "path to the value in the JSON"); }

const gt = Number(raw.GAUGE_THRESHOLD);
if (raw.GAUGE_THRESHOLD && (!Number.isFinite(gt) || gt <= 0)) problems.push("GAUGE_THRESHOLD must be a positive number (decimals allowed; it is multiplied by GAUGE_SCALE)");
let env;
try {
  env = loadEnv();
} catch (e) {
  console.error("Invalid .env values:\n", (e as Error).message);
  process.exit(1);
}

const addr = (k?: string) => (k ? privateKeyToAccount(k as `0x${string}`).address : null);
const roles = {
  deployer: addr(env.DEPLOYER_PRIVATE_KEY),
  forecastAttester: addr(env.FORECAST_ATTESTER_PRIVATE_KEY),
  gaugeAttester: addr(env.GAUGE_ATTESTER_PRIVATE_KEY),
  fallbackAttester: addr(env.FALLBACK_ATTESTER_PRIVATE_KEY),
  relayer: addr(env.RELAYER_PRIVATE_KEY),
  voucherSigner: addr(env.VOUCHER_SIGNER_PRIVATE_KEY),
};
if (Number.isFinite(gt) && gt > 0) console.log(`Gauge threshold ${gt} x GAUGE_SCALE ${env.GAUGE_SCALE} = ${Math.round(gt * env.GAUGE_SCALE)} stored on chain`);
console.log("Addresses derived from your keys (put FORECAST/GAUGE/FALLBACK in .env for the deploy script):");
for (const [k, v] of Object.entries(roles)) console.log(`  ${k.padEnd(18)} ${v ?? "(key not set)"}`);

const keyed = Object.entries(roles).filter(([, v]) => v);
const dupes = keyed.filter(([, v], i) => keyed.findIndex(([, w]) => w === v) !== i);
if (dupes.length) problems.push(`the same key is used for several roles: ${dupes.map(([k]) => k).join(", ")}. Use a separate key per role (the forecast and gauge legs must be independent).`);

const pub = makePublicClient(env);
try {
  await assertChain(env, pub);
  console.log(`\nRPC ok, chain id ${env.EXPECTED_CHAIN_ID}, block ${await pub.getBlockNumber()}`);
  const sem = (raw.SEMAPHORE_ADDRESS ?? "") as `0x${string}`;
  const code = sem ? await pub.getCode({ address: sem }) : undefined;
  if (!code || code === "0x") problems.push(`SEMAPHORE_ADDRESS has no code on chain ${env.EXPECTED_CHAIN_ID}`);
  else console.log(`Semaphore has code at ${sem}`);
  for (const [k, v] of keyed.filter(([k]) => ["deployer", "relayer", "fallbackAttester"].includes(k))) {
    const bal = await pub.getBalance({ address: v! });
    console.log(`  ${k.padEnd(18)} balance ${formatEther(bal)} ETH`);
    if (bal === 0n && k !== "fallbackAttester") problems.push(`${k} (${v}) has 0 ETH on this chain: fund it from a faucet`);
  }
} catch (e) {
  problems.push(`RPC check failed: ${(e as Error).message}`);
}

if (problems.length) {
  console.log("\nNOT READY:");
  for (const p of problems) console.log("  - " + p);
  process.exit(1);
}
console.log("\nREADY to deploy (see docs/DEPLOYMENT.md).");
