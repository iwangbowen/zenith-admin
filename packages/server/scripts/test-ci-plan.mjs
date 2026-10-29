import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { collectChangedFiles } from './test-changes.mjs';
import { buildFileGraph, resolveAffectedDomains, workspaceRoot } from './test-graph.mjs';

/** Partition exact files once; group overlaps are deduplicated before sharding. */
export function shardTestPlan(plan, limit = 3) {
  if (plan.mode === 'none') return [];
  const domains = plan.mode === 'domains' ? plan.affectedDomains : [];
  const count = Math.max(1, Math.min(limit, Math.ceil((plan.tests.length + domains.length * 15) / 100)));
  const shards = Array.from({ length: count }, () => ({ ...plan, tests: [], contractDomains: [] }));
  plan.tests.forEach((file, index) => shards[index % count].tests.push(file));
  domains.forEach((domain, index) => shards[index % count].contractDomains.push(domain));
  return shards;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const args = process.argv.slice(2);
  let base;
  let full = false;
  let output = '.tmp/server-test-plans';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--full') full = true;
    else if (args[i] === '--base') base = args[++i];
    else if (args[i] === '--out') output = args[++i];
    else throw new Error(`Unknown option: ${args[i]}`);
  }
  const diff = collectChangedFiles({ base });
  const plan = { base: diff.base, ...resolveAffectedDomains(diff.files, buildFileGraph(), { forceFull: full, uncertainDiff: diff.uncertainDiff }) };
  const directory = resolve(workspaceRoot, output);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  const matrix = { include: shardTestPlan(plan).map((shard, index) => {
    const file = `shard-${index + 1}.json`;
    writeFileSync(join(directory, file), `${JSON.stringify(shard, null, 2)}\n`);
    return { shard: index + 1, plan: file };
  }) };
  // Keep a syntactically valid matrix when no Server work is required; job-level if skips it.
  if (!matrix.include.length) matrix.include.push({ shard: 0, plan: 'plan.json' });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mode=${plan.mode}\nmatrix=${JSON.stringify(matrix)}\n`);
  console.log(JSON.stringify({ mode: plan.mode, files: plan.tests.length, domains: plan.affectedDomains, matrix, reasons: plan.reasons }, null, 2));
}
