// TEST DATA GENERATOR. Output (proofs.json) is a test fixture only. It is never used by production code.
// Produces REAL Semaphore v4 Groth16 proofs (generated with the official circuit artifacts) for the
// Foundry tests. Households are deterministic test identities.
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof } from "@semaphore-protocol/proof";
import { keccak256, toHex } from "viem";
import { writeFileSync } from "node:fs";

const h1 = new Identity("test-household-1");
const h2 = new Identity("test-household-2");

const groupA = new Group([h1.commitment, h2.commitment]); // NGO A enrolled H1 and H2
const groupB = new Group([h1.commitment]); // NGO B also enrolled H1 (the cross-NGO case)

const secret = (n) => toHex(BigInt(n), { size: 32 });
const voucherId = (s) => BigInt(keccak256(s)) >> 8n;

async function mk(label, identity, group, eventId, voucherSecret) {
  const message = voucherId(voucherSecret);
  const p = await generateProof(identity, group, message, eventId);
  return {
    label,
    eventId,
    voucherSecret,
    proof: {
      merkleTreeDepth: p.merkleTreeDepth.toString(),
      merkleTreeRoot: p.merkleTreeRoot.toString(),
      nullifier: p.nullifier.toString(),
      message: p.message.toString(),
      scope: p.scope.toString(),
      points: p.points.map((x) => x.toString()),
    },
  };
}

const out = {
  _notice: "TEST FIXTURE: real Semaphore proofs over deterministic test identities. Not production data.",
  commitments: {
    h1: h1.commitment.toString(),
    h2: h2.commitment.toString(),
  },
  proofs: [
    await mk("A_h1_event1", h1, groupA, 1, secret(101)),
    await mk("B_h1_event1", h1, groupB, 1, secret(102)),
    await mk("A_h2_event1", h2, groupA, 1, secret(103)),
    await mk("A_h1_event2", h1, groupA, 2, secret(104)),
  ],
};
writeFileSync(new URL("./proofs.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("wrote proofs.json");
