import { sql } from 'drizzle-orm';
import { db } from '../../db';
import { analyticsSettings } from '../../db/schema';
import type { RetentionPolicyDefinition, TenantRetentionDays } from './types';

/** 行为埋点：各租户在「数据分析设置」中自定义的埋点保留天数 */
async function analyticsEventRetention(): Promise<TenantRetentionDays> {
  const rows = await db.select({
    tenantId: analyticsSettings.tenantId,
    days: analyticsSettings.retentionDays,
  }).from(analyticsSettings);
  return new Map(rows.map((row) => [row.tenantId, row.days]));
}

/** 前端错误：各租户在「数据分析设置」中自定义的错误保留天数 */
async function analyticsErrorRetention(): Promise<TenantRetentionDays> {
  const rows = await db.select({
    tenantId: analyticsSettings.tenantId,
    days: analyticsSettings.errorRetentionDays,
  }).from(analyticsSettings);
  return new Map(rows.map((row) => [row.tenantId, row.days]));
}

/** 会话回放：各租户在「数据分析设置」中自定义的回放保留天数 */
async function analyticsReplayRetention(): Promise<TenantRetentionDays> {
  const rows = await db.select({
    tenantId: analyticsSettings.tenantId,
    days: analyticsSettings.replayRetentionDays,
  }).from(analyticsSettings);
  return new Map(rows.map((row) => [row.tenantId, row.days]));
}

/**
 * 全库数据保留策略声明（SSOT）。
 *
 * 新增 append-only 表时必须在此登记，`retention-coverage.test.ts` 会校验覆盖率。
 * 声明的 `defaultDays` 仅在策略首次注册时写入 `retention_policies` 表；
 * 之后管理员在后台调整的值不会被重启覆盖。
 */
