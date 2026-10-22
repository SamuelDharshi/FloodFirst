import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Env } from "./config.js";

export function makeChain(env: Env): Chain {
  return defineChain({
    id: env.EXPECTED_CHAIN_ID,
    name: `chain-${env.EXPECTED_CHAIN_ID}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [env.RPC_URL] } },
  });
}

export function makePublicClient(env: Env): PublicClient {
  return createPublicClient({ chain: makeChain(env), transport: http(env.RPC_URL), cacheTime: 0 });
}

export function makeWallet(env: Env, key: Hex): { account: PrivateKeyAccount; client: WalletClient } {
  const account = privateKeyToAccount(key);
  return { account, client: createWalletClient({ account, chain: makeChain(env), transport: http(env.RPC_URL) }) };
}

/** Refuses to run against the wrong chain: RPC chain id must equal EXPECTED_CHAIN_ID. */
export async function assertChain(env: Env, pub: PublicClient): Promise<void> {
  const id = await pub.getChainId();
  if (id !== env.EXPECTED_CHAIN_ID) {
    throw new Error(`RPC reports chain id ${id}, expected ${env.EXPECTED_CHAIN_ID}. Refusing to continue.`);
  }
}

/** Confirms the contract has bytecode at the recorded address. */
export async function assertHasCode(pub: PublicClient, name: string, address: Hex): Promise<void> {
  const code = await pub.getCode({ address });
  if (!code || code === "0x") throw new Error(`${name} has no bytecode at ${address} on this chain`);
}

export const json = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
