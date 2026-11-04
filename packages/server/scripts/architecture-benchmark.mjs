#!/usr/bin/env node
/** Static architecture evidence. This tool never imports application modules or measures test speed. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, matchesGlob, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { buildFileGraph, isTestFile, manifest, resolveAffectedDomains, workspaceRoot } from './test-graph.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sorted = (values) => [...values].sort();
const production = (file) => !isTestFile(file);
export const FIXED_SAMPLES = {
  asyncTasks: 'packages/server/src/services/tasks/async-tasks.service.ts',
  context: 'packages/server/src/lib/context.ts',
  jobSources: 'packages/server/src/lib/job-monitor/sources.ts',
  regions: 'packages/shared/src/platform/regions.ts',
  users: 'packages/server/src/services/identity/users.service.ts',
  taskDemo: 'packages/server/src/routes/tasks/task-demo.ts',
  bootstrapWorkers: 'packages/server/src/bootstrap/workers.ts',
};
const CONSUMERS = {
  context: FIXED_SAMPLES.context,
  database: 'packages/server/src/db/index.ts',
  taskCenter: 'packages/server/src/lib/task-center/index.ts',
  jobRegistry: 'packages/server/src/lib/job-monitor/registry.ts',
  jobSources: FIXED_SAMPLES.jobSources,
  importDefinitions: 'packages/server/src/lib/import-center/definitions/index.ts',
  exportDefinitions: 'packages/server/src/lib/export-center/definitions/index.ts',
  workflowAttachments: 'packages/server/src/services/workflow/workflow-attachments.service.ts',
  taskDemo: FIXED_SAMPLES.taskDemo,
  workers: FIXED_SAMPLES.bootstrapWorkers,
};

/** Preserve edge semantics; dynamic imports are deferred, even when called at module scope. */
export function architectureReferences(source, filename = 'module.ts') {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const refs = [];
  const registrations = [];
  const unresolved = [];
  const literal = (node) => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
  const add = (node, specifier, kind, syntax) => refs.push({ specifier, kind, syntax, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1 });
  const declarationKinds = (node) => {
    const clause = ts.isImportDeclaration(node) ? node.importClause : node;
    if (clause?.isTypeOnly) return ['type'];
    const bindings = ts.isImportDeclaration(node) ? clause?.namedBindings : node.exportClause;
    const named = bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) ? bindings.elements : null;
    const hasType = named?.some((entry) => entry.isTypeOnly);
    const hasValue = !named || !named.length || named.some((entry) => !entry.isTypeOnly) || (ts.isImportDeclaration(node) && clause?.name);
    return [...(hasValue ? ['eager'] : []), ...(hasType ? ['type'] : [])];
  };
  const visit = (node, functionDepth = 0) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && literal(node.moduleSpecifier)) {
      for (const kind of declarationKinds(node)) add(node, node.moduleSpecifier.text, kind, ts.isImportDeclaration(node) ? 'import' : 'export');
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && literal(node.moduleReference.expression)) {
      add(node, node.moduleReference.expression.text, node.isTypeOnly ? 'type' : 'eager', 'require');
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && literal(node.argument.literal)) {
      add(node, node.argument.literal.text, 'type', 'import-type');
    } else if (ts.isCallExpression(node)) {
      const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const mock = ts.isPropertyAccessExpression(node.expression) && /^(?:mock|doMock|unmock|doUnmock|importActual|importMock)$/.test(node.expression.name.text);
      if (dynamic || requireCall || mock) {
        if (literal(node.arguments[0])) add(node, node.arguments[0].text, mock ? 'test' : dynamic || functionDepth ? 'deferred' : 'eager', dynamic ? 'dynamic-import' : mock ? 'mock' : 'require');
        else if (dynamic || requireCall) unresolved.push({ line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, syntax: dynamic ? 'dynamic-import' : 'require' });
      }
      const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : '';
      if (!functionDepth && /^(?:register|declare|init)[A-Z]/.test(name)) registrations.push({ name, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1 });
    }
    const nextDepth = functionDepth + (ts.isFunctionLike(node) ? 1 : 0);
    ts.forEachChild(node, (child) => visit(child, nextDepth));
  };
  visit(tree);
  return { refs, registrations, unresolved };
}

