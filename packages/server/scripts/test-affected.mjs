#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDomainGraph, resolveAffectedDomains } from './test-graph.mjs';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const contractOnly = args.includes('--contract-only');
const baseIndex = args.indexOf('--base');

function git(args) {
  return execFileSync('git', args, { cwd: resolve(serverRoot, '../..'), encoding: 'utf8' }).trim();
}

function detectBase() {
  if (baseIndex >= 0 && args[baseIndex + 1]) return args[baseIndex + 1];
  try { return git(['merge-base', 'HEAD', 'origin/master']); } catch { return 'HEAD~1'; }
}

const base = detectBase();
let committed = [];
try { committed = git(['diff', '--name-only', `${base}...HEAD`]).split(/\r?\n/).filter(Boolean); } catch { /* local shallow checkout */ }
let working = [];
try { working = git(['diff', '--name-only']).split(/\r?\n/).filter(Boolean); } catch { /* ignore */ }
let untracked = [];
try { untracked = git(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/).filter(Boolean); } catch { /* ignore */ }

const plan = resolveAffectedDomains([...new Set([...committed, ...working, ...untracked])], buildDomainGraph());
console.log(JSON.stringify({ base, ...plan }, null, 2));

if (dryRun) process.exit(0);

if (plan.noServerChanges) {
  console.log('No Server/shared changes; Server tests are not required.');
  process.exit(0);
}

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const command = contractOnly ? ['run', 'test:domain', '-w', '@zenith/server', '--', '--contract-only', 'all']
  : plan.global
    ? ['run', 'test', '-w', '@zenith/server']
    : ['run', 'test:domain', '-w', '@zenith/server', '--', ...plan.affectedDomains];
const result = spawnSync(npmBin, command, { cwd: resolve(serverRoot, '../..'), stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
