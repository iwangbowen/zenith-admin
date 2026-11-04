import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adjacency, analyzeSnapshot, architectureReferences, compareCaptures, reachable, referenceTarget, stronglyConnected, validateMoves } from '../architecture-benchmark.mjs';

test('runtime, type, deferred and mock edges survive imports of the same module', () => {
  const result = architectureReferences(`
    // import './comment';
    const example = "import './string'";
    import type { A } from './shared';
    import { type B, value } from './shared';
    export type * from './types';
    type T = typeof import('./shape');
    void import('./shared');
    const eager = require('./immediate');
    function later() { return require('./later'); }
    vi.mock('./mock');
    void import(computed);
  `);
  assert.deepEqual(result.refs.filter((ref) => ref.specifier === './shared').map((ref) => ref.kind), ['type', 'eager', 'type', 'deferred']);
  assert.deepEqual(result.refs.filter((ref) => ['./types', './shape'].includes(ref.specifier)).map((ref) => ref.kind), ['type', 'type']);
  assert.equal(result.refs.find((ref) => ref.specifier === './immediate').kind, 'eager');
  assert.equal(result.refs.find((ref) => ref.specifier === './later').kind, 'deferred');
  assert.equal(result.refs.find((ref) => ref.specifier === './mock').kind, 'test');
  assert.equal(result.unresolved.length, 1);
  assert.ok(!result.refs.some((ref) => /comment|string/.test(ref.specifier)));
});

test('module-scope registration candidates exclude declarations and request callbacks', () => {
  const { registrations } = architectureReferences(`
    import { registerDefinitions } from './definitions';
    registerDefinitions();
    export function bootstrap() { registerWorker(); }
    const route = defineRoute({ handler: () => registerMember() });
    const callback = () => registerHandler();
  `);
  assert.deepEqual(registrations.map((entry) => entry.name), ['registerDefinitions']);
  assert.equal(registrations[0].line, 3);
});

test('type and deferred edges cannot manufacture an eager initialization cycle', () => {
  const edges = [{ source: 'a', target: 'b', kind: 'eager' }, { source: 'b', target: 'a', kind: 'deferred' }, { source: 'b', target: 'c', kind: 'type' }, { source: 'c', target: 'b', kind: 'type' }];
  assert.deepEqual(stronglyConnected(adjacency(edges, (edge) => edge.kind === 'eager')), []);
  assert.deepEqual(stronglyConnected(adjacency(edges, (edge) => edge.kind !== 'type')), [['a', 'b']]);
  assert.deepEqual(stronglyConnected(adjacency([...edges, { source: 'self', target: 'self', kind: 'eager' }])), [['a', 'b', 'c'], ['self']]);
  assert.deepEqual([...reachable(adjacency(edges), 'a')].sort(), ['a', 'b', 'c']);
});

test('module resolution follows extension rewrites and Shared exports without inventing external edges', () => {
  const nodes = new Set(['packages/server/src/lib/source.ts', 'packages/shared/src/core/index.ts']);
  assert.equal(referenceTarget('packages/server/src/routes/sample.ts', '../lib/source.js', nodes), 'packages/server/src/lib/source.ts');
  assert.equal(referenceTarget('packages/server/src/routes/sample.ts', '@zenith/shared/core', nodes), 'packages/shared/src/core/index.ts');
  assert.equal(referenceTarget('packages/server/src/routes/sample.ts', 'node:fs', nodes), null);
  assert.equal(referenceTarget('packages/server/src/routes/sample.ts', '../missing', nodes), null);
});

function fixtureCapture() {
  const path = 'packages/server/src/services/sample/source.ts';
  const testPath = 'packages/server/src/services/sample/source.test.ts';
  const source = "import type { Shape } from '../../../shared'; export const value = 1;";
  return analyzeSnapshot({
    capturedAt: '2026-01-01T00:00:00.000Z', metadata: { head: 'fixture', node: 'fixture', platform: 'fixture', arch: 'fixture', lockHash: 'fixture' },
    sources: { [path]: source, [testPath]: "import './source';" }, graph: { nodes: [path, testPath], edges: [[testPath, path]], tests: [testPath], uncertain: [] },
    samples: { sample: path }, plans: { sample: { mode: 'domains', affectedDomains: ['sample'], integrationGroups: [], tests: ['src/services/sample/source.test.ts'], reasons: [] } },
    manifest: { domains: { sample: { paths: ['src/services/sample/**'], shared: [] } } },
  }, { label: 'fixture' });
}

test('capture hashes content and keeps conservative reached tests distinct from selected scope', () => {
  const capture = fixtureCapture();
  assert.equal(capture.scope.timingMeasured, false);
  assert.equal(capture.selectors.sample.reverseReachableTestCount, 1);
  assert.equal(capture.selectors.sample.selectedTestCount, 1);
  assert.equal(Object.keys(capture.sourceHashes).length, 2);
  assert.equal(capture.metadata.sourceTreeHash.length, 64);
  assert.deepEqual(compareCaptures(capture, capture).samples.sample.noLongerSelected, []);
});

test('comparison rejects silent sample replacement and validates explicit moves', () => {
  const before = fixtureCapture();
  const after = structuredClone(before);
  const from = before.selectors.sample.path;
  const to = from.replace('source.ts', 'renamed.ts');
  after.selectors.sample.path = to;
  after.sourceHashes[to] = after.sourceHashes[from];
  delete after.sourceHashes[from];
  assert.throws(() => compareCaptures(before, after), /without an explicit move/);
  const compared = compareCaptures(before, after, { [from]: to });
  assert.equal(compared.moves[0].contentUnchanged, true);
  assert.equal(compared.timingMeasured, false);
  assert.throws(() => validateMoves({ [from]: 'missing' }, new Set([from]), new Set([to])), /both source versions/);
  assert.throws(() => validateMoves({ a: 'c', b: 'c' }, new Set(['a', 'b']), new Set(['c'])), /Duplicate/);
});
