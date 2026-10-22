# FloodFirst contracts

Solidity 0.8.28 (Foundry). `TestToken`, `Pool`, `VoucherIssuer`, `NullifierRegistry`, `TriggerOracle`.
Uses OpenZeppelin 5 and Semaphore v4 (installed with npm).

## Setup
```
npm install                                      # OpenZeppelin, Semaphore, proof tooling for the fixtures
forge install foundry-rs/forge-std --no-git      # test library (lib/ is git-ignored)
forge test                                       # 54 tests incl. fuzz + invariants, local chain
```

Deploy with `cd ../services && npm run deploy` (testnet only; see ../docs/DEPLOYMENT.md).
Test proofs in `test/fixtures/proofs.json` are real Groth16 proofs over deterministic TEST identities.
