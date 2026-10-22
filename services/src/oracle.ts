import type { Address, Hex, PublicClient } from "viem";
import { decodeEventLog } from "viem";
import { oracleAbi, poolAbi, READING_TYPES } from "./abi.js";
import { makeWallet } from "./chain.js";
import type { Deployment, Env } from "./config.js";
import { all, get, run, type Db } from "./db.js";

/**
 * Oracle service: reads the REAL forecast (GloFAS discharge via Open-Meteo) and a gauge reading, and when both
 * meet the thresholds stored in the TriggerOracle contract, signs the two EIP-712 readings (with two separate
 * keys) and submits the trigger. Everything is logged publicly (oracle_log).
 *
 * Gauge sources:
 *  - "http-json": a real JSON endpoint you configure (GAUGE_SOURCE_URL + GAUGE_JSON_PATH).
 *  - "operator":  a human operator enters a reading taken from an official bulletin, with its source URL, via the
 *                 authenticated admin API. This is the PRD's "designated human operator confirmation" path. It is
 *                 signed with the FALLBACK key, so the contract emits FallbackUsed publicly.
 * If the http-json source has been failing for GAUGE_OUTAGE_WINDOW_SEC, a fresh operator reading may be used as the
 * fallback (also signed with the fallback key and logged). No source ever returns invented values.
 */

export interface Reading {
  value: bigint;
  observedAt: number;
  source: string;
}

export type Fetcher = typeof fetch;

