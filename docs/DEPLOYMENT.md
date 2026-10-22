# Deployment runbook (testnet)

The contracts are deployed on Base Sepolia (addresses in [DEPLOYMENTS.md](DEPLOYMENTS.md)). The commands below are the exact path to repeat the deployment with your own funded testnet keys; each step verifies the previous one.

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
3. Admit the group: automatic when `AUTO_ADMIT_NGO_GROUPS=true` (testnet only; the server then needs the registry owner key), otherwise `npm run cli -- register-group <groupId> <ngoAddress>`
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

## Render (free tier): API + web app

`render.yaml` (Blueprint) and the root `Dockerfile` run the API, the indexer and the built web app as **one** service. The container build was **not** run here (no Docker on the dev machine); instead the runtime was simulated: a clean `npm ci --omit=dev` plus `tsx`, started with only `PORT` and the secrets, served `/api/health`, the web page and `/api/config` with the right CORS header.

1. Push this repository to GitHub (done: SamuelDharshi/FloodFirst).
2. In the Render dashboard: **New -> Blueprint**, connect GitHub, pick the repo. Render reads `render.yaml`.
3. Enter the secrets when prompted (they are never stored in git):
   - `RELAYER_PRIVATE_KEY` (a throwaway key with a little Base Sepolia ETH)
   - `VOUCHER_SIGNER_PRIVATE_KEY` (a throwaway key; **the same key whose address you used when deploying**, otherwise merchants will see "not from the voucher signer")
   - `ADMIN_API_TOKEN` (24+ random characters)
   - optional: the three attester keys, only to run the trigger from the server
   - **Do not add the deployer/owner key.** The server does not need it.
4. Deploy. Render builds the image and gives you a URL like `https://floodfirst-api.onrender.com`. Open it: that is the full app.
5. To use it from the Vercel site as well: in Vercel set `VITE_API_URL=https://floodfirst-api.onrender.com` (Project -> Settings -> Environment Variables) and redeploy; `CORS_ORIGINS` in `render.yaml` already allows `https://floodfirst.vercel.app`.

**Free-tier limits you must know:**
- The service **sleeps after about 15 minutes without traffic**; the first request afterwards takes about a minute to wake it.
- The free plan has **no persistent disk**. SQLite lives in `/tmp`, so on every restart the event index is **rebuilt from the chain** (a few minutes of `eth_getLogs` calls; nothing is lost on chain), but the **public oracle log, operator gauge readings and idempotency records are lost**. A paid instance with a disk (or a hosted database) removes this.
- Keep the **owner key off the server** on any network that matters (the testnet-only `AUTO_ADMIT_NGO_GROUPS` option is the deliberate exception); run admin commands (`register-group`, `set-thresholds`, `mint`) from your own machine with `npm run cli`.

