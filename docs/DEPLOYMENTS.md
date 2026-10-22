# Deployment records

Network: Base Sepolia (chain id 84532). Deployed from `npm run deploy`; all transactions confirmed (receipt status 1, block 48660539). `npm run verify-deployment` passed all 18 checks (bytecode at every address, all cross-contract wiring, 30% cap, thresholds forecast=43161 and gauge=4968 = 49.68 m x 100). Deploy block recorded: 48660486.

Owner of Pool/Registry/Oracle/Issuer/Token: deployer `0xc37b9189A809f034C38D6E0F9e95785361fbAf42` (single key, no multisig).

| Contract | Address | Deploy transaction |
| --- | --- | --- |
| Semaphore v4 (pre-existing, third-party) | [0xC10E5102A2Cc077BE3B9740Fc0Ad7e27Ff8E0245](https://sepolia.basescan.org/address/0xC10E5102A2Cc077BE3B9740Fc0Ad7e27Ff8E0245) | n/a |
| TestToken (FFUSD) | [0xe19e7da182298878F742c6820E1500e310cDB5fB](https://sepolia.basescan.org/address/0xe19e7da182298878F742c6820E1500e310cDB5fB) | [0xe6bd3e83…5e9f](https://sepolia.basescan.org/tx/0xe6bd3e83b756a5ea2d4caee8936eeb9569cb75196883e884e14b035e86795e9f) |
| VoucherIssuer | [0x869b4625F66fBfF0c3CEAB13d15Db481c3249CDb](https://sepolia.basescan.org/address/0x869b4625F66fBfF0c3CEAB13d15Db481c3249CDb) | [0x5a0d7d28…da7a](https://sepolia.basescan.org/tx/0x5a0d7d282d28256367be27c1bad7a7dffd7d3776aa2b91b4e55bbeec425fda7a) |
| Pool | [0xaC24CCf039F3db09dFccd7511215379315858be7](https://sepolia.basescan.org/address/0xaC24CCf039F3db09dFccd7511215379315858be7) | [0x58a37e48…b817](https://sepolia.basescan.org/tx/0x58a37e4888c8d47bf1f693d215cab09edca7363b3c254add312336892380b817) |
| NullifierRegistry | [0x5cbaa63015fafC35C9A336cEF2Acb34C4f0EDF5F](https://sepolia.basescan.org/address/0x5cbaa63015fafC35C9A336cEF2Acb34C4f0EDF5F) | [0x3512a658…4d3](https://sepolia.basescan.org/tx/0x3512a658429cde3a9114c1dec041b29210e6c34aaa5023fd9bf5f218334a74d3) |
| TriggerOracle | [0x1650a2899523729b303eb52F0331FFA42C21472F](https://sepolia.basescan.org/address/0x1650a2899523729b303eb52F0331FFA42C21472F) | [0xdcc64bc8…1e2d](https://sepolia.basescan.org/tx/0xdcc64bc8f51cd1ddefdab823327f5e68758a3f8f16b4235bfa71eb9567d51e2d) |

Explorer source verification: not performed (no `BASESCAN_API_KEY` was set during deploy). Run `forge verify-contract` per contract if wanted.
Not yet done after deployment: seeding (mint, NGO group, registry admission, donation), running the API, a live trigger, a live claim/redeem.
