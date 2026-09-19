/**
 * License 功能目录（Feature Catalog）——授权体系的唯一事实源。
 *
 * 与通知事件目录同一哲学：功能全集定义在代码里，数据库只存分配结果
 * （License features[] 与 tenant_package_features 稀疏行）。
 * 菜单的 featureKey 由此目录的 menuRoots 在种子装配时派生，
 * 不需要在几百条菜单种子上逐行标注，也不会与目录漂移。
 */
import type { LicenseEdition, LicenseFeatureKey } from './constants';
import { LICENSE_FEATURE_LABELS, LICENSE_FEATURES } from './constants';

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
};

/** 版本预设：签发 CLI 用它展开 features[]；运行时授权只看 License 载荷里的显式列表 */
export const LICENSE_EDITION_PRESETS: Record<LicenseEdition, readonly LicenseFeatureKey[]> = {
  community: ['workflow', 'wiki', 'chat'],
  pro: ['workflow', 'wiki', 'chat', 'analytics', 'report', 'cms', 'rules', 'ai', 'drive'],
  enterprise: LICENSE_FEATURES,
};

/** menuRoot → featureKey 反查表（种子装配用） */
export const MENU_ROOT_FEATURE_MAP: ReadonlyMap<number, LicenseFeatureKey> = new Map(
  (Object.entries(LICENSE_FEATURE_CATALOG) as Array<[LicenseFeatureKey, LicenseFeatureDef]>)
    .flatMap(([key, def]) => def.menuRoots.map((root) => [root, key] as const)),
);
