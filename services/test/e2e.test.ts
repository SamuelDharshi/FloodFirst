/**
 * END-TO-END TEST on a LOCAL anvil chain (chain id 31337). This is test infrastructure, NOT testnet evidence.
 * Everything below talks to real deployed contracts (including real Semaphore v4 and its verifier), the real
 * indexer, relayer and voucher-signer code, and real Groth16 proofs. The only stub is the HTTP fetcher that
 * stands in for Open-Meteo, because the local test cannot depend on live weather. The anvil private keys are the
 * public well-known dev keys and are valid on local chains only.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { Group } from "@semaphore-protocol/group";
import { Identity } from "@semaphore-protocol/identity";
import { generateProof } from "@semaphore-protocol/proof";
import { createPublicClient, createWalletClient, decodeEventLog, defineChain, http, parseUnits, recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { issuerAbi, oracleAbi, poolAbi, registryAbi, semaphoreAbi, tokenAbi, VOUCHER_TYPES } from "../src/abi.js";
import { loadDeployment, loadEnv, type Deployment, type Env } from "../src/config.js";
import { openDb, all, type Db } from "../src/db.js";
import { Indexer } from "../src/indexer.js";
import { OracleService } from "../src/oracle.js";
import { buildServer, voucherIdOf } from "../src/server.js";
import type { FastifyInstance } from "fastify";

const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;
const TMP = resolve(import.meta.dirname, ".tmp");
const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  forecast: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  gauge: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  fallback: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  relayer: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  voucher: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  ngoA: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  ngoB: "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
  donor: "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
} as const satisfies Record<string, Hex>;
const MERCHANT = "0x1111111111111111111111111111111111111111";
const acct = (k: keyof typeof KEYS) => privateKeyToAccount(KEYS[k]);

const chain = defineChain({ id: 31337, name: "anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC), cacheTime: 0 });
const wallet = (k: keyof typeof KEYS) => createWalletClient({ account: acct(k), chain, transport: http(RPC) });

let anvil: ChildProcess;
let env: Env;
let d: Deployment;
let db: Db;
let app: FastifyInstance;
let indexer: Indexer;
let groupA: bigint;
let groupB: bigint;
let eventId: bigint;

async function rpc(method: string, params: unknown[] = []) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: unknown; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

async function send(k: keyof typeof KEYS, address: Hex, abi: readonly unknown[], functionName: string, args: unknown[]) {
  const hash = await wallet(k).writeContract({ address, abi, functionName, args } as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  expect(r.status).toBe("success");
  return r;
}

// Stand-in for Open-Meteo (TEST DATA): 500 m3/s forecast discharge.
const stubFetch = (async () =>
  new Response(JSON.stringify({ daily: { river_discharge: [120, 500, 300] } }), { status: 200 })) as unknown as typeof fetch;

beforeAll(async () => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(resolve(TMP, "deployments"), { recursive: true });
  anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try {
      await pub.getChainId();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  execFileSync("forge", ["script", "script/Deploy.s.sol:DeployLocal", "--rpc-url", RPC, "--broadcast"], {
    cwd: resolve(import.meta.dirname, "../../contracts"),
    stdio: "pipe",
    env: {
      ...process.env,
      FOUNDRY_DISABLE_NIGHTLY_WARNING: "1",
      FOUNDRY_PROFILE: "e2e",
      DEPLOYER_PRIVATE_KEY: KEYS.deployer,
      BASIN_NAME: "e2e-test-basin",
      FORECAST_ATTESTER: acct("forecast").address,
      GAUGE_ATTESTER: acct("gauge").address,
      FALLBACK_ATTESTER: acct("fallback").address,
      REPORTER: "0x0000000000000000000000000000000000000000",
      FORECAST_THRESHOLD: "100",
      GAUGE_THRESHOLD: "50",
      VOUCHER_TTL_SEC: "3600",
      MIN_RELEASE_INTERVAL_SEC: "60",
      DEPLOYMENT_OUT_DIR: "../services/test/.tmp/deployments",
    },
  });
  env = loadEnv({
    EXPECTED_CHAIN_ID: "31337",
    RPC_URL: RPC,
    FORECAST_ATTESTER_PRIVATE_KEY: KEYS.forecast,
    GAUGE_ATTESTER_PRIVATE_KEY: KEYS.gauge,
    FALLBACK_ATTESTER_PRIVATE_KEY: KEYS.fallback,
    RELAYER_PRIVATE_KEY: KEYS.relayer,
    VOUCHER_SIGNER_PRIVATE_KEY: KEYS.voucher,
    BASIN_LAT: "26.2",
    BASIN_LON: "91.7",
    GAUGE_MODE: "operator",
    ADMIN_API_TOKEN: "test-admin-token-test-admin-token",
    CONFIRMATIONS: "0",
    DATABASE_PATH: resolve(TMP, "e2e.sqlite"),
    DEPLOYMENTS_FILE: resolve(TMP, "deployments/31337.json"),
  } as NodeJS.ProcessEnv);
  d = loadDeployment(env);
  db = openDb(env.DATABASE_PATH);
  app = await buildServer({ db, pub, env, d });
  indexer = new Indexer(db, pub, env, d);
});

afterAll(async () => {
  await app?.close();
  anvil?.kill();
});

describe("FloodFirst end-to-end (local anvil)", () => {
  it("sets up two NGO groups, enrolls the same household in both, and funds the pool", async () => {
    const h1 = new Identity("e2e-household-1");
    const h2 = new Identity("e2e-household-2");
    const mkGroup = async (k: "ngoA" | "ngoB") => {
      const r = await send(k, d.semaphore, semaphoreAbi, "createGroup", []);
      const ev = r.logs.map((l) => { try { return decodeEventLog({ abi: semaphoreAbi, data: l.data, topics: l.topics }); } catch { return null; } }).find((e) => e?.eventName === "GroupCreated");
      return (ev!.args as unknown as { groupId: bigint }).groupId;
    };
    groupA = await mkGroup("ngoA");
    groupB = await mkGroup("ngoB");
    await send("ngoA", d.semaphore, semaphoreAbi, "addMembers", [groupA, [h1.commitment, h2.commitment]]);
    await send("ngoB", d.semaphore, semaphoreAbi, "addMember", [groupB, h1.commitment]);
    await send("deployer", d.registry, registryAbi, "registerNgoGroup", [groupA, acct("ngoA").address]);
    await send("deployer", d.registry, registryAbi, "registerNgoGroup", [groupB, acct("ngoB").address]);

    await send("deployer", d.token, tokenAbi, "mint", [acct("donor").address, parseUnits("1000", 6)]);
    await send("donor", d.token, tokenAbi, "approve", [d.pool, parseUnits("1000", 6)]);
    await send("donor", d.pool, poolAbi, "deposit", [parseUnits("1000", 6)]);
    expect(await pub.readContract({ address: d.pool, abi: poolAbi, functionName: "balance" })).toBe(parseUnits("1000", 6));
  });

  it("oracle does nothing without a fresh gauge reading, then triggers after an operator-confirmed reading", async () => {
    const oracle = new OracleService(db, pub, env, d, stubFetch);
    expect(await oracle.tick()).toBeNull(); // forecast OK, but no gauge reading: must NOT trigger

    const unauth = await app.inject({ method: "POST", url: "/admin/gauge", payload: { value: 80, unit: "cm", sourceUrl: "https://example.org/bulletin" } });
    expect(unauth.statusCode).toBe(401);
    const ok = await app.inject({
      method: "POST", url: "/admin/gauge",
      headers: { authorization: `Bearer ${env.ADMIN_API_TOKEN}` },
      payload: { value: 80, unit: "cm", sourceUrl: "https://example.org/bulletin", note: "e2e test reading" },
    });
    expect(ok.statusCode).toBe(200);

    const hash = await oracle.tick();
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    const row = all(db, "SELECT * FROM triggers_submitted")[0]!;
    expect(row.status).toBe("confirmed");
    expect(row.used_fallback).toBe(1);
    eventId = BigInt(row.event_id as string);
    const tr = await pub.readContract({ address: d.oracle, abi: oracleAbi, functionName: "triggers", args: [eventId] });
    expect((tr as [number, bigint])[0]).toBe(2); // Executed
    // 30% of 1000 released
    expect(await pub.readContract({ address: d.pool, abi: poolAbi, functionName: "balance" })).toBe(parseUnits("700", 6));
  });

  it("indexer captures events, the fallback is publicly visible, and a second pass is idempotent", async () => {
    await indexer.sync();
    const names = all(db, "SELECT name FROM events").map((r) => r.name);
    for (const n of ["Deposited", "Released", "Triggered", "FallbackUsed", "NgoGroupRegistered", "EventOpened"]) expect(names).toContain(n);
    const before = all(db, "SELECT COUNT(*) AS c FROM events")[0]!.c;
    await new Indexer(db, pub, env, d).sync(); // simulates a restart
    expect(all(db, "SELECT COUNT(*) AS c FROM events")[0]!.c).toBe(before);
    const stats = (await app.inject({ url: "/api/stats" })).json();
    expect(stats.indexed.triggers).toBe(1);
    expect(stats.indexed.fallbackUses).toBe(1);
    expect(stats.indexed.totalReleased).toBe(parseUnits("300", 6).toString());
  });

  let voucherSecretA: Hex;
  async function claimVia(group: bigint, scopeEvent: bigint, id: Identity) {
    const members = (await app.inject({ url: `/api/groups/${group}/members` })).json().members as string[];
    const g = new Group(members.map((m) => BigInt(m)));
    const secret = ("0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")) as Hex;
    const proof = await generateProof(id, g, voucherIdOf(secret), scopeEvent);
    const payload = {
      eventId: scopeEvent.toString(), groupId: group.toString(),
      proof: {
        merkleTreeDepth: proof.merkleTreeDepth.toString(), merkleTreeRoot: proof.merkleTreeRoot.toString(),
        nullifier: proof.nullifier.toString(), message: proof.message.toString(), scope: proof.scope.toString(),
        points: proof.points.map((p: bigint) => p.toString()),
      },
    };
    const res = await app.inject({ method: "POST", url: "/api/claim", payload });
    return { res, secret, payload };
  }

  it("claims with a real ZK proof via the relayer, verified from the on-chain event", async () => {
    await indexer.sync();
    const { res, secret } = await claimVia(groupA, eventId, new Identity("e2e-household-1"));
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("confirmed");
    voucherSecretA = secret;
    const v = (await pub.readContract({ address: d.issuer, abi: issuerAbi, functionName: "vouchers", args: [voucherIdOf(secret)] })) as [bigint, boolean, boolean];
    expect(v[1]).toBe(true);
  });

  it("blocks the same household when a second NGO's group is used (cross-NGO dedup)", async () => {
    const { res } = await claimVia(groupB, eventId, new Identity("e2e-household-1"));
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("NullifierAlreadyUsed");
  });

  it("is idempotent when the identical claim is submitted again", async () => {
    // Same proof payload replay is caught by simulation (nullifier used) and never spends gas twice.
    const before = await pub.getTransactionCount({ address: acct("relayer").address });
    const { res } = await claimVia(groupA, eventId, new Identity("e2e-household-1"));
    expect(res.statusCode).toBe(422);
    expect(await pub.getTransactionCount({ address: acct("relayer").address })).toBe(before);
  });

  it("a different household in the same NGO can still claim", async () => {
    const { res } = await claimVia(groupA, eventId, new Identity("e2e-household-2"));
    expect(res.statusCode).toBe(200);
  });

  it("issues an offline-verifiable voucher and rejects unknown secrets", async () => {
    const res = await app.inject({ method: "POST", url: "/api/voucher", payload: { voucherSecret: voucherSecretA } });
    expect(res.statusCode).toBe(200);
    const { voucher, signature, signer } = res.json();
    const recovered = await recoverTypedDataAddress({
      domain: { name: "FloodFirstVoucher", version: "1", chainId: 31337, verifyingContract: d.issuer },
      types: VOUCHER_TYPES, primaryType: "Voucher",
      message: { voucherId: BigInt(voucher.voucherId), eventId: BigInt(voucher.eventId), amount: BigInt(voucher.amount), expiry: BigInt(voucher.expiry) },
      signature,
    });
    expect(recovered).toBe(signer); // verification used only data inside the voucher, no network
    expect(BigInt(voucher.amount)).toBe(parseUnits("100", 6));
    const bad = await app.inject({ method: "POST", url: "/api/voucher", payload: { voucherSecret: "0x" + "11".repeat(32) } });
    expect(bad.statusCode).toBe(404);
  });

  it("merchant sync redeems exactly once", async () => {
    const r1 = await app.inject({ method: "POST", url: "/api/redeem", payload: { voucherSecret: voucherSecretA, to: MERCHANT } });
    expect(r1.statusCode).toBe(200);
    expect(await pub.readContract({ address: d.token, abi: tokenAbi, functionName: "balanceOf", args: [MERCHANT] })).toBe(parseUnits("100", 6));
    const r2 = await app.inject({ method: "POST", url: "/api/redeem", payload: { voucherSecret: voucherSecretA, to: MERCHANT } });
    expect(r2.json().duplicate).toBe(true); // recorded confirmation returned, no second payment
    expect(await pub.readContract({ address: d.token, abi: tokenAbi, functionName: "balanceOf", args: [MERCHANT] })).toBe(parseUnits("100", 6));
  });

  it("recovers from a chain reorganisation by dropping orphaned indexed data", async () => {
    await indexer.sync();
    const snap = (await rpc("evm_snapshot")) as string;
    const claimsBefore = all(db, "SELECT COUNT(*) AS c FROM events WHERE name = 'Expired'")[0]!.c as number;
    await rpc("evm_increaseTime", [3700]);
    await rpc("evm_mine");
    const r = await app.inject({ method: "POST", url: "/api/expire", payload: { eventId: eventId.toString() } });
    expect(r.statusCode).toBe(200);
    await indexer.sync();
    expect(all(db, "SELECT COUNT(*) AS c FROM events WHERE name = 'Expired'")[0]!.c).toBe(claimsBefore + 1);
    // Reorg: discard the expiry, mine different blocks at the same heights.
    await rpc("evm_revert", [snap]);
    await rpc("evm_mine");
    await rpc("evm_mine");
    await rpc("evm_mine");
    const target = await indexer.handleReorg();
    expect(target).not.toBeNull();
    expect(all(db, "SELECT COUNT(*) AS c FROM events WHERE name = 'Expired'")[0]!.c).toBe(claimsBefore);
  });

  it("returns unredeemed funds to the pool on expiry and conserves total supply", async () => {
    await rpc("evm_increaseTime", [3700]);
    await rpc("evm_mine");
    const r = await app.inject({ method: "POST", url: "/api/expire", payload: { eventId: eventId.toString() } });
    expect(r.statusCode).toBe(200);
    await indexer.sync();
    const poolBal = (await pub.readContract({ address: d.pool, abi: poolAbi, functionName: "balance" })) as bigint;
    const issuerBal = (await pub.readContract({ address: d.token, abi: tokenAbi, functionName: "balanceOf", args: [d.issuer] })) as bigint;
    const merchant = (await pub.readContract({ address: d.token, abi: tokenAbi, functionName: "balanceOf", args: [MERCHANT] })) as bigint;
    expect(issuerBal).toBe(0n);
    expect(poolBal + merchant).toBe(parseUnits("1000", 6));
    const stats = (await app.inject({ url: "/api/stats" })).json();
    expect(stats.indexed.totalReturnedToPool).toBe(parseUnits("200", 6).toString());
  });

  it("relayer rejects malformed input and the admin API requires auth", async () => {
    expect((await app.inject({ method: "POST", url: "/api/claim", payload: { nope: 1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/admin/sms", payload: { to: "+15555550100", body: "x" } })).statusCode).toBe(401);
    const sms = await app.inject({ method: "POST", url: "/admin/sms", headers: { authorization: `Bearer ${env.ADMIN_API_TOKEN}` }, payload: { to: "+15555550100", body: "x" } });
    expect(sms.statusCode).toBe(503); // no SMS provider configured: never pretends to send
  });
});
