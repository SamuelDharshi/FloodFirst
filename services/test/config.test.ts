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

  it("uses the hosting platform's PORT when API_PORT is not set, and prefers API_PORT when both are", () => {
    expect(testEnv({ PORT: "10000" }).API_PORT).toBe(10000);
    expect(testEnv({ PORT: "10000", API_PORT: "3001" }).API_PORT).toBe(3001);
    expect(testEnv({}).API_PORT).toBe(8787);
  });

  it("accepts a private key pasted without 0x or with spaces and quotes, but still rejects malformed ones", () => {
    const k = "47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";
    expect(testEnv({ RELAYER_PRIVATE_KEY: k }).RELAYER_PRIVATE_KEY).toBe("0x" + k);
    expect(testEnv({ RELAYER_PRIVATE_KEY: `  "0x${k}"  ` }).RELAYER_PRIVATE_KEY).toBe("0x" + k);
    expect(testEnv({ RELAYER_PRIVATE_KEY: k + "\n" }).RELAYER_PRIVATE_KEY).toBe("0x" + k);
    expect(() => testEnv({ RELAYER_PRIVATE_KEY: "0x301ea090e957c28ca536ab8679EBEF2D354Febd8" })).toThrow(); // an address is not a key
    expect(() => testEnv({ RELAYER_PRIVATE_KEY: k.slice(0, 60) })).toThrow();
  });

  it("explains a bad private key without ever echoing its value", () => {
    const bad = "super-secret-but-wrong-value";
    try {
      testEnv({ RELAYER_PRIVATE_KEY: bad });
      throw new Error("should have thrown");
    } catch (e) {
      const msg = String((e as Error).message);
      expect(msg).toContain("RELAYER_PRIVATE_KEY");
      expect(msg).toMatch(/0x followed by 64 hexadecimal characters/);
      expect(msg).not.toContain(bad);
    }
  });
});

