/**
 * 应用部署（服务端应用推送到运维主机）
 *
 * 模型：部署目标（deploy_targets，应用 × 环境：主机组 / 根目录 / 重启 / 健康检查 / 保留策略）
 *   → 部署记录（deploy_runs + deploy_run_hosts + deploy_run_logs，一次部署 / 回滚 / 重启及其逐主机步骤与日志）
 *   → 发布目录登记（deploy_releases，主机上 releases/<name> 目录 = 还原点，isCurrent 镜像 current 软链）。
 * 应用 / 版本 / 制品复用「应用版本」的 client_apps / app_releases / app_artifacts（kind = service，platform = server）。
 * 主机上的布局：`{deployPath}/releases/<yyyyMMddHHmmss-version>/`、`shared/`、`current -> releases/<x>`、`tmp/`。
 * 平台级资源：不挂 tenant_id。
 */
import { pgTable, pgEnum, varchar, text, integer, smallint, bigint, boolean, jsonb, unique, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  DEPLOY_HOST_STATUSES,
  DEPLOY_LOG_LEVELS,
  DEPLOY_RESTART_MODES,
  DEPLOY_RUN_KINDS,
  DEPLOY_RUN_STATUSES,
  DEPLOY_STEPS,
  DEPLOY_STRATEGIES,
} from '@zenith/shared/ops';
import type { DeployHealthCheck, DeployRunSnapshot, DeployScripts } from '@zenith/shared/ops';
import { timestampColumns, idColumn, remarkColumn, timestamptz } from './common';
import { auditColumns } from './core';
import { appArtifacts, appReleases, clientApps } from './app-releases';
import { opsHosts } from './ops-hosts';
import { asyncTasks } from './tasks';

export const deployRestartModeEnum = pgEnum('deploy_restart_mode', DEPLOY_RESTART_MODES);
export const deployStrategyEnum = pgEnum('deploy_strategy', DEPLOY_STRATEGIES);
export const deployRunKindEnum = pgEnum('deploy_run_kind', DEPLOY_RUN_KINDS);
export const deployRunStatusEnum = pgEnum('deploy_run_status', DEPLOY_RUN_STATUSES);
export const deployHostStatusEnum = pgEnum('deploy_host_status', DEPLOY_HOST_STATUSES);
export const deployStepEnum = pgEnum('deploy_step', DEPLOY_STEPS);
export const deployLogLevelEnum = pgEnum('deploy_log_level', DEPLOY_LOG_LEVELS);

// ─── 部署目标 ─────────────────────────────────────────────────────────────────
export const deployTargets = pgTable('deploy_targets', {
  id: idColumn(),
  appId: integer().notNull().references(() => clientApps.id, { onDelete: 'cascade' }),
  /** 环境名，如 生产 / 预发 */
  name: varchar({ length: 64 }).notNull(),
  description: text(),
  /** 部署根目录（绝对路径），其下 releases/ shared/ current tmp/ */
  deployPath: varchar({ length: 255 }).notNull(),
  /** shared/ 下跨版本持久化并软链进每个 release 的相对路径 */
  sharedPaths: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** 部署成功后保留的历史 release 数（不含 current） */
  keepReleases: smallint().notNull().default(5),
  restartMode: deployRestartModeEnum().notNull().default('systemd'),
  /** systemd 单元名（restartMode = systemd） */
  serviceName: varchar({ length: 128 }),
  /** 钩子 / 重启脚本（bash，工作目录为 release 目录），只存服务端 */
  scripts: jsonb().$type<DeployScripts>().notNull().default(sql`'{"beforeSwitch":null,"restart":null}'::jsonb`),
  healthCheck: jsonb().$type<DeployHealthCheck>().notNull(),
  env: jsonb().$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
  autoRollback: boolean().notNull().default(true),
  strategy: deployStrategyEnum().notNull().default('rolling'),
  maxParallel: smallint().notNull().default(2),
  stopOnFailure: boolean().notNull().default(true),
  enabled: boolean().notNull().default(true),
  remark: remarkColumn(500),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  unique('deploy_targets_app_name_unique').on(t.appId, t.name),
]);

export type DeployTargetRow = typeof deployTargets.$inferSelect;
export type NewDeployTarget = typeof deployTargets.$inferInsert;

/** 目标 ↔ 主机；主机被删除时绑定随之消失（应用部署页会显示目标主机数变化） */
export const deployTargetHosts = pgTable('deploy_target_hosts', {
  targetId: integer().notNull().references(() => deployTargets.id, { onDelete: 'cascade' }),
  hostId: integer().notNull().references(() => opsHosts.id, { onDelete: 'cascade' }),
  /** 滚动推进顺序 */
  order: smallint().notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.targetId, t.hostId] }),
  index('deploy_target_hosts_host_idx').on(t.hostId),
]);

export type DeployTargetHostRow = typeof deployTargetHosts.$inferSelect;

