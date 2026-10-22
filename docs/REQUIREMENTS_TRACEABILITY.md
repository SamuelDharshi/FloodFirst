# Requirements Traceability

Status key: IMPLEMENTED (tested locally) = code exists and automated tests pass on a LOCAL chain; VERIFIED (testnet) = proven on a public testnet; BLOCKED = needs something only the user can provide. **Nothing is VERIFIED (testnet) yet: no deployment exists (B1).** See [TEST_RESULTS.md](TEST_RESULTS.md).

| ID | Requirement | Where | Status |
| --- | --- | --- | --- |
| F1 | Pool accepts multi-donor funds, tracks balances | Pool.sol, web Donate | IMPLEMENTED (tested locally) |
| F2 | 2-of-2 trigger, emits event | TriggerOracle.sol, services/oracle.ts | IMPLEMENTED (tested locally); live gauge BLOCKED (B2): operator-confirmed mode used |
| F3 | Release capped at 30% | Pool.sol (fuzz + invariant) | IMPLEMENTED (tested locally) |
| F4 | Per-NGO Merkle root with commitments | Semaphore groups + NullifierRegistry, web Field agent | IMPLEMENTED (tested locally) |
| F5 | Claim with membership proof + nullifier; reject repeat | NullifierRegistry.sol, services /api/claim, web Claim | IMPLEMENTED (tested locally, real ZK proofs) |
| F6 | Wallet-less claim by code | web Claim (card code), relayer | IMPLEMENTED (tested locally via API; browser UI not exercised). SMS delivery BLOCKED (B5): no provider credentials, never faked |
| F7 | Signed voucher verifiable offline | services /api/voucher, web voucher.ts + Merchant, service worker | IMPLEMENTED (unit-tested); airplane-mode phone test NOT performed |
| F8 | Merchant sync + redemption record | VoucherIssuer.redeem, /api/redeem, Merchant queue, indexer | IMPLEMENTED (tested locally) |
| F9 | Expiry returns funds | VoucherIssuer.expire, /api/expire | IMPLEMENTED (tested locally) |
| F10 | Public aggregate dashboard | indexer, /api/stats, web Dashboard | IMPLEMENTED (API tested; page not browser-tested) |
| F11 | Community veto | TriggerOracle (veto only; tie-break not needed) | IMPLEMENTED (unit-tested) |
| F12 | Backtest on historical flood | services/backtest.ts, BACKTEST_REPORT.md | PARTIAL: real 1984-2025 GloFAS series, forecast leg only, proxy event definition (no gauge history, no flood-damage ground truth) |
| F13 | Publicly logged fallback | FallbackUsed event, oracle_log, Dashboard | IMPLEMENTED (tested locally) |
| NFR-Privacy | No PII on-chain | contracts store commitments/nullifiers/voucher ids only | By design; reviewed |
| NFR-LowTech | Basic phone, no wallet | web Claim + printed card | Partial: household needs an agent device for proving |
| NFR-Transp | Auditable aggregates | indexer + dashboard | IMPLEMENTED |
| NFR-Cost | Low-fee EVM testnet | Base Sepolia configured | BLOCKED (B1): not deployed |
| NFR-Honesty | Limits and mocks labelled | banner, About page, `knownLimits` | IMPLEMENTED |
| DEMO-1..7 | Demo script | | Steps 2-6 reproducible on a local chain by the e2e test; live demo needs deployment + phone. Step 7 (false alarm cost) is on the dashboard ledger and in a unit test |
