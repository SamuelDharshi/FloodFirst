// Exports ABIs from Foundry build output so services and web use the exact compiled interfaces.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const names = ["TestToken", "Pool", "VoucherIssuer", "NullifierRegistry", "TriggerOracle"];
const out = new URL("../src/abi/", import.meta.url);
mkdirSync(out, { recursive: true });
for (const n of names) {
  const j = JSON.parse(readFileSync(new URL(`../../contracts/out/${n}.sol/${n}.json`, import.meta.url), "utf8"));
  writeFileSync(new URL(`${n}.json`, out), JSON.stringify(j.abi, null, 2));
}
const s = JSON.parse(
  readFileSync(new URL("../../contracts/out/Semaphore.sol/Semaphore.json", import.meta.url), "utf8"),
);
writeFileSync(new URL("Semaphore.json", out), JSON.stringify(s.abi, null, 2));
console.log("exported", [...names, "Semaphore"].join(", "));
