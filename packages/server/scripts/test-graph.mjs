import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, matchesGlob, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const workspaceRoot = resolve(serverRoot, '../..');
export const manifest = JSON.parse(readFileSync(join(serverRoot, 'src/domain-manifest.json'), 'utf8'));
export const SERVER_DOMAIN_NAMES = Object.keys(manifest.domains);
export const INTEGRATION_GROUPS = manifest.integrationGroups;
export const normalizePath = (path) => path.replaceAll('\\', '/').replace(/^\.\//, '');
export const isTestFile = (path) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
const domainCache = new Map();

export function domainFromPath(value) {
  const path = normalizePath(value);
  if (domainCache.has(path)) return domainCache.get(path);
  const shared = path.match(/^packages\/shared\/src\/([^/]+)\//)?.[1];
  const local = path.replace(/^packages\/server\//, '');
  const domain = SERVER_DOMAIN_NAMES.find((domain) => shared
    ? manifest.domains[domain].shared.includes(shared)
    : manifest.domains[domain].paths.some((pattern) => matchesGlob(local, pattern))) ?? null;
  domainCache.set(path, domain);
  return domain;
}

export function listSourceFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) return ['node_modules', 'dist'].includes(entry.name) ? [] : listSourceFiles(file);
    return /\.(?:[cm]?[jt]sx?|json)$/.test(entry.name) ? [file] : [];
  });
}

