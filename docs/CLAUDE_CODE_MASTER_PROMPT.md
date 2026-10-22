# MASTER PROMPT: Build FloodFirst (FloodFirst-PRD.md) as a fully real, on-chain testnet application

## ROLE
Act as principal architect, full-stack engineer, Solidity/security engineer, DevOps and QA engineer. Read `FloodFirst-PRD.md` completely before doing anything. The PRD is the source of truth. Build the actual product, not a prototype. Target: a public EVM testnet (default Base Sepolia, configurable). Never touch mainnet or real funds.

## ABSOLUTE RULES

### 1. Zero mocks, zero simulation
Forbidden: mock APIs, fake or hardcoded data shown as real, fake balances, fake tx hashes or receipts, simulated transactions, fake auth, in-memory stand-ins for required persistence, placeholder logic, buttons that report success without doing the work, artificial delays pretending to be processing, silent fallbacks that return fake success, TODOs for required features, and claims of success without evidence.

The PRD (section 9) permits some mocks. **This project overrides that.** Replace each one:
- Village register / Merkle root: real enrollment. The household generates its own secret on its device; only the commitment goes into a real Semaphore v4 group on-chain; claims use real Groth16 proofs.
- SMS delivery: a real SMS provider. If credentials are missing, mark delivery BLOCKED. Never show "sent" without a provider delivery receipt.
- Test stablecoin: a real ERC-20 deployed and verified on the testnet, labelled as a testnet token. Never invent balances.
- Fiat cash-out: out of scope per PRD non-goals. Do not fake it and do not build UI for it.
- Anchor NGO: never claim a partner or letter of interest.
- River-gauge data: if no real, accessible source exists for the basin, stop that integration and report it BLOCKED. Never substitute synthetic readings.

If any dependency (RPC, funded key, API key, data source, SMS credentials) is missing: name it, say why it is needed and how to configure it, and do not mark the item complete. Never replace it with a mock.

Automated tests may use deterministic fixtures and a local chain, but these must be labelled test data, kept out of production code, and never counted as testnet or live-integration evidence.

### 2. Truthfulness
- Transaction states: not started, signer approval requested, signed, submitted, pending, confirmed, failed/reverted, replaced/dropped, final. A tx hash alone is not success. Verify the receipt, the expected event from the expected contract address, and the resulting on-chain state.
- Backend success means the DB write is verified persisted. Integration success means the real response was validated.
- UI shows genuine loading, empty, error and unavailable states, never sample records. No fabricated balances, flows or data.
- Do not claim ZK if it is not running. Do not claim an audit that has not happened.

### 3. Security and honesty
No secrets in code, logs, frontend bundles or git. Never ask for seed phrases. No unrestricted hot wallet as a shortcut. State known limits in the UI and docs exactly as the PRD requires (double secrets cannot be prevented, oracle collusion, enrollment honesty, false positives).

### 4. Process
Work phase by phase. In each phase: inspect repo state, implement the smallest coherent unit, run lint/type-check/tests, read the real output, fix failures, review for security, update docs. Never weaken or delete tests to get green. Keep `docs/PROGRESS.md`, `docs/BLOCKERS.md`, `docs/IMPLEMENTATION_PLAN.md` and `docs/REQUIREMENTS_TRACEABILITY.md` current so a new session can resume. At each phase end, report: what was built, PRD IDs satisfied, commands run, pass/fail results, what was verified against real services, what is unverified, security concerns, blockers. Do not mark a phase complete unless its exit criteria are met. Ask the user only about decisions that block safe progress (custody, chain, keys, irreversible actions).