export const RETENTION_POLICIES: readonly RetentionPolicyDefinition[] = [
  // ── 系统管理 ───────────────────────────────────────────────────────────────
  {
    key: 'operation_logs',
    title: '操作日志',
    module: '系统管理',
    tableName: 'operation_logs',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '后台写操作的审计留痕，含变更前后快照与响应体，单行体积较大。',
  },
  {
    key: 'login_logs',
    title: '登录日志',
    module: '系统管理',
    tableName: 'login_logs',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '管理端登录 / 登出记录。',
  },
  {
    key: 'ip_access_logs',
    title: 'IP 拦截日志',
    module: '系统管理',
    tableName: 'ip_access_logs',
    timeColumn: 'created_at',
    defaultDays: 90,
    description: 'IP 黑白名单拦截流水。',
  },
  {
    key: 'login_risk_events',
    title: '登录风险事件',
    module: '系统管理',
    tableName: 'login_risk_events',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '异地 / 异常设备等登录风险识别记录。',
  },
  {
    key: 'license_events',
    title: 'License 事件日志',
    module: '系统管理',
    tableName: 'license_events',
    timeColumn: 'created_at',
    defaultDays: 365,
    description: 'License 激活 / 校验 / 状态迁移 / 功能拒绝等授权审计事件，保留一年便于商务追溯。',
  },
  {
    key: 'identity_provider_sync_logs',
    title: '身份源同步日志',
    module: '系统管理',
    tableName: 'identity_provider_sync_logs',
    timeColumn: 'started_at',
    defaultDays: 90,
    description: '企业身份源（OIDC / SAML / LDAP）用户同步运行记录。',
  },
  {
    key: 'directory_sync_runs',
    title: '通讯录同步记录',
    module: '通讯录同步',
    tableName: 'directory_sync_runs',
    timeColumn: 'started_at',
    defaultDays: 90,
    description: '通讯录同步的运行记录；差异明细（directory_sync_run_items）随记录级联删除。',
  },
  {
    key: 'maintenance_logs',
    title: '维护记录',
    module: '系统管理',
    tableName: 'maintenance_logs',
    timeColumn: 'created_at',
    defaultDays: 365,
    description: '维护模式开启至关闭的时段记录。',
  },
  {
    key: 'db_admin_query_history',
    title: '数据库查询历史',
    module: '系统管理',
    tableName: 'db_admin_query_history',
    timeColumn: 'executed_at',
    defaultDays: 90,
    description: '数据库管理台的 SQL 执行历史。',
  },
  {
    key: 'app_release_events',
    title: '应用升级事件',
    module: '系统管理',
    tableName: 'app_release_events',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '客户端检查更新 / 下载 / 安装回执流水，驱动升级看板统计与灰度设备数。',
  },
  {
    key: 'terminal_sessions',
    title: '终端会话记录',
    module: '系统管理',
    tableName: 'terminal_sessions',
    timeColumn: 'started_at',
    defaultDays: 180,
    description: 'Web 终端 / SSH / Docker 会话的连接审计记录；录屏（terminal_recordings）由独立双策略回收，不受本策略影响。',
  },
  {
    key: 'password_reset_tokens',
    title: '密码重置凭证',
    module: '系统管理',
    tableName: 'password_reset_tokens',
    timeColumn: 'expires_at',
    defaultDays: 7,
    mode: 'expiresAt',
    description: '一次性密码重置凭证；到期后保留数天便于排查，随后删除。',
  },
  {
    key: 'directory_sync_conflicts',
    title: '通讯录同步冲突',
    module: '通讯录同步',
    tableName: 'directory_sync_conflicts',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '同步产生的多重匹配 / 字段冲突记录，含两侧数据快照；超期未裁决的冲突随下次同步重建。',
  },

  // ── 系统调度 ───────────────────────────────────────────────────────────────
  {
    key: 'system_scheduler_runs',
    title: '系统调度运行日志',
    module: '系统调度',
    tableName: 'system_scheduler_runs',
    timeColumn: 'started_at',
    defaultDays: 30,
    mode: 'ageAndCap',
    capColumn: 'task_name',
    capLimit: 1000,
    description: '系统级周期任务的运行记录；按时间裁剪后每个任务再保留最近 1000 条。',
  },
  {
    key: 'cron_job_logs',
    title: '定时任务执行日志',
    module: '系统调度',
    tableName: 'cron_job_logs',
    timeColumn: 'started_at',
    defaultDays: 30,
    mode: 'ageAndCap',
    capColumn: 'job_id',
    capLimit: 500,
    description: '用户自建定时任务的执行记录。',
  },
  {
    key: 'system_scheduler_nodes',
    title: '调度节点注册记录',
    module: '系统调度',
    tableName: 'system_scheduler_nodes',
    timeColumn: 'last_heartbeat_at',
    defaultDays: 7,
    description: '调度/作业 Worker 节点心跳注册表；节点 ID 含进程号，每次重启新增一行，清理心跳停止超过保留期的历史节点。',
  },

  // ── 监控告警 ───────────────────────────────────────────────────────────────
  {
    key: 'system_metric_samples',
    title: '系统指标采样',
    module: '监控告警',
    tableName: 'system_metric_samples',
    timeColumn: 'sampled_at',
    defaultDays: 30,
    description: 'CPU / 内存 / 磁盘等指标采样点，驱动监控趋势图。',
  },
  {
    key: 'monitor_alert_events',
    title: '监控告警事件',
    module: '监控告警',
    tableName: 'monitor_alert_events',
    timeColumn: 'triggered_at',
    defaultDays: 180,
    description: '监控告警的触发与恢复事件。',
  },

  // ── 通知中心 ───────────────────────────────────────────────────────────────
  {
    key: 'email_send_logs',
    title: '邮件发送日志',
    module: '通知中心',
    tableName: 'email_send_logs',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '邮件发送流水，含正文与失败原因。',
  },
  {
    key: 'sms_send_logs',
    title: '短信发送日志',
    module: '通知中心',
    tableName: 'sms_send_logs',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '短信发送流水，含运营商回执状态。',
  },
  {
    key: 'push_send_logs',
    title: 'App 推送发送日志',
    module: '通知中心',
    tableName: 'push_send_logs',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: 'App 推送发送流水，含供应商回执与失败原因。',
  },
  {
    key: 'client_devices',
    title: '不活跃客户端设备',
    module: '通知中心',
    tableName: 'client_devices',
    timeColumn: 'last_active_at',
    defaultDays: 180,
    description: '统一设备中心档案按最近活跃时间裁剪;设备重新上线（升级检查 / 绑定推送）会自动重新登记。',
  },
  {
    key: 'in_app_messages',
    title: '站内信',
    module: '通知中心',
    tableName: 'in_app_messages',
    timeColumn: 'created_at',
    defaultDays: 365,
    description: '站内信收件记录。',
  },
  {
    key: 'notification_outbox',
    title: '通知事件 outbox',
    module: '通知中心',
    tableName: 'notification_outbox',
    timeColumn: 'created_at',
    defaultDays: 90,
    description: '通知事件的暂存与派发队列；正常事件在分钟级内派发完成，超期行均为终态或死信。',
  },
  {
    key: 'notification_dispatches',
    title: '通知派发留痕',
    module: '通知中心',
    tableName: 'notification_dispatches',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '「收件人 × 渠道」的派发决策与结果，含抑制与免打扰归因，是通知排障的第一现场。',
  },

  // ── 数据分析 ───────────────────────────────────────────────────────────────
  {
    key: 'user_events',
    title: '行为埋点事件',
    module: '数据分析',
    tableName: 'user_events',
    timeColumn: 'created_at',
    defaultDays: 180,
    perTenant: analyticsEventRetention,
    description: '原始埋点事件，增长最快的表之一；各租户可在数据分析设置中单独指定保留天数。',
  },
  {
    key: 'analytics_sessions',
    title: '行为会话',
    module: '数据分析',
    tableName: 'analytics_sessions',
    timeColumn: 'started_at',
    defaultDays: 180,
    perTenant: analyticsEventRetention,
    description: '按会话聚合的访问记录，与埋点事件同保留口径。',
  },
  {
    key: 'error_events',
    title: '前端错误事件',
    module: '数据分析',
    tableName: 'error_events',
    timeColumn: 'created_at',
    defaultDays: 90,
    perTenant: analyticsErrorRetention,
    onDeleted: async () => {
      const { purgeOrphanErrorGroups } = await import('../../services/analytics/analytics-rollup.service');
      await purgeOrphanErrorGroups();
    },
    description: '前端 JS 异常上报明细；各租户可单独指定错误保留天数。清理后同步回收无引用的错误分组。',
  },
  {
    key: 'replay_sessions',
    title: '会话回放',
    module: '数据分析',
    tableName: 'replay_sessions',
    timeColumn: 'started_at',
    defaultDays: 30,
    batchSize: 200,
    perTenant: analyticsReplayRetention,
    description: '会话回放录像（rrweb 分片随会话级联删除）；单行体积大，保留期不宜过长。',
  },
  {
    key: 'replay_click_points',
    title: '回放点击热力',
    module: '数据分析',
    tableName: 'replay_click_points',
    timeColumn: 'created_at',
    defaultDays: 90,
    description: '页面点击热力聚合的坐标事实表（与回放会话解耦，回放删除后热力仍可累计分析）。',
  },
  {
    key: 'replay_access_logs',
    title: '回放访问审计',
    module: '数据分析',
    tableName: 'replay_access_logs',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '回放查看行为的合规留痕（谁在什么时候查看了谁的操作录像）。',
  },
  {
    key: 'analytics_event_quality_daily',
    title: '埋点质量日聚合',
    module: '数据分析',
    tableName: 'analytics_event_quality_daily',
    timeColumn: 'stat_date',
    defaultDays: 180,
    description: '随事件采集持续写入的派生聚合，跟随埋点保留口径。',
  },
  {
    key: 'error_alert_logs',
    title: '错误告警日志',
    module: '数据分析',
    tableName: 'error_alert_logs',
    timeColumn: 'created_at',
    defaultDays: 90,
    description: '前端错误告警规则的触发记录。',
  },

  // ── 支付中心 ───────────────────────────────────────────────────────────────
  {
    key: 'payment_notify_logs',
    title: '支付回调日志',
    module: '支付中心',
    tableName: 'payment_notify_logs',
    timeColumn: 'created_at',
    defaultDays: 365,
    description: '渠道异步回调原始报文，用于对账与纠纷举证。',
  },
  {
    key: 'payment_events',
    title: '支付事件 outbox',
    module: '支付中心',
    tableName: 'payment_events',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '支付领域事件投递记录。',
  },
  {
    key: 'payment_risk_hits',
    title: '支付风控命中',
    module: '支付中心',
    tableName: 'payment_risk_hits',
    timeColumn: 'created_at',
    defaultDays: 365,
    description: '支付风控规则命中流水。',
  },

  // ── 会员中心 ───────────────────────────────────────────────────────────────
  {
    key: 'member_login_logs',
    title: '会员登录日志',
    module: '会员中心',
    tableName: 'member_login_logs',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: 'C 端会员登录记录。',
  },
  {
    key: 'member_notifications',
    title: '会员通知',
    module: '会员中心',
    tableName: 'member_notifications',
    timeColumn: 'created_at',
    defaultDays: 365,
    description: '生日礼 / 券到期 / 积分变动等会员站内通知，与管理端站内信同保留口径。',
  },

  // ── 开放平台 ───────────────────────────────────────────────────────────────
  {
    key: 'open_api_call_logs',
    title: '开放 API 调用日志',
    module: '开放平台',
    tableName: 'open_api_call_logs',
    timeColumn: 'created_at',
    defaultDays: 90,
    description: '开放网关调用明细；按日聚合统计由独立任务生成，不受本策略影响。',
  },
  {
    key: 'app_webhook_deliveries',
    title: '开放应用 Webhook 投递',
    module: '开放平台',
    tableName: 'app_webhook_deliveries',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '开放应用 Webhook 的投递与重试记录。',
  },
  {
    key: 'oauth2_tokens',
    title: 'OAuth2 令牌',
    module: '开放平台',
    tableName: 'oauth2_tokens',
    timeColumn: 'expires_at',
    defaultDays: 30,
    mode: 'expiresAt',
    onDeleted: async () => {
      // 令牌随族级联，孤儿令牌族一并回收
      await db.execute(sql`
        DELETE FROM oauth2_token_families f
        WHERE NOT EXISTS (SELECT 1 FROM oauth2_tokens t WHERE t.family_id = f.id)
      `);
    },
    description: '开放平台 OAuth2 access / refresh 令牌；到期后保留一段时间供审计与重放检测，随后连同无引用的令牌族一并删除。',
  },

  // ── 工作流 ─────────────────────────────────────────────────────────────────
  {
    key: 'workflow_engine_health_snapshots',
    title: '流程引擎健康快照',
    module: '工作流',
    tableName: 'workflow_engine_health_snapshots',
    timeColumn: 'created_at',
    defaultDays: 7,
    description: '每 5 分钟采集的引擎健康快照，驱动健康趋势图。',
  },
  {
    key: 'workflow_compensation_logs',
    title: '流程补偿日志',
    module: '工作流',
    tableName: 'workflow_compensation_logs',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '流程节点补偿动作的执行记录。',
  },
  {
    key: 'workflow_automation_runs',
    title: '流程自动化执行记录',
    module: '工作流',
    tableName: 'workflow_automation_runs',
    timeColumn: 'created_at',
    defaultDays: 90,
    description: '自动化规则动作（站内信 / Webhook / 发起流程 / 回写字段）的执行留痕。',
  },
  {
    key: 'workflow_connector_invocations',
    title: '流程连接器调用记录',
    module: '工作流',
    tableName: 'workflow_connector_invocations',
    timeColumn: 'created_at',
    defaultDays: 90,
    description: '连接器（外呼 HTTP）的调用留痕，含耗时、状态码与错误信息。',
  },
  {
    key: 'workflow_tokens',
    title: '流程执行 Token',
    module: '工作流',
    tableName: 'workflow_tokens',
    timeColumn: 'created_at',
    defaultDays: 90,
    mode: 'custom',
    run: async (days, batchSize) => {
      const { cleanupTerminalInstanceTokens } = await import('../../services/workflow/workflow-engine-ops.service');
      return cleanupTerminalInstanceTokens(days, batchSize);
    },
    previewPending: async (days) => {
      const { countTerminalInstanceTokens } = await import('../../services/workflow/workflow-engine-ops.service');
      return countTerminalInstanceTokens(days);
    },
    description: '流程实例的分支执行 Token；仅清理终态（通过/驳回/撤回/取消）超过保留期实例的 token，运行中实例不受影响。',
  },

  // ── 规则中心 ───────────────────────────────────────────────────────────────
  {
    key: 'rule_executions',
    title: '规则执行记录',
    module: '规则中心',
    tableName: 'rule_executions',
    timeColumn: 'created_at',
    defaultDays: 90,
    description: '决策表 / 决策流 / 评分卡 / 名单命中的统一执行流水。',
  },

  // ── 报表中心 ───────────────────────────────────────────────────────────────
  {
    key: 'report_dataset_execution_logs',
    title: '数据集执行日志',
    module: '报表中心',
    tableName: 'report_dataset_execution_logs',
    timeColumn: 'executed_at',
    defaultDays: 90,
    description: '数据集取数执行记录。',
  },
  {
    key: 'report_query_cost_logs',
    title: '查询成本日志',
    module: '报表中心',
    tableName: 'report_query_cost_logs',
    timeColumn: 'occurred_at',
    defaultDays: 90,
    description: '报表查询的耗时与扫描量统计。',
  },
  {
    key: 'report_share_access_logs',
    title: '报表分享访问日志',
    module: '报表中心',
    tableName: 'report_share_access_logs',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '公开分享链接的访问记录。',
  },
  {
    key: 'report_dq_runs',
    title: '数据质量运行记录',
    module: '报表中心',
    tableName: 'report_dq_runs',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '数据质量规则的巡检运行结果。',
  },
  {
    key: 'report_delivery_runs',
    title: '报表分发运行记录',
    module: '报表中心',
    tableName: 'report_delivery_runs',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '报表订阅推送的分发结果。',
  },
  {
    key: 'report_asset_usage_logs',
    title: '报表资产使用日志',
    module: '报表中心',
    tableName: 'report_asset_usage_logs',
    timeColumn: 'occurred_at',
    defaultDays: 180,
    description: '报表资产的引用与访问统计。',
  },
  {
    key: 'report_dq_anomalies',
    title: '数据质量异常明细',
    module: '报表中心',
    tableName: 'report_dq_anomalies',
    timeColumn: 'created_at',
    defaultDays: 365,
    description: '数据质量巡检发现的异常工单，含采样数据快照（单行体积较大）。',
  },
  {
    key: 'report_sla_violations',
    title: '报表 SLA 违约记录',
    module: '报表中心',
    tableName: 'report_sla_violations',
    timeColumn: 'created_at',
    defaultDays: 365,
    description: 'SLA 规则的违约事件与处置留痕。',
  },

  // ── CMS 内容管理 ───────────────────────────────────────────────────────────
  {
    key: 'cms_visit_logs',
    title: 'CMS 访问日志',
    module: 'CMS内容管理',
    tableName: 'cms_visit_logs',
    timeColumn: 'created_at',
    defaultDays: 90,
    description: '前台页面访问流水，驱动内容热度统计。',
  },
  {
    key: 'cms_search_logs',
    title: 'CMS 搜索日志',
    module: 'CMS内容管理',
    tableName: 'cms_search_logs',
    timeColumn: 'created_at',
    defaultDays: 90,
    description: '站内搜索关键词流水。',
  },
  {
    key: 'cms_ad_events',
    title: 'CMS 广告事件',
    module: 'CMS内容管理',
    tableName: 'cms_ad_events',
    timeColumn: 'occurred_at',
    defaultDays: 180,
    description: '广告曝光与点击明细。',
  },
  {
    key: 'cms_content_op_logs',
    title: 'CMS 内容操作日志',
    module: 'CMS内容管理',
    tableName: 'cms_content_op_logs',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '内容的编辑 / 审核 / 发布操作留痕。',
  },
  {
    key: 'cms_push_logs',
    title: 'CMS 推送日志',
    module: 'CMS内容管理',
    tableName: 'cms_push_logs',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '向搜索引擎推送 URL 的结果记录。',
  },
  {
    key: 'cms_member_view_history',
    title: 'CMS 会员浏览历史',
    module: 'CMS内容管理',
    tableName: 'cms_member_view_history',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '会员在前台的内容浏览足迹。',
  },

  // ── 公众号 ─────────────────────────────────────────────────────────────────
  {
    key: 'mp_template_send_logs',
    title: '模板消息发送日志',
    module: '公众号',
    tableName: 'mp_template_send_logs',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '公众号模板消息发送流水。',
  },
  {
    key: 'mp_messages',
    title: '粉丝消息记录',
    module: '公众号',
    tableName: 'mp_messages',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '公众号粉丝收发消息流水（含客服会话消息）。',
  },
  {
    key: 'mp_kf_sessions',
    title: '客服会话',
    module: '公众号',
    tableName: 'mp_kf_sessions',
    timeColumn: 'last_msg_at',
    defaultDays: 365,
    description: '公众号客服会话记录，按最后消息时间裁剪；会话事件（90 天）先行清理，不受级联影响。',
  },
  {
    key: 'mp_kf_session_events',
    title: '客服会话事件',
    module: '公众号',
    tableName: 'mp_kf_session_events',
    timeColumn: 'created_at',
    defaultDays: 90,
    description: '公众号客服会话的接入 / 转接 / 关闭事件。',
  },

  // ── 知识中心 ───────────────────────────────────────────────────────────────
  {
    key: 'wiki_search_logs',
    title: '知识检索日志',
    module: '知识中心',
    tableName: 'wiki_search_logs',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '知识中心搜索关键词与点击流水，供无结果关键词分析与运营统计。',
  },
  {
    key: 'wiki_doc_views',
    title: '知识文档浏览流水',
    module: '知识中心',
    tableName: 'wiki_doc_views',
    timeColumn: 'created_at',
    defaultDays: 180,
    description: '文档浏览明细，驱动热度榜与最近访问；文档上的累计浏览数不受清理影响。',
  },

  // ── 任务中心 ───────────────────────────────────────────────────────────────
  {
    key: 'async_tasks',
    title: '异步任务记录',
    module: '任务中心',
    tableName: 'async_tasks',
    timeColumn: 'completed_at',
    defaultDays: 30,
    mode: 'custom',
    run: async (days) => {
      const { cleanupAsyncTasks } = await import('../task-center');
      return cleanupAsyncTasks(days);
    },
    previewPending: async (days) => {
      const { countCleanableAsyncTasks } = await import('../task-center');
      return countCleanableAsyncTasks(days);
    },
    description: '已结束（成功/失败/已取消）的任务记录，级联清理子项明细；任务类型可在任务中心单独覆盖保留期，本策略作为全局默认值。',
  },
  {
    key: 'export_jobs',
    title: '导出任务记录',
    module: '任务中心',
    tableName: 'export_jobs',
    timeColumn: 'created_at',
    defaultDays: 180,
    mode: 'custom',
    run: async (days, batchSize) => {
      const { purgeExpiredExportJobRecords } = await import('../../services/tasks/export-jobs.service');
      return purgeExpiredExportJobRecords(days, batchSize);
    },
    description: '导出任务记录，级联清理下载留痕；导出文件由「导出文件自动清理」任务按 expires_at 提前回收，此处删行时兜底清理残留文件。',
  },
  {
    key: 'upload_sessions',
    title: '分片上传会话',
    module: '任务中心',
    tableName: 'upload_sessions',
    timeColumn: 'created_at',
    defaultDays: 1,
    mode: 'custom',
    run: async (days) => {
      const { cleanupStaleUploadSessions } = await import('../../services/files/upload-sessions.service');
      const result = await cleanupStaleUploadSessions(days * 24);
      return result.staleSessions;
    },
    description: '超时未完成的分片上传会话；清理时中止云端 multipart、删除临时分片与孤儿目录，级联清理分片记录。',
  },
  {
    key: 'short_link_clicks',
    title: '短链点击明细',
    module: '短链服务',
    tableName: 'short_link_clicks',
    timeColumn: 'clicked_at',
    defaultDays: 180,
    description: '短链访问的原始点击明细；日粒度趋势已由「短链访问日聚合」任务物化到 short_link_daily_stats，超期明细可安全清理（清理后统计详情中的设备/地域/来源分布仅覆盖保留窗口）。',
  },
  {
    key: 'iot_telemetry',
    title: 'IoT 遥测数据',
    module: 'IoT 设备',
    tableName: 'iot_telemetry',
    timeColumn: 'reported_at',
    defaultDays: 30,
    mode: 'custom',
    run: async (days) => {
      const { dropExpiredIotTelemetryPartitions } = await import('../../services/iot/iot-partitions.service');
      return dropExpiredIotTelemetryPartitions(days);
    },
    previewPending: async (days) => {
      const { countExpiredIotTelemetryRows } = await import('../../services/iot/iot-partitions.service');
      return countExpiredIotTelemetryRows(days);
    },
    description: 'IoT 设备上报的原始遥测点位，按 reported_at 日分区存储；清理按「上界早于截止时刻」的分区整表 DROP（秒级、零膨胀），因此实际保留范围会多出不足一天的尾巴。近 24h 图表查明细，长窗口图表与仪表盘读小时聚合表，最新值快照在设备影子，均不受影响。',
  },
  {
    key: 'iot_telemetry_hourly',
    title: 'IoT 遥测小时聚合',
    module: 'IoT 设备',
    tableName: 'iot_telemetry_hourly',
    timeColumn: 'bucket',
    defaultDays: 365,
    description: 'IoT 数值遥测的小时聚合（min/max/avg/last），长窗口图表与仪表盘数据源；聚合粒度已不可再生成明细，保留期应长于明细表。',
  },
  {
    key: 'iot_online_snapshots',
    title: 'IoT 在线率采样',
    module: 'IoT 设备',
    tableName: 'iot_online_snapshots',
    timeColumn: 'sampled_at',
    defaultDays: 90,
    description: 'IoT 设备在线率分钟级采样（仪表盘在线趋势）；仪表盘仅查询近 24 小时窗口，超期数据可安全清理。',
  },
  {
    key: 'iot_device_events',
    title: 'IoT 设备事件流',
    module: 'IoT 设备',
    tableName: 'iot_device_events',
    timeColumn: 'reported_at',
    defaultDays: 180,
    description: 'IoT 设备生命周期事件（上下线/激活/重置密钥）与物模型事件的追加型日志；告警记录独立保存，超期事件可安全清理。',
  },
  {
    key: 'iot_automation_runs',
    title: 'IoT 场景联动执行记录',
    module: 'IoT 设备',
    tableName: 'iot_automation_runs',
    timeColumn: 'created_at',
    defaultDays: 90,
    description: 'IoT 场景联动的执行留痕（触发上下文与动作结果）；联动列表的近 24h 触发计数只查最近窗口，超期记录可安全清理。',
  },
  {
    key: 'iot_forward_logs',
    title: 'IoT 数据流转投递日志',
    module: 'IoT 设备',
    tableName: 'iot_forward_logs',
    timeColumn: 'created_at',
    defaultDays: 30,
    description: 'IoT 数据流转的逐条投递留痕（载荷/响应码/耗时）；规则列表的近 24h 投递数只查最近窗口，超期日志可安全清理。',
  },
  {
    key: 'iot_device_logs',
    title: 'IoT 设备运行日志',
    module: 'IoT 设备',
    tableName: 'iot_device_logs',
    timeColumn: 'reported_at',
    defaultDays: 30,
    description: 'IoT 设备上报的运行日志（调试/诊断用途）；追加型高频写入，超期日志可安全清理。',
  },
  {
    key: 'iot_schedule_runs',
    title: 'IoT 计划任务执行记录',
    module: 'IoT 设备',
    tableName: 'iot_schedule_runs',
    timeColumn: 'created_at',
    defaultDays: 90,
    description: 'IoT 设备计划任务的执行留痕（目标数/成功失败/错误明细）；计划列表的近 24h 执行计数只查最近窗口，超期记录可安全清理。',
  },
  // ── 企业网盘 ───────────────────────────────────────────────────────────────
  {
    key: 'drive_activities',
    title: '网盘文件动态',
    module: '企业网盘',
    tableName: 'drive_activities',
    timeColumn: 'created_at',
    defaultDays: 180,
    mode: 'custom',
    run: async (days) => (await import('../../services/drive/drive-partitions.service')).cleanDriveLogPartitions('drive_activities', days),
    previewPending: async (days) => (await import('../../services/drive/drive-partitions.service')).cleanDriveLogPartitions('drive_activities', days, true),
    description: '网盘上传 / 下载 / 预览 / 分享 / 授权等文件级动态（含外链匿名访问）；管理端审计与文件「动态」面板的数据源，超期记录可安全清理。',
  },
  {
    key: 'drive_share_access_logs',
    title: '网盘外链访问日志',
    module: '企业网盘',
    tableName: 'drive_share_access_logs',
    timeColumn: 'created_at',
    defaultDays: 180,
    mode: 'custom',
    run: async (days) => (await import('../../services/drive/drive-partitions.service')).cleanDriveLogPartitions('drive_share_access_logs', days),
    previewPending: async (days) => (await import('../../services/drive/drive-partitions.service')).cleanDriveLogPartitions('drive_share_access_logs', days, true),
    description: '外链匿名访问留痕（含密码错误 / 过期等被拒绝的尝试）；外链的累计访问次数存于外链行本身，不受清理影响。',
  },
  {
    key: 'drive_nodes',
    title: '网盘回收站到期清理',
    module: '企业网盘',
    tableName: 'drive_nodes',
    timeColumn: 'deleted_at',
    defaultDays: 30,
    mode: 'custom',
    run: async (days) => {
      const { purgeExpiredRecycleNodes } = await import('../../services/drive/drive-nodes.service');
      return purgeExpiredRecycleNodes(days);
    },
    previewPending: async (days) => {
      const { countExpiredRecycleNodes } = await import('../../services/drive/drive-nodes.service');
      return countExpiredRecycleNodes(days);
    },
    description: '回收站中删除时间早于保留期的项目彻底删除：删除节点、版本、授权与外链，释放空间配额并回收无引用的存储对象。天数与「网盘设置 → 回收站保留天数」独立维护，以本策略为准。',
  },
];

export function findPolicy(key: string): RetentionPolicyDefinition | undefined {
  return RETENTION_POLICIES.find((policy) => policy.key === key);
}
