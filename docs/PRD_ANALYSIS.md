# PRD Analysis

Source of truth: [FloodFirst-PRD.md](../FloodFirst-PRD.md) (Draft v1, 2026-10-22). Target: public EVM **testnet**.

## 1. PRD-sanctioned mocks vs. the user's "no mock" instruction
PRD section 9 allows four mocks. The user's instruction overrides this: every one is replaced by a real implementation or marked BLOCKED.

| PRD mock | Handling |
| --- | --- |
| Village register / Merkle root | Real Semaphore v4 groups on-chain, real Groth16 proofs. Households are real test enrollees, labelled testnet |
| SMS delivery (F6) | Real SMS provider required; no "sent" status without a provider receipt. BLOCKED until credentials (B5) |
| Stablecoin | Real ERC-20 (`FFUSD`, 6 decimals) deployed on the testnet, labelled valueless test token |
| Fiat cash-out | PRD non-goal; not built, not faked |
| Anchor NGO | No claim of any partner |

## 2. Decisions (all reversible unless stated)
| # | Decision |
| --- | --- |
| D1 | Chain: Base Sepolia (84532), configurable. Low-fee EVM testnet; Semaphore v4 deployed there (verified: address has code, answers `groupCounter()`/`verifier()`) |
| D2 | Proof layer: Semaphore v4 ZK. A plain Merkle proof + nullifier cannot bind the nullifier to the secret without revealing it (see SECURITY_MODEL T1) |
| D3 | Forecast source: Open-Meteo Flood API (GloFAS discharge, keyless, non-commercial licence). Gauge source: BLOCKED (B2), only PDF bulletins found |
| D4 | Oracle: two separate attester keys (forecast, gauge) sign EIP-712 readings; contract enforces both thresholds on-chain, readings are emitted |
| D5 | Voucher = bearer secret. `voucherId = keccak256(voucherSecret) >> 8` is the Semaphore proof `message`. Redeem reveals the secret. Offline merchant check uses a signature by an off-chain voucher signer (not yet built) |
| D6 | Per-claim amount = tranche / total enrolled commitments across registered NGO groups, fixed at release. Unclaimed amounts return on expiry |
| D7 | Wallet-less claim: proof generated on the household/agent device; any relayer submits it. Relayer cannot change recipient: the voucher id is inside the proof |
| D8 | Off-chain persistence: SQLite (Docker/Postgres not installed) |
| D9 | Community reporter: veto only (a tie cannot occur since both sources must independently pass) |
| D10 | Gauge outage fallback: designated operator key; use emits `FallbackUsed` on-chain. The rule for *when* is an open PRD decision |

## 3. Open questions for the user
See [BLOCKERS.md](BLOCKERS.md).
