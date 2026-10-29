import { beforeAll, describe, expect, it } from 'vitest';
import { mockServerInfra, requestWithoutCredentials, listDefaultedBodyProperties } from './test-utils/contract';
import { buildDomainContractApp, type DomainContractApp } from './test-utils/domain-contract';
import { loadDomainOperations } from './test-utils/domain-contracts';
import { accessMismatches } from './test-utils/contract-checks';
import { FULL_REPLACE_OPERATIONS } from './test-utils/contract-exceptions';
import { SERVER_DOMAIN_NAMES, type ServerDomainName } from './routes/domain-loaders';
import type { AnyOperation } from '@zenith/shared/core';

mockServerInfra();

const names = process.env.ZENITH_TEST_DOMAINS?.split(',') ?? ['identity', 'workflow', 'payment'];
if (!names.length || names.some((name) => !SERVER_DOMAIN_NAMES.includes(name as ServerDomainName))) {
  throw new Error('ZENITH_TEST_DOMAINS contains an unknown Server domain');
}
const domains = [...new Set(names)] as ServerDomainName[];
const apps = new Map<ServerDomainName, DomainContractApp>();
const contracts = new Map<ServerDomainName, AnyOperation[]>();

beforeAll(async () => {
  for (const domain of domains) {
    apps.set(domain, await buildDomainContractApp(domain));
    contracts.set(domain, await loadDomainOperations(domain));
  }
}, 120_000);

describe.each(domains)('%s domain contract', (domain) => {
  it('mounts the requested domain and generates its OpenAPI operations', () => {
    const built = apps.get(domain)!;
    expect(built.domain.name).toBe(domain);
    expect(built.operations.length).toBeGreaterThan(0);
    const declared = new Set(contracts.get(domain)!.map((op) => `${op.method.toUpperCase()} ${op.fullPath}`));
    const jsonOperations = built.operations.filter((operation) => operation.operation.responses?.['200']?.content?.['application/json']);
    expect(jsonOperations.filter((operation) => !declared.has(operation.id)).map((operation) => operation.id)).toEqual([]);
  });

  it('enforces authentication before request validation for every declared operation', async () => {
    const built = apps.get(domain)!;
    const violations: string[] = [];
    for (const operation of built.operations) {
      const status = await requestWithoutCredentials(built.app, operation);
      if (operation.isDeclaredPublic ? status === 401 : status !== 401) violations.push(`${operation.id} -> ${status}`);
    }
    expect(violations).toEqual([]);
  }, 120_000);

  it('matches permission, platform, audit and License guards to their contracts', () => {
    const built = apps.get(domain)!;
    const result = accessMismatches(contracts.get(domain)!, built.accessFacts);
    expect(result.checked).toBeGreaterThan(0);
    expect(result.violations).toEqual([]);
  });

  it('declares standard error envelopes on JSON operations', () => {
    const violations: string[] = [];
    for (const op of apps.get(domain)!.operations) {
      const responses = op.operation.responses ?? {};
      if (!responses['200']?.content?.['application/json']) continue;
      for (const code of ['400', '401', '403', '404', '500']) {
        if (!responses[code]) violations.push(`${op.id}: missing ${code}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('does not inject creation defaults into partial updates', () => {
    const built = apps.get(domain)!;
    const violations = built.operations.filter((op) => ['put', 'patch'].includes(op.method) && !FULL_REPLACE_OPERATIONS.has(op.id))
      .flatMap((op) => listDefaultedBodyProperties(built.doc, op).map((field) => `${op.id}: ${field}`));
    expect(violations).toEqual([]);
  });

  it('does not shadow static paths with previously registered parameter routes', () => {
    const built = apps.get(domain)!;
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = built.routes.filter((route) => route.method !== 'ALL').map((route) => ({
      ...route, pattern: new RegExp(`^${route.path.split('/').map((part) => part.startsWith(':') ? '[^/]+' : escape(part)).join('/')}$`),
    }));
    const violations: string[] = [];
    for (const op of built.operations) {
      const path = op.path.replace(/\{([^}]+)\}/g, ':$1');
      const winner = patterns.find((route) => route.method === op.method.toUpperCase() && route.pattern.test(path));
      if (winner?.path !== path) violations.push(`${op.id}: matched ${winner?.path ?? '(missing)'}`);
    }
    expect(violations).toEqual([]);
  });

  it('returns the standard 404 envelope for unknown API paths', async () => {
    const response = await apps.get(domain)!.app.request('/api/__unknown_domain_test__');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 404 });
  });
});
