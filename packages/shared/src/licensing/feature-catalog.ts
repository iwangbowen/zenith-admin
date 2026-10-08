/**
 * License 功能目录（Feature Catalog）——授权体系的唯一事实源。
 *
 * 与通知事件目录同一哲学：功能全集定义在代码里，数据库只存分配结果
 * （License features[] 与 tenant_package_features 稀疏行）。
 * 菜单的 featureKey 由此目录的 menuRoots 在种子装配时派生，
 * 不需要在几百条菜单种子上逐行标注，也不会与目录漂移。
 */
import type { LicenseEdition, LicenseFeatureKey } from './constants';
import { isLicenseFeatureKey, LICENSE_FEATURE_LABELS, LICENSE_FEATURES } from './constants';

export interface LicenseFeatureDef {
  label: string;
  description: string;
  /**
   * 该功能在菜单树中的根节点 ID（子树内所有菜单继承此 featureKey）。
   * 跨段的零散页面可以列多个根。
   */
  menuRoots: readonly number[];
}

export const LICENSE_FEATURE_CATALOG: Record<LicenseFeatureKey, LicenseFeatureDef> = {
  ai: {
    label: LICENSE_FEATURE_LABELS.ai,
    description: 'AI 对话、知识库、提示词、模型竞技场与评测',
    menuRoots: [3000],
  },
  workflow: {
    label: LICENSE_FEATURE_LABELS.workflow,
    description: '流程设计器、审批运行时、自动化与连接器',
    menuRoots: [4000],
  },
  chat: {
    label: LICENSE_FEATURE_LABELS.chat,
    description: '即时消息、群组、系统号与 Webhook 机器人',
    // 5000 = 会话中心；2380 = 系统设置下的 Webhook 机器人页
    menuRoots: [5000, 2380],
  },
  rules: {
    label: LICENSE_FEATURE_LABELS.rules,
    description: '决策表、规则流与名单库',
    menuRoots: [6000],
  },
  analytics: {
    label: LICENSE_FEATURE_LABELS.analytics,
    description: '行为分析、漏斗、实验与前端错误监控',
    menuRoots: [7000],
  },
  payment: {
    label: LICENSE_FEATURE_LABELS.payment,
    description: '支付渠道、订单、对账、结算与风控',
    menuRoots: [8000],
  },
  member: {
    label: LICENSE_FEATURE_LABELS.member,
    description: '会员账户、等级、积分、钱包与营销',
    menuRoots: [9000],
  },
  mp: {
    label: LICENSE_FEATURE_LABELS.mp,
    description: '微信公众号粉丝、素材、菜单、客服与群发',
    menuRoots: [10000],
  },
  report: {
    label: LICENSE_FEATURE_LABELS.report,
    description: '数据源、数据集、仪表盘、订阅与数据质量',
    menuRoots: [12000],
  },
  'open-platform': {
    label: LICENSE_FEATURE_LABELS['open-platform'],
    description: '开发者应用、OAuth2、开放网关与配额计划',
    menuRoots: [13000],
  },
  cms: {
    label: LICENSE_FEATURE_LABELS.cms,
    description: '站群、内容、发布流水线与前台渲染管理',
    menuRoots: [14000],
  },
  wiki: {
    label: LICENSE_FEATURE_LABELS.wiki,
    description: '知识空间、文档、评论与治理',
    menuRoots: [16000],
  },
  ops: {
    label: LICENSE_FEATURE_LABELS.ops,
    description: 'Web 终端、Docker、Nginx、SSL、防火墙等系统运维',
    // 2440 = 系统设置 → 系统运维目录
    menuRoots: [2440],
  },
  drive: {
    label: LICENSE_FEATURE_LABELS.drive,
    description: '企业网盘：个人 / 部门 / 协作空间、权限、外链与版本',
    menuRoots: [19000],
  },
  growth: {
    label: LICENSE_FEATURE_LABELS.growth,
    description: '短链管理、渠道分析与营销活动',
    menuRoots: [17000],
  },
  iot: {
    label: LICENSE_FEATURE_LABELS.iot,
    description: '产品与设备管理、遥测、告警、固件升级与场景联动',
    menuRoots: [18000],
  },
};

/** 版本预设：签发 CLI 用它展开 features[]；运行时授权只看 License 载荷里的显式列表 */
export const LICENSE_EDITION_PRESETS: Record<LicenseEdition, readonly LicenseFeatureKey[]> = {
  community: ['workflow', 'wiki', 'chat'],
  pro: ['workflow', 'wiki', 'chat', 'analytics', 'report', 'cms', 'rules', 'ai', 'drive', 'growth'],
  enterprise: LICENSE_FEATURES,
};

/** menuRoot → featureKey 反查表（种子装配用） */
export const MENU_ROOT_FEATURE_MAP: ReadonlyMap<number, LicenseFeatureKey> = new Map(
  (Object.entries(LICENSE_FEATURE_CATALOG) as Array<[LicenseFeatureKey, LicenseFeatureDef]>)
    .flatMap(([key, def]) => def.menuRoots.map((root) => [root, key] as const)),
);

