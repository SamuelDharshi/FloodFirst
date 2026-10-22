import { parseEventLogs, type Abi, type Address, type Log, type PublicClient } from "viem";
import { issuerAbi, oracleAbi, poolAbi, registryAbi, semaphoreAbi } from "./abi.js";
import { json } from "./chain.js";
import type { Deployment, Env } from "./config.js";
import { all, get, getMeta, run, setMeta, tx, type Db } from "./db.js";

const MEMBER_EVENTS = ["MemberAdded", "MembersAdded"];

interface Watched {
  address: Address;
  abi: Abi;
  label: string;
}

/**
 * Event indexer. Only blocks at least `confirmations` deep are indexed. Every chunk records the hash of its
 * last block; on every pass the newest checkpoint is compared with the chain and, on mismatch (reorg),
 * data after the last matching checkpoint is deleted and re-indexed. Inserts are idempotent
 * (UNIQUE tx_hash+log_index), and the cursor is committed in the same transaction as the data, so a crash
 * at any point resumes safely.
 */
export class Indexer {
  private readonly watched: Watched[];

  constructor(
    private readonly db: Db,
    private readonly pub: PublicClient,
    private readonly env: Env,
    private readonly d: Deployment,
  ) {
    this.watched = [
      { address: d.pool, abi: poolAbi, label: "Pool" },
      { address: d.issuer, abi: issuerAbi, label: "VoucherIssuer" },
      { address: d.registry, abi: registryAbi, label: "NullifierRegistry" },
      { address: d.oracle, abi: oracleAbi, label: "TriggerOracle" },
    ];
  }

  cursor(): number {
    return Number(getMeta(this.db, "cursor") ?? this.d.deployBlock - 1);
  }

  /** Detect and undo a reorg. Returns the block number rolled back to, or null if none. */
  async handleReorg(): Promise<number | null> {
    const cps = all(this.db, "SELECT number, hash FROM blocks ORDER BY number DESC");
    if (cps.length === 0) return null;
    let rolledTo: number | null = null;
    for (const cp of cps) {
      const n = cp.number as number;
      const onChain = await this.pub.getBlock({ blockNumber: BigInt(n) });
      if (onChain.hash === cp.hash) break;
      rolledTo = n;
    }
    if (rolledTo === null) return null;
    // rolledTo is the oldest mismatching checkpoint; fall back to the checkpoint just before it.
    const prev = get(this.db, "SELECT number FROM blocks WHERE number < ? ORDER BY number DESC LIMIT 1", rolledTo);
    const target = prev ? (prev.number as number) : this.d.deployBlock - 1;
    tx(this.db, () => {
      run(this.db, "DELETE FROM events WHERE block_number > ?", target);
      run(this.db, "DELETE FROM group_members WHERE block_number > ?", target);
      run(this.db, "DELETE FROM blocks WHERE number > ?", target);
      setMeta(this.db, "cursor", String(target));
    });
    return target;
  }

