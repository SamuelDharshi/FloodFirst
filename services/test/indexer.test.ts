// Indexer tests against a FAKE CHAIN (test double) whose blocks, logs and hashes the test controls, so reorgs,
// chunking, restarts and backfill can be exercised deterministically. Real-chain behaviour is in e2e.test.ts.
import { encodeAbiParameters, encodeEventTopics, type Abi, type Address, type AbiEvent } from "viem";
import { describe, expect, it } from "vitest";
import { poolAbi, registryAbi, semaphoreAbi } from "../src/abi.js";
import { all, get, getMeta, openDb } from "../src/db.js";
import { Indexer } from "../src/indexer.js";
import { ADDR, DEPLOYMENT, testEnv } from "./helpers.js";

interface FakeLog { address: Address; topics: `0x${string}`[]; data: `0x${string}`; blockNumber: bigint; blockHash: `0x${string}`; transactionHash: `0x${string}`; logIndex: number }

class FakeChain {
  head = 0;
  fork = 0;
  logs: { fork: number; log: FakeLog }[] = [];
  getLogsCalls: { from: number; to: number; address: unknown }[] = [];
  hash(n: number, fork = this.fork): `0x${string}` { return `0x${fork.toString(16).padStart(8, "0")}${n.toString(16).padStart(56, "0")}`; }
  add(abi: Abi, address: Address, eventName: string, args: Record<string, unknown>, block: number, idx = 0) {
    const ev = (abi as readonly AbiEvent[]).find((x) => x.type === "event" && x.name === eventName)!;
    const topics = encodeEventTopics({ abi: [ev], eventName, args } as never) as `0x${string}`[];
    const nonIndexed = ev.inputs.filter((i) => !i.indexed);
    const data = nonIndexed.length ? encodeAbiParameters(nonIndexed, nonIndexed.map((i) => args[i.name!] as never)) : "0x";
    this.logs.push({ fork: this.fork, log: { address, topics, data, blockNumber: BigInt(block), blockHash: this.hash(block), transactionHash: this.hash(block * 100 + idx), logIndex: idx } });
  }
  client() {
    return {
      getBlockNumber: async () => BigInt(this.head),
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ hash: this.hash(Number(blockNumber)) }),
      getLogs: async (p: { address: Address | Address[]; fromBlock: bigint; toBlock: bigint; args?: { groupId?: bigint[] } }) => {
        this.getLogsCalls.push({ from: Number(p.fromBlock), to: Number(p.toBlock), address: p.address });
        const addrs = (Array.isArray(p.address) ? p.address : [p.address]).map((a) => a.toLowerCase());
        return this.logs
          .filter((l) => l.fork === this.fork && addrs.includes(l.log.address.toLowerCase()) && l.log.blockNumber >= p.fromBlock && l.log.blockNumber <= p.toBlock)
          .filter((l) => !p.args?.groupId || p.args.groupId.some((g) => l.log.topics[1] === `0x${g.toString(16).padStart(64, "0")}`))
          .map((l) => l.log);
      },
    } as never;
  }
}

const D = { ...DEPLOYMENT, deployBlock: 10 };
const deposit = (c: FakeChain, block: number, amount: bigint, idx = 0) => c.add(poolAbi, D.pool, "Deposited", { donor: ADDR(77), amount, donorTotal: amount }, block, idx);
const mk = (c: FakeChain, db = openDb(":memory:")) => ({ db, ix: new Indexer(db, c.client(), testEnv(), D) });

