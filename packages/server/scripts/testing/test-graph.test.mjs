import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildFileGraph, buildDomainGraph, undeclaredDomainDependencies, domainFromPath, listSourceFiles, manifest, readModuleReferences, resolveAffectedDomains, serverRoot, planDomainTests } from '../test-graph.mjs';
import { collectChangedFiles } from '../test-changes.mjs';
import { collectPlanFiles } from '../test-runner.mjs';
import { shardTestPlan } from '../test-ci-plan.mjs';

const root = mkdtempSync(join(tmpdir(), 'zenith-test-graph-fixture-'));
after(() => rmSync(root, { recursive: true, force: true }));
const write = (file, source = '') => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), source); };
const prefix = 'packages/server/';
write(`${prefix}src/services/identity/source.ts`, 'export const value = 1;');
write(`${prefix}src/services/platform/hub.ts`, "export { value } from '../identity/source.js';");
write(`${prefix}src/services/payment/consumer.ts`, "import {value} from '../platform/hub'; export { value };");
write(`${prefix}src/services/payment/consumer.test.ts`, "import './consumer';");
write(`${prefix}src/services/identity/source.test.ts`, "import './source';");
write(`${prefix}src/services/marketing/unrelated.test.ts`);
for (let i = 0; i < 25; i++) write(`${prefix}src/lib/unrelated-${i}.test.ts`);
const graph = buildFileGraph(root);

