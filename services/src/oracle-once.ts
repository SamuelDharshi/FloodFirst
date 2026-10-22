/**
 * Runs ONE oracle evaluation now (real Open-Meteo forecast + the latest operator gauge reading) and, if both are over
 * the on-chain thresholds, signs and submits the trigger. Useful for testing without the background loop.
 *   npm run oracle:once
 */
import { assertChain, makePublicClient } from "./chain.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { OracleService } from "./oracle.js";

const { env, deployment: d } = loadConfig();
const db = openDb(env.DATABASE_PATH);
const pub = makePublicClient(env);
await assertChain(env, pub);
const hash = await new OracleService(db, pub, env, d).tick();
console.log(hash ? `Trigger submitted and verified: ${hash}` : "No trigger: thresholds not met, no fresh gauge reading, pool paused, or cooldown active (see /api/oracle-log).");
