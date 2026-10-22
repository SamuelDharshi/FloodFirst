# Architecture

```
contracts/   Foundry (Solidity 0.8.28): TestToken, Pool, VoucherIssuer, NullifierRegistry, TriggerOracle
services/    Node 22 + TypeScript: oracle, indexer, relayer, voucher signer (SQLite)   
web/         PWA: agent enrollment, claim, merchant offline verify, donor dashboard    
docs/        documentation set
```

| Component | Responsibility |
| --- | --- |
| Pool | Multi-donor deposits with per-donor accounting; `release` only callable by TriggerOracle; tranche <= 30% of current balance; min interval between releases; pause stops releases only |
| TriggerOracle | `trigger(forecast, sig, gauge, sig)`: EIP-712 readings for same basin and event id, fresh, both over on-chain thresholds, signed by distinct forecast and gauge (or fallback) keys; optional veto window with reporter veto; event ids single use |
| NullifierRegistry | Owner admits NGO Semaphore groups. `claim(eventId, groupId, proof)`: proof.scope must equal eventId, global nullifier set across all NGO groups, Semaphore `verifyProof`, then registers the voucher |
| VoucherIssuer | Holds tranche; opens event with claimAmount and expiry; registers vouchers; `redeem(secret,to)`; `expire(eventId)` returns unredeemed funds to the pool |
| Services | Oracle: reads Open-Meteo and gauge, signs readings, posts trigger, publishes fallback log. Indexer: confirmation depth + reorg safe, SQLite. Relayer: gas-only claim submission, rate limited. Signer: issues offline-verifiable voucher after seeing the on-chain claim |
| Web  | Secret and proof generation on device; merchant page verifies offline (service worker); dashboard shows aggregate indexed events only |

Flow: deposit -> NGOs create/fill Semaphore groups -> oracle triggers -> Pool releases <=30% to VoucherIssuer -> household proof via relayer -> voucher -> merchant redeem -> expiry back to pool.

Trust boundaries: household device (secrets), relayer (gas only), attesters (two keys), voucher signer (offline check only), contracts (authority).
