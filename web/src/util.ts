export const esc = (v: unknown): string =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function fmtUnits(raw: string | bigint, decimals = 6, dp = 2): string {
  const v = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").slice(0, dp);
  return `${whole.toLocaleString()}${dp > 0 ? "." + frac : ""}`;
}

export const shortHex = (h: string, n = 6): string => (h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);

export function ts(sec: number | string): string {
  return new Date(Number(sec) * 1000).toLocaleString();
}

export const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T => {
  const e = root.querySelector<T>(sel);
  if (!e) throw new Error(`missing element ${sel}`);
  return e;
};

export function msg(kind: "info" | "err" | "ok", text: string): string {
  return `<div class="msg ${kind === "info" ? "" : kind}" role="${kind === "err" ? "alert" : "status"}">${esc(text)}</div>`;
}

export function store<T>(key: string, fallback: T): { get(): T; set(v: T): void } {
  return {
    get() {
      try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
      } catch {
        return fallback;
      }
    },
    set(v: T) {
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* storage unavailable: the page still works, state just is not kept */
      }
    },
  };
}
