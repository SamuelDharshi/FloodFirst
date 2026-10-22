import { parseUnits } from "viem";
import type { AppConfig } from "../api";
import { poolAbi, tokenAbi } from "../abis";
import { txBox } from "../txbox";
import { $, esc, fmtUnits, msg } from "../util";
import { publicClient, runTx, wallet } from "../wallet";

export function donor(root: HTMLElement, cfg: AppConfig | null): void {
  if (!cfg) { root.innerHTML = `<h1>Donate</h1>${msg("err", "Cannot reach the FloodFirst API and no cached configuration exists.")}`; return; }
  const c = cfg;
  root.innerHTML = `<h1>Donate to the <em>pool</em></h1>
    <p class="muted">Testnet only. FFUSD is a valueless test token. If you need some, the contract owner can mint it to your address with <code>npm run cli -- mint &lt;your address&gt; &lt;amount&gt;</code>.</p>
    ${wallet.address ? "" : msg("info", "Connect your wallet (top right) first.")}
    <section class="card"><div id="bal" class="muted">Reading your balance…</div>
    <label for="amt">Amount (FFUSD)</label><input id="amt" inputmode="decimal" value="10" />
    <div class="row" style="margin-top:12px"><button id="appr" class="secondary">1. Approve</button><button id="dep">2. Deposit</button></div>
    <div id="tx"></div></section>`;
  const tx = txBox($(root, "#tx"));
  const appr = $<HTMLButtonElement>(root, "#appr");
  const dep = $<HTMLButtonElement>(root, "#dep");
  const pub = publicClient(c);

  async function bal() {
    if (!wallet.address) return;
    try {
      const [b, a, d] = await Promise.all([
        pub.readContract({ address: c.deployment.token, abi: tokenAbi, functionName: "balanceOf", args: [wallet.address] }),
        pub.readContract({ address: c.deployment.token, abi: tokenAbi, functionName: "allowance", args: [wallet.address, c.deployment.pool] }),
        pub.readContract({ address: c.deployment.pool, abi: poolAbi, functionName: "donated", args: [wallet.address] }),
      ]);
      $(root, "#bal").innerHTML = `Your balance: <b>${esc(fmtUnits(b, 6))}</b> FFUSD · approved to pool: ${esc(fmtUnits(a, 6))} · you have donated: ${esc(fmtUnits(d, 6))}`;
    } catch (e) { $(root, "#bal").innerHTML = msg("err", `Balance unavailable: ${(e as Error).message}`); }
  }
  void bal();

  const amount = (): bigint | null => {
    try { const v = parseUnits($<HTMLInputElement>(root, "#amt").value.trim(), 6); return v > 0n ? v : null; } catch { return null; }
  };

  async function precheck(v: bigint, needAllowance: boolean): Promise<string | null> {
    if (!wallet.address) return "Connect your wallet first.";
    const [b, a] = await Promise.all([
      pub.readContract({ address: c.deployment.token, abi: tokenAbi, functionName: "balanceOf", args: [wallet.address] }),
      pub.readContract({ address: c.deployment.token, abi: tokenAbi, functionName: "allowance", args: [wallet.address, c.deployment.pool] }),
    ]);
    if (b < v) return `You only have ${fmtUnits(b, 6)} FFUSD. Ask the contract owner to mint test tokens to ${wallet.address}.`;
    if (needAllowance && a < v) return "Not approved yet. Click \"1. Approve\" first and confirm it, then deposit.";
    return null;
  }

  appr.onclick = async () => {
    const v = amount();
    if (!v) { tx({ phase: "failed", error: "Enter a positive amount." }); return; }
    const why = await precheck(v, false).catch((e) => (e as Error).message);
    if (why) { tx({ phase: "failed", error: why }); return; }
    appr.disabled = true;
    try {
      await runTx(c, (w) => w.writeContract({ address: c.deployment.token, abi: tokenAbi, functionName: "approve", args: [c.deployment.pool, v], account: wallet.address!, chain: null }),
        async (_r, p) => {
          const a = await p.readContract({ address: c.deployment.token, abi: tokenAbi, functionName: "allowance", args: [wallet.address!, c.deployment.pool] });
          if (a < v) throw new Error("allowance on chain is lower than requested");
        }, tx);
    } finally { appr.disabled = false; void bal(); }
  };

  dep.onclick = async () => {
    const v = amount();
    if (!v) { tx({ phase: "failed", error: "Enter a positive amount." }); return; }
    const why = await precheck(v, true).catch((e) => (e as Error).message);
    if (why) { tx({ phase: "failed", error: why }); return; }
    if (!window.confirm(`Deposit ${fmtUnits(v, 6)} FFUSD into the pool? Donations cannot be withdrawn; unspent vouchers return to the pool, not to you.`)) return;
    dep.disabled = true;
    try {
      const before = await pub.readContract({ address: c.deployment.pool, abi: poolAbi, functionName: "donated", args: [wallet.address!] });
      await runTx(c, (w) => w.writeContract({ address: c.deployment.pool, abi: poolAbi, functionName: "deposit", args: [v], account: wallet.address!, chain: null }),
        async (_r, p) => {
          const after = await p.readContract({ address: c.deployment.pool, abi: poolAbi, functionName: "donated", args: [wallet.address!] });
          if (after - before !== v) throw new Error("pool accounting did not increase by the deposited amount");
        }, tx);
    } finally { dep.disabled = false; void bal(); }
  };
}