export async function fetchForecast(
  env: Env,
  fetcher: Fetcher = fetch,
  now = () => Math.floor(Date.now() / 1000),
): Promise<Reading> {
  if (env.BASIN_LAT === undefined || env.BASIN_LON === undefined) throw new Error("BASIN_LAT/BASIN_LON not configured");
  const url = new URL("https://flood-api.open-meteo.com/v1/flood");
  url.searchParams.set("latitude", String(env.BASIN_LAT));
  url.searchParams.set("longitude", String(env.BASIN_LON));
  url.searchParams.set("daily", "river_discharge");
  url.searchParams.set("forecast_days", String(Math.max(env.ORACLE_FORECAST_HORIZON_DAYS, 1)));
  const res = await fetcher(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Open-Meteo flood API HTTP ${res.status}`);
  const body = (await res.json()) as { daily?: { river_discharge?: (number | null)[] } };
  const series = body.daily?.river_discharge;
  if (!Array.isArray(series) || series.length === 0) throw new Error("Open-Meteo response has no river_discharge");
  const vals = series.slice(0, env.ORACLE_FORECAST_HORIZON_DAYS).filter((v): v is number => typeof v === "number");
  if (vals.length === 0) throw new Error("Open-Meteo returned only null discharge values");
  return {
    value: BigInt(Math.round(Math.max(...vals))),
    observedAt: now(),
    source: `open-meteo-glofas max discharge m3/s over next ${env.ORACLE_FORECAST_HORIZON_DAYS}d`,
  };
}

function pick(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export async function fetchGaugeHttp(
  env: Env,
  fetcher: Fetcher = fetch,
  now = () => Math.floor(Date.now() / 1000),
): Promise<Reading> {
  if (!env.GAUGE_SOURCE_URL || !env.GAUGE_JSON_PATH) throw new Error("GAUGE_SOURCE_URL/GAUGE_JSON_PATH not configured");
  const res = await fetcher(env.GAUGE_SOURCE_URL, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`gauge source HTTP ${res.status}`);
  const v = pick(await res.json(), env.GAUGE_JSON_PATH);
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) throw new Error("gauge value missing or not a number");
  return { value: BigInt(Math.round(n * env.GAUGE_SCALE)), observedAt: now(), source: env.GAUGE_SOURCE_URL };
}

export function latestOperatorGauge(db: Db, maxAgeSec: number, now = Math.floor(Date.now() / 1000)): Reading | null {
  const r = get(db, "SELECT value, observed_at, source_url FROM operator_gauge ORDER BY observed_at DESC LIMIT 1");
  if (!r) return null;
  const at = r.observed_at as number;
  if (now - at > maxAgeSec || at > now) return null;
  return { value: BigInt(r.value as string), observedAt: at, source: `operator:${r.source_url as string}` };
}

export function logOracle(db: Db, source: string, ok: boolean, value: bigint | null, detail: string): void {
  run(
    db,
    "INSERT INTO oracle_log (ts, source, ok, value, detail) VALUES (?, ?, ?, ?, ?)",
    Math.floor(Date.now() / 1000),
    source,
    ok ? 1 : 0,
    value === null ? null : value.toString(),
    detail,
  );
}

export class OracleService {
  constructor(
    private readonly db: Db,
    private readonly pub: PublicClient,
    private readonly env: Env,
    private readonly d: Deployment,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  private async onChainThresholds() {
    const read = (fn: string) =>
      this.pub.readContract({ address: this.d.oracle, abi: oracleAbi, functionName: fn }) as Promise<bigint>;
    const [f, g, maxAge] = await Promise.all([read("forecastThreshold"), read("gaugeThreshold"), read("maxReadingAge")]);
    return { forecast: f, gauge: g, maxAge: Number(maxAge) };
  }

  private gaugeFailingSince(): number | null {
    // First failure after the last success of the http-json source.
    const lastOk = get(this.db, "SELECT MAX(ts) AS ts FROM oracle_log WHERE source = 'gauge-http' AND ok = 1");
    const firstFail = get(
      this.db,
      "SELECT MIN(ts) AS ts FROM oracle_log WHERE source = 'gauge-http' AND ok = 0 AND ts > ?",
      (lastOk?.ts as number | null) ?? 0,
    );
    return (firstFail?.ts as number | null) ?? null;
  }

  /** One evaluation cycle. Returns the trigger tx hash if a trigger was submitted. */
  async tick(): Promise<Hex | null> {
    const env = this.env;
    if (!env.FORECAST_ATTESTER_PRIVATE_KEY || !env.RELAYER_PRIVATE_KEY) {
      throw new Error("FORECAST_ATTESTER_PRIVATE_KEY and RELAYER_PRIVATE_KEY are required to run the oracle");
    }
    const th = await this.onChainThresholds();
    const now = Math.floor(Date.now() / 1000);

    let forecast: Reading;
    try {
      forecast = await fetchForecast(env, this.fetcher);
      logOracle(this.db, "forecast", true, forecast.value, forecast.source);
    } catch (e) {
      logOracle(this.db, "forecast", false, null, String((e as Error).message));
      return null;
    }

    let gauge: Reading | null = null;
    let viaFallback = false;
    if (env.GAUGE_MODE === "http-json") {
      try {
        gauge = await fetchGaugeHttp(env, this.fetcher);
        logOracle(this.db, "gauge-http", true, gauge.value, gauge.source);
      } catch (e) {
        logOracle(this.db, "gauge-http", false, null, String((e as Error).message));
        const since = this.gaugeFailingSince();
        if (since !== null && now - since >= env.GAUGE_OUTAGE_WINDOW_SEC) {
          gauge = latestOperatorGauge(this.db, th.maxAge);
          if (gauge) {
            viaFallback = true;
            logOracle(
              this.db,
              "fallback",
              true,
              gauge.value,
              `gauge source down since ${since}; using operator-confirmed reading from ${gauge.source}`,
            );
          }
        }
      }
    } else {
      gauge = latestOperatorGauge(this.db, th.maxAge);
      viaFallback = true;
      if (gauge) logOracle(this.db, "gauge-operator", true, gauge.value, gauge.source);
      else logOracle(this.db, "gauge-operator", false, null, "no fresh operator-entered gauge reading");
    }
    if (!gauge) return null;

    if (forecast.value < th.forecast || gauge.value < th.gauge) return null; // below threshold: no trigger

    // Do not spam: the pool enforces a minimum interval between releases and can be paused.
    const rd = (fn: string) =>
      this.pub.readContract({ address: this.d.pool, abi: poolAbi, functionName: fn }) as Promise<bigint | boolean>;
    const [last, minInt, paused] = await Promise.all([rd("lastRelease"), rd("minReleaseInterval"), rd("paused")]);
    if (paused === true) {
      logOracle(this.db, "trigger", false, null, "thresholds met but pool releases are paused");
      return null;
    }
    if ((last as bigint) !== 0n && BigInt(now) < (last as bigint) + (minInt as bigint)) {
      logOracle(this.db, "trigger", false, null, "thresholds met but minimum release interval has not elapsed");
      return null;
    }

    const gaugeKey = viaFallback ? env.FALLBACK_ATTESTER_PRIVATE_KEY : env.GAUGE_ATTESTER_PRIVATE_KEY;
    if (!gaugeKey) throw new Error(viaFallback ? "FALLBACK_ATTESTER_PRIVATE_KEY missing" : "GAUGE_ATTESTER_PRIVATE_KEY missing");

    const eventId = BigInt(now);
    const domain = {
      name: "FloodFirstTriggerOracle",
      version: "1",
      chainId: env.EXPECTED_CHAIN_ID,
      verifyingContract: this.d.oracle,
    } as const;
    const mk = (r: Reading, kind: 0 | 1) => ({
      basin: this.d.basin,
      eventId,
      value: r.value,
      observedAt: BigInt(r.observedAt),
      kind,
    });
    const f = mk(forecast, 0);
    const g = mk(gauge, 1);
    const fWallet = makeWallet(env, env.FORECAST_ATTESTER_PRIVATE_KEY);
    const gWallet = makeWallet(env, gaugeKey as Hex);
    const fSig = await fWallet.account.signTypedData({ domain, types: READING_TYPES, primaryType: "Reading", message: f });
    const gSig = await gWallet.account.signTypedData({ domain, types: READING_TYPES, primaryType: "Reading", message: g });

    const sender = makeWallet(env, env.RELAYER_PRIVATE_KEY);
    run(
      this.db,
      `INSERT OR IGNORE INTO triggers_submitted (event_id, status, forecast_value, gauge_value, used_fallback, created_at)
       VALUES (?, 'submitting', ?, ?, ?, ?)`,
      eventId.toString(),
      forecast.value.toString(),
      gauge.value.toString(),
      viaFallback ? 1 : 0,
      now,
    );
    try {
      const { request } = await this.pub.simulateContract({
        account: sender.account,
        address: this.d.oracle,
        abi: oracleAbi,
        functionName: "trigger",
        args: [f, fSig, g, gSig],
      });
      const hash = await sender.client.writeContract(request);
      run(this.db, "UPDATE triggers_submitted SET tx_hash = ?, status = 'pending' WHERE event_id = ?", hash, eventId.toString());
      const receipt = await this.pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("trigger transaction reverted");
      // Postcondition: the contract must have emitted TriggerPending/Triggered for this event id.
      const seen = receipt.logs.some((l) => {
        if (l.address.toLowerCase() !== this.d.oracle.toLowerCase()) return false;
        try {
          const ev = decodeEventLog({ abi: oracleAbi, data: l.data, topics: l.topics });
          return (
            (ev.eventName === "TriggerPending" || ev.eventName === "Triggered") &&
            (ev.args as unknown as { eventId: bigint }).eventId === eventId
          );
        } catch {
          return false;
        }
      });
      if (!seen) throw new Error("receipt contains no trigger event for this event id");
      run(this.db, "UPDATE triggers_submitted SET status = 'confirmed' WHERE event_id = ?", eventId.toString());
      logOracle(this.db, "trigger", true, forecast.value, `trigger ${eventId} confirmed in ${hash}`);
      return hash;
    } catch (e) {
      const msg = String((e as Error).message).slice(0, 500);
      run(this.db, "UPDATE triggers_submitted SET status = 'failed', error = ? WHERE event_id = ?", msg, eventId.toString());
      logOracle(this.db, "trigger", false, null, msg);
      throw e;
    }
  }

  start(onError: (e: unknown) => void): () => void {
    let stopped = false;
    const loop = async () => {
      while (!stopped) {
        try {
          await this.tick();
        } catch (e) {
          onError(e);
        }
        await new Promise((r) => setTimeout(r, this.env.ORACLE_INTERVAL_SEC * 1000));
      }
    };
    void loop();
    return () => {
      stopped = true;
    };
  }
}

export function recentOracleLog(db: Db, limit = 100) {
  return all(db, "SELECT ts, source, ok, value, detail FROM oracle_log ORDER BY id DESC LIMIT ?", limit);
}

export type { Address };
