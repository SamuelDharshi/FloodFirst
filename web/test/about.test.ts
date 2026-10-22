// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { about } from "../src/pages/about";
import { CFG, root } from "./pagehelpers";

describe("about page", () => {
  it("states that this is testnet-only and unaudited", () => {
    const r = root();
    about(r, CFG());
    expect(r.textContent).toMatch(/Testnet only/);
    expect(r.textContent).toMatch(/No independent security audit/);
  });

  it("lists the known limits from the API, escaped", () => {
    const r = root();
    about(r, CFG());
    const li = r.querySelector(".limits li")!;
    expect(li.textContent).toBe("Known limit <one>");
    expect(r.querySelector("limit, one")).toBeNull();
  });

  it("explains the 30% cap and the 2-of-2 trigger", () => {
    const r = root();
    about(r, CFG());
    expect(r.textContent).toMatch(/30%/);
    expect(r.textContent).toMatch(/forecast.*AND.*river gauge/s);
  });

  it("is honest that operator mode gauge readings are human-entered", () => {
    const r = root();
    about(r, CFG({ gaugeMode: "operator" }));
    expect(r.textContent).toMatch(/designated human operator/);
    expect(r.textContent).toMatch(/no public real-time gauge API was found/);
  });

  it("shows an error and a safe default when configuration is unavailable", () => {
    const r = root();
    about(r, null);
    expect(r.querySelector(".err")).not.toBeNull();
    expect(r.textContent).toMatch(/Configuration unavailable/);
  });
});
