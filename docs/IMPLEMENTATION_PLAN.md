# Implementation Plan

Stack: Foundry/Solidity 0.8.28 (OpenZeppelin 5, Semaphore v4); Node 22 + TypeScript + viem + Fastify + node:sqlite (flag-free on Node 22.13 but still marked experimental; chosen because native better-sqlite3 crashed on the dev machine); Vite PWA (vanilla TS) with @semaphore-protocol/* and viem.

Phases 1-6 are built (see [PROGRESS.md](PROGRESS.md)). Remaining work is deployment and live verification (BLOCKERS).

Possible next work: browser E2E (Playwright) with a test wallet against a local anvil; gauge integration once a real endpoint is chosen; multisig ownership; audit.
