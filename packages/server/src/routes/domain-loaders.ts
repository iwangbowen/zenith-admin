/**
 * 领域路由按需加载器。
 *
 * 生产入口继续从 `routes/index.ts` 静态装配全部领域；领域契约测试只通过这里加载
 * 目标领域，避免为了验证单个领域而把完整路由图加入测试模块图。
 */
import type { RouteDomain } from './_kit';
import manifest from '../domain-manifest.json';

export type ServerDomainName = keyof typeof manifest.domains;
export const SERVER_DOMAIN_NAMES = Object.keys(manifest.domains) as ServerDomainName[];

const DOMAIN_LOADERS: Record<ServerDomainName, () => Promise<{ default: RouteDomain }>> = {
  ops: () => import('./ops'),
  identity: () => import('./identity'),
  member: () => import('./member'),
  platform: () => import('./platform'),
  files: () => import('./files'),
  tasks: () => import('./tasks'),
  analytics: () => import('./analytics'),
  report: () => import('./report'),
  messaging: () => import('./messaging'),
  payment: () => import('./payment'),
  'open-platform': () => import('./open-platform'),
  workflow: () => import('./workflow'),
  chat: () => import('./chat'),
  mp: () => import('./mp'),
  'biz-demo': () => import('./biz-demo'),
  ai: () => import('./ai'),
  'short-link': () => import('./short-link'),
  marketing: () => import('./marketing'),
  iot: () => import('./iot'),
  cms: () => import('./cms'),
  wiki: () => import('./wiki'),
  drive: () => import('./drive'),
};

export async function loadRouteDomain(name: ServerDomainName): Promise<RouteDomain> {
  return (await DOMAIN_LOADERS[name]()).default;
}
