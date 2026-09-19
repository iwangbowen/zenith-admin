/**
 * 全部契约组的目录：按域收集各 `contracts/index.ts` 导出的 `defineContract()` 产物。
 *
 * 接口目录 / 权限矩阵 / 访问声明一致性测试都从这里遍历，不需要任何反射或运行时扫描——
 * 「有哪些接口、各需要什么权限」在构建期就是静态可知的。新增业务域只需在下方加一行 import 与登记；
 * `contracts.test.ts` 会断言每个域的契约导出都已收录。
 */
import { contractOperations, type AnyContract, type AnyOperation } from './core/contract';
import * as ai from './ai/contracts';
import * as analytics from './analytics/contracts';
import * as biz from './biz/contracts';
import * as chat from './chat/contracts';
import * as cms from './cms/contracts';
import * as drive from './drive/contracts';
import * as identity from './identity/contracts';
import * as iot from './iot/contracts';
import * as licensing from './licensing/contracts';
import * as marketing from './marketing/contracts';
import * as member from './member/contracts';
import * as messaging from './messaging/contracts';
import * as mp from './mp/contracts';
import * as openPlatform from './open-platform/contracts';
import * as ops from './ops/contracts';
import * as payment from './payment/contracts';
import * as platform from './platform/contracts';
import * as report from './report/contracts';
import * as rules from './rules/contracts';
import * as settings from './settings/contracts';
import * as shortLink from './short-link/contracts';
import * as tasks from './tasks/contracts';
import * as wiki from './wiki/contracts';
import * as workflow from './workflow/contracts';

/** 模块导出里的契约组（`defineContract()` 产物：有 basePath 且至少一个操作） */
export function isContract(value: unknown): value is AnyContract {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.basePath === 'string' && contractOperations(record as AnyContract).length > 0;
}

/** 从一个域的契约模块（`import * as xxx from './xxx/contracts'`）里挑出全部契约组 */
export function collectContracts(module: Record<string, unknown>): AnyContract[] {
  return Object.values(module).filter(isContract);
}

/** 域 → 该域全部契约组 */
export const CONTRACTS_BY_DOMAIN = {
  identity: collectContracts(identity),
  platform: collectContracts(platform),
  ops: collectContracts(ops),
  messaging: collectContracts(messaging),
  tasks: collectContracts(tasks),
  licensing: collectContracts(licensing),
  settings: collectContracts(settings),
  workflow: collectContracts(workflow),
  chat: collectContracts(chat),
  rules: collectContracts(rules),
  analytics: collectContracts(analytics),
  report: collectContracts(report),
  payment: collectContracts(payment),
  member: collectContracts(member),
  biz: collectContracts(biz),
  mp: collectContracts(mp),
  cms: collectContracts(cms),
  wiki: collectContracts(wiki),
  drive: collectContracts(drive),
  'open-platform': collectContracts(openPlatform),
  ai: collectContracts(ai),
  iot: collectContracts(iot),
  marketing: collectContracts(marketing),
  'short-link': collectContracts(shortLink),
} as const satisfies Record<string, readonly AnyContract[]>;

export type ContractDomain = keyof typeof CONTRACTS_BY_DOMAIN;

/** 域的展示名（接口目录 / 权限矩阵筛选与列展示） */
export const CONTRACT_DOMAIN_LABELS: Record<ContractDomain, string> = {
  identity: '身份与组织',
  platform: '平台基础',
  ops: '运维',
  messaging: '消息通知',
  tasks: '任务中心',
  licensing: 'License',
  settings: '系统设置',
  workflow: '工作流',
  chat: '会话中心',
  rules: '规则引擎',
  analytics: '行为分析',
  report: '报表',
  payment: '支付',
  member: '会员',
  biz: '业务示例',
  mp: '公众号',
  cms: 'CMS',
  wiki: '知识库',
  drive: '企业网盘',
  'open-platform': '开放平台',
  ai: 'AI',
  iot: 'IoT',
  marketing: '营销',
  'short-link': '短链',
};

export const ALL_CONTRACTS: readonly AnyContract[] = Object.values(CONTRACTS_BY_DOMAIN).flat();

export interface CatalogOperation {
  readonly domain: ContractDomain;
  readonly contract: AnyContract;
  readonly op: AnyOperation;
}

/** 全部契约操作（含所属域与契约组），按域 → 契约组 → 声明顺序 */
export function listAllOperations(): CatalogOperation[] {
  const result: CatalogOperation[] = [];
  for (const [domain, contracts] of Object.entries(CONTRACTS_BY_DOMAIN) as Array<[ContractDomain, readonly AnyContract[]]>) {
    for (const contract of contracts) {
      for (const op of contractOperations(contract)) result.push({ domain, contract, op });
    }
  }
  return result;
}
