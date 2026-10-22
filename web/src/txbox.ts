import { EXPLORER } from "./api";
import { phaseText, type TxProgress } from "./wallet";
import { esc, shortHex } from "./util";

/** Returns a progress callback that renders the real transaction lifecycle into `el`. */
export function txBox(el: HTMLElement): (p: TxProgress) => void {
  return (p) => {
    const kind = p.phase === "verified" ? "ok" : ["reverted", "rejected", "failed"].includes(p.phase) ? "err" : "";
    el.innerHTML = `<div class="msg ${kind}" role="${kind === "err" ? "alert" : "status"}">${esc(phaseText[p.phase])}${p.error ? " " + esc(p.error) : ""}${p.hash ? ` <a href="${esc(EXPLORER)}/tx/${esc(p.hash)}" target="_blank" rel="noopener">${esc(shortHex(p.hash))}</a>` : ""}</div>`;
  };
}
