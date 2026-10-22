import type { Abi } from "viem";
import token from "./abi/TestToken.json" with { type: "json" };
import pool from "./abi/Pool.json" with { type: "json" };
import issuer from "./abi/VoucherIssuer.json" with { type: "json" };
import registry from "./abi/NullifierRegistry.json" with { type: "json" };
import oracle from "./abi/TriggerOracle.json" with { type: "json" };
import semaphore from "./abi/Semaphore.json" with { type: "json" };

// ABIs are exported from the compiled Foundry artifacts by `npm run abis`.
export const tokenAbi = token as Abi;
export const poolAbi = pool as Abi;
export const issuerAbi = issuer as Abi;
export const registryAbi = registry as Abi;
export const oracleAbi = oracle as Abi;
export const semaphoreAbi = semaphore as Abi;

export const READING_TYPES = {
  Reading: [
    { name: "basin", type: "bytes32" },
    { name: "eventId", type: "uint256" },
    { name: "value", type: "uint256" },
    { name: "observedAt", type: "uint64" },
    { name: "kind", type: "uint8" },
  ],
} as const;

export const VOUCHER_TYPES = {
  Voucher: [
    { name: "voucherId", type: "uint256" },
    { name: "eventId", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "expiry", type: "uint64" },
  ],
} as const;
