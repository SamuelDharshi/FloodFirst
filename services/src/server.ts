import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeEventLog,
  keccak256,
  type Hex,
  type PublicClient,
} from "viem";
import { z } from "zod";
import { issuerAbi, oracleAbi, poolAbi, registryAbi, semaphoreAbi, tokenAbi, VOUCHER_TYPES } from "./abi.js";
import { json, makeWallet } from "./chain.js";
import type { Deployment, Env } from "./config.js";
import { all, get, run, type Db } from "./db.js";
import { recentOracleLog } from "./oracle.js";
import { sendSms, smsStatus } from "./sms.js";

const num = z.string().regex(/^\d{1,78}$/);
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const claimBody = z.object({
  eventId: num,
  groupId: num,
  proof: z.object({
    merkleTreeDepth: num,
    merkleTreeRoot: num,
    nullifier: num,
    message: num,
    scope: num,
    points: z.array(num).length(8),
  }),
});

export interface ServerCtx {
  db: Db;
  pub: PublicClient;
  env: Env;
  d: Deployment;
  /** Directory of the built web app. When present it is served from the same port as the API. */
  webDist?: string;
}

export const voucherIdOf = (secret: Hex): bigint => BigInt(keccak256(secret)) >> 8n;

function revertName(e: unknown): string | null {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? "revert";
  }
  return null;
}

const KNOWN_LIMITS = [
  "TESTNET ONLY. Tokens have no monetary value. No independent security audit has been performed.",
  "Reduces double payment; does not prove one-person-one-household: a household that creates two secrets and enrolls with two NGOs is not detected.",
  "The trigger depends on two off-chain data attesters. If both collude or are compromised, a release can be forced (capped at 30% of the pool per event).",
  "A voucher is a bearer instrument: anyone who learns its secret before redemption can redeem it.",
  "SMS delivery requires a configured provider; without one, no SMS is sent and the UI says so.",
];

