import type { AppConfig } from "../api";
import { esc, msg } from "../util";

export function about(root: HTMLElement, cfg: AppConfig | null): void {
  root.innerHTML = `<h1>How it works, and where it is <em>weak</em></h1>
    <div class="card"><b>Testnet only.</b> Tokens have no value. No independent security audit has been performed.</div>
    <h2>Flow</h2>
    <ol>
      <li>Donors fund a shared pool.</li>
      <li>NGOs enroll households by adding a hash (a <i>commitment</i>) of a secret the household owns to the NGO's own group. No personal data is recorded.</li>
      <li>When a flood <b>forecast</b> AND a <b>river gauge</b> both pass their thresholds, the oracle contract releases a tranche of at most 30% of the pool.</li>
      <li>A household proves, with a zero-knowledge proof made on its own device, that it is in some NGO's group, and gets one voucher. The shared registry refuses a second claim from the same household for the same event, whichever NGO enrolled it, without any NGO seeing another's list.</li>
      <li>A merchant checks the voucher's signature offline and later redeems it on chain. Unspent vouchers expire back to the pool.</li>
    </ol>
    <h2>Known limits</h2>
    <ul class="limits">${(cfg?.knownLimits ?? ["Configuration unavailable; limits could not be loaded."]).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    <h2>What is real here</h2>
    <ul class="limits">
      <li>Flood forecast: GloFAS river discharge from Open-Meteo (real data, non-commercial licence).</li>
      <li>River gauge: ${cfg ? (cfg.gaugeMode === "operator" ? "entered by a designated human operator from an official bulletin and recorded publicly as a fallback event (no public real-time gauge API was found)" : "read from the configured gauge source") : "unknown (configuration unavailable)"}.</li>
      <li>Contracts, proofs, claims and redemptions are real transactions on the configured testnet. SMS is only sent if the operator configured a provider; this app never claims a message was delivered on its own.</li>
    </ul>
    ${cfg ? "" : msg("err", "Could not load configuration from the FloodFirst API.")}`;
}
