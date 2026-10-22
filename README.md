# FloodFirst

Anticipatory flood cash on an EVM **testnet**. A donor pool pre-funds voucher tranches that release automatically when two independent sources agree (a flood forecast and a river gauge). A shared, privacy-preserving **nullifier registry** (Semaphore v4 zero-knowledge proofs) stops two NGOs paying the same household without either sharing its beneficiary list. Spec: [FloodFirst-PRD.md](FloodFirst-PRD.md).

> **Testnet only. No independent audit.** Tokens have no value. Do not use real funds.

## Layout
| Path | What |
| --- | --- |
| [contracts/](contracts) | Solidity (Foundry): `TestToken`, `Pool`, `VoucherIssuer`, `NullifierRegistry`, `TriggerOracle` + tests |
| [services/](services) | Node/TypeScript: API, relayer, voucher signer, event indexer, oracle, CLI, backtest (SQLite) |
| [web/](web) | PWA: dashboard, donate, field agent, claim, merchant (offline voucher check) |
| [docs/](docs) | Analysis, architecture, security, deployment, operations, test results, traceability |
| [deployments/](deployments) | `<chainId>.json` written by the deploy script (empty until you deploy) |

## Quick start
1. Fill [.env](.env) (see comments inside). Required to deploy: the keys, `GAUGE_THRESHOLD`, `ADMIN_API_TOKEN`.
2. `cd services && npm install && npm run preflight` (read-only readiness check against the live RPC)
3. `npm run deploy` then `npm run verify-deployment`
4. `npm run start` (API + indexer) and in another shell `cd ../web && npm install && npm run dev`

Full steps: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Status of every requirement: [docs/REQUIREMENTS_TRACEABILITY.md](docs/REQUIREMENTS_TRACEABILITY.md). Honest test results: [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md). Open items: [docs/BLOCKERS.md](docs/BLOCKERS.md).

## Tests
- `node test-all.mjs` runs everything below (177 tests + typechecks + web build)
- `cd contracts && npm install && forge install foundry-rs/forge-std --no-git && forge test` (54 tests incl. fuzz + invariants, real Semaphore verifier and real proofs, local chain)
- `cd services && npx vitest run` (needs `anvil` and `forge` on PATH; deploys all contracts to a local chain)
- `cd web && npx vitest run`
