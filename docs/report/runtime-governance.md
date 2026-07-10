# 报表中心统一取数运行时（P1 第一阶段）

## 本阶段完成项

- 仪表盘查看、内部嵌入、公开分享统一走 `POST /api/report/dashboards/{id}/data` / `POST /api/report/public/dashboards/{token}/data`
- 批量返回按组件结构化结果：

```json
{
  "widgetId": {
    "data": { "columns": [], "fields": [], "rows": [], "total": 0 },
    "error": { "code": 400, "message": "数据源已停用" },
    "durationMs": 23,
    "cacheHit": false
  }
}
```

- 数据集取数支持 `limit` 或 `page/pageSize/sortField/sortOrder`
- 表格组件改为服务端分页；其他组件保持 limit 模式
- `ReportDataResult.fields` 贯通表格、图表 tooltip、导出格式化
- 数据源停用后，预览、数据集、仪表盘、打印、预警、订阅、公开分享统一禁止取数
- 数据集执行日志新增后端落库与查询接口：`GET /api/report/executions`
- 手动物化刷新改为任务中心异步任务；周期扫描仍复用同一刷新核心
- 可视化建模支持主表别名、多表 `LEFT/INNER JOIN`、关联字段配置
- 订阅 / 预警统一接入可靠投递：
  - `aggregateReportRows/compare` 下沉到 `@zenith/shared`
  - 手动推送订阅 / 手动评估预警改为任务中心异步任务
  - 定时扫描按 `nextRunAt` + 幂等 claim 执行，不再全表 `cron.prev()` 判断
  - 投递历史与通道明细落库，支持分页查询与告警确认
  - 订阅 / 预警支持 `timezone`、`misfirePolicy(skip/fire_once)`、`nextRunAt`

## 运行时治理约束

### 参数与字段校验

- 参数名 / 字段名 / 计算字段名仅允许标识符格式
- `__` 前缀保留给系统变量
- API 运行参数只允许传递已声明参数
- 计算字段表达式引用未声明字段时拒绝保存

### 缓存

- Redis key 纳入数据集 `updatedAt` 与数据源 `updatedAt`
- 更新配置后不依赖 `SCAN` 才能避免旧缓存命中
- 清理失败会写服务端日志

### 物化

- 手动刷新接口：`POST /api/report/datasets/{id}/materialize`
- 返回任务中心任务实体，可直接查看进度/取消
- 幂等键基于 `datasetId + updatedAt + refreshedAtMs`

### 可靠投递

- 历史表：
  - `report_delivery_runs`
  - `report_delivery_attempts`
- 历史查询接口：`GET /api/report/delivery-runs`
- 告警确认接口：`POST /api/report/delivery-runs/{id}/acknowledge`
- 手动任务接口：
  - `POST /api/report/subscriptions/{id}/run`
  - `POST /api/report/alerts/{id}/evaluate`
- 失败语义：
  - 所有通道成功 → `success`
  - 部分成功 → `partial`
  - 全部失败 → `failed`
  - 取消 → `cancelled`
- 只有全部必需通道成功时才更新：
  - 订阅：`lastRunAt` / `lastSummary`
  - 预警：`lastNotifiedAt`
- 失败不会进入静默窗口；重试使用指数退避并复用同一 delivery run。

## 迁移

- 新增表：`report_dataset_execution_logs`
- 迁移文件：`packages/server/drizzle/0032_slim_black_panther.sql`
- 新增表 / 字段：
  - `report_delivery_runs`
  - `report_delivery_attempts`
  - `report_dashboard_subscriptions.timezone/misfire_policy/next_run_at/last_delivery_*`
  - `report_alert_rules.timezone/misfire_policy/next_run_at/last_delivery_*`
- 迁移文件：`packages/server/drizzle/0033_eager_the_spike.sql`

## P1 第二阶段：发布生命周期 / 分享嵌入 / 协作评论

- 仪表盘新增 `lifecycleStatus(draft/published/offline)`、`revision`、`publishedSnapshot`、`publishedAt/publishedBy`
- `PUT /api/report/dashboards/{id}` 改为**仅保存草稿**，必须携带 `expectedRevision`；冲突返回 `409 + currentRevision`
- 已发布查看、公开分享、匿名嵌入默认读取 `publishedSnapshot`；草稿预览需 `report:dashboard:update`
- 新增：
  - `POST /api/report/dashboards/{id}/publish`
  - `POST /api/report/dashboards/{id}/offline`
  - `GET /api/report/dashboards/{id}/versions/diff`
  - `POST /api/report/public/dashboards/{token}/access`
  - `GET /api/report/public/embed/{token}`
- 公开分享改为**密码换 Redis 短期 access session**，并支持 `maxAccessCount`、`allowedIps`、`allowedCidrs`
- 嵌入支持 scoped embed token：仅允许指定 dashboard + 白名单/固定筛选器
- 评论支持 `parentId`、解决/重开、软删除、分页、组件级评论与回复

## 第二阶段迁移

- 新增枚举/字段/表：
  - `report_dashboards.lifecycle_status/revision/published_*`
  - `report_dashboard_versions.source`
  - `report_dashboard_shares.max_access_count/allowed_ips/allowed_cidrs`
  - `report_dashboard_embed_tokens`
  - `report_dashboard_comments.parent_id/resolved_*/deleted_*`
- 迁移文件：`packages/server/drizzle/0034_rare_warbound.sql`