  /** Index one chunk. Returns true if progress was made. */
  async step(): Promise<boolean> {
    await this.handleReorg();
    const head = Number(await this.pub.getBlockNumber());
    const safe = head - this.env.CONFIRMATIONS;
    const from = this.cursor() + 1;
    if (from > safe) return false;
    const to = Math.min(safe, from + this.env.INDEXER_CHUNK - 1);

    const logs = await this.pub.getLogs({
      address: this.watched.map((w) => w.address),
      fromBlock: BigInt(from),
      toBlock: BigInt(to),
    });

    const rows: { log: Log; name: string; contract: string; args: unknown }[] = [];
    for (const w of this.watched) {
      const mine = logs.filter((l) => l.address.toLowerCase() === w.address.toLowerCase());
      for (const p of parseEventLogs({ abi: w.abi, logs: mine })) {
        rows.push({ log: p, name: p.eventName, contract: w.label, args: p.args });
      }
    }

    const newGroups = rows
      .filter((r) => r.name === "NgoGroupRegistered")
      .map((r) => String((r.args as { groupId: bigint }).groupId));
    const knownBefore = this.knownGroups();

    // Members of newly registered groups are backfilled from the deploy block; others only for this range.
    const memberRows: { group: string; idx: number; commitment: string; block: number }[] = [];
    const fetchMembers = async (groups: string[], fromBlock: number, toBlock: number) => {
      if (groups.length === 0) return;
      const ranges: [number, number][] = [];
      for (let s = fromBlock; s <= toBlock; s += this.env.INDEXER_CHUNK) ranges.push([s, Math.min(toBlock, s + this.env.INDEXER_CHUNK - 1)]);
      // A public RPC answers one 200-block request in ~0.5 s, so a long backfill is fetched with a few requests in flight.
      const results: Log[][] = new Array(ranges.length);
      let next = 0;
      const worker = async () => {
        while (next < ranges.length) {
          const i = next++;
          const [lo, hi] = ranges[i]!;
          results[i] = (await this.pub.getLogs({
            address: this.d.semaphore,
            fromBlock: BigInt(lo),
            toBlock: BigInt(hi),
            // groupId is the only indexed argument shared by every member event; filter by topic OR.
            events: semaphoreAbi.filter(
              (x) => x.type === "event" && MEMBER_EVENTS.includes(x.name),
            ) as never,
            args: { groupId: groups.map((g) => BigInt(g)) } as never,
          })) as unknown as Log[];
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, ranges.length) }, worker));
      for (const ml of results) {
        for (const p of parseEventLogs({ abi: semaphoreAbi, logs: ml })) {
          const a = p.args as Record<string, unknown>;
          const gid = String(a.groupId);
          const bn = Number(p.blockNumber);
          if (p.eventName === "MemberAdded") {
            memberRows.push({ group: gid, idx: Number(a.index), commitment: String(a.identityCommitment), block: bn });
          } else if (p.eventName === "MembersAdded") {
            const cs = a.identityCommitments as bigint[];
            cs.forEach((c, i) =>
              memberRows.push({ group: gid, idx: Number(a.startIndex) + i, commitment: String(c), block: bn }),
            );
          }
        }
      }
    };
    await fetchMembers(newGroups, this.d.deployBlock, to);
    await fetchMembers(knownBefore, from, to);

    const hash = (await this.pub.getBlock({ blockNumber: BigInt(to) })).hash;

    tx(this.db, () => {
      for (const r of rows) {
        run(
          this.db,
          `INSERT OR IGNORE INTO events (block_number, block_hash, tx_hash, log_index, contract, name, args)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          Number(r.log.blockNumber),
          r.log.blockHash as string,
          r.log.transactionHash as string,
          Number(r.log.logIndex),
          r.contract,
          r.name,
          json(r.args),
        );
      }
      for (const m of memberRows) {
        run(
          this.db,
          "INSERT OR IGNORE INTO group_members (group_id, idx, commitment, block_number) VALUES (?, ?, ?, ?)",
          m.group,
          m.idx,
          m.commitment,
          m.block,
        );
      }
      run(this.db, "INSERT OR REPLACE INTO blocks (number, hash) VALUES (?, ?)", to, hash);
      run(this.db, "DELETE FROM blocks WHERE number < ?", to - 4096);
      setMeta(this.db, "cursor", String(to));
    });
    return true;
  }

  /** Catch up until the safe head. */
  async sync(): Promise<void> {
    while (await this.step()) {
      /* continue */
    }
  }

  knownGroups(): string[] {
    return all(this.db, "SELECT args FROM events WHERE name = 'NgoGroupRegistered'").map(
      (r) => String((JSON.parse(r.args as string) as { groupId: string }).groupId),
    );
  }

  start(intervalMs: number, onError: (e: unknown) => void): () => void {
    let stopped = false;
    const loop = async () => {
      while (!stopped) {
        try {
          await this.sync();
        } catch (e) {
          onError(e);
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    };
    void loop();
    return () => {
      stopped = true;
    };
  }
}