export function referenceTarget(file, specifier, nodes) {
  let base;
  if (specifier.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(file), specifier));
  else {
    const match = specifier.match(/^@zenith\/(shared|analytics-sdk)(?:\/(.*))?$/);
    if (!match) return null;
    base = `packages/${match[1]}/src/${match[2] ?? 'index'}`;
  }
  const stem = base.replace(/\.(?:js|jsx|mjs|cjs)$/, '');
  return [base, ...['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.mjs'].map((ext) => stem + ext), ...['index.ts', 'index.tsx', 'index.mts', 'index.js'].map((name) => posix.join(base, name))].find((candidate) => nodes.has(candidate)) ?? null;
}

export function adjacency(edges, predicate = () => true) {
  const graph = new Map();
  for (const edge of edges) {
    if (!predicate(edge)) continue;
    if (!graph.has(edge.source)) graph.set(edge.source, new Set());
    graph.get(edge.source).add(edge.target);
  }
  return graph;
}

export function reachable(graph, start) {
  const reached = new Set([start]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) for (const target of graph.get(queue[i]) ?? []) if (!reached.has(target)) { reached.add(target); queue.push(target); }
  return reached;
}

export function stronglyConnected(graph) {
  const indices = new Map();
  const low = new Map();
  const stack = [];
  const active = new Set();
  const components = [];
  let next = 0;
  const visit = (node) => {
    indices.set(node, next); low.set(node, next++); stack.push(node); active.add(node);
    for (const target of graph.get(node) ?? []) {
      if (!indices.has(target)) { visit(target); low.set(node, Math.min(low.get(node), low.get(target))); }
      else if (active.has(target)) low.set(node, Math.min(low.get(node), indices.get(target)));
    }
    if (low.get(node) === indices.get(node)) {
      const component = [];
      let item;
      do { item = stack.pop(); active.delete(item); component.push(item); } while (item !== node);
      if (component.length > 1 || graph.get(node)?.has(node)) components.push(sorted(component));
    }
  };
  for (const node of sorted(new Set([...graph.keys(), ...[...graph.values()].flatMap((set) => [...set])]))) if (!indices.has(node)) visit(node);
  return components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

function domainOf(file, definitions) {
  const shared = file.match(/^packages\/shared\/src\/([^/]+)\//)?.[1];
  const local = file.replace(/^packages\/server\//, '');
  return Object.keys(definitions).find((domain) => shared ? definitions[domain].shared.includes(shared) : definitions[domain].paths.some((pattern) => matchesGlob(local, pattern))) ?? null;
}

export function validateMoves(moves, beforeNodes, afterNodes) {
  const targets = new Set();
  for (const [from, to] of Object.entries(moves)) {
    if (!beforeNodes.has(from) || !afterNodes.has(to)) throw new Error(`Invalid move: ${from} -> ${to}; both source versions must exist`);
    if (targets.has(to)) throw new Error(`Duplicate move target: ${to}`);
    if (from === to) throw new Error(`Move must change the path: ${from}`);
    targets.add(to);
  }
}

export function analyzeSnapshot(snapshot, { label, moves = {} } = {}) {
  const nodes = new Set(snapshot.graph.nodes);
  const edges = [];
  const routeTopLevelRegistrations = [];
  const unresolved = [];
  for (const file of sorted(nodes)) {
    if (!production(file) || file.endsWith('.json')) continue;
    const parsed = architectureReferences(snapshot.sources[file], file);
    for (const ref of parsed.refs) {
      const target = referenceTarget(file, ref.specifier, nodes);
      if (target && production(target)) edges.push({ source: file, target, kind: ref.kind, syntax: ref.syntax, line: ref.line });
    }
    unresolved.push(...parsed.unresolved.map((ref) => ({ file, ...ref })));
    if (file.startsWith('packages/server/src/routes/')) routeTopLevelRegistrations.push(...parsed.registrations.map((ref) => ({ file, ...ref })));
  }
  const views = {
    all: () => true,
    static: (edge) => edge.kind === 'eager' && ['import', 'export'].includes(edge.syntax),
    eager: (edge) => edge.kind === 'eager',
    runtime: (edge) => edge.kind === 'eager' || edge.kind === 'deferred',
    type: (edge) => edge.kind === 'type',
    deferred: (edge) => edge.kind === 'deferred',
  };
  const graphs = Object.fromEntries(Object.entries(views).map(([name, predicate]) => [name, adjacency(edges, predicate)]));
  const consumerClosures = Object.fromEntries(Object.entries(CONSUMERS).map(([name, originalPath]) => {
    const path = moves[originalPath] ?? originalPath;
    return [name, { originalPath, path, exists: nodes.has(path), views: Object.fromEntries(Object.entries(graphs).map(([view, graph]) => {
      const files = nodes.has(path) ? sorted(reachable(graph, path)) : [];
      return [view, { modulesIncludingRoot: files.length, sourceBytes: files.reduce((sum, file) => sum + Buffer.byteLength(snapshot.sources[file] ?? ''), 0), bootstrap: files.filter((file) => file.startsWith('packages/server/src/bootstrap/')), closureHash: sha256(JSON.stringify(files)) }];
    })) }];
  }));
  const reverse = adjacency(snapshot.graph.edges.map(([source, target]) => ({ source: target, target: source })));
  const selectors = Object.fromEntries(Object.entries(snapshot.samples).map(([name, file]) => {
    const plan = snapshot.plans[name];
    const reached = reachable(reverse, file);
    const reachedTests = snapshot.graph.tests.filter((test) => reached.has(test));
    return [name, { path: file, mode: plan.mode, domains: plan.affectedDomains, integrationGroups: plan.integrationGroups, selectedTests: plan.tests, selectedTestCount: plan.tests.length, reverseReachableTests: reachedTests, reverseReachableTestCount: reachedTests.length, reasons: plan.reasons }];
  }));
  const domainEdges = (predicate) => {
    const unique = new Map();
    for (const edge of edges.filter(predicate)) {
      const source = domainOf(edge.source, snapshot.manifest.domains), target = domainOf(edge.target, snapshot.manifest.domains);
      if (source && target && source !== target) unique.set(`${source}|${target}`, { source, target });
    }
    return [...unique.values()].sort((a, b) => `${a.source}|${a.target}`.localeCompare(`${b.source}|${b.target}`));
  };
  const domains = Object.fromEntries(['all', 'runtime', 'eager'].map((view) => {
    const refs = domainEdges(views[view]);
    return [view, { edges: refs.length, components: stronglyConnected(adjacency(refs)) }];
  }));
  const crossDomainServiceReferences = edges.filter((edge) => {
    const source = edge.source.match(/^packages\/server\/src\/services\/([^/]+)\//)?.[1];
    const target = edge.target.match(/^packages\/server\/src\/services\/([^/]+)\//)?.[1];
    return source && target && source !== target;
  });
  const coreToBootstrap = edges.filter((edge) => /^packages\/server\/src\/(?:lib|db|middleware)\//.test(edge.source) && edge.target.startsWith('packages/server/src/bootstrap/'));
  const sourceHashes = Object.fromEntries(sorted(nodes).map((file) => [file, sha256(snapshot.sources[file])]));
  return {
    schemaVersion: 1, label, capturedAt: snapshot.capturedAt,
    metadata: { ...snapshot.metadata, analyzerHash: sha256(readFileSync(scriptPath)), sourceTreeHash: sha256(JSON.stringify(sourceHashes)) },
    scope: { packages: ['server', 'shared', 'analytics-sdk'], includesWeb: false, evidence: 'static-source-analysis', timingMeasured: false },
    inventory: { sourceFiles: nodes.size, conservativeEdges: snapshot.graph.edges.length, serverTests: snapshot.graph.tests.length, productionTypedEdges: edges.length, typedEdgesByKind: Object.fromEntries(['eager', 'deferred', 'type', 'test'].map((kind) => [kind, edges.filter((edge) => edge.kind === kind).length])) },
    selectors, consumerClosures,
    cycles: { eagerFiles: stronglyConnected(graphs.eager), runtimeFiles: stronglyConnected(graphs.runtime), domains },
    boundaries: { coreToBootstrap, routeTopLevelRegistrations, crossDomainServiceReferenceCount: crossDomainServiceReferences.length, crossDomainServiceReferences, unownedProductionLibFiles: sorted(nodes).filter((file) => /^packages\/server\/src\/lib\//.test(file) && production(file) && !domainOf(file, snapshot.manifest.domains)), computedImports: unresolved },
    moves, sourceHashes,
    limitations: [
      'Static/eager closures include module-level import and re-export dependencies; they are not measured application startup or proof of an executed cycle.',
      'Deferred marks literal dynamic imports and require inside functions; no execution-path prediction is attempted.',
      'Type-only edges remain in the conservative test selector. No tests are removed by this analyzer.',
      'Route registration entries are syntactic module-scope candidates; aliases, immediately invoked callbacks and indirect registration require review.',
      'Cross-domain service references are counts of implementation imports, not automatically violations; public APIs and deliberate transactional collaboration need policy.',
      'Test-count and source-byte changes do not establish wall-clock, CPU, RSS or user-visible performance gains.',
    ],
  };
}

function currentSnapshot(moves) {
  const graph = buildFileGraph();
  const samples = Object.fromEntries(Object.entries(FIXED_SAMPLES).map(([name, file]) => [name, moves[file] ?? file]));
  for (const file of Object.values(samples)) if (!graph.nodes.has(file)) throw new Error(`Sample missing: ${file}. Supply its explicit --moves mapping.`);
  return {
    schemaVersion: 1, capturedAt: new Date().toISOString(),
    metadata: { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot, encoding: 'utf8' }).trim(), node: process.version, platform: os.platform(), release: os.release(), arch: os.arch(), lockHash: sha256(readFileSync(join(workspaceRoot, 'package-lock.json'))), workingTreeStatus: execFileSync('git', ['status', '--porcelain'], { cwd: workspaceRoot, encoding: 'utf8' }).trim() },
    manifest, samples, plans: Object.fromEntries(Object.entries(samples).map(([name, file]) => [name, resolveAffectedDomains([file], graph)])),
    graph: { nodes: [...graph.nodes], edges: graph.edges, tests: graph.tests, uncertain: [...graph.uncertain] },
    sources: Object.fromEntries(sorted(graph.nodes).map((file) => [file, readFileSync(join(workspaceRoot, file), 'utf8')])),
  };
}

export function compareCaptures(before, after, moves = {}) {
  if (before.schemaVersion !== 1 || after.schemaVersion !== 1) throw new Error('Unsupported architecture capture schema');
  validateMoves(moves, new Set(Object.keys(before.sourceHashes)), new Set(Object.keys(after.sourceHashes)));
  const mapPath = (file) => moves[file] ?? file;
  const serverTest = (file) => file.startsWith('packages/server/src/') && isTestFile(file);
  const beforeTests = new Set(Object.keys(before.sourceHashes).filter(serverTest).map(mapPath));
  const afterTests = new Set(Object.keys(after.sourceHashes).filter(serverTest));
  const comparability = Object.fromEntries(['node', 'platform', 'arch', 'lockHash', 'analyzerHash'].map((key) => [key, before.metadata[key] === after.metadata[key]]));
  return {
    schemaVersion: 1, baseline: { label: before.label, head: before.metadata.head, sourceTreeHash: before.metadata.sourceTreeHash }, candidate: { label: after.label, head: after.metadata.head, sourceTreeHash: after.metadata.sourceTreeHash }, comparability,
    moves: Object.entries(moves).map(([from, to]) => ({ from, to, contentUnchanged: before.sourceHashes[from] === after.sourceHashes[to] })),
    testInventory: { before: before.inventory.serverTests, after: after.inventory.serverTests, removed: sorted([...beforeTests].filter((file) => !afterTests.has(file))), added: sorted([...afterTests].filter((file) => !beforeTests.has(file))) },
    samples: Object.fromEntries(Object.entries(before.selectors).map(([name, previous]) => {
      const next = after.selectors[name];
      if (!next) throw new Error(`Candidate omitted sample ${name}`);
      if (next.path !== mapPath(previous.path)) throw new Error(`Sample ${name} changed without an explicit move: ${previous.path} -> ${next.path}`);
      const expected = new Set(previous.selectedTests.map((file) => mapPath(`packages/server/${file}`)));
      const actual = new Set(next.selectedTests.map((file) => `packages/server/${file}`));
      return [name, { beforePath: previous.path, afterPath: next.path, beforeMode: previous.mode, afterMode: next.mode, selectedTestsBefore: previous.selectedTestCount, selectedTestsAfter: next.selectedTestCount, reverseReachableBefore: previous.reverseReachableTestCount, reverseReachableAfter: next.reverseReachableTestCount, noLongerSelected: sorted([...expected].filter((file) => !actual.has(file))), newlySelected: sorted([...actual].filter((file) => !expected.has(file))) }];
    })),
    consumers: Object.fromEntries(Object.keys(before.consumerClosures).map((name) => [name, Object.fromEntries(Object.keys(before.consumerClosures[name].views).map((view) => [view, { before: before.consumerClosures[name].views[view].modulesIncludingRoot, after: after.consumerClosures[name]?.views[view]?.modulesIncludingRoot ?? null }]))])),
    boundaries: { coreToBootstrap: [before.boundaries.coreToBootstrap.length, after.boundaries.coreToBootstrap.length], routeTopLevelRegistrations: [before.boundaries.routeTopLevelRegistrations.length, after.boundaries.routeTopLevelRegistrations.length], crossDomainServiceReferences: [before.boundaries.crossDomainServiceReferenceCount, after.boundaries.crossDomainServiceReferenceCount] },
    cycles: Object.fromEntries(['eagerFiles', 'runtimeFiles'].map((view) => [view, { componentsBefore: before.cycles[view].length, componentsAfter: after.cycles[view].length, largestBefore: before.cycles[view][0]?.length ?? 0, largestAfter: after.cycles[view][0]?.length ?? 0 }])),
    timingMeasured: false,
    caveats: ['Selection changes require independent coverage review; fewer selected tests are not evidence of faster identical-work tests.', 'Use the existing Server test benchmark with the same test inventory to compare wall-clock, CPU and RSS. Static closure changes do not prove runtime gains.'],
  };
}

function writeJson(path, data) { mkdirSync(dirname(resolve(path)), { recursive: true }); writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`); }
function main(argv) {
  const [command, ...args] = argv;
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (!['--label', '--out', '--snapshot', '--moves', '--baseline', '--candidate'].includes(args[i])) throw new Error(`Unknown argument: ${args[i]}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('Missing argument value');
    options[args[i - 1].slice(2)] = value;
  }
  const moves = options.moves ? JSON.parse(readFileSync(options.moves, 'utf8')) : {};
  if (!options.out) throw new Error('--out is required');
  if (command === 'capture') {
    if (!options.label) throw new Error('--label is required');
    const snapshot = options.snapshot ? JSON.parse(readFileSync(options.snapshot, 'utf8')) : currentSnapshot(moves);
    const result = analyzeSnapshot(snapshot, { label: options.label, moves });
    writeJson(options.out, result);
    console.log(JSON.stringify({ out: options.out, label: result.label, capturedAt: result.capturedAt, inventory: result.inventory, routeTopLevelRegistrations: result.boundaries.routeTopLevelRegistrations, selectors: Object.fromEntries(Object.entries(result.selectors).map(([key, plan]) => [key, { mode: plan.mode, tests: plan.selectedTestCount }])) }, null, 2));
  } else if (command === 'compare') {
    if (!options.baseline || !options.candidate) throw new Error('--baseline and --candidate are required');
    const result = compareCaptures(JSON.parse(readFileSync(options.baseline, 'utf8')), JSON.parse(readFileSync(options.candidate, 'utf8')), moves);
    writeJson(options.out, result);
    console.log(JSON.stringify({ out: options.out, comparability: result.comparability, boundaries: result.boundaries, timingMeasured: false }, null, 2));
  } else throw new Error('Use capture --label NAME --out FILE or compare --baseline FILE --candidate FILE --out FILE');
}
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) main(process.argv.slice(2));