test('AST understands imports and ignores commented/stringified fake imports', () => {
  const refs = readModuleReferences(`
    // import('./fake');
    const example = "from './fake-2'";
    import './side-effect';
    import type { X } from './type';
    export * from './barrel';
    type Y = import('./import-type').Y;
    const a = import('./dynamic');
    const b = require('./cjs');
    vi.mock('./mocked', () => ({}));
    const c = import(name);
  `);
  assert.deepEqual(refs.specifiers.sort(), ['./barrel', './cjs', './dynamic', './import-type', './mocked', './side-effect', './type']);
  assert.equal(refs.computedImport, true);
});
test('file graph follows .js -> .ts and re-exports through a platform hub', () => {
  const plan = resolveAffectedDomains([`${prefix}src/services/identity/source.ts`], graph);
  assert.equal(plan.mode, 'domains');
  assert.ok(plan.tests.includes('src/services/payment/consumer.test.ts'));
  assert.ok(!plan.tests.includes('src/services/marketing/unrelated.test.ts'));
});
test('Windows paths and Shared domains with different route owners are classified', () => {
  assert.equal(domainFromPath('packages\\server\\src\\services\\identity\\users.ts'), 'identity');
  assert.equal(domainFromPath('packages/shared/src/biz/contracts/leaves.ts'), 'biz-demo');
  for (const shared of ['settings', 'licensing', 'rules']) assert.equal(domainFromPath(`packages/shared/src/${shared}/index.ts`), 'platform');
});
test('root config, lockfile, SDK, test infrastructure and unknown files require full tests', () => {
  for (const file of ['package-lock.json', 'tsconfig.base.json', '.github/workflows/ci.yml', 'packages/analytics-sdk/src/index.ts', `${prefix}src/test-utils/contract.ts`, `${prefix}src/unknown.ts`]) {
    assert.equal(resolveAffectedDomains([file], graph).mode, 'full', file);
  }
});
test('deleted/renamed modules and missing Git history cannot silently skip tests', () => {
  assert.equal(resolveAffectedDomains([`${prefix}src/services/identity/deleted.ts`], graph).mode, 'full');
  assert.equal(resolveAffectedDomains([], graph, { uncertainDiff: true }).mode, 'full');
});
test('forced full runs execute on an empty diff and on docs-only diffs', () => {
  for (const changes of [[], ['docs/guide/development.md']]) {
    assert.equal(resolveAffectedDomains(changes, graph, { forceFull: true }).mode, 'full');
    assert.equal(resolveAffectedDomains(changes, graph).mode, 'none');
  }
});
test('integration groups contain executable tests and unknown domains/groups fail', () => {
  const plan = planDomainTests([], graph, { groups: ['payment-member'] });
  assert.ok(plan.tests.includes('src/services/member/member-wallet.service.test.ts'));
  assert.throws(() => planDomainTests(['missing'], graph));
  assert.throws(() => planDomainTests([], graph, { groups: ['missing'] }));
});
test('Git collection includes staged, unstaged, untracked and both rename paths', () => {
  const calls = [];
  const diff = collectChangedFiles({ base: 'main', git: (args) => {
    calls.push(args);
    if (args[0] === 'rev-parse') return 'a'.repeat(40);
    if (args[0] === 'ls-files') return 'new file.ts\0';
    return args.at(-1) === 'HEAD' ? 'staged.ts\0unstaged.ts\0' : 'before.ts\0after.ts\0';
  } });
  assert.deepEqual(diff.files, ['after.ts', 'before.ts', 'new file.ts', 'staged.ts', 'unstaged.ts']);
  assert.ok(calls.some((args) => args.includes('--no-renames')));
  assert.equal(collectChangedFiles({ git: () => { throw new Error('history unavailable'); } }).uncertainDiff, true);
});
test('manifest covers every production route domain and registered integration test', () => {
  const directories = readdirSync(join(serverRoot, 'src/routes'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(Object.keys(manifest.domains).sort(), directories);
  for (const group of Object.values(manifest.integrationGroups)) {
    for (const domain of group.domains) assert.ok(manifest.domains[domain]);
    for (const file of group.tests) assert.ok(readFileSync(join(serverRoot, file), 'utf8').length > 0, file);
  }
});

test('Vitest collects only requested files and one contract suite per project', () => {
  const plan = { mode: 'domains', tests: ['src/lib/openapi-doc-cache.test.ts'], affectedDomains: ['identity', 'payment'] };
  const files = collectPlanFiles(plan);
  assert.deepEqual(files.map((entry) => [entry.projectName, entry.file.split('/src/')[1]]).sort(), [
    ['contract:identity', 'domain-contract.test.ts'], ['contract:payment', 'domain-contract.test.ts'],
    ['selected', 'lib/openapi-doc-cache.test.ts'],
  ]);
});

test('domain tests keep full application and global contract catalogs out of their direct imports', () => {
  const violations = [];
  for (const file of listSourceFiles(join(serverRoot, 'src'))) {
    if (!file.endsWith('.test.ts') || !domainFromPath(`packages/server/${file.slice(serverRoot.length + 1).replaceAll('\\', '/')}`)) continue;
    for (const specifier of readModuleReferences(readFileSync(file, 'utf8')).specifiers) {
      const target = resolve(dirname(file), specifier).replaceAll('\\', '/').replace(/\.[cm]?[jt]sx?$/, '');
      const base = serverRoot.replaceAll('\\', '/');
      if (specifier === '@zenith/shared/contracts' || [base + '/src/app', base + '/src/routes', base + '/src/routes/index'].includes(target)) {
        violations.push(`${file} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(violations, [], 'Use buildDomainContractApp for domain route checks; keep complete app assertions in app.contract.test.ts');
});

test('CI shards preserve every selected file and contract domain exactly once', () => {
  const plan = { mode: 'domains', tests: Array.from({ length: 230 }, (_, i) => `test-${i}.test.ts`), affectedDomains: ['identity', 'workflow', 'payment'] };
  const shards = shardTestPlan(plan);
  assert.equal(shards.length, 3);
  const files = shards.flatMap((shard) => shard.tests);
  assert.equal(new Set(files).size, files.length);
  assert.deepEqual(files.sort(), [...plan.tests].sort());
  assert.deepEqual(shards.flatMap((shard) => shard.contractDomains).sort(), [...plan.affectedDomains].sort());
  assert.deepEqual(shardTestPlan({ mode: 'none' }), []);
  assert.deepEqual(shardTestPlan({ ...plan, mode: 'full' }).flatMap((shard) => shard.contractDomains), []);
});

test('production cross-domain dependencies must be explicitly declared', () => {
  assert.deepEqual(undeclaredDomainDependencies({ forward: { identity: ['workflow'] } }, { identity: { dependsOn: [] } }), ['identity -> workflow']);
  assert.deepEqual(undeclaredDomainDependencies({ forward: { identity: ['workflow'] } }, { identity: { dependsOn: ['workflow'] } }), []);
  for (const [name, definition] of Object.entries(manifest.domains)) {
    assert.ok(Array.isArray(definition.dependsOn), name);
    assert.equal(new Set(definition.dependsOn).size, definition.dependsOn.length, name);
    assert.ok(definition.dependsOn.every((target) => target !== name && manifest.domains[target]), name);
  }
  assert.deepEqual(undeclaredDomainDependencies(buildDomainGraph()), []);
});
