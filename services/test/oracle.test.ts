// Oracle decision logic with a STUBBED chain client and STUBBED HTTP (test doubles). Real signing/submission against
// a real contract is covered by e2e.test.ts.
import { describe, expect, it } from "vitest";
import { all, openDb, run } from "../src/db.js";
import { OracleService, fetchForecast, latestOperatorGauge, logOracle, recentOracleLog } from "../src/oracle.js";
import { DEPLOYMENT, KEYS, jsonResponse, testEnv } from "./helpers.js";

type Fn = Record<string, bigint | boolean>;
const chain = (v: Fn) => ({ readContract: async ({ functionName }: { functionName: string }) => v[functionName] }) as never;
const base: Fn = { forecastThreshold: 100n, gaugeThreshold: 5000n, maxReadingAge: 86400n, lastRelease: 0n, minReleaseInterval: 86400n, paused: false };
const env = (x: Record<string, string> = {}) => testEnv({ FORECAST_ATTESTER_PRIVATE_KEY: KEYS.forecast, RELAYER_PRIVATE_KEY: KEYS.relayer, FALLBACK_ATTESTER_PRIVATE_KEY: KEYS.fallback, ...x });
const forecast = (v: number) => jsonResponse({ daily: { river_discharge: [v, v, v] } });
const now = () => Math.floor(Date.now() / 1000);
const addGauge = (db: ReturnType<typeof openDb>, value: number, ageSec = 60) =>
  run(db, "INSERT INTO operator_gauge (value, unit, observed_at, source_url, note, created_at) VALUES (?, 'cm', ?, 'https://s', '', ?)", String(value), now() - ageSec, now());

describe("oracle module", () => {
  it("logs a forecast failure publicly and never triggers", async () => {
    const db = openDb(":memory:");
    const o = new OracleService(db, chain(base), env(), DEPLOYMENT, jsonResponse({}, 503));
    expect(await o.tick()).toBeNull();
    const log = recentOracleLog(db);
    expect(log[0]).toMatchObject({ source: "forecast", ok: 0 });
  });

  it("does nothing when the forecast is below the on-chain threshold", async () => {
    const db = openDb(":memory:");
    addGauge(db, 9000);
    const o = new OracleService(db, chain(base), env(), DEPLOYMENT, forecast(50));
    expect(await o.tick()).toBeNull();
    expect(all(db, "SELECT * FROM triggers_submitted")).toHaveLength(0);
  });

  it("does nothing without a fresh operator gauge reading, and says why", async () => {
    const db = openDb(":memory:");
    const o = new OracleService(db, chain(base), env(), DEPLOYMENT, forecast(500));
    expect(await o.tick()).toBeNull();
    expect(recentOracleLog(db).some((l) => l.source === "gauge-operator" && l.ok === 0)).toBe(true);
  });

  it("does nothing when the gauge reading is below its threshold even if the forecast passes", async () => {
    const db = openDb(":memory:");
    addGauge(db, 4000);
    const o = new OracleService(db, chain(base), env(), DEPLOYMENT, forecast(500));
    expect(await o.tick()).toBeNull();
    expect(all(db, "SELECT * FROM triggers_submitted")).toHaveLength(0);
  });

  it("does not submit while the pool is paused or the cooldown has not elapsed", async () => {
    const db = openDb(":memory:");
    addGauge(db, 9000);
    expect(await new OracleService(db, chain({ ...base, paused: true }), env(), DEPLOYMENT, forecast(500)).tick()).toBeNull();
    expect(recentOracleLog(db)[0]!.detail).toMatch(/paused/);
    const recent = BigInt(now() - 10);
    expect(await new OracleService(db, chain({ ...base, lastRelease: recent }), env(), DEPLOYMENT, forecast(500)).tick()).toBeNull();
    expect(recentOracleLog(db)[0]!.detail).toMatch(/minimum release interval/);
    expect(all(db, "SELECT * FROM triggers_submitted")).toHaveLength(0);
  });

  it("requires its signing keys and refuses to run without them", async () => {
    const o = new OracleService(openDb(":memory:"), chain(base), testEnv(), DEPLOYMENT, forecast(500));
    await expect(o.tick()).rejects.toThrow(/required/);
  });

  it("uses a stale operator reading as 'no reading' and ignores future-dated ones", () => {
    const db = openDb(":memory:");
    addGauge(db, 1, 90000);
    expect(latestOperatorGauge(db, 3600)).toBeNull();
    run(db, "INSERT INTO operator_gauge (value, unit, observed_at, source_url, note, created_at) VALUES ('5','m',?, 'https://s','',?)", now() + 1000, now());
    expect(latestOperatorGauge(db, 3600)).toBeNull();
    logOracle(db, "x", true, 1n, "d");
    expect(recentOracleLog(db, 1)).toHaveLength(1);
  });

  it("takes the maximum discharge over the horizon only", async () => {
    const e = env({ ORACLE_FORECAST_HORIZON_DAYS: "2" });
    const r = await fetchForecast(e, jsonResponse({ daily: { river_discharge: [10, 70, 9999] } }));
    expect(r.value).toBe(70n);
  });
});