// ─── 部署记录 ─────────────────────────────────────────────────────────────────
export const deployRuns = pgTable('deploy_runs', {
  id: idColumn(),
  appId: integer().notNull().references(() => clientApps.id, { onDelete: 'cascade' }),
  targetId: integer().notNull().references(() => deployTargets.id, { onDelete: 'cascade' }),
  kind: deployRunKindEnum().notNull(),
  status: deployRunStatusEnum().notNull().default('pending'),
  /** 部署的应用版本（deploy）；版本被删除时保留记录 */
  appReleaseId: integer().references(() => appReleases.id, { onDelete: 'set null' }),
  version: varchar({ length: 32 }),
  artifactId: integer().references(() => appArtifacts.id, { onDelete: 'set null' }),
  /** 本次 run 在各主机上的 release 目录名（同一次 run 全部主机同名）；rollback 为目标 release 名 */
  releaseName: varchar({ length: 80 }),
  /** 任务中心任务；取消 / 进度经通用任务接口 */
  asyncTaskId: integer().references(() => asyncTasks.id, { onDelete: 'set null' }),
  /** 发起时的目标配置快照：历史可复现 */
  snapshot: jsonb().$type<DeployRunSnapshot>().notNull(),
  hostTotal: smallint().notNull().default(0),
  hostSucceeded: smallint().notNull().default(0),
  hostFailed: smallint().notNull().default(0),
  /** 主机之外的整体失败原因（制品读取 / 任务投递等） */
  error: text(),
  remark: remarkColumn(500),
  startedAt: timestamptz(),
  finishedAt: timestamptz(),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('deploy_runs_target_created_idx').on(t.targetId, t.createdAt),
  index('deploy_runs_app_created_idx').on(t.appId, t.createdAt),
  index('deploy_runs_status_started_idx').on(t.status, t.startedAt),
  index('deploy_runs_status_finished_idx').on(t.status, t.finishedAt),
  // 目标级互斥：同一目标同时只允许一个未结束的 run
  uniqueIndex('deploy_runs_target_active_unique').on(t.targetId).where(sql`${t.status} in ('pending', 'running')`),
]);

export type DeployRunRow = typeof deployRuns.$inferSelect;
export type NewDeployRun = typeof deployRuns.$inferInsert;

export const deployRunHosts = pgTable('deploy_run_hosts', {
  id: idColumn(),
  runId: integer().notNull().references(() => deployRuns.id, { onDelete: 'cascade' }),
  hostId: integer().notNull().references(() => opsHosts.id, { onDelete: 'cascade' }),
  status: deployHostStatusEnum().notNull().default('pending'),
  /** 当前 / 失败时所在步骤 */
  step: deployStepEnum(),
  releaseName: varchar({ length: 80 }),
  /** 切换前的 current；自动回滚即切回它 */
  previousReleaseName: varchar({ length: 80 }),
  startedAt: timestamptz(),
  finishedAt: timestamptz(),
  error: text(),
}, (t) => [
  unique('deploy_run_hosts_run_host_unique').on(t.runId, t.hostId),
  index('deploy_run_hosts_status_started_idx').on(t.status, t.startedAt),
]);

export type DeployRunHostRow = typeof deployRunHosts.$inferSelect;
export type NewDeployRunHost = typeof deployRunHosts.$inferInsert;

/** 逐行日志：run 内 seq 单调递增，客户端按 seq 增量拉取；WS deploy:log 实时推送同一份 */
export const deployRunLogs = pgTable('deploy_run_logs', {
  id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  runId: integer().notNull().references(() => deployRuns.id, { onDelete: 'cascade' }),
  /** null = run 级日志（预检 / 汇总） */
  hostId: integer().references(() => opsHosts.id, { onDelete: 'cascade' }),
  seq: integer().notNull(),
  level: deployLogLevelEnum().notNull().default('info'),
  step: deployStepEnum(),
  line: text().notNull(),
  createdAt: timestamptz().defaultNow().notNull(),
}, (t) => [
  unique('deploy_run_logs_run_seq_unique').on(t.runId, t.seq),
]);

export type DeployRunLogRow = typeof deployRunLogs.$inferSelect;
export type NewDeployRunLog = typeof deployRunLogs.$inferInsert;

// ─── 发布目录登记（还原点）────────────────────────────────────────────────────
export const deployReleases = pgTable('deploy_releases', {
  id: idColumn(),
  appId: integer().notNull().references(() => clientApps.id, { onDelete: 'cascade' }),
  targetId: integer().notNull().references(() => deployTargets.id, { onDelete: 'cascade' }),
  hostId: integer().notNull().references(() => opsHosts.id, { onDelete: 'cascade' }),
  /** 主机上 releases/ 下的目录名 */
  releaseName: varchar({ length: 80 }).notNull(),
  version: varchar({ length: 32 }).notNull(),
  appReleaseId: integer().references(() => appReleases.id, { onDelete: 'set null' }),
  artifactId: integer().references(() => appArtifacts.id, { onDelete: 'set null' }),
  /** 创建它的部署 run */
  runId: integer().references(() => deployRuns.id, { onDelete: 'set null' }),
  /** 镜像主机上 current 软链的指向；每个 (target, host) 至多一个 */
  isCurrent: boolean().notNull().default(false),
  /** 最近一次成为 current 的时间（部署 / 回滚切换时刻；回滚回来会刷新） */
  currentSince: timestamptz(),
  sizeBytes: bigint({ mode: 'number' }),
  /** 已从主机清理（保留策略 / 手动删除 / 对账发现缺失） */
  removedAt: timestamptz(),
  createdAt: timestamptz().defaultNow().notNull(),
}, (t) => [
  unique('deploy_releases_target_host_name_unique').on(t.targetId, t.hostId, t.releaseName),
  index('deploy_releases_target_host_idx').on(t.targetId, t.hostId),
  uniqueIndex('deploy_releases_current_unique').on(t.targetId, t.hostId).where(sql`${t.isCurrent} = true`),
]);

export type DeployReleaseRow = typeof deployReleases.$inferSelect;
export type NewDeployRelease = typeof deployReleases.$inferInsert;
