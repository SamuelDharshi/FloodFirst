import { Identity } from "@semaphore-protocol/identity";
import QRCode from "qrcode";
import { decodeEventLog } from "viem";
import { getJson, type AppConfig } from "../api";
import { semaphoreAbi } from "../abis";
import { txBox } from "../txbox";
import { $, esc, msg, store } from "../util";
import { runTx, wallet } from "../wallet";

const myGroup = store<string>("ff.myGroup", "");

export function agent(root: HTMLElement, cfg: AppConfig | null): void {
  if (!cfg) { root.innerHTML = `<h1>Field agent / <em>NGO</em></h1>${msg("err", "Cannot reach the FloodFirst API and no cached configuration exists.")}`; return; }
  const c = cfg;
  root.innerHTML = `<h1>Field agent / <em>NGO</em></h1>
    <p class="muted">Each NGO runs its own private group of household <b>commitments</b> (a one-way hash of a secret the household owns). No name, phone number or location is ever stored. NGOs never see each other's groups' contents linked to people.</p>
    ${wallet.address ? "" : msg("info", "Connect your wallet (top right) to create a group or enroll households.")}
    <section class="card"><h2>1. Your NGO group</h2>
      <p>Group id: <b id="gid">${esc(myGroup.get() || "none yet")}</b></p>
      <div class="row"><button id="mk">Create my NGO group</button></div>
      <div id="mkTx"></div><div id="reg"></div></section>
    <section class="card"><h2>2. Enroll a household</h2>
      <p class="muted"><b>Known limit:</b> this reduces double payment but cannot prove one-person-one-household. Check that the household has no existing FloodFirst card before issuing a new one.</p>
      <div class="row"><button id="gen" class="secondary">Generate household secret on this device</button></div>
      <div id="card"></div></section>`;
  const gidEl = $(root, "#gid");
  const mk = $<HTMLButtonElement>(root, "#mk");
  const mkTx = txBox($(root, "#mkTx"));
  const pub = async () => (await import("../wallet")).publicClient(c);

  async function showReg() {
    const g = myGroup.get();
    const box = $(root, "#reg");
    if (!g) { box.innerHTML = ""; return; }
    try {
      const list = await getJson<{ groupId: string }[]>("/api/groups");
      const ok = list.some((x) => x.groupId === g);
      box.innerHTML = ok ? msg("ok", "This group is admitted to the shared registry.")
        : msg("info", `Not yet admitted to the registry. The registry owner must run: npm run cli -- register-group ${g} ${wallet.address ?? "<your address>"}`);
    } catch (e) { box.innerHTML = msg("err", `Registry status unavailable: ${(e as Error).message}`); }
  }
  void showReg();

  mk.onclick = async () => {
    mk.disabled = true;
    try {
      await runTx(c,
        (w) => w.writeContract({ address: c.deployment.semaphore, abi: semaphoreAbi, functionName: "createGroup", args: [], account: wallet.address!, chain: null }),
        async (r, p) => {
          const ev = r.logs.flatMap((l) => { try { return [decodeEventLog({ abi: semaphoreAbi, data: l.data, topics: l.topics })]; } catch { return []; } }).find((e) => e.eventName === "GroupCreated");
          if (!ev) throw new Error("receipt has no GroupCreated event");
          const gid = (ev.args as unknown as { groupId: bigint }).groupId;
          const admin = await p.readContract({ address: c.deployment.semaphore, abi: semaphoreAbi, functionName: "getGroupAdmin", args: [gid] });
          if (admin.toLowerCase() !== wallet.address!.toLowerCase()) throw new Error("group admin on chain is not your address");
          myGroup.set(gid.toString());
          gidEl.textContent = gid.toString();
        }, mkTx);
    } finally { mk.disabled = false; void showReg(); }
  };

  $<HTMLButtonElement>(root, "#gen").onclick = async () => {
    const id = new Identity();
    const code = "FF1-" + id.export();
    const card = $(root, "#card");
    const qr = await QRCode.toDataURL(code, { errorCorrectionLevel: "M", margin: 1, width: 300 });
    card.innerHTML = `
      <div class="msg">Give this card to the household. <b>The secret is shown only now and is not saved anywhere.</b> Anyone with it can claim in their place.</div>
      <p class="mono" id="code">${esc(code)}</p>
      <img class="qr" alt="QR code of the household card" src="${qr}" />
      <div class="row"><button id="print" class="secondary">Print card</button><button id="add">Add this household to my group</button></div>
      <div id="addTx"></div>`;
    $<HTMLButtonElement>(card, "#print").onclick = () => window.print();
    const add = $<HTMLButtonElement>(card, "#add");
    const tx = txBox($(card, "#addTx"));
    add.onclick = async () => {
      const g = myGroup.get();
      if (!g) { tx({ phase: "failed", error: "Create your NGO group first." }); return; }
      add.disabled = true; // prevent duplicate submissions
      const commitment = id.commitment;
      try {
        await runTx(c,
          (w) => w.writeContract({ address: c.deployment.semaphore, abi: semaphoreAbi, functionName: "addMember", args: [BigInt(g), commitment], account: wallet.address!, chain: null }),
          async (_r, p) => {
            const has = await p.readContract({ address: c.deployment.semaphore, abi: semaphoreAbi, functionName: "hasMember", args: [BigInt(g), commitment] });
            if (!has) throw new Error("commitment is not a member of the group on chain");
          }, tx);
      } finally { add.disabled = false; }
    };
    void pub;
  };
}
