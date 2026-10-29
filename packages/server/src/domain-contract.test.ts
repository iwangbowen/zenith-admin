import { beforeAll, describe, expect, it } from 'vitest';
import { mockServerInfra, requestWithoutCredentials } from './test-utils/contract';
import { buildDomainContractApp, type DomainContractApp } from './test-utils/domain-contract';
import { SERVER_DOMAIN_NAMES, type ServerDomainName } from './routes/domain-loaders';

mockServerInfra();

const DEFAULT_DOMAINS: readonly ServerDomainName[] = ['identity', 'workflow', 'payment'];
const PILOT_DOMAINS: readonly ServerDomainName[] = (process.env.ZENITH_TEST_DOMAINS?.split(',') ?? DEFAULT_DOMAINS)
  .filter((domain): domain is ServerDomainName => SERVER_DOMAIN_NAMES.includes(domain as ServerDomainName));

if (PILOT_DOMAINS.length === 0) throw new Error('ZENITH_TEST_DOMAINS must include at least one pilot domain');

const apps = new Map<ServerDomainName, DomainContractApp>();

beforeAll(async () => {
  for (const domain of PILOT_DOMAINS) {
    apps.set(domain, await buildDomainContractApp(domain));
  }
}, 120_000);

describe.each(PILOT_DOMAINS)('%s 领域契约', (domain) => {
  it('只暴露本领域已登记的操作', () => {
    const built = apps.get(domain)!;
    expect(built.domain.name).toBe(domain);
    expect(built.operations.length, `${domain} 没有生成任何 OpenAPI 操作`).toBeGreaterThan(0);
    expect(built.routes.some((route) => route.method !== 'ALL')).toBe(true);
  });

  it('运行时认证行为与契约 security 声明一致', async () => {
    const built = apps.get(domain)!;
    const violations: string[] = [];
    for (const operation of built.operations) {
      const status = await requestWithoutCredentials(built.app, operation);
      if (operation.isDeclaredPublic ? status === 401 : status !== 401) {
        violations.push(`${operation.id} → ${status}`);
      }
    }
    expect(violations).toEqual([]);
  }, 120_000);
});
