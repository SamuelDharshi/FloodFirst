# Security Model

| ID | Threat | Response / status |
| --- | --- | --- |
| T1 | Plain Merkle proof + nullifier is not bound to the secret; revealing the secret exposes all future events | Semaphore ZK: nullifier derived in-circuit from secret and scope=eventId. Tested with real proofs (forged nullifier and swapped message are rejected) |
| T2 | Relayer or observer redirects a claim | Voucher id is the proof `message`; changing it invalidates the proof (tested) |
| T3 | Same household paid by two NGOs | Registry keeps one global nullifier set across all NGO groups (tested with same identity in two groups) |
| T4 | One household, two secrets | NOT preventable (PRD 5.2). Must be stated in UI/pitch |
| T5 | Oracle collusion / compromise | Two distinct keys required, thresholds on-chain, readings emitted; 30% cap and expiry bound loss. Collusion of both remains possible (PRD 12) |
| T6 | Attestation replay | EIP-712 domain includes chain id and contract; event ids single use; freshness window (tested) |
| T7 | Repeated triggers drain the pool | 30% of current balance per release plus min interval; still geometric drain over time, documented |
| T8 | Voucher theft / front-run | Bearer instrument: whoever learns the secret can redeem; redeem reveals it. Mempool front-running not mitigated on-chain; Base Sepolia sequencer has no public mempool. Offline double-spend before sync: first sync wins |
| T9 | Reentrancy, token quirks | ReentrancyGuard on state-changing token flows, SafeERC20, balance-delta accounting on deposit |
| T10 | Key exposure | Keys only in env/secret store, never in frontend or git |
| T11 | Privacy | On-chain: commitments (inside Semaphore groups), nullifiers, voucher ids, aggregate amounts. Group membership and nullifier timing are public metadata |
| T12 | NGO dilutes claims by adding fake commitments | Trust assumption on registered NGOs (owner admits groups). Documented |

Privileged roles: contract owner (pause releases, set thresholds/attesters/params, admit NGO groups). No upgradeability. Owner is a single key right now; a multisig is needed before any real use.

## Review status
- **No independent audit has been performed.** Testnet only.
- Slither was run ([SLITHER_OUTPUT.txt](SLITHER_OUTPUT.txt)). Hardening applied: required attesters must be non-zero; NGO group count capped at 64 to bound the loop in `totalEnrolled()`.
- Services: the relayer simulates every claim/redeem on chain before spending gas, verifies the expected event in the receipt, dedupes by (nullifier, voucher id), and rate limits per route. The admin API needs a bearer token (24+ chars) and is never called from the browser. Secrets come only from the environment. CORS is limited to configured origins.
- Web: all server-provided strings are HTML-escaped. The household card secret is never sent anywhere and never stored. The voucher secret is sent only to get a signed voucher and to redeem (bearer instrument by design).
- Residual risks: single owner key; two off-chain attesters can collude; relayer is a liveness dependency; public RPC; saved vouchers in browser localStorage are bearer instruments on shared devices; offline double-accept across merchant devices is only caught at sync (first sync wins); forecast data quality is not independently validated.
