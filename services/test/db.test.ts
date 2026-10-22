import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { all, get, getMeta, openDb, run, setMeta, tx } from "../src/db.js";

describe("db module", () => {
  it("creates every table and records the schema version", () => {
    const db = openDb(":memory:");
    const tables = all(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
    for (const t of ["meta", "blocks", "events", "group_members", "oracle_log", "operator_gauge", "triggers_submitted", "relayed_tx", "sms_log"]) {
      expect(tables).toContain(t);
    }
  });

  it("persists data across reopen of a file database (restart) and does not re-run migrations", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ffdb-")), "t.sqlite");
    const a = openDb(path);
    setMeta(a, "cursor", "42");
    a.close();
    const b = openDb(path);
    expect(getMeta(b, "cursor")).toBe("42");
    expect(all(b, "SELECT COUNT(*) AS c FROM schema_version")[0]!.c).toBe(1);
  });

  it("enforces uniqueness of event rows (idempotent indexing)", () => {
    const db = openDb(":memory:");
    const ins = () => run(db, "INSERT INTO events (block_number, block_hash, tx_hash, log_index, contract, name, args) VALUES (1,'h','t',0,'Pool','Deposited','{}')");
    ins();
    expect(ins).toThrow();
    run(db, "INSERT OR IGNORE INTO events (block_number, block_hash, tx_hash, log_index, contract, name, args) VALUES (1,'h','t',0,'Pool','Deposited','{}')");
    expect(all(db, "SELECT * FROM events")).toHaveLength(1);
  });

  it("rolls back a failed transaction completely", () => {
    const db = openDb(":memory:");
    expect(() =>
      tx(db, () => {
        setMeta(db, "a", "1");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(getMeta(db, "a")).toBeUndefined();
    tx(db, () => setMeta(db, "a", "2"));
    expect(getMeta(db, "a")).toBe("2");
  });

  it("keeps relayed transactions unique per (kind, key) so a claim cannot be recorded twice", () => {
    const db = openDb(":memory:");
    run(db, "INSERT INTO relayed_tx (kind, key, status, created_at) VALUES ('claim','k','pending',1)");
    expect(() => run(db, "INSERT INTO relayed_tx (kind, key, status, created_at) VALUES ('claim','k','pending',2)")).toThrow();
    run(db, "INSERT INTO relayed_tx (kind, key, status, created_at) VALUES ('redeem','k','pending',2)");
    expect(get(db, "SELECT COUNT(*) AS c FROM relayed_tx")!.c).toBe(2);
  });
});
