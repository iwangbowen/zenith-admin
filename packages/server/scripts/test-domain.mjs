#!/usr/bin/env node
/**
 * Run domain-scoped Server tests without loading the full route graph.
 *
 * Usage:
 *   npm run test:domain -w @zenith/server -- identity
 *   npm run test:domain -w @zenith/server -- identity workflow payment
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOMAIN_NAMES = new Set([
  'ops', 'identity', 'member', 'platform', 'files', 'tasks', 'analytics', 'report', 'messaging',
  'payment', 'open-platform', 'workflow', 'chat', 'mp', 'biz-demo', 'ai', 'short-link', 'marketing',
  'iot', 'cms', 'wiki', 'drive',
]);

const domains = process.argv.slice(2);
if (domains.length === 0 || domains.some((domain) => !DOMAIN_NAMES.has(domain))) {
  console.error(`Usage: npm run test:domain -w @zenith/server -- <domain> [...domain]`);
  console.error(`Available domains: ${[...DOMAIN_NAMES].join(', ')}`);
  process.exit(2);
}

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const vitestPackage = require.resolve('vitest/package.json', { paths: [serverRoot] });
const vitestBin = resolve(dirname(vitestPackage), 'vitest.mjs');
const patterns = domains.flatMap((domain) => [`src/routes/${domain}`, `src/services/${domain}`]);

const result = spawnSync(process.execPath, [
  vitestBin,
  'run',
  '--config', 'vitest.config.ts',
  '--reporter=dot',
  'src/domain-contract.test.ts',
  ...patterns,
], {
  cwd: serverRoot,
  stdio: 'inherit',
  env: { ...process.env, ZENITH_TEST_DOMAINS: domains.join(',') },
});

process.exit(result.status ?? 1);
