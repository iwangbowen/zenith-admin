import { timestampColumns } from './common';
import { pgTable, varchar, timestamp, pgEnum, integer, text, jsonb, boolean, index } from 'drizzle-orm/pg-core';
import { OPS_HOST_AUTH_TYPES, OPS_HOST_STATUSES } from '@zenith/shared/ops';
import type { OpsHostSnapshot } from '@zenith/shared/ops';
import { auditColumns } from './core';

// ─── 运维主机注册表（多主机管理）───────────────────────────────────────────────
/**
 * 平台级共享的远程主机连接配置（区别于 ssh_profiles:那是用户私有的终端书签）。
 *
 * - 凭据经 lib/secret-crypto 加密存储,接口只回传有无标识;
 * - host_key_fingerprint 实现 TOFU:首连记录 SSH host key 指纹,
 *   后续连接不匹配即拒绝(防中间人);
 * - snapshot 为探测 cron 的时点快照(非时序),概览矩阵直接读缓存;
 * - 平台级资源:不挂 tenant_id,仅平台侧管理端可见。
 */
export const opsHostAuthTypeEnum = pgEnum('ops_host_auth_type', OPS_HOST_AUTH_TYPES);

export const opsHostStatusEnum = pgEnum('ops_host_status', OPS_HOST_STATUSES);

export const opsHosts = pgTable('ops_hosts', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull().unique(),
  host: varchar({ length: 255 }).notNull(),
  port: integer().notNull().default(22),
  username: varchar({ length: 64 }).notNull(),
  authType: opsHostAuthTypeEnum().notNull().default('password'),
  passwordEncrypted: text(),
  keyContentEncrypted: text(),
  keyPassphraseEncrypted: text(),
  /** 连接端点/凭据配置修订号；连接握手在接受前必须确认未发生变化。 */
  connectionVersion: integer().notNull().default(0),
  /** SSH host key SHA256 指纹(base64);null = 尚未首连 */
  hostKeyFingerprint: varchar({ length: 64 }),
  status: opsHostStatusEnum().notNull().default('unknown'),
  snapshot: jsonb().$type<OpsHostSnapshot>(),
  probedAt: timestamp(),
  probeError: text(),
  enabled: boolean().notNull().default(true),
  remark: varchar({ length: 500 }),
  ...timestampColumns(),
  ...auditColumns(),
}, (t) => [
  index('ops_hosts_enabled_idx').on(t.enabled, t.status),
]);

export type OpsHostRow = typeof opsHosts.$inferSelect;

export type NewOpsHost = typeof opsHosts.$inferInsert;
