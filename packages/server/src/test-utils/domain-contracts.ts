import { contractOperations, type AnyContract } from '@zenith/shared/core';
import type { ServerDomainName } from '../routes/domain-loaders';
import manifest from '../domain-manifest.json';

const loaders = {
  ops: () => import('@zenith/shared/ops'), identity: () => import('@zenith/shared/identity'),
  member: () => import('@zenith/shared/member'), platform: () => import('@zenith/shared/platform'),
  tasks: () => import('@zenith/shared/tasks'), analytics: () => import('@zenith/shared/analytics'),
  report: () => import('@zenith/shared/report'), messaging: () => import('@zenith/shared/messaging'),
  payment: () => import('@zenith/shared/payment'), 'open-platform': () => import('@zenith/shared/open-platform'),
  workflow: () => import('@zenith/shared/workflow'), chat: () => import('@zenith/shared/chat'),
  mp: () => import('@zenith/shared/mp'), biz: () => import('@zenith/shared/biz'), ai: () => import('@zenith/shared/ai'),
  'short-link': () => import('@zenith/shared/short-link'), marketing: () => import('@zenith/shared/marketing'),
  iot: () => import('@zenith/shared/iot'), cms: () => import('@zenith/shared/cms'),
  wiki: () => import('@zenith/shared/wiki'), drive: () => import('@zenith/shared/drive'),
  settings: () => import('@zenith/shared/settings'), licensing: () => import('@zenith/shared/licensing'),
  rules: () => import('@zenith/shared/rules'),
};

export async function loadDomainOperations(domain: ServerDomainName) {
  const definition = manifest.domains[domain];
  const modules = 'contracts' in definition ? definition.contracts : definition.shared;
  const operations = [];
  for (const name of modules) {
    const module: Record<string, unknown> = await loaders[name as keyof typeof loaders]();
    const values = [...Object.values(module), ...Object.values((module.settingsHistoryContracts ?? {}) as Record<string, unknown>)];
    for (const value of values) {
      if (value && typeof value === 'object' && 'basePath' in value) operations.push(...contractOperations(value as AnyContract));
    }
  }
  return operations;
}
