import "@fontsource-variable/instrument-sans";
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/instrument-serif/latin-400-italic.css";
import "./style.css";
import { registerSW } from "virtual:pwa-register";
import { loadConfig, type AppConfig } from "./api";
import { about } from "./pages/about";
import { agent } from "./pages/agent";
import { claim } from "./pages/claim";
import { dashboard } from "./pages/dashboard";
import { landing } from "./pages/landing";
import { donor } from "./pages/donor";
import { merchant } from "./pages/merchant";
import { connect, disconnect, onWalletChange, refresh, switchChain, wallet, watchWallet } from "./wallet";
import { esc, shortHex } from "./util";
import { logoHtml } from "./logo";

registerSW({ immediate: true });

type Page = (root: HTMLElement, cfg: AppConfig | null) => void | (() => void);
const routes: Record<string, { label: string; page: Page }> = {
  "/": { label: "Home", page: landing },
  "/dashboard": { label: "Dashboard", page: dashboard },
  "/donate": { label: "Donate", page: donor },
  "/agent": { label: "Field agent", page: agent },
  "/claim": { label: "Claim", page: claim },
  "/merchant": { label: "Merchant", page: merchant },
  "/about": { label: "How it works", page: about },
};

let cfg: AppConfig | null = null;
let stopAmbient: (() => void) | null = null;
let ambientLoading = false;
/** The landing page draws its own scene; every other page gets the quiet ambient version behind it. */
function syncAmbient(onLanding: boolean) {
  if (onLanding) { stopAmbient?.(); stopAmbient = null; return; }
  if (stopAmbient || ambientLoading) return;
  ambientLoading = true;
  import("./ambient").then((m) => { if (!document.body.classList.contains("is-landing")) stopAmbient = m.startAmbient(); }).catch(() => {}).finally(() => { ambientLoading = false; });
}
let cleanup: (() => void) | void;
const main = document.getElementById("main")!;
const brand = document.querySelector<HTMLElement>(".brand");
if (brand) brand.innerHTML = logoHtml(44);

function renderNav(path: string) {
  document.getElementById("nav")!.innerHTML = Object.entries(routes)
    .map(([p, r]) => `<a href="#${p}" ${p === path ? 'aria-current="page"' : ""}>${esc(r.label)}</a>`).join("");
}

function renderWallet() {
  const el = document.getElementById("wallet")!;
  if (!cfg) { el.textContent = ""; return; }
  if (!wallet.address) { el.innerHTML = `<button id="cw" class="secondary">Connect wallet</button>`; (document.getElementById("cw") as HTMLButtonElement).onclick = () => connect(cfg!).catch((e) => alert((e as Error).message)); return; }
  el.innerHTML = (wallet.wrongChain
    ? `<span class="tag">Wrong network</span> <button id="sw">Switch to chain ${esc(cfg.chainId)}</button>`
    : `<span class="tag">${esc(shortHex(wallet.address, 4))}</span>`) + ` <button id="dc" class="secondary" title="Disconnect this wallet from the app">Disconnect</button>`;
  const dc = document.getElementById("dc");
  if (dc) dc.onclick = () => void disconnect();
  const sw = document.getElementById("sw");
  if (sw) sw.onclick = () => switchChain(cfg!).catch((e) => alert((e as Error).message));
}

function route() {
  const path = location.hash.replace(/^#/, "") || "/";
  const r = routes[path] ?? routes["/"]!;
  const key = routes[path] ? path : "/";
  document.body.classList.toggle("is-landing", key === "/");
  syncAmbient(key === "/");
  renderNav(key);
  window.scrollTo(0, 0);
  cleanup?.();
  cleanup = r.page(main, cfg);
  main.focus();
}

async function boot() {
  const r = await loadConfig();
  cfg = r.cfg;
  const b = document.getElementById("banner")!;
  // The banner is only for problems the user needs to know about (offline / API unreachable). The testnet
  // disclosure lives in the footer, the About page and the FAQ.
  b.textContent = cfg
    ? (r.fromCache ? "Offline: using settings saved from your last visit." : "")
    : `Cannot reach the FloodFirst API (${r.error ?? "unknown error"}) and no saved settings exist.`;
  if (cfg) { watchWallet(cfg); void refresh(cfg).catch(() => {}); }
  onWalletChange(() => { renderWallet(); route(); });
  renderWallet();
  route();
}
window.addEventListener("hashchange", route);
void boot();
