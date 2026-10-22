/**
 * Operator CLI (owner/deployer key). Usage: npm run cli -- <command> [args]
 *   status                         pool, issuer and oracle state read from chain
 *   register-group <id> <ngoAddr>  admit an NGO's Semaphore group to the registry (owner only)
 *   mint <to> <amountTokens>       mint testnet FFUSD (owner only)
 *   set-thresholds <forecast> <gauge> <maxAgeSec> <vetoWindowSec>   (owner only)
 *   pause | unpause                stop/resume tranche releases (owner only)
 *   expire <eventId>               return an expired event's funds to the pool (anyone)
 * Every write waits for the receipt and fails if the transaction reverts.
 */
import { parseUnits, type Abi, type Hex } from "viem";
import { issuerAbi, oracleAbi, poolAbi, registryAbi, tokenAbi } from "./abi.js";
import { assertChain, makePublicClient, makeWallet } from "./chain.js";
import { loadConfig } from "./config.js";

const { env, deployment: d } = loadConfig();
const pub = makePublicClient(env);
await assertChain(env, pub);
const [cmd, ...args] = process.argv.slice(2);

function owner() {
  if (!env.DEPLOYER_PRIVATE_KEY) throw new Error("DEPLOYER_PRIVATE_KEY (contract owner) is required for this command");
  return makeWallet(env, env.DEPLOYER_PRIVATE_KEY);
}

async function write(address: Hex, abi: Abi, functionName: string, a: unknown[]) {
  const w = owner();
  const { request } = await pub.simulateContract({ account: w.account, address, abi, functionName, args: a } as never);
  const hash = await w.client.writeContract(request as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  console.log(`${functionName} confirmed in block ${r.blockNumber}: ${hash}`);
}

switch (cmd) {
  case "status": {
    const read = (address: Hex, abi: Abi, functionName: string) => pub.readContract({ address, abi, functionName } as never);
    console.log({
      chainId: env.EXPECTED_CHAIN_ID,
      poolBalance: String(await read(d.pool, poolAbi, "balance")),
      paused: await read(d.pool, poolAbi, "paused"),
      totalDonated: String(await read(d.pool, poolAbi, "totalDonated")),
      totalReleased: String(await read(d.pool, poolAbi, "totalReleased")),
      enrolled: String(await read(d.registry, registryAbi, "totalEnrolled")),
      forecastThreshold: String(await read(d.oracle, oracleAbi, "forecastThreshold")),
      gaugeThreshold: String(await read(d.oracle, oracleAbi, "gaugeThreshold")),
      deployment: d,
    });
    break;
  }
  case "register-group":
    await write(d.registry, registryAbi, "registerNgoGroup", [BigInt(args[0] ?? ""), args[1]]);
    break;
  case "mint":
    await write(d.token, tokenAbi, "mint", [args[0], parseUnits(args[1] ?? "0", 6)]);
    break;
  case "set-thresholds":
    await write(d.oracle, oracleAbi, "setThresholds", args.map((x) => BigInt(x)));
    break;
  case "pause":
    await write(d.pool, poolAbi, "setPaused", [true]);
    break;
  case "unpause":
    await write(d.pool, poolAbi, "setPaused", [false]);
    break;
  case "expire":
    await write(d.issuer, issuerAbi, "expire", [BigInt(args[0] ?? "")]);
    break;
  default:
    console.log("commands: status | register-group | mint | set-thresholds | pause | unpause | expire");
    process.exitCode = 1;
}
