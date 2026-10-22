# Operations

## Health and monitoring
- `GET /api/health`: `ok` false if the RPC chain id differs from `EXPECTED_CHAIN_ID`; `indexedUpTo` should trail `head` by about `CONFIRMATIONS`. Alert if the gap grows past ~50 blocks or `ok` is false.
- Structured JSON logs (pino via Fastify). `Authorization` headers are redacted. No keys or card secrets are ever logged (the server never receives card secrets).
- Public oracle log: `GET /api/oracle-log` and the dashboard. Alert on repeated `forecast` or `gauge-*` failures.

## Backups
- SQLite at `DATABASE_PATH` (WAL). The event index and group members are **fully rebuildable from the chain** (delete the file; the indexer re-syncs from `deployBlock`). Not rebuildable: `oracle_log`, `operator_gauge` (the public audit trail of human-entered readings), `relayed_tx`, `sms_log`. Back up the file nightly (`sqlite3 .backup` or copy while the process is stopped).

## Incidents
| Situation | Action |
| --- | --- |
| Attester key suspected compromised | `owner` calls `setConfig` with new attesters; `npm run cli -- pause` first to stop releases; review recent `Triggered` events |
| False trigger | Funds return on expiry; pause if more are expected; the loss is only what households redeemed |
| Gauge source down | `GAUGE_MODE=operator`; enter readings from the official bulletin; each use shows as `FallbackUsed` on chain |
| Relayer out of gas | Fund the relayer address; claims return 5xx until then (nothing is marked paid) |
| Reorg | Handled by the indexer (checkpoint hash comparison + rollback + re-index); verify `indexedUpTo` advances |
| Stuck/failed redemption | Merchant app keeps the voucher `queued`; re-sync. Expired vouchers are rejected by the chain with `EventIsExpired` |
| Wrong deployment | Deploy again; update `deployments/<chainId>.json`; restart services (new DB file or delete old) |

## Known operational risks
- A single owner key controls pause/params/attesters/NGO admission. Use a multisig before anything beyond a demo.
- Public RPC rate limits (Base Sepolia `sepolia.base.org`) can stall the indexer; use a dedicated RPC endpoint for sustained operation.
- Open-Meteo is free for non-commercial use only.