export async function buildServer(ctx: ServerCtx): Promise<FastifyInstance> {
  const { db, pub, env, d } = ctx;
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization"] } });
  app.setErrorHandler((err: Error, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "invalid request", issues: err.issues.map((i) => ({ path: i.path, message: i.message })) });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: err.message });
    app.log.error({ err }, "request failed");
    return reply.code(status ?? 500).send({ error: status === 503 ? err.message : "internal error" });
  });
  await app.register(cors, { origin: env.CORS_ORIGINS.split(",").map((s) => s.trim()) });
  const isApiPath = (url: string) => url.startsWith("/api") || url.startsWith("/admin");
  // Rate limits protect the API; static files for the web app are not counted against them.
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute", allowList: (req) => !isApiPath(req.url) });

  // Single-port mode: serve the built web app next to the API (hash routing, so only "/" really needs index.html).
  if (ctx.webDist && existsSync(join(ctx.webDist, "index.html"))) {
    await app.register(fastifyStatic, {
      root: ctx.webDist,
      dotfiles: "deny",
      setHeaders: (res, path) => {
        res.header("X-Content-Type-Options", "nosniff");
        res.header("Referrer-Policy", "no-referrer");
        res.header("X-Frame-Options", "DENY");
        res.header("Permissions-Policy", "camera=(self), geolocation=(), microphone=()");
        if (path.replaceAll("\\", "/").includes("/assets/")) res.header("Cache-Control", "public, max-age=31536000, immutable");
        else res.header("Cache-Control", "no-cache"); // index.html, sw.js, manifest: always revalidate
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (isApiPath(req.url) || req.method !== "GET") return reply.code(404).send({ error: "not found" });
      return reply.sendFile("index.html");
    });
  }

  const relayer = env.RELAYER_PRIVATE_KEY ? makeWallet(env, env.RELAYER_PRIVATE_KEY) : null;
  const signer = env.VOUCHER_SIGNER_PRIVATE_KEY ? makeWallet(env, env.VOUCHER_SIGNER_PRIVATE_KEY) : null;
  const inflight = new Set<string>();
  // Testnet convenience: the registry owner key admits NGO groups on request (see POST /api/groups/admit).
  const registrar = env.AUTO_ADMIT_NGO_GROUPS === "true" && env.DEPLOYER_PRIVATE_KEY ? makeWallet(env, env.DEPLOYER_PRIVATE_KEY) : null;

  const admin = (req: { headers: Record<string, unknown> }): boolean =>
    !!env.ADMIN_API_TOKEN && req.headers.authorization === `Bearer ${env.ADMIN_API_TOKEN}`;

  // ---------- public read API ----------
  app.get("/api/health", async () => {
    const [chainId, head] = await Promise.all([pub.getChainId(), pub.getBlockNumber()]);
    const cursor = get(db, "SELECT value FROM meta WHERE key = 'cursor'");
    return {
      ok: chainId === env.EXPECTED_CHAIN_ID,
      chainId,
      head: head.toString(),
      indexedUpTo: cursor ? Number(cursor.value) : null,
      relayerConfigured: !!relayer,
      voucherSignerConfigured: !!signer,
      smsConfigured: !!(env.SMS_PROVIDER && env.SMS_ACCOUNT_SID && env.SMS_AUTH_TOKEN && env.SMS_FROM_NUMBER),
      oracleEnabled: env.ORACLE_ENABLED === "true",
    };
  });

  app.get("/api/config", async () => ({
    chainId: env.EXPECTED_CHAIN_ID,
    rpcUrl: env.RPC_URL,
    deployment: d,
    voucherSigner: signer?.account.address ?? null,
    gaugeMode: env.GAUGE_MODE,
    knownLimits: KNOWN_LIMITS,
    labels: {
      testnet: true,
      zkProofs: "Semaphore v4 Groth16 proofs, generated on the claimant's device",
      sms: "SMS is only sent through the configured provider; delivery is never assumed",
    },
  }));

  app.get("/api/stats", async () => {
    const rows = all(db, "SELECT name, args FROM events");
    const sum = (name: string, field: string) =>
      rows.filter((r) => r.name === name).reduce((a, r) => a + BigInt((JSON.parse(r.args as string) as Record<string, string>)[field] ?? "0"), 0n);
    const count = (name: string) => rows.filter((r) => r.name === name).length;
    const [poolBalance, issuerBalance, symbol, decimals] = await Promise.all([
      pub.readContract({ address: d.pool, abi: poolAbi, functionName: "balance" }) as Promise<bigint>,
      pub.readContract({ address: d.token, abi: tokenAbi, functionName: "balanceOf", args: [d.issuer] }) as Promise<bigint>,
      pub.readContract({ address: d.token, abi: tokenAbi, functionName: "symbol" }) as Promise<string>,
      pub.readContract({ address: d.token, abi: tokenAbi, functionName: "decimals" }) as Promise<number>,
    ]);
    return JSON.parse(
      json({
        token: { symbol, decimals },
        live: { poolBalance, heldByVoucherIssuer: issuerBalance }, // read directly from chain
        indexed: {
          totalDonated: sum("Deposited", "amount"),
          donations: count("Deposited"),
          triggers: count("Triggered"),
          fallbackUses: count("FallbackUsed"),
          vetoes: count("Vetoed"),
          totalReleased: sum("Released", "tranche"),
          claims: count("Claimed"),
          redemptions: count("Redeemed"),
          totalRedeemed: sum("Redeemed", "amount"),
          expiries: count("Expired"),
          totalReturnedToPool: sum("Expired", "returnedToPool"),
          ngoGroups: count("NgoGroupRegistered"),
        },
        indexedUpTo: Number(get(db, "SELECT value FROM meta WHERE key = 'cursor'")?.value ?? -1),
      }),
    );
  });

  app.get("/api/events", async (req) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0), name: z.string().optional() }).parse(req.query);
    const rows = q.name
      ? all(db, "SELECT * FROM events WHERE name = ? ORDER BY block_number DESC, log_index DESC LIMIT ? OFFSET ?", q.name, q.limit, q.offset)
      : all(db, "SELECT * FROM events ORDER BY block_number DESC, log_index DESC LIMIT ? OFFSET ?", q.limit, q.offset);
    return rows.map((r) => ({ ...r, args: JSON.parse(r.args as string) }));
  });

  app.get("/api/oracle-log", async () => recentOracleLog(db));

  app.get("/api/groups", async () =>
    all(db, "SELECT args FROM events WHERE name = 'NgoGroupRegistered'").map((r) => JSON.parse(r.args as string)),
  );

  app.get("/api/groups/:id/members", async (req, reply) => {
    const { id } = z.object({ id: num }).parse(req.params);
    const rows = all(db, "SELECT idx, commitment FROM group_members WHERE group_id = ? ORDER BY idx", id);
    // Indexing must be gap-free for the client to rebuild the same Merkle root.
    rows.forEach((r, i) => {
      if (r.idx !== i) throw Object.assign(new Error("member index incomplete for this group; try again shortly"), { statusCode: 503 });
    });
    void reply;
    return { groupId: id, members: rows.map((r) => r.commitment), indexedUpTo: Number(get(db, "SELECT value FROM meta WHERE key = 'cursor'")?.value ?? -1) };
  });

  // ---------- NGO group admission ----------
  // Only the registry owner may admit a group. When AUTO_ADMIT_NGO_GROUPS=true the server does it on request, so an NGO does not
  // have to wait for an operator. The NGO address is read from the chain (the group's admin), never taken from the request.
  // This is a testnet convenience: on mainnet admission must stay a governed, human decision.
  app.post("/api/groups/admit", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z.object({ groupId: z.string().regex(/^\d{1,18}$/) }).parse(req.body);
    const groupId = BigInt(body.groupId);
    const registered = (await pub.readContract({ address: d.registry, abi: registryAbi, functionName: "isNgoGroup", args: [groupId] }).catch(() => null)) as boolean | null;
    if (registered === true) return { status: "already-admitted", groupId: body.groupId };
    if (!registrar) return reply.code(503).send({ error: "automatic admission is off on this server; the registry owner must admit the group" });
    let ngo: Hex;
    try {
      ngo = (await pub.readContract({ address: d.semaphore, abi: semaphoreAbi, functionName: "getGroupAdmin", args: [groupId] })) as Hex;
    } catch {
      return reply.code(404).send({ error: "no such Semaphore group on chain" });
    }
    if (/^0x0+$/.test(ngo)) return reply.code(404).send({ error: "no such Semaphore group on chain" });
    try {
      const { request } = await pub.simulateContract({ account: registrar.account, address: d.registry, abi: registryAbi, functionName: "registerNgoGroup", args: [groupId, ngo] });
      const hash = await registrar.client.writeContract(request);
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") return reply.code(502).send({ error: "admission transaction reverted", txHash: hash });
      return { status: "admitted", groupId: body.groupId, ngo, txHash: hash };
    } catch (e) {
      const name = revertName(e);
      return reply.code(name ? 422 : 502).send({ error: name ?? "admission failed" });
    }
  });

  // ---------- relayer: claim ----------
  app.post("/api/claim", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!relayer) return reply.code(503).send({ error: "relayer not configured (RELAYER_PRIVATE_KEY)" });
    const body = claimBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid request", issues: body.error.issues });
    const { eventId, groupId, proof } = body.data;
    const p = {
      merkleTreeDepth: BigInt(proof.merkleTreeDepth),
      merkleTreeRoot: BigInt(proof.merkleTreeRoot),
      nullifier: BigInt(proof.nullifier),
      message: BigInt(proof.message),
      scope: BigInt(proof.scope),
      points: proof.points.map((x) => BigInt(x)) as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint],
    };
    const key = `${p.nullifier}:${p.message}`; // identical retry => same key; same nullifier with a different voucher is NOT a duplicate
    const prior = get(db, "SELECT * FROM relayed_tx WHERE kind = 'claim' AND key = ?", key);
    if (prior && prior.status === "confirmed") return { status: "confirmed", txHash: prior.tx_hash, voucherId: p.message.toString(), duplicate: true };
    if (inflight.has(key) || (prior && prior.status === "pending")) return reply.code(409).send({ error: "claim already in flight" });
    inflight.add(key);
    try {
      // Pre-flight on chain: verifies the zero-knowledge proof and the nullifier before any gas is spent.
      let request;
      try {
        ({ request } = await pub.simulateContract({
          account: relayer.account,
          address: d.registry,
          abi: registryAbi,
          functionName: "claim",
          args: [BigInt(eventId), BigInt(groupId), p],
        }));
      } catch (e) {
        const name = revertName(e);
        return reply.code(name ? 422 : 502).send({ error: name ?? "simulation failed", status: "rejected" });
      }
      run(db, "INSERT INTO relayed_tx (kind, key, status, created_at) VALUES ('claim', ?, 'pending', ?) ON CONFLICT(kind, key) DO UPDATE SET status = 'pending', error = NULL", key, Math.floor(Date.now() / 1000));
      let hash: Hex;
      try {
        hash = await relayer.client.writeContract(request);
      } catch (e) {
        run(db, "UPDATE relayed_tx SET status = 'failed', error = ? WHERE kind = 'claim' AND key = ?", String((e as Error).message).slice(0, 300), key);
        return reply.code(502).send({ error: "submission failed", status: "failed" });
      }
      run(db, "UPDATE relayed_tx SET tx_hash = ? WHERE kind = 'claim' AND key = ?", hash, key);
      const receipt = await pub.waitForTransactionReceipt({ hash });
      const claimed = receipt.status === "success" && receipt.logs.some((l) => {
        if (l.address.toLowerCase() !== d.registry.toLowerCase()) return false;
        try {
          const ev = decodeEventLog({ abi: registryAbi, data: l.data, topics: l.topics });
          return ev.eventName === "Claimed" && (ev.args as unknown as { nullifier: bigint }).nullifier === p.nullifier;
        } catch {
          return false;
        }
      });
      if (!claimed) {
        run(db, "UPDATE relayed_tx SET status = 'failed', error = 'reverted or no Claimed event' WHERE kind = 'claim' AND key = ?", key);
        return reply.code(502).send({ error: "transaction did not produce a Claimed event", status: receipt.status === "success" ? "unverified" : "reverted", txHash: hash });
      }
      run(db, "UPDATE relayed_tx SET status = 'confirmed' WHERE kind = 'claim' AND key = ?", key);
      return { status: "confirmed", txHash: hash, blockNumber: receipt.blockNumber.toString(), voucherId: p.message.toString() };
    } finally {
      inflight.delete(key);
    }
  });

  // ---------- voucher issuance (offline-verifiable) ----------
  async function voucherInfo(secret: Hex) {
    const id = voucherIdOf(secret);
    const v = (await pub.readContract({ address: d.issuer, abi: issuerAbi, functionName: "vouchers", args: [id] })) as [bigint, boolean, boolean];
    if (!v[1]) return null;
    const e = (await pub.readContract({ address: d.issuer, abi: issuerAbi, functionName: "eventInfo", args: [v[0]] })) as [bigint, bigint, bigint, number, number, boolean];
    return { id, eventId: v[0], redeemed: v[2], amount: e[1], expiry: e[2], expired: e[5] };
  }

  app.post("/api/voucher", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!signer) return reply.code(503).send({ error: "voucher signer not configured (VOUCHER_SIGNER_PRIVATE_KEY)" });
    const b = z.object({ voucherSecret: hex32 }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid request" });
    const info = await voucherInfo(b.data.voucherSecret as Hex);
    if (!info) return reply.code(404).send({ error: "no confirmed claim exists for this voucher secret" });
    if (info.redeemed) return reply.code(409).send({ error: "voucher already redeemed" });
    const message = { voucherId: info.id, eventId: info.eventId, amount: info.amount, expiry: info.expiry };
    const signature = await signer.account.signTypedData({
      domain: { name: "FloodFirstVoucher", version: "1", chainId: env.EXPECTED_CHAIN_ID, verifyingContract: d.issuer },
      types: VOUCHER_TYPES,
      primaryType: "Voucher",
      message,
    });
    return JSON.parse(json({ voucher: { secret: b.data.voucherSecret, ...message }, signature, signer: signer.account.address }));
  });

  // ---------- merchant redemption sync ----------
  app.post("/api/redeem", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!relayer) return reply.code(503).send({ error: "relayer not configured" });
    const b = z.object({ voucherSecret: hex32, to: addr }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid request" });
    const secret = b.data.voucherSecret as Hex;
    const key = voucherIdOf(secret).toString();
    const prior = get(db, "SELECT * FROM relayed_tx WHERE kind = 'redeem' AND key = ?", key);
    if (prior && prior.status === "confirmed") return { status: "confirmed", txHash: prior.tx_hash, duplicate: true };
    if (inflight.has("r" + key) || (prior && prior.status === "pending")) return reply.code(409).send({ error: "redemption already in flight" });
    inflight.add("r" + key);
    try {
      let request;
      try {
        ({ request } = await pub.simulateContract({ account: relayer.account, address: d.issuer, abi: issuerAbi, functionName: "redeem", args: [secret, b.data.to as Hex] }));
      } catch (e) {
        const name = revertName(e);
        return reply.code(name ? 422 : 502).send({ error: name ?? "simulation failed", status: "rejected" });
      }
      run(db, "INSERT INTO relayed_tx (kind, key, status, created_at) VALUES ('redeem', ?, 'pending', ?) ON CONFLICT(kind, key) DO UPDATE SET status = 'pending', error = NULL", key, Math.floor(Date.now() / 1000));
      const hash = await relayer.client.writeContract(request);
      run(db, "UPDATE relayed_tx SET tx_hash = ? WHERE kind = 'redeem' AND key = ?", hash, key);
      const receipt = await pub.waitForTransactionReceipt({ hash });
      const ok = receipt.status === "success" && receipt.logs.some((l) => {
        if (l.address.toLowerCase() !== d.issuer.toLowerCase()) return false;
        try {
          const ev = decodeEventLog({ abi: issuerAbi, data: l.data, topics: l.topics });
          return ev.eventName === "Redeemed" && (ev.args as unknown as { voucherId: bigint }).voucherId === BigInt(key);
        } catch {
          return false;
        }
      });
      if (!ok) {
        run(db, "UPDATE relayed_tx SET status = 'failed', error = 'reverted or no Redeemed event' WHERE kind = 'redeem' AND key = ?", key);
        return reply.code(502).send({ error: "transaction did not produce a Redeemed event", txHash: hash });
      }
      run(db, "UPDATE relayed_tx SET status = 'confirmed' WHERE kind = 'redeem' AND key = ?", key);
      return { status: "confirmed", txHash: hash, blockNumber: receipt.blockNumber.toString() };
    } finally {
      inflight.delete("r" + key);
    }
  });

  // ---------- anyone may return expired funds; the relayer pays gas ----------
  app.post("/api/expire", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!relayer) return reply.code(503).send({ error: "relayer not configured" });
    const b = z.object({ eventId: num }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid request" });
    try {
      const { request } = await pub.simulateContract({ account: relayer.account, address: d.issuer, abi: issuerAbi, functionName: "expire", args: [BigInt(b.data.eventId)] });
      const hash = await relayer.client.writeContract(request);
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") return reply.code(502).send({ error: "reverted", txHash: hash });
      return { status: "confirmed", txHash: hash };
    } catch (e) {
      return reply.code(422).send({ error: revertName(e) ?? "failed" });
    }
  });

  // ---------- admin ----------
  app.post("/admin/gauge", async (req, reply) => {
    if (!admin(req)) return reply.code(401).send({ error: "unauthorized" });
    const b = z
      .object({
        value: z.number().nonnegative(),
        unit: z.string().min(1).max(20),
        observedAt: z.number().int().positive().optional(),
        sourceUrl: z.string().url(),
        note: z.string().max(500).default(""),
      })
      .safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid request", issues: b.error.issues });
    const now = Math.floor(Date.now() / 1000);
    const at = b.data.observedAt ?? now;
    if (at > now) return reply.code(400).send({ error: "observedAt is in the future" });
    const scaled = BigInt(Math.round(b.data.value * env.GAUGE_SCALE));
    run(db, "INSERT INTO operator_gauge (value, unit, observed_at, source_url, note, created_at) VALUES (?, ?, ?, ?, ?, ?)", scaled.toString(), b.data.unit, at, b.data.sourceUrl, b.data.note, now);
    return { recorded: true, value: scaled.toString(), publiclyLoggedAs: "operator" };
  });

  app.post("/admin/sms", async (req, reply) => {
    if (!admin(req)) return reply.code(401).send({ error: "unauthorized" });
    const b = z.object({ to: z.string().regex(/^\+\d{8,15}$/), body: z.string().min(1).max(320) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid request" });
    try {
      return await sendSms(db, env, b.data.to, b.data.body);
    } catch (e) {
      return reply.code(503).send({ error: (e as Error).message });
    }
  });

  app.get("/admin/sms/:sid", async (req, reply) => {
    if (!admin(req)) return reply.code(401).send({ error: "unauthorized" });
    const { sid } = z.object({ sid: z.string().regex(/^[A-Za-z0-9]+$/) }).parse(req.params);
    try {
      return await smsStatus(env, sid);
    } catch (e) {
      return reply.code(503).send({ error: (e as Error).message });
    }
  });

  // surface oracle contract thresholds for the dashboard
  app.get("/api/thresholds", async () => {
    const r = (fn: string) => pub.readContract({ address: d.oracle, abi: oracleAbi, functionName: fn }) as Promise<bigint>;
    const [forecast, gauge, maxAge, veto] = await Promise.all([r("forecastThreshold"), r("gaugeThreshold"), r("maxReadingAge"), r("vetoWindow")]);
    return JSON.parse(json({ forecast, gauge, maxReadingAgeSec: maxAge, vetoWindowSec: veto }));
  });

  return app;
}
