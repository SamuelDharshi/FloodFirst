import { Group } from "@semaphore-protocol/group";
import { Identity } from "@semaphore-protocol/identity";
import { generateProof } from "@semaphore-protocol/proof";
import QRCode from "qrcode";
import { bytesToHex, type Hex } from "viem";
import { getJson, postJson, type AppConfig } from "../api";
import { semaphoreAbi } from "../abis";
import { $, esc, fmtUnits, msg, store, ts } from "../util";
import { publicClient } from "../wallet";
import { voucherIdOf, type SignedVoucher } from "../voucher";

interface Ev { name: string; args: Record<string, string> }
const saved = store<SignedVoucher[]>("ff.vouchers", []);

export function claim(root: HTMLElement, cfg: AppConfig | null): void {
  if (!cfg) { root.innerHTML = `<h1>Claim</h1>${msg("err", "Cannot reach the FloodFirst API and no cached configuration exists.")}`; return; }
  const c = cfg;
  root.innerHTML = `<h1>Claim a <em>voucher</em></h1>
    <p class="muted">Used by the household's agent on a phone or computer with a connection. No wallet and no gas are needed: the proof is created on this device from the household card, and a relayer pays the fee. The card secret is never sent to any server.</p>
    <section class="card">
      <label for="code">Household card code</label>
      <input id="code" placeholder="FF1-…" autocomplete="off" spellcheck="false" />
      <label for="evt">Trigger event</label><select id="evt"><option>Loading…</option></select>
      <div class="row" style="margin-top:12px"><button id="go">Claim voucher</button></div>
      <div id="out" aria-live="polite"></div>
    </section>
    <h2>Vouchers stored on this device</h2><div id="mine"></div>`;
  const evtSel = $<HTMLSelectElement>(root, "#evt");
  const go = $<HTMLButtonElement>(root, "#go");
  const out = $(root, "#out");

  async function loadEvents() {
    try {
      const evs = await getJson<Ev[]>("/api/events?name=EventOpened&limit=20");
      const now = Date.now() / 1000;
      const open = evs.filter((e) => Number(e.args.expiry) > now);
      evtSel.innerHTML = open.length
        ? open.map((e) => `<option value="${esc(e.args.eventId)}">Event ${esc(e.args.eventId)} · ${esc(fmtUnits(e.args.claimAmount ?? "0", 6))} FFUSD each · claim before ${esc(ts(e.args.expiry ?? "0"))}</option>`).join("")
        : `<option value="">No open trigger event right now</option>`;
    } catch (e) { evtSel.innerHTML = `<option value="">Events unavailable: ${esc((e as Error).message)}</option>`; }
  }
  void loadEvents();

  function renderMine() {
    const list = saved.get();
    $(root, "#mine").innerHTML = list.length
      ? list.map((v, i) => `<div class="card"><div>Event ${esc(v.voucher.eventId)} · ${esc(fmtUnits(v.voucher.amount, 6))} FFUSD · expires ${esc(ts(v.voucher.expiry))}</div><div class="row"><button class="secondary" data-i="${i}">Show QR</button><button class="secondary" data-copy="${i}">Copy voucher text</button></div><div id="q${i}"></div><div id="t${i}"></div></div>`).join("")
      : `<p class="muted">None.</p>`;
    root.querySelectorAll<HTMLButtonElement>("button[data-copy]").forEach((b) => {
      b.onclick = async () => {
        const text = JSON.stringify(saved.get()[Number(b.dataset.copy)]);
        const box = $(root, `#t${b.dataset.copy}`);
        try {
          await navigator.clipboard.writeText(text);
          box.innerHTML = msg("ok", "Voucher text copied. Paste it on the Merchant page.");
        } catch {
          // Clipboard blocked (e.g. insecure origin): show the text so it can be selected and copied by hand.
          box.innerHTML = `<label>Select all and copy</label><textarea readonly rows="4" class="mono">${esc(text)}</textarea>`;
          box.querySelector("textarea")!.select();
        }
      };
    });
    root.querySelectorAll<HTMLButtonElement>("button[data-i]").forEach((b) => {
      b.onclick = async () => {
        const v = saved.get()[Number(b.dataset.i)]!;
        const url = await QRCode.toDataURL(JSON.stringify(v), { errorCorrectionLevel: "L", margin: 1, width: 360 });
        $(root, `#q${b.dataset.i}`).innerHTML = `<img class="qr" alt="Voucher QR code" src="${url}" /><p class="muted">Show this to a local merchant. It works with no internet at the merchant's phone.</p>`;
      };
    });
  }
  renderMine();

  go.onclick = async () => {
    const eventId = evtSel.value;
    if (!eventId) { out.innerHTML = msg("err", "No open trigger event."); return; }
    let identity: Identity;
    try {
      const raw = $<HTMLInputElement>(root, "#code").value.trim();
      if (!raw.startsWith("FF1-")) throw new Error("bad prefix");
      identity = Identity.import(raw.slice(4));
    } catch { out.innerHTML = msg("err", "That card code is not valid."); return; }
    go.disabled = true; // prevents duplicate submission
    try {
      out.innerHTML = msg("info", "Finding your NGO group…");
      const groups = await getJson<{ groupId: string }[]>("/api/groups");
      let found: { groupId: string; members: bigint[] } | null = null;
      for (const g of groups) {
        const r = await getJson<{ members: string[] }>(`/api/groups/${g.groupId}/members`);
        const members = r.members.map((m) => BigInt(m));
        if (members.includes(identity.commitment)) { found = { groupId: g.groupId, members }; break; }
      }
      if (!found) {
        // A server that is still re-reading chain history cannot know every group yet; say so instead of a false "not enrolled".
        const h = await getJson<{ head?: string; indexedUpTo?: number | null }>("/api/health").catch(() => null);
        const behind = h?.head && h.indexedUpTo != null ? Number(h.head) - h.indexedUpTo : 0;
        if (behind > 400) throw new Error(`The server is still syncing chain history (${behind.toLocaleString()} blocks behind), so it cannot see every NGO group yet. Wait a few minutes and try again. Your card is not rejected.`);
        throw new Error("This card is not enrolled in any participating NGO group. Ask the field agent to enrol it (Field agent page), then try again.");
      }

      const group = new Group(found.members);
      const onChainRoot = await publicClient(c).readContract({ address: c.deployment.semaphore, abi: semaphoreAbi, functionName: "getMerkleTreeRoot", args: [BigInt(found.groupId)] });
      if (onChainRoot !== group.root) throw new Error("Our index of this group does not match the chain yet. Try again in a minute.");

      const secret = bytesToHex(crypto.getRandomValues(new Uint8Array(32))) as Hex;
      out.innerHTML = msg("info", "Creating zero-knowledge proof on this device (can take several seconds)…");
      const proof = await generateProof(identity, group, voucherIdOf(secret), BigInt(eventId));

      out.innerHTML = msg("info", "Submitting through the relayer and waiting for on-chain confirmation…");
      const body = { eventId, groupId: found.groupId, proof: {
        merkleTreeDepth: proof.merkleTreeDepth.toString(), merkleTreeRoot: proof.merkleTreeRoot.toString(), nullifier: proof.nullifier.toString(),
        message: proof.message.toString(), scope: proof.scope.toString(), points: proof.points.map((p) => String(p)) } };
      const r = await postJson<{ status?: string; error?: string; txHash?: string }>("/api/claim", body);
      if (r.status !== 200 || r.data.status !== "confirmed") {
        const why = r.data.error === "NullifierAlreadyUsed" ? "This household has already claimed for this event (through this or another NGO)."
          : r.data.error === "EventNotOpen" ? "This event is no longer open for claims." : (r.data.error ?? `HTTP ${r.status}`);
        throw new Error(why);
      }
      const v = await postJson<SignedVoucher & { error?: string }>("/api/voucher", { voucherSecret: secret });
      if (v.status !== 200 || !v.data.voucher) throw new Error(v.data.error ?? "Voucher could not be issued");
      saved.set([...saved.get(), { voucher: v.data.voucher, signature: v.data.signature }]);
      out.innerHTML = msg("ok", `Claim confirmed on chain (tx ${r.data.txHash}). Voucher saved on this device.`);
      renderMine();
    } catch (e) {
      out.innerHTML = msg("err", (e as Error).message);
    } finally { go.disabled = false; }
  };
}
