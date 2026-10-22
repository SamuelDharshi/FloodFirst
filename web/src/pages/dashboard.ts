import { EXPLORER, getJson, type AppConfig } from "../api";
import { esc, fmtUnits, msg, shortHex, ts } from "../util";

interface Stats {
  token: { symbol: string; decimals: number };
  live: { poolBalance: string; heldByVoucherIssuer: string };
  indexed: Record<string, string | number>;
  indexedUpTo: number;
}
interface Ev { name: string; tx_hash: string; block_number: number; args: Record<string, string> }
interface OLog { ts: number; source: string; ok: number; value: string | null; detail: string }

export function dashboard(root: HTMLElement, cfg: AppConfig | null): () => void {
  root.innerHTML = `<h1>Donor <em>dashboard</em></h1>
    <p class="muted">Aggregate flows only. No names, phone numbers or locations exist in this system. Pool and voucher balances are read from the chain through our API; counts come from our event index (confirmed blocks only).</p>
    <div id="dash">${msg("info", "Loading…")}</div>`;
  const box = root.querySelector<HTMLElement>("#dash")!;
  let stopped = false;

  async function load() {
    try {
      const [stats, events, olog, th, groups] = await Promise.all([
        getJson<Stats>("/api/stats"),
        getJson<Ev[]>("/api/events?limit=200"),
        getJson<OLog[]>("/api/oracle-log"),
        getJson<{ forecast: string; gauge: string; maxReadingAgeSec: string; vetoWindowSec: string }>("/api/thresholds"),
        getJson<unknown[]>("/api/groups"),
      ]);
      if (stopped) return;
      const d = stats.token.decimals;
      const sym = stats.token.symbol;
      const u = (v: string | number) => `${fmtUnits(String(v), d)} ${esc(sym)}`;
      const i = stats.indexed;

      // Per-event ledger, built only from indexed chain events.
      type Row = { tranche?: string; claimAmount?: string; expiry?: string; claims: number; redeemed: number; redeemedAmt: bigint; returned?: string };
      const ledger = new Map<string, Row>();
      const row = (id: string) => ledger.get(id) ?? (ledger.set(id, { claims: 0, redeemed: 0, redeemedAmt: 0n }), ledger.get(id)!);
      for (const e of [...events].reverse()) {
        const id = e.args.eventId;
        if (!id) continue;
        if (e.name === "EventOpened") Object.assign(row(id), { tranche: e.args.tranche, claimAmount: e.args.claimAmount, expiry: e.args.expiry });
        if (e.name === "VoucherRegistered") row(id).claims++;
        if (e.name === "Redeemed") { row(id).redeemed++; row(id).redeemedAmt += BigInt(e.args.amount ?? "0"); }
        if (e.name === "Expired") row(id).returned = e.args.returnedToPool;
      }
      const fallbacks = events.filter((e) => e.name === "FallbackUsed");

      box.innerHTML = `
        <div class="grid">
          <div class="tile"><div class="k">Pool balance (live, on-chain)</div><div class="v">${u(stats.live.poolBalance)}</div></div>
          <div class="tile"><div class="k">Held as live vouchers (on-chain)</div><div class="v">${u(stats.live.heldByVoucherIssuer)}</div></div>
          <div class="tile"><div class="k">Total donated</div><div class="v">${u(i.totalDonated ?? 0)}</div></div>
          <div class="tile"><div class="k">Triggers fired</div><div class="v">${esc(i.triggers)}</div></div>
          <div class="tile"><div class="k">Total released</div><div class="v">${u(i.totalReleased ?? 0)}</div></div>
          <div class="tile"><div class="k">Claims / redemptions</div><div class="v">${esc(i.claims)} / ${esc(i.redemptions)}</div></div>
          <div class="tile"><div class="k">Redeemed by merchants</div><div class="v">${u(i.totalRedeemed ?? 0)}</div></div>
          <div class="tile"><div class="k">Returned to pool at expiry</div><div class="v">${u(i.totalReturnedToPool ?? 0)}</div></div>
        </div>
        <p class="muted">Indexed up to block ${esc(stats.indexedUpTo)}. Participating NGO registries: ${esc(groups.length)}. Fallback (human-confirmed gauge) uses on-chain: ${esc(i.fallbackUses)}.</p>

        <h2>Trigger rule (read from the contract)</h2>
        <div class="card">Both must be at or above their thresholds: forecast discharge ≥ <b>${esc(th.forecast)}</b> and gauge reading ≥ <b>${esc(th.gauge)}</b> (readings must be ≤ ${esc(th.maxReadingAgeSec)} s old). Each release is capped at <b>30%</b> of the pool. Unspent vouchers expire back to the pool.</div>

        <h2>Per trigger event: cost of each release</h2>
        <p class="muted">Cost to donors = amount households actually redeemed. Everything else returns to the pool after expiry. A false alarm shows up here as a release with little or no redemption.</p>
        <div class="card scroll"><table><thead><tr><th>Event</th><th>Released</th><th>Per household</th><th>Claims</th><th>Redeemed</th><th>Returned</th><th>Expires</th></tr></thead><tbody>
        ${[...ledger.entries()].map(([id, r]) => `<tr><td class="mono">${esc(id)}</td><td>${r.tranche ? u(r.tranche) : "–"}</td><td>${r.claimAmount ? u(r.claimAmount) : "–"}</td><td>${r.claims}</td><td>${r.redeemed} (${u(r.redeemedAmt.toString())})</td><td>${r.returned !== undefined ? u(r.returned) : "not yet expired"}</td><td>${r.expiry ? esc(ts(r.expiry)) : "–"}</td></tr>`).join("") || `<tr><td colspan="7">No trigger events yet.</td></tr>`}
        </tbody></table></div>

        <h2>Oracle and fallback log (public)</h2>
        ${fallbacks.length ? `<div class="msg">The gauge leg was confirmed by the designated human operator for ${fallbacks.length} event(s). This is recorded on-chain as FallbackUsed.</div>` : ""}
        <div class="card scroll"><table><thead><tr><th>Time</th><th>Source</th><th>Result</th><th>Detail</th></tr></thead><tbody>
        ${olog.slice(0, 25).map((l) => `<tr><td>${esc(ts(l.ts))}</td><td>${esc(l.source)}</td><td>${l.ok ? "ok" : "failed"}${l.value ? " · " + esc(l.value) : ""}</td><td>${esc(l.detail)}</td></tr>`).join("") || `<tr><td colspan="4">No oracle activity yet.</td></tr>`}
        </tbody></table></div>

        <h2>Recent on-chain events</h2>
        <div class="card scroll"><table><thead><tr><th>Block</th><th>Event</th><th>Transaction</th></tr></thead><tbody>
        ${events.filter((e) => !["OwnershipTransferred", "OracleSet", "RegistrySet", "ConfigSet", "ThresholdsSet"].includes(e.name)).slice(0, 30).map((e) => `<tr><td>${esc(e.block_number)}</td><td>${esc(e.name)}</td><td><a href="${esc(EXPLORER)}/tx/${esc(e.tx_hash)}" target="_blank" rel="noopener">${esc(shortHex(e.tx_hash))}</a></td></tr>`).join("") || `<tr><td colspan="3">No events yet.</td></tr>`}
        </tbody></table></div>
        ${cfg ? `<p class="muted">Verify yourself: <a href="${esc(EXPLORER)}/address/${esc(cfg.deployment.pool)}" target="_blank" rel="noopener">Pool contract</a> · <a href="${esc(EXPLORER)}/address/${esc(cfg.deployment.registry)}" target="_blank" rel="noopener">Registry</a> · <a href="${esc(EXPLORER)}/address/${esc(cfg.deployment.oracle)}" target="_blank" rel="noopener">Oracle</a></p>` : ""}`;
    } catch (e) {
      if (!stopped) box.innerHTML = msg("err", `Data is unavailable: ${(e as Error).message}. Nothing shown here is estimated.`);
    }
  }
  void load();
  const t = setInterval(load, 15000);
  return () => { stopped = true; clearInterval(t); };
}
