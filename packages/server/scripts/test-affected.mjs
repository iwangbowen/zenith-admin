#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectChangedFiles } from './test-changes.mjs';
import { buildFileGraph, resolveAffectedDomains, workspaceRoot } from './test-graph.mjs';
import { runTestPlan } from './test-runner.mjs';

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (['--dry-run', '--json', '--full'].includes(arg)) options[arg.slice(2)] = true;
  else if (['--base', '--plan-out', '--plan'].includes(arg)) {
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2)] = value;
  } else throw new Error(`Unknown option: ${arg}`);
}
let plan;
if (options.plan) plan = JSON.parse(readFileSync(resolve(workspaceRoot, options.plan), 'utf8'));
else {
  const diff = collectChangedFiles({ base: options.base });
  plan = { base: diff.base, ...resolveAffectedDomains(diff.files, buildFileGraph(), { forceFull: options.full, uncertainDiff: diff.uncertainDiff }) };
  if (diff.error) plan.reasons.push(diff.error);
}
if (options['plan-out']) writeFileSync(resolve(workspaceRoot, options['plan-out']), `${JSON.stringify(plan, null, 2)}\n`);
if (options.json) console.log(JSON.stringify(plan, null, 2));
else {
  console.log(`Server test plan: ${plan.mode}; ${plan.tests.length} files; domains: ${plan.affectedDomains.join(', ') || '(none)'}`);
  for (const reason of plan.reasons ?? []) console.log(`- ${reason}`);
}
if (!options['dry-run']) process.exitCode = runTestPlan(plan);
