# Outbox phase 0 evidence

Source: 318d71ed6a51d73bd6552d9598704c1fc418280c. Node v24.21.0; 8 forks; file isolation on; module cache off; dotenv disabled; full PDF font fixed.

| Profile | Samples | Files | Passed | Skipped | Median seconds | Range seconds |
| --- | --- | --- | --- | --- | --- | --- |
| full | 3 | 550 | 4086 | 83 | 475.066 | 460.674–476.682 |
| identity | 3 | 22 | 225 | 0 | 58.689 | 51.796–61.965 |
| workflow | 3 | 44 | 330 | 0 | 67.029 | 66.945–76.505 |
| payment | 3 | 24 | 205 | 1 | 58.205 | 50.456–60.955 |

All adopted samples passed. First incorrectly isolated dependency sample is excluded, with its raw files retained.

The full-3 sample overlapped one short single-fork focused run (21:02:46–21:03:21); workflow-3 overlapped static inventory work. These are raw development-host observations, not an idle-host speed comparison. Final measurement must pair frozen baseline/candidate runs under matching host load.

## Real infrastructure fault probe

The scripts create a unique disposable localhost PostgreSQL database; source/effect tables are synthetic, but event publication and durable claim/execute use the real production primitives. Redis is PING only, and HTTP is a separate anonymous loopback receiver. No application business rows or external recipients are touched.

Legacy production openEventBus: after committing the source fact, emit then immediate process exit left 1 source fact and 0 effects; a fresh process did not recover it. Durable primitive: the same boundary left 1 source and 0 effects initially, then recovered exactly 1 effect in a fresh process. Normal 50-event runs produced exactly 50 effects; durable additionally recovered the crashed fact.

This verifies the primitive failure boundary, not full payment/workflow/Webhook end-to-end behavior. Single smoke latency records are retained in legacy-boundary-1.json and core-boundary-smoke.json; they are not sufficient for a performance claim.

## Reproduce

From workspace root, run the inventory script with --source-root pointing at the frozen server and --source-ref at the immutable commit. For runtime probes, run packages/server/scripts/domain-events/benchmark-boundary.mts from packages/server using --mode legacy --source-root ../../output/outbox-baseline/source/packages/server or --mode durable --schema-sql drizzle/0006_true_senator_kelly.sql. Output filenames must be unique per run.

The current adopted raw full/profile samples live in tests/outbox-baseline-isolated-summary.json and individual JSON/log/resources files. The immutable source snapshot excludes .env and resolves local dependency versions via junctions; do not remove those links until final comparison completes.
