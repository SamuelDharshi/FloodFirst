/**
 * F12 backtest on REAL GloFAS reanalysis discharge from Open-Meteo (1984-present) for the configured point.
 *
 * What this can and cannot show (stated in the output):
 *  - It replays the FORECAST leg only. No historical river-gauge data is available to us (BLOCKERS B2).
 *  - There is no ground-truth flood-damage record here. "Event" is a PROXY: discharge at or above the
 *    EVENT_RETURN_YEARS return level of this same series. Precision/recall are therefore relative to that proxy.
 *  - A reanalysis is not an archive of past forecasts, so this measures threshold behaviour on the best-estimate
 *    series, not real forecast skill or lead time.
 * Usage: npm run backtest -- <lat> <lon> <triggerThreshold> [eventReturnYears=5] [startYear=1984] [endYear=2025]
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [lat = "26.19", lon = "91.70", trig = "", ryRaw = "5", sy = "1984", ey = "2025"] = process.argv.slice(2);
const eventReturnYears = Number(ryRaw);
const lookaheadDays = 3;
const cooldownDays = 1; // pool's min release interval
const voucherTtlDays = 7;

const url = new URL("https://flood-api.open-meteo.com/v1/flood");
url.searchParams.set("latitude", lat);
url.searchParams.set("longitude", lon);
url.searchParams.set("daily", "river_discharge");
url.searchParams.set("start_date", `${sy}-01-01`);
url.searchParams.set("end_date", `${ey}-12-31`);
const res = await fetch(url);
if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
const j = (await res.json()) as { latitude: number; longitude: number; daily: { time: string[]; river_discharge: (number | null)[] } };
const days = j.daily.time;
const q = j.daily.river_discharge.map((v) => (v === null ? NaN : v));
const valid = q.filter((v) => !Number.isNaN(v));
if (valid.length < 365 * 5) throw new Error("not enough valid data to backtest");

// Return level from annual maxima: sort annual maxima, take the value exceeded on average once per N years.
const byYear = new Map<string, number>();
days.forEach((d, i) => {
  const y = d.slice(0, 4);
  const v = q[i]!;
  if (!Number.isNaN(v)) byYear.set(y, Math.max(byYear.get(y) ?? 0, v));
});
const maxima = [...byYear.values()].sort((a, b) => b - a);
const rank = Math.max(1, Math.round(maxima.length / eventReturnYears));
const eventLevel = maxima[rank - 1]!;
const trigger = trig ? Number(trig) : Math.round(eventLevel * 0.7);

function episodes(pred: (i: number) => boolean, gap: number): number[] {
  const out: number[] = [];
  let last = -1e9;
  for (let i = 0; i < q.length; i++) {
    if (!Number.isNaN(q[i]!) && pred(i)) {
      if (i - last > gap) out.push(i);
      last = i;
    }
  }
  return out;
}
const events = episodes((i) => q[i]! >= eventLevel, 7);
const trigEps = episodes((i) => q[i]! >= trigger, 7);

const hit = (idx: number, set: number[], before: number, after: number) => set.some((s) => s >= idx - before && s <= idx + after);
// A trigger is a true positive if an event episode starts within the next `lookaheadDays` (or is ongoing).
const tp = trigEps.filter((t) => hit(t, events, 0, lookaheadDays) || q[Math.min(t + lookaheadDays, q.length - 1)]! >= eventLevel).length;
const fp = trigEps.length - tp;
const caught = events.filter((e) => hit(e, trigEps, lookaheadDays, 0)).length;
const precision = trigEps.length ? tp / trigEps.length : 0;
const recall = events.length ? caught / events.length : 0;

// Releases are limited by the pool's min interval; count how many releases the cap/cooldown would allow.
let releases = 0;
let lastRel = -1e9;
for (const t of trigEps) if (t - lastRel >= cooldownDays) { releases++; lastRel = t; }
// Exposure per false alarm if the pool were P: 30% locked up to voucherTtlDays, loss = redeemed share only.
const years = (days.length / 365.25).toFixed(1);

const md = `# Backtest report (F12) - generated ${new Date().toISOString().slice(0, 10)}

**Scope and limits (read first)**
- Data: Open-Meteo Flood API (GloFAS reanalysis discharge), point ${lat},${lon} (grid cell ${j.latitude},${j.longitude}), ${days[0]} to ${days.at(-1)} (${years} years, ${valid.length} valid days).
- Forecast leg only. No historical river-gauge data is available (docs/BLOCKERS.md B2), so the 2-of-2 rule is NOT replayed.
- "Event" is a proxy, not an observed damaging flood: discharge >= the ${eventReturnYears}-year return level (${Math.round(eventLevel)} m3/s) of this same series.
- A reanalysis is not an archive of historical forecasts: this does not measure forecast skill or lead time.
- Precision/recall are relative to the proxy event definition and the ${lookaheadDays}-day look-ahead window.

| Parameter | Value |
| --- | --- |
| Trigger threshold | ${trigger} m3/s |
| Proxy event level (${eventReturnYears}-yr return) | ${Math.round(eventLevel)} m3/s |
| Trigger episodes | ${trigEps.length} |
| Proxy event episodes | ${events.length} |
| True positive triggers | ${tp} |
| False positive triggers | ${fp} |
| Events preceded by a trigger | ${caught} / ${events.length} |
| Precision | ${(precision * 100).toFixed(1)}% |
| Recall | ${(recall * 100).toFixed(1)}% |
| Releases allowed by ${cooldownDays}-day pool cooldown | ${releases} |

**Cost of a false positive under the 30% cap:** each false alarm locks at most 30% of the pool balance for ${voucherTtlDays} days. Funds return to the pool on expiry; the money actually lost is only the share households redeem. With ${fp} false alarms over ${years} years (${(fp / Number(years)).toFixed(2)} per year), the *maximum redeemed outlay per false alarm* is 30% of the pool at that time; the realised cost depends on the redemption rate, which is unknown until a pilot (we do not assume one).
`;
const out = resolve(import.meta.dirname, "../../docs/BACKTEST_REPORT.md");
writeFileSync(out, md);
console.log(md);
