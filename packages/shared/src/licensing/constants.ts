import { createLabelOptionsFromMap } from '../core/enum-options';

// ─── License 运行模式 ─────────────────────────────────────────────────────────
/**
 * off      默认。完全不启用授权体系，License 表可为空，dev/demo/CI 零感知。
 * warn     全功能可用；未授权功能横幅告警并记录 license_events（推荐生产默认）。
 * required 强制执行：未授权功能拒绝访问，License 失效进入受限模式。
 */
export const LICENSE_MODES = ['off', 'warn', 'required'] as const;

export type LicenseMode = (typeof LICENSE_MODES)[number];

// ─── 可授权功能 ───────────────────────────────────────────────────────────────
/**
 * 可授权功能全集。核心能力（identity/platform/messaging/files/tasks/dashboard）
 * 不在此列——它们不可关闭，菜单 featureKey 为 null。
 */
export const LICENSE_FEATURES = [
  'workflow',
  'analytics',
  'report',
  'cms',
  'wiki',
  'ai',
  'payment',
  'member',
  'mp',
  'chat',
  'open-platform',
  'rules',
  'ops',
  'drive',
] as const;

export type LicenseFeatureKey = (typeof LICENSE_FEATURES)[number];

export const LICENSE_FEATURE_LABELS: Record<LicenseFeatureKey, string> = {
  workflow: '工作流引擎',
  analytics: '数据分析',
  report: '报表中心',
  cms: 'CMS 内容管理',
  wiki: '知识中心',
  ai: '智能助手',
  payment: '支付中心',
  member: '会员中心',
  mp: '公众号管理',
  chat: '会话中心',
  'open-platform': '开放平台',
  rules: '规则中心',
  ops: '系统运维',
  drive: '企业网盘',
};

export const LICENSE_FEATURE_OPTIONS: Array<{ value: LicenseFeatureKey; label: string }> =
  createLabelOptionsFromMap(LICENSE_FEATURE_LABELS);

export function isLicenseFeatureKey(value: string): value is LicenseFeatureKey {
  return (LICENSE_FEATURES as readonly string[]).includes(value);
}

// ─── License 状态 ─────────────────────────────────────────────────────────────
export const LICENSE_STATUSES = ['active', 'grace', 'expired', 'revoked', 'invalid', 'replaced'] as const;

export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export const LICENSE_STATUS_LABELS: Record<LicenseStatus, string> = {
  active: '生效中',
  grace: '宽限期',
  expired: '已过期',
  revoked: '已吊销',
  invalid: '无效',
  replaced: '已替换',
};

export const LICENSE_STATUS_OPTIONS: Array<{ value: LicenseStatus; label: string }> =
  createLabelOptionsFromMap(LICENSE_STATUS_LABELS);

// ─── 版本（纯展示标签与签发预设，授权判断只看 features[]）──────────────────────
export const LICENSE_EDITIONS = ['community', 'pro', 'enterprise'] as const;

export type LicenseEdition = (typeof LICENSE_EDITIONS)[number];

export const LICENSE_EDITION_LABELS: Record<LicenseEdition, string> = {
  community: '社区版',
  pro: '专业版',
  enterprise: '企业版',
};

// ─── License 事件（追加型日志的事件类型，存 varchar 便于演进）──────────────────
export const LICENSE_EVENT_TYPES = [
  'activated',
  'verified',
  'entered_grace',
  'expired',
  'replaced',
  'deactivated',
  'invalid_signature',
  'clock_anomaly',
  'limit_warning',
  'feature_denied',
] as const;

export type LicenseEventType = (typeof LICENSE_EVENT_TYPES)[number];

export const LICENSE_EVENT_TYPE_LABELS: Record<LicenseEventType, string> = {
  activated: '激活',
  verified: '校验通过',
  entered_grace: '进入宽限期',
  expired: '已过期',
  replaced: '被新 License 替换',
  deactivated: '手动停用',
  invalid_signature: '签名无效',
  clock_anomaly: '系统时钟异常',
  limit_warning: '配额告警',
  feature_denied: '功能拒绝（warn 记录）',
};

/** License 文档的 audience 固定值：防止其他产品签发的文件被误用 */
export const LICENSE_AUDIENCE = 'zenith-admin';

/** 当前支持的 envelope 版本与算法 */
export const LICENSE_ENVELOPE_VERSION = 1;
export const LICENSE_ALGORITHM = 'Ed25519';
