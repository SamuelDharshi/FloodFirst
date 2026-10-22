import { resolve } from "node:path";
import { assertChain, assertHasCode, makePublicClient } from "./chain.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { Indexer } from "./indexer.js";
import { OracleService } from "./oracle.js";
import { buildServer } from "./server.js";

const { env, deployment: d } = loadConfig();
const db = openDb(env.DATABASE_PATH);
const pub = makePublicClient(env);

await assertChain(env, pub);
for (const [name, addr] of Object.entries({ token: d.token, issuer: d.issuer, pool: d.pool, registry: d.registry, oracle: d.oracle, semaphore: d.semaphore })) {
  await assertHasCode(pub, name, addr);
}

const webDist = resolve(import.meta.dirname, "../../web/dist");
const app = await buildServer({ db, pub, env, d, webDist });
const indexer = new Indexer(db, pub, env, d);
const stopIndexer = indexer.start(5000, (e) => app.log.error({ err: e }, "indexer pass failed"));

let stopOracle = () => {};
if (env.ORACLE_ENABLED === "true") {
  stopOracle = new OracleService(db, pub, env, d).start((e) => app.log.error({ err: e }, "oracle tick failed"));
}

// Dual-stack ("::") so both http://localhost and http://127.0.0.1 reach this server; fall back to IPv4-only if IPv6 is off.
try {
  await app.listen({ port: env.API_PORT, host: "::" });
} catch (e) {
  if ((e as { code?: string }).code === "EADDRINUSE") throw e;
  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
}

const shutdown = async () => {
  stopIndexer();
  stopOracle();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
