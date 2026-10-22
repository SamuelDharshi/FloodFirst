import { createPublicClient, createWalletClient, custom, defineChain, http, type Hex, type PublicClient, type TransactionReceipt, type WalletClient } from "viem";
import type { AppConfig } from "./api";

interface Eip1193 {
  request(a: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(ev: string, fn: (...a: unknown[]) => void): void;
}
declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

export const makeChain = (cfg: AppConfig) =>
  defineChain({ id: cfg.chainId, name: `testnet-${cfg.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpcUrl] } } });

export const publicClient = (cfg: AppConfig): PublicClient => createPublicClient({ chain: makeChain(cfg), transport: http(cfg.rpcUrl), cacheTime: 0 });

export interface WalletState {
  address: Hex | null;
  chainId: number | null;
  wrongChain: boolean;
  client: WalletClient | null;
}

const FLAG = "ff.walletDisconnected";
const flagged = (): boolean => { try { return localStorage.getItem(FLAG) === "1"; } catch { return false; } };
const setFlag = (on: boolean): void => { try { if (on) localStorage.setItem(FLAG, "1"); else localStorage.removeItem(FLAG); } catch { /* storage unavailable */ } };

export const wallet: WalletState = { address: null, chainId: null, wrongChain: false, client: null };
const listeners = new Set<() => void>();
export const onWalletChange = (fn: () => void) => listeners.add(fn);
const emit = () => listeners.forEach((f) => f());

export async function refresh(cfg: AppConfig): Promise<void> {
  const eth = window.ethereum;
  if (!eth) return;
  const accounts = (await eth.request({ method: "eth_accounts" })) as Hex[];
  const chainId = Number((await eth.request({ method: "eth_chainId" })) as string);
  wallet.address = flagged() ? null : (accounts[0] ?? null); // stay disconnected after the user chose to disconnect
  wallet.chainId = chainId;
  wallet.wrongChain = chainId !== cfg.chainId;
  wallet.client = wallet.address ? createWalletClient({ account: wallet.address, chain: makeChain(cfg), transport: custom(eth) }) : null;
  emit();
}

export async function connect(cfg: AppConfig): Promise<void> {
  const eth = window.ethereum;
  if (!eth) throw new Error("No browser wallet found. Install a wallet extension such as MetaMask.");
  setFlag(false);
  await eth.request({ method: "eth_requestAccounts" });
  await refresh(cfg);
}

/**
 * Disconnect. A page cannot force a wallet extension to forget it, so this asks the wallet to revoke the site's
 * permission (supported by MetaMask-compatible wallets) AND makes the app forget the wallet until Connect is clicked.
 */
export async function disconnect(): Promise<void> {
  setFlag(true);
  try {
    await window.ethereum?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  } catch {
    /* wallet does not support revoking: the app still forgets it */
  }
  wallet.address = null;
  wallet.client = null;
  wallet.wrongChain = false;
  emit();
}

export async function switchChain(cfg: AppConfig): Promise<void> {
  const eth = window.ethereum;
  if (!eth) throw new Error("No browser wallet found");
  const chainId = "0x" + cfg.chainId.toString(16);
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (e) {
    if ((e as { code?: number }).code === 4902) {
      await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId, chainName: `FloodFirst testnet (${cfg.chainId})`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [cfg.rpcUrl] }] });
    } else throw e;
  }
  await refresh(cfg);
}

export function watchWallet(cfg: AppConfig): void {
  const eth = window.ethereum;
  if (!eth?.on) return;
  eth.on("accountsChanged", () => void refresh(cfg));
  eth.on("chainChanged", () => void refresh(cfg));
  eth.on("disconnect", () => {
    wallet.address = null;
    wallet.client = null;
    emit();
  });
}

export type TxPhase = "wallet" | "submitted" | "pending" | "confirmed" | "verified" | "reverted" | "rejected" | "failed";
export interface TxProgress {
  phase: TxPhase;
  hash?: Hex;
  error?: string;
}

/**
 * Runs a wallet transaction through the full lifecycle. "verified" is reached only after the receipt is
 * successful AND the caller's postcondition check passed against chain state. A hash alone is never success.
 */
export async function runTx(
  cfg: AppConfig,
  send: (c: WalletClient) => Promise<Hex>,
  verify: (receipt: TransactionReceipt, pub: PublicClient) => Promise<void>,
  onProgress: (p: TxProgress) => void,
): Promise<TransactionReceipt | null> {
  if (!wallet.client || !wallet.address) {
    onProgress({ phase: "failed", error: "Connect a wallet first" });
    return null;
  }
  if (wallet.wrongChain) {
    onProgress({ phase: "failed", error: `Wrong network. Switch your wallet to chain ${cfg.chainId}.` });
    return null;
  }
  const pub = publicClient(cfg);
  onProgress({ phase: "wallet" });
  let hash: Hex;
  try {
    hash = await send(wallet.client);
  } catch (e) {
    const code = (e as { code?: number; cause?: { code?: number } }).code ?? (e as { cause?: { code?: number } }).cause?.code;
    if (code === 4001 || /user rejected|denied/i.test(String((e as Error).message))) {
      onProgress({ phase: "rejected", error: "You rejected the request in your wallet." });
    } else {
      onProgress({ phase: "failed", error: (e as Error).message.split("\n")[0] });
    }
    return null;
  }
  onProgress({ phase: "submitted", hash });
  try {
    onProgress({ phase: "pending", hash });
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") {
      onProgress({ phase: "reverted", hash, error: "The transaction was mined but reverted." });
      return receipt;
    }
    onProgress({ phase: "confirmed", hash });
    await verify(receipt, pub);
    onProgress({ phase: "verified", hash });
    return receipt;
  } catch (e) {
    onProgress({ phase: "failed", hash, error: (e as Error).message.split("\n")[0] });
    return null;
  }
}

export const phaseText: Record<TxPhase, string> = {
  wallet: "Waiting for wallet approval…",
  submitted: "Submitted to the network.",
  pending: "Pending: waiting for confirmation…",
  confirmed: "Confirmed on chain. Checking the result…",
  verified: "Done and verified against on-chain state.",
  reverted: "Reverted on chain. Nothing changed.",
  rejected: "Rejected in wallet. Nothing was sent.",
  failed: "Failed.",
};
