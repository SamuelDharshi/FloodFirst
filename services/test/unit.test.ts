// Unit tests. Any HTTP responses here are TEST FIXTURES standing in for third-party APIs; they are not evidence
// of live integration (live Open-Meteo access is verified separately by `npm run check:live`).
import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config.js";
import { all, getMeta, openDb, run, setMeta } from "../src/db.js";
import { fetchForecast, fetchGaugeHttp, latestOperatorGauge } from "../src/oracle.js";
import { sendSms } from "../src/sms.js";

const base = { EXPECTED_CHAIN_ID: "84532", RPC_URL: "http://localhost:8545", BASIN_LAT: "26.2", BASIN_LON: "91.7" } as NodeJS.ProcessEnv;
const resp = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("config", () => {
  it("treats empty .env lines as unset and rejects bad keys", () => {
    const env = loadEnv({ ...base, DEPLOYER_PRIVATE_KEY: "" } as NodeJS.ProcessEnv);
    expect(env.DEPLOYER_PRIVATE_KEY).toBeUndefined();
    expect(() => loadEnv({ ...base, RELAYER_PRIVATE_KEY: "0x1234" } as NodeJS.ProcessEnv)).toThrow();
  });
});

describe("forecast source parsing", () => {
  const env = loadEnv({ ...base, ORACLE_FORECAST_HORIZON_DAYS: "2" } as NodeJS.ProcessEnv);
  it("takes the max discharge over the horizon and rounds", async () => {
    const r = await fetchForecast(env, resp({ daily: { river_discharge: [10.4, 99.6, 5000] } }), () => 123);
    expect(r.value).toBe(100n);
    expect(r.observedAt).toBe(123);
  });
  it("fails loudly on HTTP errors, empty and null data instead of inventing a value", async () => {
    await expect(fetchForecast(env, resp({}, 500))).rejects.toThrow(/HTTP 500/);
    await expect(fetchForecast(env, resp({ daily: {} }))).rejects.toThrow(/no river_discharge/);
    await expect(fetchForecast(env, resp({ daily: { river_discharge: [null, null] } }))).rejects.toThrow(/null/);
  });
});

describe("gauge http-json source", () => {
  const env = loadEnv({ ...base, GAUGE_MODE: "http-json", GAUGE_SOURCE_URL: "https://gauge.example/api", GAUGE_JSON_PATH: "data.level", GAUGE_SCALE: "100" } as NodeJS.ProcessEnv);
  it("extracts and scales a nested value", async () => {
    expect((await fetchGaugeHttp(env, resp({ data: { level: "12.345" } }))).value).toBe(1235n);
  });
  it("rejects missing or negative values", async () => {
    await expect(fetchGaugeHttp(env, resp({ data: {} }))).rejects.toThrow();
    await expect(fetchGaugeHttp(env, resp({ data: { level: -1 } }))).rejects.toThrow();
  });
});

describe("database", () => {
  it("migrates idempotently and persists meta", () => {
    const db = openDb(":memory:");
    setMeta(db, "k", "v");
    setMeta(db, "k", "v2");
    expect(getMeta(db, "k")).toBe("v2");
    expect(all(db, "SELECT MAX(version) AS v FROM schema_version")[0]!.v).toBe(1);
  });
  it("only returns fresh, non-future operator gauge readings", () => {
    const db = openDb(":memory:");
    const now = 1_000_000;
    expect(latestOperatorGauge(db, 3600, now)).toBeNull();
    run(db, "INSERT INTO operator_gauge (value, unit, observed_at, source_url, note, created_at) VALUES ('80','cm',?, 'https://s', '', ?)", now - 7200, now);
    expect(latestOperatorGauge(db, 3600, now)).toBeNull(); // stale
    run(db, "INSERT INTO operator_gauge (value, unit, observed_at, source_url, note, created_at) VALUES ('90','cm',?, 'https://s', '', ?)", now - 60, now);
    expect(latestOperatorGauge(db, 3600, now)?.value).toBe(90n);
  });
});

describe("sms", () => {
  it("never pretends to send without provider credentials", async () => {
    const db = openDb(":memory:");
    await expect(sendSms(db, loadEnv(base), "+15555550100", "hi")).rejects.toThrow(/not configured/);
    expect(all(db, "SELECT * FROM sms_log")).toHaveLength(0);
  });
  it("records the provider's own status, not an assumed delivery", async () => {
    const db = openDb(":memory:");
    const env = loadEnv({ ...base, SMS_PROVIDER: "twilio", SMS_ACCOUNT_SID: "ACx", SMS_AUTH_TOKEN: "t", SMS_FROM_NUMBER: "+1555" } as NodeJS.ProcessEnv);
    const r = await sendSms(db, env, "+15555550100", "hi", resp({ sid: "SM1", status: "queued" }));
    expect(r.providerStatus).toBe("queued");
    expect(r.delivered).toBe(false);
  });
});
