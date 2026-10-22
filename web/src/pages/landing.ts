import "./landing.css";
import { EXPLORER, getJson, type AppConfig } from "../api";
import { esc, fmtUnits } from "../util";
import type { FxData } from "./landing-fx";
import { logoHtml } from "../logo";
import wadeImg from "../assets/cyanotype-wade.jpg";
import warningImg from "../assets/flood-warning.jpg";
import statueImg from "../assets/flooded-statue.jpg";
import privacyImg from "../assets/private-check-phone.jpg";
import noPhoneImg from "../assets/no-smartphone.jpg";

type Visual = { src: string; alt: string; w: number; h: number; portrait?: boolean };
const PROBLEMS: readonly (readonly [string, string, Visual])[] = [
  ["Aid arrives after the flood", "Forecast-based cash is an established approach, but disbursement is slow and opaque to the people funding it.",
    { src: warningImg, alt: "A yellow flood warning sign in front of a stormy sky with lightning", w: 236, h: 157 }],
  ["Competing NGOs, shared villages", "Each NGO guards its list, so duplicate payments and gaps are hard to spot without exposing the lists.",
    { src: privacyImg, alt: "A person smiling at a phone, with a shield, a padlock and check marks around them", w: 1200, h: 800 }],
  ["Households without wallets or data", "Claiming works from a printed card on an agent's phone. Merchants verify vouchers offline.", { src: noPhoneImg, alt: "A smartphone with a red prohibition sign across it", w: 660, h: 828, portrait: true }],
];

interface Stats {
  token: { symbol: string; decimals: number };
  live: { poolBalance: string; heldByVoucherIssuer: string };
  indexed: Record<string, string | number>;
}

const STEPS = [
  ["Fund", "Donors and NGOs pay test tokens into one shared pool contract. Every deposit is on chain and counted per donor."],
  ["Trigger", "A flood forecast and a river gauge must both cross their thresholds. Two separate keys sign, and the contract checks both before it moves a cent."],
  ["Claim", "A household proves it is enrolled with a zero-knowledge proof made on its own device. The registry blocks a second payment, whichever NGO enrolled it."],
  ["Redeem", "A merchant verifies the signed voucher with no internet and cashes it in later. Anything unspent expires back to the pool."],
];

const BENEFITS = [
  ["Cash before the peak", "Money is released on a forecast plus a gauge reading, not after the damage is counted."],
  ["Two independent signals", "One data source cannot release funds. Forecast and gauge are signed by different keys and checked on chain."],
  ["No double pay across NGOs", "One shared registry of nullifiers. NGOs never see each other's beneficiary lists."],
  ["Nothing personal on chain", "Only hashes of household secrets, proof nullifiers and aggregate amounts. No names, numbers or locations."],
  ["Capped downside", "A release is at most 30% of the pool. A false alarm costs only what households redeem; the rest returns."],
  ["Public by default", "Every trigger, release, claim, redemption and return is a public event the dashboard reads back."],
];

const WEAK = [
  "A household that makes two secrets and enrolls with two NGOs is not detected. FloodFirst reduces double payment; it does not prove one person, one household.",
  "The trigger trusts two off-chain data attesters. If both collude, a release can be forced, capped at 30% of the pool per event.",
  "No public real-time Brahmaputra gauge API exists, so gauge readings are entered by a designated operator from an official bulletin and flagged on chain as a fallback.",
  "A voucher is a bearer instrument: whoever learns its secret before redemption can redeem it.",
  "It runs on a testnet. The token has no value and there has been no independent security audit.",
];

const ROADMAP: [string, string, string][] = [
  ["Done", "Contracts and services built", "Five contracts, relayer, indexer, oracle and offline merchant check, with a full automated test suite on a local chain."],
  ["Done", "Deployed to Base Sepolia", "All contracts deployed and their wiring read back from the chain."],
  ["Next", "Live trigger and claim on testnet", "A real trigger, a real zero-knowledge claim and a real redemption, recorded on the public testnet."],
  ["Next", "Airplane-mode redemption on a phone", "Prove the offline merchant flow end to end over HTTPS."],
  ["Planned", "A real pilot partner", "No NGO partner exists yet and none is claimed. Outreach is the biggest credibility gap."],
  ["Before real use", "Audit and multisig ownership", "An independent audit and a multisig owner are required before any real value is involved."],
];

