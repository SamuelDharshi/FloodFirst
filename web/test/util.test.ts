// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { $, esc, fmtUnits, msg, shortHex, store, ts } from "../src/util";

describe("util module", () => {
  beforeEach(() => localStorage.clear());

  it("escapes HTML so server-provided text cannot inject markup", () => {
    expect(esc(`<img src=x onerror="a('b')">&`)).toBe("&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
    expect(esc(123)).toBe("123");
    expect(msg("err", "<b>x</b>")).not.toContain("<b>");
  });

  it("formats token amounts without floating point error", () => {
    expect(fmtUnits("100000000", 6)).toBe("100.00");
    expect(fmtUnits(1n, 6)).toBe("0.00");
    expect(fmtUnits("1234567890123456789", 6, 4)).toBe(`${(1234567890123n).toLocaleString()}.4567`); // grouping follows the viewer's locale
    expect(fmtUnits(5_500_000n, 6, 0)).toBe("5");
  });

  it("shortens long hex and leaves short strings alone", () => {
    expect(shortHex("0x" + "ab".repeat(32))).toMatch(/^0x[0-9a-f]{6}…[0-9a-f]{6}$/);
    expect(shortHex("0x1234")).toBe("0x1234");
    expect(shortHex("0x" + "ab".repeat(32), 4)).toMatch(/^0xabab…abab$/);
  });

  it("converts unix seconds to a local date string", () => {
    expect(ts(0)).toBe(new Date(0).toLocaleString());
    expect(ts("1700000000")).toBe(new Date(1_700_000_000_000).toLocaleString());
  });

  it("finds elements and throws a clear error for a missing one", () => {
    document.body.innerHTML = `<div id="a"></div>`;
    expect($(document.body, "#a")).toBeInstanceOf(HTMLElement);
    expect(() => $(document.body, "#nope")).toThrow(/missing element/);
  });

  it("stores JSON, falls back on corrupt data, and survives unavailable storage", () => {
    const s = store<number[]>("k", []);
    s.set([1, 2]);
    expect(s.get()).toEqual([1, 2]);
    localStorage.setItem("k", "{not json");
    expect(s.get()).toEqual([]);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => s.set([3])).not.toThrow();
    spy.mockRestore();
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(s.get()).toEqual([]);
    get.mockRestore();
  });
});
