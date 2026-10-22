// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { txBox } from "../src/txbox";

const HASH = "0x" + "cd".repeat(32);
const render = (p: Parameters<ReturnType<typeof txBox>>[0]) => {
  const el = document.createElement("div");
  txBox(el)(p);
  return el;
};

describe("txbox module", () => {
  it("shows a progress message with a link to the transaction on the explorer", () => {
    const el = render({ phase: "pending", hash: HASH as never });
    expect(el.textContent).toMatch(/Pending/);
    const a = el.querySelector("a")!;
    expect(a.getAttribute("href")).toContain(`/tx/${HASH}`);
    expect(a.getAttribute("rel")).toBe("noopener");
  });

  it("marks only a verified result as success", () => {
    expect(render({ phase: "verified" }).querySelector(".ok")).not.toBeNull();
    expect(render({ phase: "confirmed" }).querySelector(".ok")).toBeNull();
  });

  it("marks reverted, rejected and failed as errors with an alert role", () => {
    for (const phase of ["reverted", "rejected", "failed"] as const) {
      const m = render({ phase, error: "x" }).querySelector(".err")!;
      expect(m.getAttribute("role")).toBe("alert");
    }
  });

  it("escapes error text from the wallet or network", () => {
    const el = render({ phase: "failed", error: "<script>alert(1)</script>" });
    expect(el.querySelector("script")).toBeNull();
    expect(el.textContent).toContain("<script>");
  });

  it("omits the explorer link when there is no hash yet", () => {
    expect(render({ phase: "wallet" }).querySelector("a")).toBeNull();
  });
});
