# Requirements Traceability

Last updated 2026-10-22 from live evidence. Status key:
- **VERIFIED (testnet)**: done on Base Sepolia with a transaction or live read as evidence.
- **IMPLEMENTED (tested locally)**: code exists and automated tests pass on a LOCAL chain only.
- **PARTIAL / BLOCKED / NOT DONE**: described in the row.

On-chain evidence so far (see [DEPLOYMENTS.md](DEPLOYMENTS.md)): five contracts deployed and wired; real FFUSD deposit(s) (pool balance 17.00 FFUSD); one NGO group admitted; one household enrolled; one trigger (tx `0x0f33f8ec…18a1`); one zero-knowledge claim; **0 redemptions so far**.

| ID | Requirement | Where | Status | Evidence / gap |
| --- | --- | --- | --- | --- |
| F1 | Pool accepts multi-donor funds, tracks balances | Pool.sol, web Donate | **VERIFIED (testnet)** | Real deposits; live pool balance read from chain. Only one donor wallet used so far |
| F2 | 2-of-2 trigger, emits event | TriggerOracle.sol, services/oracle.ts | **VERIFIED (testnet), with a staged gauge** | Trigger executed with the real GloFAS forecast and an operator-entered **test** gauge reading, with thresholds temporarily lowered then restored. No real-time gauge feed exists (B2) |
| F3 | Release capped at 30% | Pool.sol | **VERIFIED (testnet)** | Pool 10.00 -> 7.00, issuer holds 3.00 (exactly 30%). Fuzz + invariant tests locally |
| F4 | Per-NGO Merkle root with commitments | Semaphore groups + NullifierRegistry | **VERIFIED (testnet)** | Group created in the browser, admitted, household commitment added |
| F5 | Claim with membership proof + nullifier; reject repeats | NullifierRegistry.sol | **VERIFIED (testnet) for the claim; block verified locally** | Real in-browser ZK claim recorded on chain. Rejection of a repeat / second NGO is proven by unit + e2e tests and `SemaphoreGap.t.sol`, **not yet shown on testnet** |
| F6 | Wallet-less claim by code, SMS delivery | web Claim, relayer | **PARTIAL** | Claim by card works with no wallet (verified). **SMS delivery BLOCKED (B5)**: no provider configured; nothing is faked |
| F7 | Signed voucher verifiable offline | /api/voucher, web voucher.ts, Merchant, service worker | **PARTIAL** | Voucher issued and signed on testnet. Offline verification is unit/jsdom-tested; **not yet demonstrated on a real phone in airplane mode** |
| F8 | Merchant redemption sync + record | VoucherIssuer.redeem, /api/redeem | **IMPLEMENTED (tested locally); NOT yet on testnet** | `redeemed = 0` on chain. Needs Merchant -> Verify -> Sync |
| F9 | Expiry returns funds | VoucherIssuer.expire | **IMPLEMENTED (tested locally)** | Event 1792671804 expires 2026-10-29; not yet exercised on testnet |
| F10 | Public aggregate dashboard | indexer, /api/stats, web Dashboard | **VERIFIED** | Live on localhost, Render and Vercel, data from the chain |
| F11 | Community veto | TriggerOracle (veto only) | **IMPLEMENTED (unit-tested)** | Reporter is disabled (zero address) on the deployment |
| F12 | Backtest on a historical flood | services/backtest.ts | **PARTIAL** | Real 1984-2025 GloFAS series, forecast leg only, proxy event definition; no gauge history or damage ground truth |
| F13 | Publicly logged fallback | FallbackUsed event, oracle log | **VERIFIED (testnet)** | `FallbackUsed` emitted and shown on the dashboard |
| NFR-Privacy | No PII on chain | contracts | **VERIFIED by design** | Only hashes, nullifiers, voucher ids, aggregates |
| NFR-LowTech | Basic phone, no wallet | web Claim, Merchant | **PARTIAL** | No wallet needed; proving needs internet and downloads 3-8 MB of circuit files (see FEEDBACK.md) |
| NFR-Transp | Auditable aggregates | indexer + dashboard | **VERIFIED** | |
| NFR-Cost | Low-fee EVM testnet | Base Sepolia | **VERIFIED** | Full deployment cost about 0.00007 ETH |
| NFR-Honesty | Limits and mocks labelled | UI, docs | **VERIFIED** | Test trigger and test reading are labelled; no partner or audit claimed |
| DEMO-1..7 | Demo script | | **NOT DONE** | No recorded video; steps 2-4 reproducible; step 4 (second NGO blocked) shown only in tests; step 5 (airplane mode) not done on a phone; step 7 (false alarm returning funds) waits for expiry |

## Outstanding (ordered)
1. Perform a real redemption (F8) and show it on the dashboard.
2. Record the demo and pitch video; submit on DoraHacks.
3. Airplane-mode redemption on a real phone over HTTPS (F7, DEMO-5).
4. Show a repeat / second-NGO claim being rejected on testnet (F5), which needs a way to enrol an existing card into a second NGO group in the UI.
5. SMS provider (F6), BaseScan verification, multisig, independent audit.
