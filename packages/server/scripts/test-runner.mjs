import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { serverRoot } from './test-graph.mjs';

const require = createRequire(import.meta.url);
export const vitestBin = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

export function withTestPlan(plan, action) {
  if (plan.mode === 'none') return 0;
  const directory = mkdtempSync(join(tmpdir(), 'zenith-server-test-plan-'));
  const filename = join(directory, 'plan.json');
  try {
    writeFileSync(filename, JSON.stringify({ ...plan, contractDomains: plan.contractDomains ?? (plan.mode === 'domains' ? plan.affectedDomains : []) }));
    return action(filename);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

export function collectPlanFiles(plan) {
  return withTestPlan(plan, (filename) => {
    const result = spawnSync(process.execPath, [vitestBin, 'list', '--config', 'vitest.selected.config.ts', '--filesOnly', '--json'], {
      cwd: serverRoot, encoding: 'utf8', env: { ...process.env, ZENITH_TEST_PLAN: filename },
    });
    if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Vitest collection failed');
    return JSON.parse(result.stdout);
  });
}

export function runTestPlan(plan, extraArgs = []) {
  return withTestPlan(plan, (filename) => {
    const result = spawnSync(process.execPath, [vitestBin, 'run', '--config', 'vitest.selected.config.ts', '--reporter=dot', ...extraArgs], {
      cwd: serverRoot,
      stdio: 'inherit',
      env: { ...process.env, ZENITH_TEST_PLAN: filename },
    });
    if (result.error) console.error(result.error.message);
    return result.status ?? 1;
  });
}
