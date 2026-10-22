import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDeployment, loadEnv } from "../src/config.js";
import { ADDR, DEPLOYMENT, testEnv } from "./helpers.js";

describe("config module", () => {
  it("applies safe defaults", () => {
    const e = testEnv();
    expect(e.GAUGE_MODE).toBe("operator");
    expect(e.ORACLE_ENABLED).toBe("false");
    expect(e.GAUGE_SCALE).toBe(1);
    expect(e.API_PORT).toBe(8787);
  });

  it("rejects a malformed private key and a bad URL", () => {
    expect(() => testEnv({ RELAYER_PRIVATE_KEY: "0xabc" })).toThrow();
    expect(() => testEnv({ RPC_URL: "not a url" })).toThrow();
  });

  it("rejects out-of-range coordinates and non-positive scale", () => {
    expect(() => testEnv({ BASIN_LAT: "91" })).toThrow();
    expect(() => testEnv({ GAUGE_SCALE: "0" })).toThrow();
  });

  it("requires a recognised gauge mode and a long-enough admin token", () => {
    expect(() => testEnv({ GAUGE_MODE: "magic" })).toThrow();
    expect(() => testEnv({ ADMIN_API_TOKEN: "short" })).toThrow();
    expect(testEnv({ ADMIN_API_TOKEN: "x".repeat(24) }).ADMIN_API_TOKEN).toHaveLength(24);
  });

  it("loads a valid deployment record and refuses a missing or wrong-chain one", () => {
    const dir = mkdtempSync(join(tmpdir(), "ffcfg-"));
    const good = join(dir, "31337.json");
    writeFileSync(good, JSON.stringify({ ...DEPLOYMENT }));
    expect(loadDeployment(testEnv({ DEPLOYMENTS_FILE: good })).pool).toBe(DEPLOYMENT.pool);
    expect(() => loadDeployment(testEnv({ DEPLOYMENTS_FILE: join(dir, "missing.json") }))).toThrow(/No deployment record/);
    const wrong = join(dir, "wrong.json");
    writeFileSync(wrong, JSON.stringify({ ...DEPLOYMENT, chainId: 1 }));
    expect(() => loadDeployment(testEnv({ DEPLOYMENTS_FILE: wrong }))).toThrow(/does not match/);
  });

  it("rejects a deployment record with a bad address", () => {
    const dir = mkdtempSync(join(tmpdir(), "ffcfg-"));
    const f = join(dir, "bad.json");
    writeFileSync(f, JSON.stringify({ ...DEPLOYMENT, pool: "0x1234" }));
    expect(() => loadDeployment(testEnv({ DEPLOYMENTS_FILE: f }))).toThrow();
    expect(ADDR(9)).toMatch(/^0x[0-9a-f]{40}$/);
    expect(loadEnv).toBeTypeOf("function");
  });
});
