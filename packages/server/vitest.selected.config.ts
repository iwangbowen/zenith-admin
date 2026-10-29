import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import base from './vitest.config.ts';

const path = process.env.ZENITH_TEST_PLAN;
if (!path) throw new Error('Run selected Server tests through test:domain or test:affected');
const plan = JSON.parse(readFileSync(path, 'utf8')) as { tests: string[]; contractDomains?: string[] };
const options = base.test!;

export default defineConfig({
  root: import.meta.dirname,
  test: {
    ...options,
    projects: [
      ...(plan.tests.length ? [{ extends: false, test: { ...options, name: 'selected', include: plan.tests } }] : []),
      ...(plan.contractDomains ?? []).map((domain) => ({
        extends: false,
        test: {
          ...options,
          name: `contract:${domain}`,
          include: ['src/domain-contract.test.ts'],
          exclude: [],
          env: { ...options.env, ZENITH_TEST_DOMAINS: domain },
        },
      })),
    ],
  },
});