## PHASE 1: Analysis, architecture, foundation
Read the PRD and the repo. Produce `docs/PRD_ANALYSIS.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `SECURITY_MODEL.md`, `REQUIREMENTS_TRACEABILITY.md` (every F1-F13, NFR and demo step mapped to components and tests), `.env.example` (names and placeholders only), the repo structure, lint/type/test tooling, and the list of genuine external dependencies. Resolve ambiguities (chain, proof layer, oracle trust model, voucher design, gauge source) and document each decision. Verify external data sources actually exist and are accessible (GloFAS/Open-Meteo, the gauge) and note licence limits.
Exit: all requirements tracked, blockers listed, foundation builds.

## PHASE 2: Backend, database, off-chain logic
A real durable database with migrations. Oracle service reading real forecast and gauge data, applying thresholds, signing attestations with separate keys, and publicly logging the fallback rule when a source is down (F13). Indexer that follows contract events with confirmation depth, reorg handling, idempotency and restart recovery. Relayer API for wallet-less claims (gas only, rate-limited, verifies the proof before spending gas, never holds user secrets). Voucher signing service. Input validation, structured logs, health checks, API docs, integration tests against the real database.
Exit: migrations run, APIs pass integration tests, restarts recover, authorization tests cover allowed and denied cases.

## PHASE 3: Smart contracts and blockchain integration
Contracts: `Pool` (multi-donor deposits, per-donor accounting, 30% cap per release, expiry returns), `TriggerOracle` (2-of-2 EIP-712 attestations from forecast and gauge attesters, readings emitted, replay protection, optional community veto/tie-break), `NullifierRegistry` (per-NGO Semaphore groups, global nullifier set across NGOs, scope = event id), `VoucherIssuer` (EIP-712 signed vouchers, redeem, expire), plus the real test token. Add custom errors, events, reentrancy protection, access control, a pause that never blocks expiry returns. No upgradeability unless justified.
Tests: normal paths, invalid inputs, unauthorized calls, boundaries, reverts, the 30% cap, nullifier reuse across NGOs, attestation replay, reentrancy, fuzz and invariant tests (pool accounting conserves funds), and a real Semaphore proof integration test. Run static analysis (e.g. Slither) and record the findings.
On-chain: verify chain ID, verify the Semaphore address with `eth_getCode` before use, deploy only to the testnet using a user-provided funded key, verify source on the explorer, record addresses and deployment tx hashes in `docs/DEPLOYMENTS.md`. Read real state from the chain; submit real transactions and verify receipts and events.
Exit: contracts compile, tests pass, analysis documented, testnet deployment evidence exists.

## PHASE 4: Frontend (PWA)
Build every PRD flow with real wallets, API and chain: field-agent enrollment (the secret is generated on the device and never leaves it; commitment added on-chain), household wallet-less claim (proof generated client-side, submitted via the relayer), voucher QR, merchant page that verifies signed vouchers **offline** (service worker caching, local queue, sync later), a donor dashboard of aggregate flows from the indexer and chain only, a trigger and fallback log, and a visible failure case showing a false positive, its cost under the 30% cap and the funds returning. Include wallet connect, chain validation, account and chain change handling, double-submit prevention, confirmation for consequential actions, accessibility and responsive layouts. Display the real tx lifecycle states with explorer links. Show the PRD's known limits clearly.
Exit: every control does its real job, UI state matches verified chain and DB state, no sample data anywhere.

## PHASE 5: End-to-end integration, security, QA
Unit, integration, contract, frontend and E2E tests against the real services, with results reported separately: unit, integration, E2E, testnet verification. Include authorization tests, duplicate-request and idempotency tests, RPC outage, revert and reorg handling, restart recovery, and a performance check on the critical flows. Run the real airplane-mode merchant redemption on an actual phone. Review secrets, dependencies, injection, rate limiting, wallet-signing flows, privileged roles and logging/privacy. The F12 backtest must replay a real historical flood with real data and report precision, recall and false-positive cost. If the gauge history is unavailable, F12 stays BLOCKED.
Exit: critical tests pass, every gap is documented and classified, nothing critical is ignored.

## PHASE 6: Deployment and handover
Production-style configuration, secret management, hosting for the frontend and backend, TLS, CORS, security headers, monitoring, backups, health checks, and rollback and incident docs. Deploy only with credentials and authorization I provide; verify the deployed endpoints and the on-chain contracts directly (addresses, chain ID, bytecode). Deliver environment docs, migration and recovery instructions, deployment records, the security review, the test results, the production-readiness checklist, and a final per-requirement report with an honest status for each PRD item.
If access is missing, prepare the artifacts and mark the deployment BLOCKED. Never claim anything is live without checking it.

## DEFINITION OF DONE
A feature is done only when it maps to a PRD requirement, is really implemented and integrated with the real service, persistence is verified, the blockchain lifecycle is verified, validation and security are in place, automated tests pass, the UI reflects true state, and the docs and traceability are updated. A contract that is not deployed, a hash without a receipt, a local test standing in for testnet evidence, or an integration missing credentials is not done.

## START NOW
Do not begin coding yet. First read the PRD and the repo, write the Phase 1 docs, and report blockers and missing credentials. Then continue phase by phase without stopping while the information and access are available. Priority order: correctness, security, real functionality, verifiability, maintainability, UX.
