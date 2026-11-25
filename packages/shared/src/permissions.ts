import { IDENTITY_PERMISSIONS } from './identity/permissions';
import { PLATFORM_PERMISSIONS } from './platform/permissions';
import { OPS_PERMISSIONS } from './ops/permissions';
import { MESSAGING_PERMISSIONS } from './messaging/permissions';
import { TASKS_PERMISSIONS } from './tasks/permissions';
import { WORKFLOW_PERMISSIONS } from './workflow/permissions';
import { CHAT_PERMISSIONS } from './chat/permissions';
import { RULES_PERMISSIONS } from './rules/permissions';
import { ANALYTICS_PERMISSIONS } from './analytics/permissions';
import { REPORT_PERMISSIONS } from './report/permissions';
import { PAYMENT_PERMISSIONS } from './payment/permissions';
import { MEMBER_PERMISSIONS } from './member/permissions';
import { BIZ_PERMISSIONS } from './biz/permissions';
import { MP_PERMISSIONS } from './mp/permissions';
import { CMS_PERMISSIONS } from './cms/permissions';
import { WIKI_PERMISSIONS } from './wiki/permissions';
import { DRIVE_PERMISSIONS } from './drive/permissions';
import { OPEN_PLATFORM_PERMISSIONS } from './open-platform/permissions';
import { AI_PERMISSIONS } from './ai/permissions';
import { IOT_PERMISSIONS } from './iot/permissions';
import { MARKETING_PERMISSIONS } from './marketing/permissions';
import { SHORT_LINK_PERMISSIONS } from './short-link/permissions';
import type { PermissionMeta } from './core/permissions';

/** 按域分组的全部权限码注册表（顺序即权限目录展示顺序） */
export const PERMISSION_REGISTRY_BY_DOMAIN = {
  'identity': IDENTITY_PERMISSIONS,
  'platform': PLATFORM_PERMISSIONS,
  'ops': OPS_PERMISSIONS,
  'messaging': MESSAGING_PERMISSIONS,
  'tasks': TASKS_PERMISSIONS,
  'workflow': WORKFLOW_PERMISSIONS,
  'chat': CHAT_PERMISSIONS,
  'rules': RULES_PERMISSIONS,
  'analytics': ANALYTICS_PERMISSIONS,
  'report': REPORT_PERMISSIONS,
  'payment': PAYMENT_PERMISSIONS,
  'member': MEMBER_PERMISSIONS,
  'biz': BIZ_PERMISSIONS,
  'mp': MP_PERMISSIONS,
  'cms': CMS_PERMISSIONS,
  'wiki': WIKI_PERMISSIONS,
  'drive': DRIVE_PERMISSIONS,
  'open-platform': OPEN_PLATFORM_PERMISSIONS,
  'ai': AI_PERMISSIONS,
  'iot': IOT_PERMISSIONS,
  'marketing': MARKETING_PERMISSIONS,
  'short-link': SHORT_LINK_PERMISSIONS,
} as const;

export type PermissionDomain = keyof typeof PERMISSION_REGISTRY_BY_DOMAIN;

/** 全部权限码 → 元数据（跨域合并；重复码由 permissions.test.ts 守住） */
export const ALL_PERMISSIONS: Readonly<Record<string, PermissionMeta>> = Object.assign({}, ...Object.values(PERMISSION_REGISTRY_BY_DOMAIN));