describe("indexer module", () => {
  it("indexes only blocks that are at least CONFIRMATIONS deep", async () => {
    const c = new FakeChain();
    deposit(c, 12, 5n);
    deposit(c, 20, 6n);
    c.head = 21; // CONFIRMATIONS=2 => safe head 19
    const { db, ix } = mk(c);
    await ix.sync();
    expect(all(db, "SELECT block_number FROM events").map((r) => r.block_number)).toEqual([12]);
    expect(ix.cursor()).toBe(19);
    c.head = 22;
    await ix.sync();
    expect(all(db, "SELECT COUNT(*) AS c FROM events")[0]!.c).toBe(2);
  });

  it("makes no progress and no calls when nothing is confirmed yet", async () => {
    const c = new FakeChain();
    c.head = 11; // safe head 9 < deployBlock
    const { ix } = mk(c);
    expect(await ix.step()).toBe(false);
    expect(c.getLogsCalls).toHaveLength(0);
  });

  it("walks the range in chunks and is idempotent across a restart", async () => {
    const c = new FakeChain();
    deposit(c, 15, 1n);
    deposit(c, 250, 2n);
    c.head = 302; // safe 300, chunk 100 => from 10: 10-109, 110-209, 210-300
    const { db, ix } = mk(c);
    await ix.sync();
    const ranges = c.getLogsCalls.filter((x) => Array.isArray(x.address)).map((x) => [x.from, x.to]);
    expect(ranges).toEqual([[10, 109], [110, 209], [210, 300]]);
    expect(all(db, "SELECT COUNT(*) AS c FROM events")[0]!.c).toBe(2);
    // restart: new instance, same database, nothing new on chain
    const before = c.getLogsCalls.length;
    await new Indexer(db, c.client(), testEnv(), D).sync();
    expect(c.getLogsCalls.length).toBe(before);
    expect(all(db, "SELECT COUNT(*) AS c FROM events")[0]!.c).toBe(2);
    expect(getMeta(db, "cursor")).toBe("300");
  });

  it("rolls back and re-indexes after a reorganisation", async () => {
    const c = new FakeChain();
    deposit(c, 12, 10n);
    deposit(c, 30, 20n); // will be orphaned
    c.head = 32;
    const { db, ix } = mk(c);
    await ix.sync(); // checkpoint at 30 (safe head)
    expect(all(db, "SELECT COUNT(*) AS c FROM events")[0]!.c).toBe(2);

    // Chain reorganises: a different fork replaces blocks from 25 onward; the new fork has a different event.
    c.fork = 1;
    deposit(c, 12, 10n); // unaffected history is the same on the new fork
    deposit(c, 28, 99n);
    c.head = 36;
    const target = await ix.handleReorg();
    expect(target).not.toBeNull();
    expect(all(db, "SELECT COUNT(*) AS c FROM events WHERE block_number > ?", target!)[0]!.c).toBe(0);
    await ix.sync();
    const amounts = all(db, "SELECT args FROM events ORDER BY block_number").map((r) => JSON.parse(r.args as string).amount);
    expect(amounts).toEqual(["10", "99"]); // orphaned 20 is gone, replaced by the new fork's 99
  });

  it("backfills group members from the deploy block when an NGO group is registered, gap-free", async () => {
    const c = new FakeChain();
    const member = (g: bigint, i: number, commit: bigint, block: number) =>
      c.add(semaphoreAbi, D.semaphore, "MemberAdded", { groupId: g, index: BigInt(i), identityCommitment: commit, merkleTreeRoot: 1n }, block, i);
    member(7n, 0, 111n, 11); // added BEFORE the group is registered with the registry
    member(9n, 0, 555n, 12); // another group: must be ignored
    c.add(registryAbi, D.registry, "NgoGroupRegistered", { groupId: 7n, ngo: ADDR(50) }, 15);
    member(7n, 1, 222n, 16); // added after registration
    c.head = 30;
    const { db, ix } = mk(c);
    await ix.sync();
    const rows = all(db, "SELECT group_id, idx, commitment FROM group_members ORDER BY idx");
    expect(rows).toEqual([{ group_id: "7", idx: 0, commitment: "111" }, { group_id: "7", idx: 1, commitment: "222" }]);
    expect(get(db, "SELECT COUNT(*) AS c FROM group_members WHERE group_id = '9'")!.c).toBe(0);
    expect(ix.knownGroups()).toEqual(["7"]);
  });
});
