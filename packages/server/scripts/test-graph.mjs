import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const workspaceRoot = resolve(serverRoot, '../..');

export const SERVER_DOMAIN_NAMES = [
  'ops', 'identity', 'member', 'platform', 'files', 'tasks', 'analytics', 'report', 'messaging',
  'payment', 'open-platform', 'workflow', 'chat', 'mp', 'biz-demo', 'ai', 'short-link', 'marketing',
  'iot', 'cms', 'wiki', 'drive',
];

export const INTEGRATION_GROUPS = {
  'identity-workflow': ['identity', 'workflow'],
  'payment-member': ['payment', 'member'],
  'cms-workflow': ['cms', 'workflow'],
  'messaging-tasks': ['messaging', 'tasks'],
};

const DOMAIN_SET = new Set(SERVER_DOMAIN_NAMES);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.mjs']);
const GLOBAL_FILE_PATTERNS = [
  /^package(-lock)?\.json$/,
  /^packages\/server\/(package\.json|tsconfig(?:\.[^/]+)?\.json)$/,
  /^packages\/server\/src\/(app(?:-core)?\.ts|routes\/(?:index|_kit|domain-loaders)\.ts)/,
  /^packages\/server\/src\/(middleware|db|lib|bootstrap)\//,
  /^packages\/shared\/src\/(core|contracts\.ts|permissions\.ts|permission-catalog[^/]*\.ts)\//,
  /^packages\/shared\/src\/core\//,
  /^packages\/shared\/package\.json$/,
];

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function relativeWorkspacePath(value) {
  return normalizePath(relative(workspaceRoot, resolve(workspaceRoot, value)));
}

export function domainFromPath(value) {
  const path = normalizePath(value);
  const serverMatch = path.match(/^packages\/server\/src\/(?:routes|services)\/([^/]+)/);
  if (serverMatch && DOMAIN_SET.has(serverMatch[1])) return serverMatch[1];
  const sharedMatch = path.match(/^packages\/shared\/src\/([^/]+)/);
  if (sharedMatch && DOMAIN_SET.has(sharedMatch[1])) return sharedMatch[1];
  return null;
}

export function isGlobalFile(value) {
  const path = normalizePath(value);
  return GLOBAL_FILE_PATTERNS.some((pattern) => pattern.test(path));
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
      result.push(...listFiles(full));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)) && !entry.name.endsWith('.d.ts')) {
      result.push(full);
    }
  }
  return result;
}

function resolveRelativeImport(sourceFile, specifier) {
  const base = resolve(dirname(sourceFile), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.mjs`, join(base, 'index.ts')];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function targetDomainFromImport(sourceFile, specifier) {
  if (specifier.startsWith('@zenith/shared/')) {
    const domain = specifier.slice('@zenith/shared/'.length).split('/')[0];
    return DOMAIN_SET.has(domain) ? domain : null;
  }
  if (!specifier.startsWith('.')) return null;
  const target = resolveRelativeImport(sourceFile, specifier);
  return target ? domainFromPath(relativeWorkspacePath(target)) : null;
}

function importSpecifiers(source) {
  const result = [];
  const pattern = /(?:from\s*|import\s*\()(['"])([^'"]+)\1/g;
  for (const match of source.matchAll(pattern)) result.push(match[2]);
  return result;
}

export function buildDomainGraph() {
  const files = [
    ...listFiles(join(workspaceRoot, 'packages/server/src')),
    ...listFiles(join(workspaceRoot, 'packages/shared/src')),
  ];
  const reverse = new Map(SERVER_DOMAIN_NAMES.map((domain) => [domain, new Set()]));
  const forward = new Map(SERVER_DOMAIN_NAMES.map((domain) => [domain, new Set()]));

  for (const file of files) {
    const sourceDomain = domainFromPath(relativeWorkspacePath(file));
    if (!sourceDomain) continue;
    const source = readFileSync(file, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      const targetDomain = targetDomainFromImport(file, specifier);
      if (!targetDomain || targetDomain === sourceDomain) continue;
      forward.get(sourceDomain).add(targetDomain);
      reverse.get(targetDomain).add(sourceDomain);
    }
  }

  return {
    forward: Object.fromEntries([...forward].map(([domain, deps]) => [domain, [...deps].sort()])),
    reverse: Object.fromEntries([...reverse].map(([domain, dependents]) => [domain, [...dependents].sort()])),
  };
}

function addClosure(seed, reverse) {
  const result = new Set(seed);
  const queue = [...seed];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const dependent of reverse[current] ?? []) {
      if (result.has(dependent)) continue;
      result.add(dependent);
      queue.push(dependent);
    }
  }
  return result;
}

export function resolveAffectedDomains(changedFiles, graph = buildDomainGraph()) {
  const normalized = [...new Set(changedFiles.map(normalizePath).filter(Boolean))];
  const relevantFiles = normalized.filter((file) => file.startsWith('packages/server/') || file.startsWith('packages/shared/'));
  if (relevantFiles.length === 0) {
    return {
      changedFiles: normalized,
      noServerChanges: true,
      global: false,
      directDomains: [],
      affectedDomains: [],
      integrationGroups: [],
      reasons: ['没有 packages/server 或 packages/shared 改动'],
      graph,
    };
  }
  const direct = new Set();
  const reasons = [];
  let global = normalized.length === 0;

  for (const file of normalized) {
    if (isGlobalFile(file)) {
      global = true;
      reasons.push(`${file}: global rule`);
      continue;
    }
    const domain = domainFromPath(file);
    if (domain) {
      direct.add(domain);
      reasons.push(`${file}: ${domain}`);
    } else if (file.startsWith('packages/server/') || file.startsWith('packages/shared/')) {
      global = true;
      reasons.push(`${file}: unclassified server/shared file`);
    }
  }

  const domains = global ? [...SERVER_DOMAIN_NAMES] : [...addClosure(direct, graph.reverse)].sort();
  const integrationGroups = Object.entries(INTEGRATION_GROUPS)
    .filter(([, members]) => members.some((domain) => domains.includes(domain)))
    .map(([name]) => name);

  return {
    changedFiles: normalized,
    noServerChanges: false,
    global,
    directDomains: [...direct].sort(),
    affectedDomains: domains,
    integrationGroups,
    reasons,
    graph,
  };
}

export function graphReport() {
  const graph = buildDomainGraph();
  return {
    domains: SERVER_DOMAIN_NAMES,
    integrationGroups: INTEGRATION_GROUPS,
    ...graph,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.stdout.write(`${JSON.stringify(graphReport(), null, 2)}\n`);
}