/** Include re-exports, type imports, side effects, literal dynamic imports and mock dependencies. */
export function readModuleReferences(source, filename = 'module.ts') {
  const syntax = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const specifiers = new Set();
  let computedImport = false;
  const literal = (node) => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && literal(node.moduleSpecifier)) {
      specifiers.add(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && literal(node.moduleReference.expression)) {
      specifiers.add(node.moduleReference.expression.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && literal(node.argument.literal)) {
      specifiers.add(node.argument.literal.text);
    } else if (ts.isCallExpression(node)) {
      const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const mock = ts.isPropertyAccessExpression(node.expression)
        && /^(?:mock|doMock|unmock|doUnmock|importActual|importMock)$/.test(node.expression.name.text);
      if (dynamic || requireCall || mock) {
        if (literal(node.arguments[0])) specifiers.add(node.arguments[0].text);
        else if (dynamic || requireCall) computedImport = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(syntax);
  return { specifiers: [...specifiers], computedImport };
}

const isFile = (path) => existsSync(path) && statSync(path).isFile();

export function buildFileGraph(root = workspaceRoot) {
  const paths = ['server', 'shared', 'analytics-sdk'].flatMap((pkg) => listSourceFiles(join(root, `packages/${pkg}/src`)));
  const nodes = new Set(paths.map((path) => normalizePath(relative(root, path))));
  const imports = new Map([...nodes].map((path) => [path, new Set()]));
  const reverse = new Map();
  const uncertain = new Set();
  const edges = [];
  const sourcePath = (base) => {
    const stem = base.replace(/\.(?:js|jsx|mjs|cjs)$/, '');
    const candidates = [base, ...['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.mjs'].map((extension) => `${stem}${extension}`),
      ...['index.ts', 'index.tsx', 'index.mts', 'index.js'].map((index) => join(base, index))];
    return candidates.find((candidate) => nodes.has(normalizePath(relative(root, candidate))));
  };
  const resolveSpecifier = (file, specifier) => {
    if (specifier.startsWith('@zenith/')) {
      const match = specifier.match(/^@zenith\/(shared|analytics-sdk)(?:\/(.*))?$/);
      if (!match) return null;
      const base = join(root, `packages/${match[1]}/src`, match[2] ?? 'index');
      return sourcePath(base) ?? null;
    }
    if (!specifier.startsWith('.')) return undefined;
    const resolved = sourcePath(resolve(dirname(file), specifier));
    if (resolved) return resolved;
    const asset = resolve(dirname(file), specifier.replace(/\?.*$/, ''));
    return isFile(asset) ? asset : null;
  };
  for (const file of paths) {
    const source = normalizePath(relative(root, file));
    if (extname(file) === '.json') continue;
    const references = readModuleReferences(readFileSync(file, 'utf8'), source);
    if (references.computedImport) uncertain.add(source);
    for (const specifier of references.specifiers) {
      const targetFile = resolveSpecifier(file, specifier);
      if (targetFile === undefined) continue;
      if (!targetFile) { uncertain.add(source); continue; }
      const target = normalizePath(relative(root, targetFile));
      if (target.startsWith('..') || target.includes('/node_modules/')) continue;
      imports.get(source).add(target);
      if (!reverse.has(target)) reverse.set(target, new Set());
      reverse.get(target).add(source);
      edges.push([source, target]);
    }
  }
  const tests = [...nodes].filter((file) => file.startsWith('packages/server/src/') && isTestFile(file)).sort();
  return { root, nodes, imports, reverse, uncertain, edges, tests };
}

export function buildDomainGraph(graph = buildFileGraph()) {
  const forward = Object.fromEntries(SERVER_DOMAIN_NAMES.map((domain) => [domain, new Set()]));
  for (const [file, dependency] of graph.edges) {
    if (isTestFile(file)) continue;
    const source = domainFromPath(file);
    const target = domainFromPath(dependency);
    if (source && target && source !== target) forward[source].add(target);
  }
  const reverse = Object.fromEntries(SERVER_DOMAIN_NAMES.map((domain) => [domain, []]));
  for (const [domain, dependencies] of Object.entries(forward)) {
    for (const dependency of dependencies) reverse[dependency].push(domain);
  }
  return { forward: Object.fromEntries(Object.entries(forward).map(([key, value]) => [key, [...value].sort()])), reverse };
}

function relevant(path) {
  return /^(?:package(?:-lock)?\.json|tsconfig\.base\.json|vitest\.config\.mts)$/.test(path)
    || path === '.github/workflows/ci.yml' || /^packages\/(?:server|shared|analytics-sdk)\//.test(path);
}

export function isGlobalFile(path) { return relevant(path) && !domainFromPath(path); }
const serverRelative = (file) => file.replace(/^packages\/server\//, '');

export function planDomainTests(domains, graph = buildFileGraph(), { contractOnly = false, groups = [] } = {}) {
  for (const domain of domains) if (!manifest.domains[domain]) throw new Error(`Unknown Server domain: ${domain}`);
  const selected = new Set(domains);
  const integrationGroups = [...new Set([...groups, ...Object.entries(INTEGRATION_GROUPS)
    .filter(([, group]) => group.domains.some((domain) => selected.has(domain))).map(([name]) => name)])];
  const tests = contractOnly ? [] : graph.tests.filter((file) => selected.has(domainFromPath(file))).map(serverRelative);
  if (!contractOnly) {
    for (const name of integrationGroups) {
      if (!INTEGRATION_GROUPS[name]) throw new Error(`Unknown integration group: ${name}`);
      tests.push(...INTEGRATION_GROUPS[name].tests);
    }
  }
  return { mode: 'domains', affectedDomains: [...selected].sort(), integrationGroups, tests: [...new Set(tests)].sort() };
}

/** File-level reverse reachability keeps every hub edge; broad or unknown changes use full validation. */
export function resolveAffectedDomains(changedFiles, graph = buildFileGraph(), { forceFull = false, uncertainDiff = false } = {}) {
  const files = [...new Set(changedFiles.map(normalizePath))].sort();
  const changed = files.filter(relevant);
  const directDomains = [...new Set(changed.map(domainFromPath).filter(Boolean))].sort();
  const reasons = [];
  let full = forceFull || uncertainDiff || changed.some(isGlobalFile);
  if (forceFull) reasons.push('full run requested');
  if (uncertainDiff) reasons.push('Git comparison unavailable; full validation required');
  for (const file of changed.filter(isGlobalFile)) reasons.push(`${file}: shared infrastructure or unclassified file`);
  const visited = new Set(changed);
  const queue = [...changed];
  while (queue.length) {
    for (const importer of graph.reverse.get(queue.shift()) ?? []) {
      if (visited.has(importer)) continue;
      visited.add(importer);
      queue.push(importer);
    }
  }
  if (changed.some((file) => !graph.nodes.has(file))) {
    full = true;
    reasons.push('changed source is absent from the current graph (delete/rename/unsupported source)');
  }
  if (changed.some((file) => graph.uncertain.has(file))) {
    full = true;
    reasons.push('changed module contains an unresolved or computed internal import');
  }
  const fullOnly = new Set([...manifest.fullAppTests, manifest.domainContractTest]);
  const reachedTests = graph.tests.filter((file) => visited.has(file) && !fullOnly.has(serverRelative(file)));
  const affectedDomains = [...new Set([...directDomains, ...reachedTests.map(domainFromPath).filter(Boolean)])].sort();
  const domainPlan = planDomainTests(affectedDomains, graph);
  const tests = [...new Set([...domainPlan.tests, ...reachedTests.map(serverRelative), ...(changed.length ? manifest.structuralTests : [])])].sort();
  if (tests.length >= graph.tests.length * 0.75 && tests.length > 0) {
    full = true;
    reasons.push('affected tests cover at least 75% of the Server inventory');
  }
  const mode = full ? 'full' : changed.length ? 'domains' : 'none';
  return {
    changedFiles: files, mode, global: full, noServerChanges: mode === 'none', directDomains,
    affectedDomains: full ? SERVER_DOMAIN_NAMES : affectedDomains,
    integrationGroups: full ? Object.keys(INTEGRATION_GROUPS) : domainPlan.integrationGroups,
    tests: full ? graph.tests.filter((file) => serverRelative(file) !== manifest.domainContractTest).map(serverRelative) : tests,
    reasons,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({ domains: SERVER_DOMAIN_NAMES, integrationGroups: INTEGRATION_GROUPS, ...buildDomainGraph() }, null, 2));
}
