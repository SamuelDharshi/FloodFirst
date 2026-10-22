# Deployment runbook (testnet)

Nothing has been deployed yet: it needs your funded testnet keys ([BLOCKERS B1](BLOCKERS.md)). The commands below are the exact path; each step verifies the previous one.

## 0. Prerequisites
Node 22.13+, Foundry (`forge`, `cast`, `anvil`), a Base Sepolia faucet for ETH.

## 1. Keys
Create one throwaway key per role with `cast wallet new` (deployer, forecast attester, fallback operator, voucher signer, relayer; gauge attester only for `GAUGE_MODE=http-json`). Put them in `.env`. Fund the **deployer** and **relayer** with Base Sepolia ETH. The deployer is the contract **owner**: use a hardware wallet or multisig for anything beyond a demo.

## 2. Parameters
- `FORECAST_THRESHOLD` (m3/s): prefilled with the backtest suggestion 43161. Review `docs/BACKTEST_REPORT.md` first.
- `GAUGE_THRESHOLD`: in the unit of the readings you will enter (e.g. cm of gauge height; use the official danger level of your chosen station).
- `ADMIN_API_TOKEN`: `openssl rand -hex 24`.

## 3. Check, deploy, verify
```
cd services && npm install
npm run preflight            # read-only: env complete, RPC chain id, Semaphore code, balances
npm run deploy               # forge script; refuses mainnets; verifies source if BASESCAN_API_KEY is set
npm run verify-deployment    # reads the chain: bytecode + all cross-contract wiring
```
`npm run deploy` writes `deployments/84532.json` (addresses, deploy block, basin). Copy the printed addresses and transaction hashes into [DEPLOYMENTS.md](DEPLOYMENTS.md). Do not write anything there that is not printed by the tools.

## 4. Seed the system (all real transactions)
1. Mint testnet tokens to donors: `npm run cli -- mint <donor> 1000`
2. An NGO connects its wallet on the web **Field agent** page, creates its group, enrolls households.
3. Admit the group: `npm run cli -- register-group <groupId> <ngoAddress>`
4. Donors approve + deposit on the **Donate** page.

## 5. Run the services
```
npm run start     # API :8787 + indexer; set ORACLE_ENABLED=true to run the trigger loop in-process
```
Gauge readings in operator mode (from an official bulletin; the source URL is stored and publicly shown):
```
curl -X POST $API/admin/gauge -H "Authorization: Bearer $ADMIN_API_TOKEN" -H "content-type: application/json" \
  -d '{"value": 4521, "unit":"cm", "sourceUrl":"https://<official bulletin>", "note":"station X, 08:00"}'
```
Docker: `docker build -f services/Dockerfile -t floodfirst-api .` (not tested in this environment: Docker is not installed here).

## 6. Web
`cd web && cp .env.example .env.local` (set `VITE_API_URL` to the hosted API) `&& npm run build`. Host `web/dist` on any static host (`web/vercel.json` sets security headers). Add the web origin to `CORS_ORIGINS`. Serve the API over HTTPS. The service worker only works over HTTPS (or localhost).

## 7. Smoke tests that move no value
`GET /api/health` (chain id, indexed block), `GET /api/stats`, open the dashboard, load the merchant page once while online then once in airplane mode.

## Rollback / recovery
See [OPERATIONS.md](OPERATIONS.md). Contracts are not upgradeable: a bad deployment is replaced by a new deployment and a new `deployments/<chainId>.json`; the old pool can be left to expire.
