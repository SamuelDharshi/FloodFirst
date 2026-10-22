# Backtest report (F12) - generated 2026-10-21

**Scope and limits (read first)**
- Data: Open-Meteo Flood API (GloFAS reanalysis discharge), point 26.19,91.70 (grid cell 26.175003,91.67502), 1984-01-01 to 2025-12-31 (42.0 years, 10592 valid days).
- Forecast leg only. No historical river-gauge data is available (docs/BLOCKERS.md B2), so the 2-of-2 rule is NOT replayed.
- "Event" is a proxy, not an observed damaging flood: discharge >= the 5-year return level (61659 m3/s) of this same series.
- A reanalysis is not an archive of historical forecasts: this does not measure forecast skill or lead time.
- Precision/recall are relative to the proxy event definition and the 3-day look-ahead window.

| Parameter | Value |
| --- | --- |
| Trigger threshold | 43161 m3/s |
| Proxy event level (5-yr return) | 61659 m3/s |
| Trigger episodes | 41 |
| Proxy event episodes | 7 |
| True positive triggers | 5 |
| False positive triggers | 36 |
| Events preceded by a trigger | 5 / 7 |
| Precision | 12.2% |
| Recall | 71.4% |
| Releases allowed by 1-day pool cooldown | 41 |

**Cost of a false positive under the 30% cap:** each false alarm locks at most 30% of the pool balance for 7 days. Funds return to the pool on expiry; the money actually lost is only the share households redeem. With 36 false alarms over 42.0 years (0.86 per year), the *maximum redeemed outlay per false alarm* is 30% of the pool at that time; the realised cost depends on the redemption rate, which is unknown until a pilot (we do not assume one).
