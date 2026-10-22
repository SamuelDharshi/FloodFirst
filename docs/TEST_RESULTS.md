# Test results

Run on 2026-10-22 on a Windows dev machine. Results are separated by what they can prove. The automated suites run against a local chain. Testnet evidence (deposits, a trigger, a zero-knowledge claim) is listed in [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md) and [DEPLOYMENTS.md](DEPLOYMENTS.md).

## Contract tests (Foundry, local in-memory chain): 48 passed, 0 failed
`cd contracts && forge test`. Uses the real Semaphore v4 contracts and verifier and **real Groth16 proofs** (fixtures from `test/fixtures/generate.mjs`, deterministic test identities, labelled test data).
- Pool: deposits/accounting, 30% cap (512-run fuzz), cooldown, pause, access control, no-enrollee guard.
- TriggerOracle: 2-of-2, thresholds, wrong/rogue/same signer, replay, stale reading, wrong basin/kind, fallback event, veto window, zero attester.
- Registry: valid claim, **same household blocked across two NGOs**, replay, next event allowed, wrong scope/group, tampered message/nullifier, closed/expired event, group cap.
- Issuer: redeem once, unknown voucher, expiry returns funds, false-alarm cost, conservation, access control.
- Invariants (128 runs x 4096 calls, 0 reverts): tokens conserved between pool and issuer; no release above 30%; voucher holdings never exceed donations.
- Line coverage ~85% (summary from `forge coverage`).

## Static analysis
Slither 0.11 run on `src/` (`docs/SLITHER_OUTPUT.txt`). Acted on: required attesters reject zero address; NGO group count bounded (loop in `totalEnrolled`). Remaining findings reviewed and accepted: timestamp comparisons (intended: expiry/cooldown windows), events emitted after calls to trusted in-system contracts, strict equality on `claimAmount == 0`, unindexed address events, `missing-inheritance`. **This is not an audit.**

## Service integration tests (local anvil, real contracts): 12 passed
`cd services && npx vitest run`. Deploys all contracts plus Semaphore to a local anvil chain, then drives the real code paths: operator gauge entry + auth, oracle sign/submit/receipt-verify, indexer (idempotent, restart-safe), real ZK claim through the relayer with on-chain event verification, **cross-NGO duplicate rejection**, identical-claim idempotency (no extra gas), signed-voucher issuance and signature recovery, merchant redemption exactly once, **reorg rollback**, expiry/conservation, input validation, admin auth, SMS refusing to pretend.
Test-only stand-in: the HTTP response from Open-Meteo is a stub in these tests (the local chain test cannot depend on live weather).

## Full run (`node test-all.mjs`, 2026-10-22): ALL STEPS PASSED
| Suite | Result |
| --- | --- |
| Contracts (`forge test`) | 54 passed, 0 failed |
| Services typecheck + vitest | 65 passed, 0 failed (9 files) |
| Web typecheck + vitest (jsdom) + PWA build | 58 passed, 0 failed (11 files); build OK |
| Total | 177 tests |

## Per-module tests (every module has at least 4)
Contracts: TestToken 6, Pool 9, TriggerOracle 15, NullifierRegistry/claims 14, VoucherIssuer 7, invariants 3.
Services (chain client and HTTP are test doubles unless stated): config 6, db 5, chain 5, sms 5, oracle 8, indexer 5 (fake chain with reorg, chunking, restart, member backfill), server routes 10, unit 9, **e2e on a real local chain 12**.
Web (jsdom; wallet, chain and network are test doubles): util 6, api 5, wallet/tx lifecycle 6, txbox 5, voucher offline check 5, dashboard 5, merchant 5, claim 5, donor 5, agent 6, about 5.

## Bugs found and fixed by this round of tests
- API returned HTTP 500 for invalid query/path input (now 400 with issues); an incomplete group-member index now returns 503.
- Claim idempotency keyed only on the nullifier (could echo "confirmed" for a different voucher): now keyed on nullifier + voucher id.
- Indexer used a cached block number (viem cache): disabled with `cacheTime: 0`.
- Donate page could submit a deposit that was bound to revert: now pre-checks balance and approval.
- Gauge thresholds with decimals were silently rounded: now scaled by `GAUGE_SCALE` end to end.

## Real external services verified (read-only, 2026-10-22)
- Base Sepolia public RPC: chain id 84532, Semaphore v4 address has code and answers `groupCounter()` / `verifier()`; `npm run preflight` reaches it.
- Open-Meteo Flood API (GloFAS): live fetch OK (`npm run check:live`); backtest over 1984-2025 completed (`docs/BACKTEST_REPORT.md`).

## NOT verified (honest gaps)
- No contract deployed to a public testnet; no transaction on a public chain; no explorer verification.
- Browser wallet flows (connect, create group, enroll, donate) are implemented and type-checked but were **not exercised in a real browser with a real wallet** here.
- The in-browser proof generation path (claim page) was not run in a browser; the same proof library is exercised in Node by the integration test.
- Real-phone airplane-mode redemption was **not performed**. The offline verification logic is unit-tested and the app shell is cached by a service worker (build succeeds), but it must be done manually on a phone over HTTPS.
- SMS: no provider credentials, so real delivery is untested.
- No load/performance test, no Docker build test, no third-party audit.
