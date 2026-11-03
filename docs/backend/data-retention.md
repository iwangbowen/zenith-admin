# 数据保留

数据保留用于清理日志、事件、临时文件记录和运行痕迹。策略定义位于 `packages/server/src/lib/retention/policies.ts`，执行器位于 `packages/server/src/lib/retention/runner.ts`。

## 数据模型与接口

策略表为 `retention_policies`：

| 字段 | 说明 |
| --- | --- |
| `policy_key` | 策略主键 |
| `enabled` | 是否启用 |
| `retention_days` | 保留天数，0 表示不清理 |
| `batch_size` | 单批删除上限，默认 5000 |
| `last_run_at` | 最近执行时间 |
| `last_deleted` | 最近删除行数 |

接口挂载在 `/api/retention-policies`：

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/` | `system:retention:view` | 策略列表 |
| `PUT` | `/{key}` | `system:retention:edit` | 更新启用状态、保留天数、批大小 |
| `GET` | `/{key}/preview` | `system:retention:view` | 预览待清理行数 |
| `POST` | `/{key}/run` | `system:retention:run` | 立即执行策略 |

## 策略模式

执行器支持四类模式：

- `age`：按时间字段删除早于保留天数的数据；
- `ageAndCap`：按时间保留，同时限制总量；
- `expiresAt`：按过期时间字段删除；
- `custom`：由策略提供自定义清理逻辑。

默认按 `ctid` 分批删除，每批默认 5000 行，最多 200 批。手动执行会调用相同 runner；传入天数覆盖时仍要求天数大于 0。

## 注册与同步

`registerRetentionPolicies()` 会把代码中的策略同步到 `retention_policies`：

- 新策略插入默认天数和批大小；
- 已存在策略保留数据库中的运维配置；
- 代码中移除的策略会清理数据库残留。

系统级任务 `data-retention` 每天 `0 3 * * *` 触发全量数据保留清理。

## 策略清单

策略清单以代码声明与运行时「数据保留」页面为准，主要分组如下：

| 策略 | 默认天数 | 说明 |
| --- | --- | --- |
| `operation_logs` | 180 | 操作日志 |
| `api_access_logs` | 90 | API 请求访问事实与脱敏请求快照，使用全局保留天数 |
| `login_logs` | 180 | 管理员登录日志 |
| `ip_access_logs` | 90 | IP 拦截日志 |
| `login_risk_events` | 180 | 登录风险事件 |
| `license_events` | 365 | License 事件 |
| `identity_provider_sync_logs` | 90 | 身份源同步日志 |
| `directory_sync_runs` | 90 | 通讯录同步运行 |
| `maintenance_logs` | 365 | 维护模式记录 |
| `db_admin_query_history` | 90 | 数据库管理查询历史 |
| `app_release_events` | 180 | 应用发布事件 |
| `terminal_sessions` | 180 | 终端会话 |
| `password_reset_tokens` | 7 | 密码重置 token |
| `directory_sync_conflicts` | 180 | 通讯录同步冲突 |
| `system_scheduler_runs` | 30 | 系统调度运行日志，带数量上限 |
| `cron_job_logs` | 30 | 定时任务日志，带数量上限 |
| `system_scheduler_nodes` | 7 | 调度节点心跳 |
| `system_metric_samples` | 30 | 系统指标样本 |
| `monitor_alert_events` | 180 | 监控告警事件 |
| `email_send_logs` | 180 | 邮件发送日志 |
| `sms_send_logs` | 180 | 短信发送日志 |
| `in_app_messages` | 365 | 站内信 |
| `notification_outbox` | 90 | 通知 outbox |
| `notification_dispatches` | 180 | 通知投递记录 |
| `user_events` | 180 | 用户行为事件（CMS v2 可信事件至少保留 400 天，支撑同比对比） |
| `analytics_sessions` | 180 | 行为分析会话 |
| `error_events` | 90 | 前端错误事件 |
| `analytics_event_quality_daily` | 180 | 埋点质量日报 |
| `error_alert_logs` | 90 | 错误告警日志 |
| `payment_notify_logs` | 365 | 支付通知日志 |
| `payment_risk_hits` | 365 | 支付风控命中 |
| `member_login_logs` | 180 | 会员登录日志 |
| `member_notifications` | 365 | 会员通知 |
| `open_api_call_logs` | 90 | Open API 调用日志 |
| `app_webhook_deliveries` | 180 | 应用 Webhook 投递 |
| `oauth2_tokens` | 30 | 开放平台 OAuth2 token |
| `workflow_engine_health_snapshots` | 7 | 工作流引擎健康快照 |
| `workflow_compensation_logs` | 180 | 工作流补偿日志 |
| `workflow_automation_runs` | 90 | 工作流自动化运行 |
| `workflow_connector_invocations` | 90 | 工作流连接器调用 |
| `workflow_tokens` | 90 | 工作流 token |
| `rule_executions` | 90 | 规则执行记录 |
| `report_dataset_execution_logs` | 90 | 数据集执行日志 |
| `report_query_cost_logs` | 90 | 查询成本日志 |
| `report_share_access_logs` | 180 | 分享访问日志 |
| `report_dq_runs` | 180 | 数据质量运行 |
| `report_delivery_runs` | 180 | 报表投递运行 |
| `report_asset_usage_logs` | 180 | 报表资产使用日志 |
| `report_dq_anomalies` | 365 | 数据质量异常 |
| `report_sla_violations` | 365 | SLA 违规 |
| `cms_visit_logs` | 90 | CMS 访问日志 |
| `cms_search_logs` | 90 | CMS 搜索日志 |
| `cms_ad_events` | 180 | CMS 广告事件 |
| `cms_content_op_logs` | 180 | CMS 内容操作日志 |
| `cms_push_logs` | 180 | CMS 推送日志 |
| `cms_member_view_history` | 180 | CMS 会员浏览历史 |
| `cms_telemetry_receipts` | 90 | CMS 采集接收/拒收/重复诊断 |
| `cms_telemetry_outbox` | 90 | CMS 转化投递记录（仅清理已投递） |
| `mp_template_send_logs` | 180 | 公众号模板消息发送 |
| `mp_messages` | 180 | 公众号消息 |
| `mp_kf_sessions` | 365 | 公众号客服会话 |
| `mp_kf_session_events` | 90 | 公众号客服会话事件 |
| `wiki_search_logs` | 180 | Wiki 搜索日志 |
| `wiki_doc_views` | 180 | Wiki 文档浏览 |
| `async_tasks` | 30 | 异步任务 |
| `export_jobs` | 180 | 导出任务 |
| `upload_sessions` | 1 | 上传会话 |

## 注意事项

- 数据保留策略主要面向日志与运行痕迹，不替代业务归档。
- 需要租户隔离的策略在代码中显式配置 per-tenant 行为。
- 自定义清理策略应保证可重复执行，并返回删除行数。