const FAQ = [
  ["Is this real money?", "No. It runs on the Base Sepolia testnet with a valueless test token (FFUSD). Nothing here can be cashed out."],
  ["Does a household need a wallet or data?", "No wallet and no gas. A field agent's device creates the proof and a relayer pays the fee. The merchant checks the voucher with no internet."],
  ["Can someone still be paid twice?", "Not by two NGOs using the same household secret: the registry rejects the repeat. But a household that makes two separate secrets cannot be detected. That limit is stated, not hidden."],
  ["What if the river gauge is down?", "A designated operator can confirm a reading from an official bulletin. It is signed with a separate key and recorded on chain as a fallback, visible on the dashboard."],
  ["Who has to be trusted?", "The two data attesters (bounded by the 30% cap), the NGOs admitted to the registry, and the contract owner. There is no upgrade key. Ownership should move to a multisig before any real use."],
  ["Is SMS included?", "Only if an operator configures a provider. Without one nothing is sent and the app says so; it never reports a message as delivered on its own."],
];

const DEMO = [
  ["Forecast and gauge", "Both sources cross their thresholds. Two keys sign."],
  ["Release", "The pool releases at most 30%."],
  ["Claim", "A zero-knowledge proof. A repeat is rejected."],
  ["Voucher", "A signed QR code on a basic phone."],
  ["Merchant", "Verified offline. Synced and paid later."],
];

/** Splits text into per-character spans so the effects layer can fragment the type. Text stays selectable/readable. */
function frag(text: string): string {
  let italic = false;
  const words: { c: string; it: boolean }[][] = [[]];
  for (const c of text) {
    if (c === "*") { italic = !italic; continue; }
    if (c === " ") { words.push([]); continue; }
    words[words.length - 1]!.push({ c, it: italic });
  }
  return words
    .filter((w) => w.length)
    .map((w) => `<span class="w">${w.map((x) => `<span class="ch${x.it ? " it" : ""}">${esc(x.c)}</span>`).join("")}</span>`)
    .join(" ");
}

const MARQUEE = ["FloodFirst ®", "Cash before the flood", "Testnet only", "Zero-knowledge dedup", "Offline vouchers", "30% cap"];
const marqueeRow = () => MARQUEE.map((t) => `<span>${esc(t)}</span>`).join("");

