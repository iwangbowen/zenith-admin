import type { Menu } from '../identity/contracts';
import { applyMenuFeatureKeys } from '../licensing/feature-catalog';
import { ALL_PERMISSIONS } from '../permissions';
import type { PermissionMeta } from '../core/permissions';
import { SEED_DATE } from './_base';
import { PAGE_READ_PERMISSION_BY_NAME } from './menus/page-permissions';
import { SEED_MENUS_COMMON } from './menus/common';
import { SEED_MENUS_SYSTEM } from './menus/system';
import { SEED_MENUS_SETTINGS } from './menus/settings';
import { SEED_MENUS_ALERTS } from './menus/alerts';
import { SEED_MENUS_AI } from './menus/ai';
import { SEED_MENUS_WORKFLOW } from './menus/workflow';
import { SEED_MENUS_MESSAGING } from './menus/messaging';
import { SEED_MENUS_RULES } from './menus/rules';
import { SEED_MENUS_ANALYTICS } from './menus/analytics';
import { SEED_MENUS_PAYMENT } from './menus/payment';
import { SEED_MENUS_MEMBER } from './menus/member';
import { SEED_MENUS_MP } from './menus/mp';
import { SEED_MENUS_BIZ } from './menus/biz';
import { SEED_MENUS_REPORT } from './menus/report';
import { SEED_MENUS_OPEN_PLATFORM } from './menus/open-platform';
import { SEED_MENUS_CMS } from './menus/cms';
import { SEED_MENUS_WIKI } from './menus/wiki';
import { SEED_MENUS_GROWTH } from './menus/growth';
import { SEED_MENUS_IOT } from './menus/iot';
import { SEED_MENUS_DRIVE } from './menus/drive';

export { SEED_DATE };

/**
 * 菜单按一级目录 ID 段维护于 ./menus/；新增条目写入对应分片，只声明 directory / menu。
 * 操作权限只存在于各域 permissions.ts 和权限目录；菜单种子不生成任何权限挂载节点。
 * 数组顺序决定菜单落库顺序。
 */
export const SEED_MENUS: Menu[] = applyMenuFeatureKeys(expandPagePermissions([
  ...SEED_MENUS_COMMON,
  ...SEED_MENUS_SYSTEM,
  ...SEED_MENUS_SETTINGS,
  ...SEED_MENUS_ALERTS,
  ...SEED_MENUS_AI,
  ...SEED_MENUS_WORKFLOW,
  ...SEED_MENUS_MESSAGING,
  ...SEED_MENUS_RULES,
  ...SEED_MENUS_ANALYTICS,
  ...SEED_MENUS_PAYMENT,
  ...SEED_MENUS_MEMBER,
  ...SEED_MENUS_MP,
  ...SEED_MENUS_BIZ,
  ...SEED_MENUS_REPORT,
  ...SEED_MENUS_OPEN_PLATFORM,
  ...SEED_MENUS_CMS,
  ...SEED_MENUS_WIKI,
  ...SEED_MENUS_GROWTH,
  ...SEED_MENUS_IOT,
  ...SEED_MENUS_DRIVE,
], ALL_PERMISSIONS));

/**
 * 把页面读权限写入页面节点。
 *
 * 操作权限只存在于权限注册表/权限目录，绝不生成菜单节点：
 * - `button` 不是菜单资源，也不是权限本身；
 * - 页面按 `name` 匹配 `page-permissions.ts`，注册表引用了不存在的页面在构造期抛错。
 */
export function expandPagePermissions(pages: Menu[], registry: Readonly<Record<string, PermissionMeta>>): Menu[] {
  const pageByName = new Map(pages.flatMap(page => page.name ? [[page.name, page] as const] : []));
  const pageReadCodes = new Map<number, string>();
  for (const page of pages) {
    if (!page.name) continue;
    const code = PAGE_READ_PERMISSION_BY_NAME[page.name];
    if (!code) continue;
    const meta = registry[code];
    if (!meta) throw new Error(`页面 ${page.name} 的读权限 ${code} 未在权限注册表登记`);
    const menuNames = typeof meta.menu === 'string' ? [meta.menu] : meta.menu ?? [];
    if (!menuNames.includes(page.name)) throw new Error(`页面 ${page.name} 的读权限 ${code} 未声明绑定该页面`);
    pageReadCodes.set(page.id, code);
  }
  // 操作权限不生成节点，但仍校验注册表绑定的页面存在且不是目录，避免种子静默丢权限。
  for (const [code, meta] of Object.entries(registry)) {
    const menuNames = typeof meta.menu === 'string' ? [meta.menu] : meta.menu ?? [];
    for (const name of menuNames) {
      const page = pageByName.get(name);
      if (!page) throw new Error(`权限码 ${code} 引用了不存在的菜单页面 ${name}`);
      if (page.type !== 'menu') throw new Error(`权限码 ${code} 只能绑定页面菜单，当前绑定到 ${name}（${page.type}）`);
    }
  }
  return pages.map(page => pageReadCodes.has(page.id) ? { ...page, permission: pageReadCodes.get(page.id) } : page);
}

// ─── 菜单派生工具（基于 SEED_MENUS 结构化推导，避免硬编码 ID 漂移）───────────────

/** 收集某菜单节点的整棵子树 ID（含自身） */
export function collectMenuSubtreeIds(rootId: number): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const m of SEED_MENUS) {
    const list = childrenByParent.get(m.parentId) ?? [];
    list.push(m.id);
    childrenByParent.set(m.parentId, list);
  }
  const result: number[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);
    queue.push(...(childrenByParent.get(id) ?? []));
  }
  return result;
}

/** CMS 明细导出（raw export）权限码，非超管演示角色排除 */
export const CMS_RAW_EXPORT_PERMISSIONS: readonly string[] = [
  'cms:subscription:export-raw',
  'cms:ad-event:export-raw',
  'cms:interaction:export-raw',
];

/** 为初始角色选择操作能力。所选页面自身的读能力随页面生效。 */
export function explicitPermissionCodesForPageIds(pageIds: readonly number[], excluded: readonly string[] = []): string[] {
  const pages = SEED_MENUS.filter(menu => menu.type === 'menu' && pageIds.includes(menu.id));
  const pageNames = new Set(pages.map(menu => menu.name));
  const excludedSet = new Set([...excluded, ...pages.flatMap(page => page.permission ?? [])]);
  return Object.entries(ALL_PERMISSIONS).flatMap(([code, meta]) => {
    if (excludedSet.has(code)) return [];
    const menuNames = typeof meta.menu === 'string' ? [meta.menu] : meta.menu ?? [];
    return menuNames.some(name => pageNames.has(name)) ? [code] : [];
  });
}

export const CMS_ROOT_MENU_ID = 14000;

// 知识中心根目录与文档中心页面（供角色种子引用，避免魔法数字散落）
export const WIKI_ROOT_MENU_ID = 16000;
export const WIKI_DOC_CENTER_MENU_ID = 16010;

// 企业网盘根目录与工作台页面（普通用户默认可用个人网盘）
export const DRIVE_ROOT_MENU_ID = 19000;
export const DRIVE_WORKBENCH_MENU_ID = 19010;