export interface CoreMenuRootDef {
  id: number;
  reason: string;
}

/** 核心入口显式登记；系统设置里的已登记授权子树仍按对应功能控制。 */
export const CORE_MENU_ROOTS: readonly CoreMenuRootDef[] = [
  { id: 1, reason: '首页是登录后的基础工作台' },
  { id: 11, reason: '个人中心负责账号与个人资料维护' },
  { id: 12, reason: '公告中心属于基础消息触达' },
  { id: 13, reason: '站内信属于基础消息触达' },
  { id: 14, reason: '搜索中心是跨模块入口，结果仍受各模块权限约束' },
  { id: 1000, reason: '系统管理负责身份、权限、租户与授权恢复' },
  { id: 2000, reason: '系统设置提供基础治理；运维与机器人子树另行授权' },
  { id: 11000, reason: '业务示例用于展示基础集成能力' },
  { id: 15000, reason: '告警中心负责平台自身运行监控' },
];

/**
 * 种子菜单必须归入授权功能或显式核心根，禁止把漏登记的新模块默认为核心。
 * 授权根可以位于核心容器中（如系统设置），但授权根之间不可重复或嵌套。
 */
export function applyMenuFeatureKeys<T extends { id: number; parentId: number }>(
  menus: readonly T[],
  catalog: Readonly<Partial<Record<LicenseFeatureKey, Pick<LicenseFeatureDef, 'menuRoots'>>>> = LICENSE_FEATURE_CATALOG,
  coreRoots: readonly CoreMenuRootDef[] = CORE_MENU_ROOTS,
): Array<T & { featureKey: LicenseFeatureKey | null }> {
  const menuById = new Map<number, T>();
  const childrenByParent = new Map<number, T[]>();
  for (const menu of menus) {
    if (menuById.has(menu.id)) throw new Error(`菜单 ID ${menu.id} 重复`);
    menuById.set(menu.id, menu);
    const children = childrenByParent.get(menu.parentId) ?? [];
    children.push(menu);
    childrenByParent.set(menu.parentId, children);
  }
  for (const menu of menus) {
    if (menu.parentId !== 0 && !menuById.has(menu.parentId)) {
      throw new Error(`菜单 ${menu.id} 未覆盖：父节点 ${menu.parentId} 不存在`);
    }
  }

  const featureRoots = new Map<number, LicenseFeatureKey>();
  for (const [feature, definition] of Object.entries(catalog)) {
    if (!isLicenseFeatureKey(feature)) throw new Error(`未登记的 License 功能 ${feature}`);
    if (definition.menuRoots.length === 0) throw new Error(`License 功能 ${feature} 未登记菜单根`);
    for (const rootId of definition.menuRoots) {
      if (!menuById.has(rootId)) throw new Error(`授权菜单根 ${rootId} 不存在（${feature}）`);
      if (featureRoots.has(rootId)) throw new Error(`授权菜单根 ${rootId} 重复登记`);
      featureRoots.set(rootId, feature);
    }
  }
  for (const rootId of featureRoots.keys()) {
    const seen = new Set([rootId]);
    let parentId = menuById.get(rootId)!.parentId;
    while (parentId !== 0) {
      if (seen.has(parentId)) throw new Error(`菜单 ${rootId} 的父级形成循环`);
      if (featureRoots.has(parentId)) throw new Error(`授权菜单根 ${rootId} 与 ${parentId} 重叠`);
      seen.add(parentId);
      parentId = menuById.get(parentId)!.parentId;
    }
  }

  const coreIds = new Set<number>();
  for (const root of coreRoots) {
    const menu = menuById.get(root.id);
    if (!menu) throw new Error(`核心菜单根 ${root.id} 不存在`);
    if (coreIds.has(root.id) || featureRoots.has(root.id)) throw new Error(`菜单根 ${root.id} 重复归类`);
    if (menu.parentId !== 0) throw new Error(`核心菜单根 ${root.id} 必须是顶层入口`);
    if (!root.reason.trim()) throw new Error(`核心菜单根 ${root.id} 缺少归类原因`);
    coreIds.add(root.id);
  }

  const featuresById = new Map<number, LicenseFeatureKey | null>();
  const pending: Array<{ id: number; feature: LicenseFeatureKey | null }> = [];
  for (const root of childrenByParent.get(0) ?? []) {
    if (!featureRoots.has(root.id) && !coreIds.has(root.id)) {
      throw new Error(`顶层菜单 ${root.id} 未归类，请登记授权功能或核心原因`);
    }
    pending.push({ id: root.id, feature: featureRoots.get(root.id) ?? null });
  }
  while (pending.length > 0) {
    const current = pending.pop()!;
    const feature = featureRoots.get(current.id) ?? current.feature;
    featuresById.set(current.id, feature);
    for (const child of childrenByParent.get(current.id) ?? []) pending.push({ id: child.id, feature });
  }
  return menus.map((menu) => {
    const featureKey = featuresById.get(menu.id);
    if (featureKey === undefined) throw new Error(`菜单 ${menu.id} 未覆盖，请检查菜单树和根分类`);
    return { ...menu, featureKey };
  });
}
