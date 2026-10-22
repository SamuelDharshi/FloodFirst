import { EXPLORER, postJson, type AppConfig } from "../api";
import { $, esc, fmtUnits, msg, shortHex, store, ts } from "../util";
import { verifyVoucherOffline, type Voucher } from "../voucher";

interface QItem {
  voucher: Voucher;
  raw: string;
  acceptedAt: number;
  status: "queued" | "synced" | "rejected";
  txHash?: string;
  reason?: string;
}
const queue = store<QItem[]>("ff.merchant.queue", []);
const payout = store<string>("ff.merchant.payout", "");

export function merchant(root: HTMLElement, cfg: AppConfig | null): () => void {
  const usable = cfg && cfg.voucherSigner ? { chainId: cfg.chainId, issuer: cfg.deployment.issuer, voucherSigner: cfg.voucherSigner } : null;
  root.innerHTML = `<h1><em>Merchant</em></h1>
    <p class="muted">Accepting a voucher needs <b>no internet</b>: the signature is checked on this device against settings saved from your last online visit. Redemptions are sent to the chain when you are online again.</p>
    ${usable ? "" : msg("err", "This device has no saved settings yet. Open this page once while online so it can save the voucher-signer address, then it works offline.")}
    <div id="net"></div>
    <section class="card">
      <label for="pay">Your payout address (receives the tokens)</label>
      <input id="pay" placeholder="0x…" value="${esc(payout.get())}" spellcheck="false" />
      <label for="v">Voucher (scan the QR or paste its text)</label>
      <textarea id="v" rows="4" spellcheck="false"></textarea>
      <div class="row" style="margin-top:12px"><button id="scan" class="secondary">Scan QR with camera</button><button id="acc">Verify and accept</button></div>
      <video id="cam" playsinline style="display:none;width:100%;max-width:360px;margin-top:8px"></video>
      <div id="res" aria-live="polite"></div>
    </section>
    <h2>Accepted vouchers</h2><div class="row"><button id="sync">Sync to chain now</button></div><div id="syncRes" aria-live="polite"></div><div id="list"></div>`;
  const res = $(root, "#res");
  const list = $(root, "#list");
  const validAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);

  const net = () => { $(root, "#net").innerHTML = navigator.onLine ? "" : msg("info", "You are offline. You can still accept vouchers; sync later."); };
  net();
  window.addEventListener("online", net);
  window.addEventListener("offline", net);

  function render() {
    const q = queue.get();
    list.innerHTML = q.length ? `<div class="card scroll"><table><thead><tr><th>Amount</th><th>Event</th><th>Accepted</th><th>Status</th></tr></thead><tbody>${q.map((i) =>
      `<tr><td>${esc(fmtUnits(i.voucher.amount, 6))} FFUSD</td><td class="mono">${esc(shortHex(i.voucher.eventId, 4))}</td><td>${esc(ts(i.acceptedAt / 1000))}</td><td>${i.status === "synced" ? `Paid on chain <a href="${esc(EXPLORER)}/tx/${esc(i.txHash ?? "")}" target="_blank" rel="noopener">${esc(shortHex(i.txHash ?? ""))}</a>` : i.status === "rejected" ? `Rejected by chain: ${esc(i.reason ?? "")}` : "Accepted offline, waiting to sync (not paid yet)"}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">None.</p>`;
  }
  render();

  const acc = $<HTMLButtonElement>(root, "#acc");
  acc.onclick = async () => {
    const p = $<HTMLInputElement>(root, "#pay").value.trim();
    if (!validAddr(p)) { res.innerHTML = msg("err", "Enter a valid payout address first (0x followed by 40 hex characters)."); return; }
    payout.set(p);
    if (!usable) { res.innerHTML = msg("err", "No saved settings; go online once to enable offline checks."); return; }
    const raw = $<HTMLTextAreaElement>(root, "#v").value.trim();
    if (!raw) { res.innerHTML = msg("err", "Paste the voucher text (or scan its QR code) first."); return; }
    if (raw.startsWith("FF1-")) { res.innerHTML = msg("err", "That is a household card (it stays secret and is never shown to a shop). Open the Claim page, claim with this card, then use \"Copy voucher text\" and paste that voucher here."); return; }
    const r = await verifyVoucherOffline(raw, usable);
    if (!r.ok) { res.innerHTML = msg("err", `Do NOT accept: ${r.reason}.`); return; }
    if (queue.get().some((i) => i.voucher.voucherId === r.voucher.voucherId)) { res.innerHTML = msg("err", "This voucher was already accepted on this device."); return; }
    queue.set([...queue.get(), { voucher: r.voucher, raw, acceptedAt: Date.now(), status: "queued" }]);
    res.innerHTML = msg("ok", `Valid voucher for ${fmtUnits(r.voucher.amount, 6)} FFUSD. Give the goods. It is only paid when synced and the chain confirms.`);
    $<HTMLTextAreaElement>(root, "#v").value = "";
    render();
  };

  let stream: MediaStream | null = null;
  let scanning = false;
  $<HTMLButtonElement>(root, "#scan").onclick = async () => {
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!BD) { res.innerHTML = msg("info", "This browser cannot scan QR codes. Paste the voucher text instead."); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const cam = $<HTMLVideoElement>(root, "#cam");
      cam.srcObject = stream; cam.style.display = "block"; await cam.play();
      const det = new BD({ formats: ["qr_code"] });
      scanning = true;
      while (scanning) {
        const found = await det.detect(cam);
        if (found[0]) { $<HTMLTextAreaElement>(root, "#v").value = found[0].rawValue; break; }
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (e) { res.innerHTML = msg("err", `Camera unavailable: ${(e as Error).message}`); }
    stop();
  };
  function stop() { scanning = false; stream?.getTracks().forEach((t) => t.stop()); stream = null; $<HTMLVideoElement>(root, "#cam").style.display = "none"; }

  const sync = $<HTMLButtonElement>(root, "#sync");
  sync.onclick = async () => {
    const to = payout.get();
    if (!validAddr(to)) { $(root, "#syncRes").innerHTML = msg("err", "Set your payout address first."); return; }
    sync.disabled = true; // no duplicate sync runs
    const q = queue.get();
    let done = 0, failed = 0, offline = 0;
    for (const item of q) {
      if (item.status !== "queued") continue;
      try {
        const r = await postJson<{ status?: string; txHash?: string; error?: string }>("/api/redeem", { voucherSecret: item.voucher.secret, to });
        if (r.status === 200 && r.data.status === "confirmed") { item.status = "synced"; item.txHash = r.data.txHash; done++; }
        else if (r.status === 422) { item.status = "rejected"; item.reason = r.data.error ?? "rejected"; failed++; }
        else { offline++; } // 5xx / busy: leave queued, never mark paid
      } catch { offline++; }
      queue.set(q);
    }
    $(root, "#syncRes").innerHTML = msg(failed || offline ? "info" : "ok", `Paid on chain: ${done}. Rejected: ${failed}. Still waiting (offline or busy): ${offline}.`);
    sync.disabled = false;
    render();
  };
  return () => { stop(); window.removeEventListener("online", net); window.removeEventListener("offline", net); };
}
