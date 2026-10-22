// API route tests with a STUBBED chain client (test double). They cover validation, auth, DB-backed reads and
// configuration behaviour. Real claim/redeem/voucher paths against real contracts are in e2e.test.ts.
import type { FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, run, setMeta, type Db } from "../src/db.js";
import { buildServer } from "../src/server.js";
import { DEPLOYMENT, KEYS, testEnv } from "./helpers.js";

const TOKEN = "t".repeat(32);
const stubPub = (chainId = 31337) =>
  ({
    getChainId: async () => chainId,
    getBlockNumber: async () => 100n,
    readContract: async ({ functionName }: { functionName: string }) => ({ balance: 5n, balanceOf: 7n, symbol: "FFUSD", decimals: 6, forecastThreshold: 1n, gaugeThreshold: 2n, maxReadingAge: 3n, vetoWindow: 0n })[functionName],
  }) as never;
let db: Db;
let app: FastifyInstance;
const auth = { authorization: `Bearer ${TOKEN}` };

async function make(extra: Record<string, string> = {}, chainId = 31337) {
  db = openDb(":memory:");
  app = await buildServer({ db, pub: stubPub(chainId), env: testEnv({ ADMIN_API_TOKEN: TOKEN, GAUGE_SCALE: "100", ...extra }), d: DEPLOYMENT });
}
const addEvent = (n: number, name: string, args: object) =>
  run(db, "INSERT INTO events (block_number, block_hash, tx_hash, log_index, contract, name, args) VALUES (?, 'h', ?, 0, 'c', ?, ?)", n, `tx${n}${name}`, name, JSON.stringify(args));

describe("server module", () => {
  beforeEach(() => make());

  it("health reports ok, and not-ok on a chain id mismatch", async () => {
    setMeta(db, "cursor", "98");
    const ok = (await app.inject({ url: "/api/health" })).json();
    expect(ok).toMatchObject({ ok: true, chainId: 31337, indexedUpTo: 98, relayerConfigured: false, smsConfigured: false });
    await make({}, 1);
    expect((await app.inject({ url: "/api/health" })).json().ok).toBe(false);
  });

  it("config never leaks any private key and states the testnet limits", async () => {
    await make({ RELAYER_PRIVATE_KEY: KEYS.relayer, VOUCHER_SIGNER_PRIVATE_KEY: KEYS.voucher });
    const body = (await app.inject({ url: "/api/config" })).body;
    for (const k of Object.values(KEYS)) expect(body).not.toContain(k.slice(2));
    const j = JSON.parse(body);
    expect(j.voucherSigner).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(j.knownLimits.join(" ")).toMatch(/TESTNET ONLY/);
  });

  it("lists events newest first, paginates and filters by name", async () => {
    for (let i = 1; i <= 5; i++) addEvent(i, i % 2 ? "Deposited" : "Claimed", { n: i });
    const all = (await app.inject({ url: "/api/events?limit=2" })).json();
    expect(all.map((e: { block_number: number }) => e.block_number)).toEqual([5, 4]);
    const page2 = (await app.inject({ url: "/api/events?limit=2&offset=2" })).json();
    expect(page2.map((e: { block_number: number }) => e.block_number)).toEqual([3, 2]);
    const f = (await app.inject({ url: "/api/events?name=Claimed" })).json();
    expect(f).toHaveLength(2);
    expect((await app.inject({ url: "/api/events?limit=9999" })).statusCode).toBe(400);
  });

  it("serves group members in index order and refuses an incomplete index", async () => {
    run(db, "INSERT INTO group_members (group_id, idx, commitment, block_number) VALUES ('7', 1, '222', 1), ('7', 0, '111', 1)");
    const ok = (await app.inject({ url: "/api/groups/7/members" })).json();
    expect(ok.members).toEqual(["111", "222"]);
    run(db, "INSERT INTO group_members (group_id, idx, commitment, block_number) VALUES ('8', 1, '5', 1)");
    expect((await app.inject({ url: "/api/groups/8/members" })).statusCode).toBe(503);
    expect((await app.inject({ url: "/api/groups/abc/members" })).statusCode).toBe(400);
  });

  it("aggregates stats from indexed events and live chain reads", async () => {
    addEvent(1, "Deposited", { amount: "1000" });
    addEvent(2, "Deposited", { amount: "500" });
    addEvent(3, "Redeemed", { amount: "300" });
    const s = (await app.inject({ url: "/api/stats" })).json();
    expect(s.indexed.totalDonated).toBe("1500");
    expect(s.indexed.donations).toBe(2);
    expect(s.indexed.totalRedeemed).toBe("300");
    expect(s.live.poolBalance).toBe("5");
    expect(s.token.symbol).toBe("FFUSD");
  });

  it("rejects malformed claims, and says the relayer is unavailable when unconfigured", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/claim", payload: { eventId: "1" } });
    expect(bad.statusCode).toBe(503); // no relayer key configured: refuses before anything else
    await make({ RELAYER_PRIVATE_KEY: KEYS.relayer });
    expect((await app.inject({ method: "POST", url: "/api/claim", payload: { eventId: "x" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/redeem", payload: { voucherSecret: "0x12", to: "0x1" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/expire", payload: { eventId: "-1" } })).statusCode).toBe(400);
  });

  it("voucher endpoint needs a signer and a well-formed secret", async () => {
    expect((await app.inject({ method: "POST", url: "/api/voucher", payload: { voucherSecret: "0x" + "11".repeat(32) } })).statusCode).toBe(503);
    await make({ VOUCHER_SIGNER_PRIVATE_KEY: KEYS.voucher });
    expect((await app.inject({ method: "POST", url: "/api/voucher", payload: { voucherSecret: "nope" } })).statusCode).toBe(400);
  });

  it("admin endpoints require the exact bearer token", async () => {
    const p = { value: 1, unit: "m", sourceUrl: "https://s.example" };
    expect((await app.inject({ method: "POST", url: "/admin/gauge", payload: p })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/admin/gauge", payload: p, headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/admin/gauge", payload: p, headers: auth })).statusCode).toBe(200);
    await make({ ADMIN_API_TOKEN: "" });
    expect((await app.inject({ method: "POST", url: "/admin/gauge", payload: p, headers: { authorization: "Bearer " } })).statusCode).toBe(401); // unset token = admin disabled
  });

  it("stores operator gauge readings scaled to whole numbers and rejects bad ones", async () => {
    const post = (payload: object) => app.inject({ method: "POST", url: "/admin/gauge", payload, headers: auth });
    const ok = await post({ value: 49.68, unit: "m", sourceUrl: "https://s.example", note: "t" });
    expect(ok.json().value).toBe("4968");
    expect((await post({ value: -1, unit: "m", sourceUrl: "https://s.example" })).statusCode).toBe(400);
    expect((await post({ value: 1, unit: "m", sourceUrl: "not-a-url" })).statusCode).toBe(400);
    expect((await post({ value: 1, unit: "m", sourceUrl: "https://s.example", observedAt: Math.floor(Date.now() / 1000) + 9999 })).statusCode).toBe(400);
  });

  it("SMS admin route refuses without a provider and requires auth", async () => {
    const p = { to: "+15555550100", body: "hi" };
    expect((await app.inject({ method: "POST", url: "/admin/sms", payload: p })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/admin/sms", payload: p, headers: auth })).statusCode).toBe(503);
    expect((await app.inject({ method: "POST", url: "/admin/sms", payload: { to: "bad", body: "" }, headers: auth })).statusCode).toBe(400);
  });
});