export function landing(root: HTMLElement, cfg: AppConfig | null): () => void {
  const explorer = (a: string) => `${esc(EXPLORER)}/address/${esc(a)}`;
  const contracts = cfg
    ? (["pool", "registry", "oracle", "issuer", "token"] as const)
        .map((k) => `<a href="${explorer(cfg.deployment[k])}" target="_blank" rel="noopener">${k === "issuer" ? "voucher issuer" : k}</a>`)
        .join("")
    : "";

  root.innerHTML = `
  <div class="lp3" id="lp3">
    <canvas id="lp-gl" aria-hidden="true"></canvas>

    <header class="lp-nav">
      <a class="lp-logo" href="#/" aria-label="FloodFirst home">${logoHtml(46)}</a>
      <nav aria-label="Sections">
        <button data-scroll="why">Why</button><button data-scroll="how">How it works</button><button data-scroll="benefits">Benefits</button>
        <button data-scroll="roadmap">Roadmap</button><button data-scroll="faq">FAQ</button>
      </nav>
      <a class="lp-pill" href="#/dashboard">Open the app</a>
    </header>

    <section class="lp-hero" id="top">
      <p class="lp-kicker">Anticipatory cash for flood-prone households</p>
      <h1 class="lp-mega" aria-label="We pay before the flood">
        <span class="line" aria-hidden="true">${frag("We pay")}</span>
        <span class="line lime" aria-hidden="true">${frag("*before*")}</span>
        <span class="line" aria-hidden="true">${frag("the flood")}</span>
      </h1>
      <div class="lp-sub-row"><p class="lp-sub">A shared registry stops two NGOs paying the same household, without anyone sharing a list.</p></div>
      <div class="lp-cta"><a class="lp-pill big" href="#/dashboard">Try the live dashboard</a><button class="lp-ghost" data-scroll="how">See how it works</button></div>
      <p class="lp-live" id="lp-live" role="status">Reading the chain…</p>
      <span class="lp-scroll" aria-hidden="true">scroll</span>
    </section>

    <div class="lp-marquee" aria-hidden="true"><div class="lp-track" data-dir="-1">${marqueeRow()}${marqueeRow()}</div></div>

    <section id="why" class="lp-why dim">
      <p class="lp-label">Why</p>
      <div class="why-grid">
        <div class="why-copy">
          <h2 class="lp-big">${frag("Water rises. *Aid arrives late.*")}</h2>
          <p><b>The problem.</b> Aid after a disaster is slow, and several NGOs often serve the same villages without being able to compare lists. Money arrives late, twice, or not at all.</p>
          <p><b>The idea.</b> A donor pool pre-funds small voucher tranches. They release automatically when a forecast and a river gauge agree, and a shared registry stops the same household being paid twice, without any NGO sharing its list.</p>
        </div>
        <div class="why-art">
          <figure class="duo a1"><div class="duo-frame"><img src="${wadeImg}" alt="A silhouetted person wading into dark water where the surface glows with light" loading="lazy" decoding="async" width="1179" height="1456" /></div>
          </figure>
          <figure class="duo a2"><div class="duo-frame"><img src="${statueImg}" alt="A digitally composed scene of a statue standing in rising sea water" loading="lazy" decoding="async" width="1000" height="1250" /></div>
          </figure>
        </div>
      </div>
    </section>

    <section id="how" class="lp-how">
      <div class="how-pin">
        <p class="lp-label">How it works</p>
        <div class="how-big" aria-hidden="true"><span id="how-n">01</span></div>
        <ol class="how-steps">
          ${STEPS.map(([t, d], i) => `<li class="step"><span class="step-n">${String(i + 1).padStart(2, "0")}</span><h2>${esc(t)}</h2><p>${esc(d)}</p></li>`).join("")}
        </ol>
        <div class="how-bar" aria-hidden="true"><i></i></div>
      </div>
    </section>

    <section class="lp-demo" id="demo">
      <p class="lp-label">The flow, looping</p>
      <div class="demo-grid">
        <div class="phone" aria-label="Illustration of the FloodFirst flow">
          <div class="phone-screen">
            ${DEMO.map(([t, d], i) => `<div class="scene"><span class="scene-n">${i + 1}/5</span><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join("")}
          </div>
        </div>
        <div class="demo-copy"><h2 class="lp-big">${frag("One tap. One proof. *One payment.*")}</h2><p>An illustration of the real flow, not live data. Live numbers are further down.</p></div>
      </div>
    </section>

    <div class="lp-marquee alt" aria-hidden="true"><div class="lp-track" data-dir="1">${marqueeRow()}${marqueeRow()}</div></div>

    <section id="benefits" class="lp-ben dim">
      <p class="lp-label">Benefits</p>
      <ul>${BENEFITS.map(([t, d], i) => `<li class="benefit"><span>${String(i + 1).padStart(2, "0")}</span><h2>${esc(t)}</h2><p>${esc(d)}</p></li>`).join("")}</ul>
    </section>

    <section class="lp-high" id="highlights">
      <p class="lp-label">Highlights, live from the chain</p>
      <div class="high-track" id="lp-stats">Loading…</div>
      <p class="lp-note">Pool and voucher balances are read directly from the contracts. If data is unavailable you will see that, never an estimate.</p>
    </section>

    <section class="lp-prob dim">
      <p class="lp-label">Problems that we solve</p>
      <div class="prob-grid">
        ${PROBLEMS.map(([t, d, v]) =>
          `<article class="prob"><figure class="duo small${v.portrait ? " portrait" : ""}"><div class="duo-frame"><img src="${v.src}" alt="${esc(v.alt)}" loading="lazy" decoding="async" width="${v.w}" height="${v.h}" /></div></figure><h3>${esc(t)}</h3><p>${esc(d)}</p></article>`).join("")}
      </div>
    </section>

    <section class="lp-aud dim">
      <div><h2>For NGOs and <em>field agents</em></h2><p>Create your own private group, enroll households with a secret they own, and let the registry stop double payment across organisations. You keep your list.</p><a class="lp-pill" href="#/agent">Open the field agent</a></div>
      <div><h2>For donors and <em>merchants</em></h2><p>Fund the pool and watch every release and redemption in aggregate. Merchants accept vouchers offline and get paid when they sync.</p><span class="row"><a class="lp-pill" href="#/donate">Donate (testnet)</a><a class="lp-ghost" href="#/merchant">Merchant</a></span></div>
    </section>

    <section class="lp-weak dim">
      <p class="lp-label">Where it is weak</p>
      <ul>${WEAK.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
    </section>

    <section id="roadmap" class="lp-road dim">
      <p class="lp-label">Roadmap, honestly</p>
      <div class="road-wrap"><div class="road-line" aria-hidden="true"><i></i></div>
        <ol>${ROADMAP.map(([s, t, d]) => `<li class="road-item"><span class="status s-${esc(s.split(" ")[0]!.toLowerCase())}">${esc(s)}</span><h2>${esc(t)}</h2><p>${esc(d)}</p></li>`).join("")}</ol>
      </div>
    </section>

    <section id="faq" class="lp-faq dim">
      <p class="lp-label">Questions</p>
      <div class="faq-list">${FAQ.map(([q, a], i) => `<div class="faq-item"><button class="faq-q" aria-expanded="false" aria-controls="faq-a${i}" id="faq-q${i}"><span>${String(i + 1).padStart(2, "0")}</span>${esc(q)}<i aria-hidden="true"></i></button><div class="faq-a" id="faq-a${i}" role="region" aria-labelledby="faq-q${i}"><div><p>${esc(a)}</p></div></div></div>`).join("")}</div>
    </section>

    <footer class="lp-foot">
      <div class="foot-top"><h2 class="lp-big">${frag("See it *working*")}</h2>
        <div class="lp-cta"><a class="lp-pill big" href="#/dashboard">Open the dashboard</a><a class="lp-ghost" href="#/about">Read the limits</a></div>
        ${contracts ? `<p class="lp-contracts">Verify the contracts: ${contracts}</p>` : ""}</div>
      <div class="foot-word" aria-hidden="true">${frag("Flood*first*")}</div>
      <div class="foot-bar"><span>${logoHtml(28)} <span class="foot-note">Testnet only. No independent audit. Tokens have no value.</span></span>
        <span><a href="#/dashboard">Dashboard</a><a href="#/agent">Field agent</a><a href="#/claim">Claim</a><a href="#/merchant">Merchant</a><a href="#/about">How it works</a></span></div>
    </footer>
  </div>`;

  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollTo = (id: string) => root.querySelector<HTMLElement>(`#${id}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  root.querySelectorAll<HTMLButtonElement>("button[data-scroll]").forEach((b) => (b.onclick = () => scrollTo(b.dataset.scroll!)));

  // FAQ accordion (works without the effects layer).
  root.querySelectorAll<HTMLButtonElement>(".faq-q").forEach((q) => {
    q.onclick = () => {
      const open = q.getAttribute("aria-expanded") === "true";
      q.setAttribute("aria-expanded", String(!open));
      q.closest(".faq-item")!.classList.toggle("open", !open);
    };
  });

  // Live numbers: real API data or an explicit unavailable state.
  let stopped = false;
  const live = root.querySelector<HTMLElement>("#lp-live")!;
  const tiles = root.querySelector<HTMLElement>("#lp-stats")!;
  // Data for the 3D scene and the readout panel. Only real values; anything missing stays "no live ...".
  let fxData: FxData = {};
  let fx: { update(d: FxData): void; stop(): void } | null = null;
  const pushFx = () => fx?.update(fxData);
  interface OLog { source: string; ok: number; value: string | null }
  const latest = (log: OLog[], sources: string[]) => log.find((l) => sources.includes(l.source) && l.ok === 1 && l.value !== null);

  void Promise.all([
    getJson<{ forecast: string; gauge: string }>("/api/thresholds"),
    getJson<OLog[]>("/api/oracle-log"),
  ])
    .then(([th, log]) => {
      if (stopped) return;
      const f = latest(log, ["forecast"]);
      const g = latest(log, ["gauge-http", "gauge-operator", "fallback"]);
      const fT = Number(th.forecast);
      const gT = Number(th.gauge);
      if (f && fT > 0) {
        fxData = { ...fxData, forecastRatio: Number(f.value) / fT };
      }
      if (g && gT > 0) {
        fxData = { ...fxData, gaugeRatio: Number(g.value) / gT };
      }
      pushFx();
    })
    .catch(() => { /* readout stays at "no live reading" */ });

  getJson<Stats>("/api/stats")
    .then((s) => {
      if (stopped) return;
      const pool = Number(s.live.poolBalance);
      const held = Number(s.live.heldByVoucherIssuer);
      fxData = { ...fxData, poolFraction: pool + held > 0 ? pool / (pool + held) : 0 };
      pushFx();
      const u = (v: string | number) => `${fmtUnits(String(v), s.token.decimals)} ${esc(s.token.symbol)}`;
      const i = s.indexed;
      live.innerHTML = `Live on testnet${cfg ? ` (chain ${esc(cfg.chainId)})` : ""}: pool holds <b>${u(s.live.poolBalance)}</b> · ${esc(i.claims)} claims · ${esc(i.redemptions)} redemptions`;
      const t = (k: string, v: string) => `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`;
      tiles.innerHTML = t("Pool balance", u(s.live.poolBalance)) + t("Held as live vouchers", u(s.live.heldByVoucherIssuer)) + t("Total donated", u(i.totalDonated ?? 0)) +
        t("Triggers fired", esc(i.triggers ?? 0)) + t("Claims", esc(i.claims ?? 0)) + t("Returned to pool", u(i.totalReturnedToPool ?? 0)) +
        t("Release cap", "30%") + t("Signals required", "2 of 2");
    })
    .catch(() => {
      if (stopped) return;
      live.textContent = "Live data is unavailable right now. Nothing here is estimated.";
      tiles.textContent = "Live data is unavailable right now.";
    });

  // Effects layer (WebGL + GSAP): loaded on demand; the page is complete without it.
  if (!reduce) {
    import("./landing-fx")
      .then((m) => { if (!stopped) { fx = m.startFx(root.querySelector<HTMLElement>("#lp3")!); pushFx(); } })
      .catch(() => { /* effects are optional; static page stays fully usable */ });
  }

  return () => { stopped = true; fx?.stop(); };
}
