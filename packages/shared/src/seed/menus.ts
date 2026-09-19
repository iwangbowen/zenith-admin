import type { Menu } from '../identity/contracts';
import { MENU_ROOT_FEATURE_MAP } from '../licensing/feature-catalog';
import { ALL_PERMISSIONS } from '../permissions';
import type { PermissionMeta } from '../core/permissions';
import { SEED_DATE } from './_base';
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
 * 菜单种子数据 —— 按一级目录 ID 段分片维护（见 ./menus/）。
 *
 * 分片文件只写 directory / menu 节点；button 节点（权限码）由各域 `permissions.ts` 注册表生成
 * （`expandPermissionButtons`），权限码在整个仓库只声明一次。
 *
 * 新增模块时只改对应段的分片文件，不要在本文件堆积条目：
 *   系统管理 1000 / 系统设置 2000 / 智能助手 3000 / 工作流 4000 / 会话中心 5000 /
 *   规则中心 6000 / 数据分析 7000 / 支付中心 8000 / 会员中心 9000 / 公众号 10000 /
 *   业务示例 11000 / 报表中心 12000 / 开放平台 13000 / CMS 14000 / 告警中心 15000 /
 *   知识中心 16000 / 运营中心 17000 / IoT 18000 / 企业网盘 19000
 *
 * 数组顺序即菜单落库顺序，调整分片顺序会影响 SEED_MENUS 的相对次序。
 */
export const SEED_MENUS: Menu[] = applyMenuFeatureKeys(expandPermissionButtons([
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

function attachmentAt<T>(value: T | readonly (T | undefined)[] | undefined, index: number): T | undefined {
  if (Array.isArray(value)) return (value as readonly (T | undefined)[])[index];
  return value as T | undefined;
}

/**
 * 把注册表里的权限码展开为 button 节点，紧跟其所属页面之后插入。
 *
 * 规则（与手写时代的 id 约定一致，已初始化环境的菜单 id 不变）：
 * - 第 idx 个按钮 `id = 页面 id + 1 + idx`、`sort = idx`；注册表的 `id` / `sort` 可逐个覆盖；
 * - 同一权限码挂多个页面时，`menu` / `id` / `sort` 数组按位置对应；
 * - 页面按 `name` 匹配，注册表引用了不存在的页面在构造期抛错（种子不会带着幻觉权限落库）。
 */
export function expandPermissionButtons(pages: Menu[], registry: Readonly<Record<string, PermissionMeta>>): Menu[] {
  const pageByName = new Map<string, Menu>();
  for (const page of pages) if (page.name) pageByName.set(page.name, page);

  const buttonsByPage = new Map<number, Menu[]>();
  const seenIds = new Set(pages.map((p) => p.id));
  for (const [code, meta] of Object.entries(registry)) {
    const menus = typeof meta.menu === 'string' ? [meta.menu] : meta.menu;
    menus.forEach((menuName, position) => {
      const page = pageByName.get(menuName);
      if (!page) throw new Error(`权限码 ${code} 引用了不存在的菜单页面 ${menuName}`);
      const list = buttonsByPage.get(page.id) ?? [];
      const idx = list.length;
      const id = attachmentAt(meta.id, position) ?? page.id + 1 + idx;
      if (seenIds.has(id)) throw new Error(`权限码 ${code} 生成的按钮 id ${id} 与其它菜单冲突`);
      seenIds.add(id);
      list.push({
        id,
        parentId: page.id,
        title: meta.label,
        type: 'button',
        permission: code,
        sort: attachmentAt(meta.sort, position) ?? idx,
        status: 'enabled',
        visible: true,
        createdAt: SEED_DATE,
        updatedAt: SEED_DATE,
      } as Menu);
      buttonsByPage.set(page.id, list);
    });
  }

  return pages.flatMap((page) => [page, ...(buttonsByPage.get(page.id) ?? [])]);
}

/**
 * 按功能目录的 menuRoots 为整棵子树派生 featureKey。
 * featureKey 为 null 的菜单属于核心能力（不可关闭）；分片文件无需逐行标注，
 * 目录（@zenith/shared/licensing 的 LICENSE_FEATURE_CATALOG）是唯一事实源。
 */
function applyMenuFeatureKeys(menus: Menu[]): Menu[] {
  const childrenByParent = new Map<number, Menu[]>();
  for (const m of menus) {
    const list = childrenByParent.get(m.parentId) ?? [];
    list.push(m);
    childrenByParent.set(m.parentId, list);
  }
  const featureById = new Map<number, string>();
  for (const [rootId, featureKey] of MENU_ROOT_FEATURE_MAP) {
    const queue = [rootId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      featureById.set(id, featureKey);
      for (const child of childrenByParent.get(id) ?? []) queue.push(child.id);
    }
  }
  return menus.map((m) => ({ ...m, featureKey: featureById.get(m.id) ?? null }));
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

/** CMS 明细导出（raw export）按钮：按权限码推导，非超管演示角色排除 */
const CMS_RAW_EXPORT_PERMISSIONS: readonly string[] = [
  'cms:subscription:export-raw',
  'cms:ad-event:export-raw',
  'cms:interaction:export-raw',
];

export const CMS_ROOT_MENU_ID = 14000;

// 知识中心根目录与文档中心页面（供角色种子引用，避免魔法数字散落）
export const WIKI_ROOT_MENU_ID = 16000;
export const WIKI_DOC_CENTER_MENU_ID = 16010;

// 企业网盘根目录与工作台页面（普通用户默认可用个人网盘）
export const DRIVE_ROOT_MENU_ID = 19000;
export const DRIVE_WORKBENCH_MENU_ID = 19010;

export const CMS_RAW_EXPORT_MENU_IDS: number[] = SEED_MENUS
  .filter((m) => m.permission !== undefined && CMS_RAW_EXPORT_PERMISSIONS.includes(m.permission))
  .map((m) => m.id);
