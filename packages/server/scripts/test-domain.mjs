#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SERVER_DOMAIN_NAMES, INTEGRATION_GROUPS, buildFileGraph, planDomainTests, workspaceRoot } from './test-graph.mjs';
import { runTestPlan } from './test-runner.mjs';

const args = process.argv.slice(2);
let contractOnly = false;
let dryRun = false;
let output;
let update = false;
const domains = [];
const groups = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--contract-only') contractOnly = true;
  else if (arg === '--update') update = true;
  else if (arg === '--dry-run') dryRun = true;
  else if (arg === '--plan-out') output = args[++i];
  else if (arg === '--group') groups.push(args[++i]);
  else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
  else domains.push(arg);
}
const selected = domains.includes('all') ? SERVER_DOMAIN_NAMES : domains;
for (const group of groups) if (!INTEGRATION_GROUPS[group]) throw new Error(`Unknown integration group: ${group}`);
if (!selected.length && !groups.length) throw new Error('Specify domains, all, or --group <name>');
const plan = planDomainTests(selected, buildFileGraph(), { contractOnly, groups });
if (output) writeFileSync(resolve(workspaceRoot, output), `${JSON.stringify(plan, null, 2)}\n`);
if (dryRun) console.log(JSON.stringify(plan, null, 2));
else process.exitCode = runTestPlan(plan, update ? ['--update'] : []);