// Single-port mode: the API also serves the built web app (a temp directory of TEST files stands in for web/dist).
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("server static web app (single port)", () => {
  let dist: string;
  let web: FastifyInstance;
  beforeEach(async () => {
    dist = mkdtempSync(join(tmpdir(), "ffdist-"));
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>FloodFirst</title><div id=main></div>");
    writeFileSync(join(dist, "assets", "app-abc123.js"), "console.log(1)");
    writeFileSync(join(dist, "sw.js"), "// sw");
    web = await buildServer({ db: openDb(":memory:"), pub: stubPub(), env: testEnv(), d: DEPLOYMENT, webDist: dist });
  });

  it("serves index.html at / with security headers and no-cache", async () => {
    const r = await web.inject({ url: "/" });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("FloodFirst");
    expect(r.headers["cache-control"]).toBe("no-cache");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-frame-options"]).toBe("DENY");
  });

  it("serves hashed assets as immutable and the service worker as always-revalidate", async () => {
    const a = await web.inject({ url: "/assets/app-abc123.js" });
    expect(a.statusCode).toBe(200);
    expect(a.headers["cache-control"]).toContain("immutable");
    expect((await web.inject({ url: "/sw.js" })).headers["cache-control"]).toBe("no-cache");
  });

  it("falls back to index.html for unknown pages but never for API paths", async () => {
    expect((await web.inject({ url: "/some/page" })).body).toContain("<div id=main>");
    const api = await web.inject({ url: "/api/does-not-exist" });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: "not found" });
    expect((await web.inject({ method: "POST", url: "/anything" })).statusCode).toBe(404);
  });

  it("does not leak files outside the web directory", async () => {
    for (const u of ["/../.env", "/..%2f..%2f.env", "/%2e%2e/%2e%2e/.env"]) {
      const r = await web.inject({ url: u });
      expect(r.body).not.toMatch(/PRIVATE_KEY|EXPECTED_CHAIN_ID/);
    }
  });

  it("does not count static files against the API rate limit, but still serves the API from the same port", async () => {
    for (let i = 0; i < 140; i++) expect((await web.inject({ url: "/assets/app-abc123.js" })).statusCode).toBe(200);
    expect((await web.inject({ url: "/api/health" })).statusCode).toBe(200);
  });
});
