/**
 * Independently verifies the recorded deployment by reading the chain: bytecode exists at every address and
 * the contracts are wired to each other as intended. Read-only. Prints explorer links.
 *   npm run verify-deployment
 */
import { oracleAbi, poolAbi, issuerAbi, registryAbi } from "./abi.js";
import { assertChain, makePublicClient } from "./chain.js";
import { loadConfig } from "./config.js";

const { env, deployment: d } = loadConfig();
const pub = makePublicClient(env);
await assertChain(env, pub);
const explorer = process.env.EXPLORER_URL || "https://sepolia.basescan.org";
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const read = (address: `0x${string}`, abi: never, functionName: string) => pub.readContract({ address, abi, functionName } as never);

for (const [name, address] of Object.entries({ semaphore: d.semaphore, token: d.token, issuer: d.issuer, pool: d.pool, registry: d.registry, oracle: d.oracle })) {
  const code = await pub.getCode({ address });
  check(`${name} has bytecode`, !!code && code !== "0x", `${explorer}/address/${address}`);
}
check("pool.oracle == oracle", same((await read(d.pool, poolAbi as never, "oracle")) as string, d.oracle));
check("pool.registry == registry", same((await read(d.pool, poolAbi as never, "registry")) as string, d.registry));
check("pool.issuer == issuer", same((await read(d.pool, poolAbi as never, "issuer")) as string, d.issuer));
check("pool.token == token", same((await read(d.pool, poolAbi as never, "token")) as string, d.token));
check("issuer.pool == pool", same((await read(d.issuer, issuerAbi as never, "pool")) as string, d.pool));
check("issuer.registry == registry", same((await read(d.issuer, issuerAbi as never, "registry")) as string, d.registry));
check("registry.issuer == issuer", same((await read(d.registry, registryAbi as never, "issuer")) as string, d.issuer));
check("registry.semaphore == semaphore", same((await read(d.registry, registryAbi as never, "semaphore")) as string, d.semaphore));
check("oracle.pool == pool", same((await read(d.oracle, oracleAbi as never, "pool")) as string, d.pool));
check("oracle.basin recorded", (await read(d.oracle, oracleAbi as never, "basin")) === d.basin);
check("pool max release is 30%", (await read(d.pool, poolAbi as never, "MAX_RELEASE_BPS")) === 3000n);
const fT = (await read(d.oracle, oracleAbi as never, "forecastThreshold")) as bigint;
const gT = (await read(d.oracle, oracleAbi as never, "gaugeThreshold")) as bigint;
check("oracle thresholds set", fT > 0n && gT > 0n, `forecast=${fT} gauge=${gT}`);
console.log(`\nOwner (pool): ${await read(d.pool, poolAbi as never, "owner")}`);
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll deployment checks passed.");
process.exit(failed ? 1 : 0);
