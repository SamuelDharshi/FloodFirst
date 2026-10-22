# Blockers (what only you can provide)

| ID | Blocker | What to provide | Blocks |
| --- | --- | --- | --- |
| B1 | No funded Base Sepolia keys | Fill the key lines in `.env` (see comments), fund deployer + relayer from a faucet, then `npm run preflight && npm run deploy` | All public-chain deployment, testnet verification, live demo |
| B2 | No public real-time Brahmaputra gauge API found (CWC and FFWC publish daily PDF bulletins) | Choose: a real gauge JSON endpoint (`GAUGE_MODE=http-json`) or accept operator-entered readings from an official bulletin (`GAUGE_MODE=operator`, default, recorded publicly). Set `GAUGE_THRESHOLD` | Fully automatic 2-of-2; gauge half of F12 backtest |
| B3 | Semaphore address from docs | RESOLVED for existence: has code and answers on Base Sepolia; the deploy script re-checks | none |
| B4 | Open-Meteo licence is non-commercial | Fine for a hackathon demo; pilots need a commercial licence or Copernicus access | production only |
| B5 | No SMS provider credentials | Twilio (or similar) account: `SMS_*` in `.env` | Real SMS delivery |
| B6 | Phone + HTTPS host for the airplane-mode test | Host `web/dist` over HTTPS and test on a real phone | DEMO step 5 proof |
| B7 | No independent audit; single-key owner | Audit + multisig before any use beyond testnet | Any real-value use |
