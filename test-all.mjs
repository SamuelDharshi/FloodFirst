// Runs every test suite and the type checks/builds. Usage: node test-all.mjs
// Needs forge and anvil on PATH (the services end-to-end test deploys to a local anvil chain).
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = import.meta.dirname;
const steps = [
  ["contracts: forge test", "contracts", "forge", ["test"]],
  ["services: typecheck", "services", "npx", ["tsc", "-p", "tsconfig.json", "--noEmit"]],
  ["services: vitest (unit + local-chain e2e)", "services", "npx", ["vitest", "run"]],
  ["web: typecheck", "web", "npx", ["tsc", "--noEmit"]],
  ["web: vitest (jsdom)", "web", "npx", ["vitest", "run"]],
  ["web: production build (PWA)", "web", "npx", ["vite", "build"]],
];
let failed = 0;
for (const [name, dir, cmd, args] of steps) {
  console.log(`\n=== ${name} ===`);
  const r = spawnSync(cmd, args, { cwd: resolve(root, dir), stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, FOUNDRY_DISABLE_NIGHTLY_WARNING: "1" } });
  if (r.status !== 0) { failed++; console.log(`FAILED: ${name}`); }
}
console.log(failed ? `\n${failed} step(s) FAILED` : "\nALL STEPS PASSED");
process.exit(failed ? 1 : 0);
