# 容量演进与架构触发条件

行为中心阶段 2 的容量策略：默认维持 PostgreSQL 单库单表方案；只有命中明确阈值后，才进入分区或 OLAP 架构演进。

## 现状基线

| 链路 | 当前实现 |
|------|----------|
| 存储 | PostgreSQL 单表存储：`user_events` 原始事件流、`analytics_sessions` 会话聚合、`error_events` 错误事件、`analytics_daily_rollup` 每日预聚合；表定义位于 `packages/server/src/db/schema/analytics.ts` |
| 写路径 | `POST /api/analytics/events` 批量采集（单批最多 100 条）+ 服务端权威语义事件 `trackServerEvent()`；写入 `user_events` 时使用 `eventId` 唯一索引和 `ON CONFLICT DO NOTHING` 幂等 |
| 事务边界 | HTTP 批量采集在事务中写入事件、更新 `analytics_sessions`、upsert 用户画像；服务端事件在事务中写入事件、upsert 用户画像，不创建会话 |
| 读路径 | 行为分析接口按时间范围实时聚合；趋势查询优先读 `analytics_daily_rollup`，当天或缺失日期回退 `user_events`；报表中心通过内置主库数据源复用行为数据集 |
| 保留策略 | `analyticsRetention` 每日 02:00 执行，逐租户读取 `analytics_settings.retentionDays` / `errorRetentionDays`，清理过期事件、会话、错误事件和空错误分组 |
| 观测手段 | 系统监控 `/api/monitor` 暴露全局 HTTP QPS / P95 / 错误率；数据库监控读取 `pg_stat_statements` Top 慢查询（需启用扩展）。当前没有按单个分析接口持久化的 p95 明细表 |

## 架构演进触发条件

满足任一条件才启动架构改造；否则继续使用现状方案。

| 条件 | 阈值 | 观测口径 |
|------|------|----------|
| 原始事件规模 | `user_events` 行数 > 2 亿 | PostgreSQL 统计信息 + 实际计数抽样校验 |
| 分析查询耗时 | 分析类查询 p95 > 3s | 优先看 `/api/monitor` 的 HTTP P95、应用访问日志/网关日志；SQL 侧用慢查询日志与 `pg_stat_statements` 定位慢 SQL |
| 写入峰值 | > 2000 events/s | 采集入口请求量 × 单批事件数，或用 `pg_stat_user_tables.n_tup_ins` 采样估算写入速率 |

### 自查 SQL

行数估算（依赖 `ANALYZE` 后的统计信息，适合快速判断量级）：

```sql
SELECT reltuples::bigint
FROM pg_class
WHERE relname = 'user_events';
```

写入速率采样（60 秒窗口）：

```sql
WITH before AS (
  SELECT n_tup_ins FROM pg_stat_user_tables WHERE relname = 'user_events'
), pause AS (
  SELECT pg_sleep(60)
), after AS (
  SELECT n_tup_ins FROM pg_stat_user_tables WHERE relname = 'user_events'
)
SELECT ((after.n_tup_ins - before.n_tup_ins) / 60.0)::numeric(12,2) AS events_per_second
FROM before, pause, after;
```

慢查询定位（需启用 `pg_stat_statements`；该扩展不保存单次执行样本，下面的 p95 是“归一化 SQL 平均耗时”的 p95，用于找慢查询族，不等同接口真实 p95）：

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

SELECT
  percentile_disc(0.95) WITHIN GROUP (ORDER BY mean_exec_time) AS p95_mean_exec_ms,
  max(mean_exec_time) AS max_mean_exec_ms
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
  AND query ILIKE '%user_events%';
```

Top 慢 SQL：

```sql
SELECT
  calls,
  round(mean_exec_time::numeric, 2) AS mean_ms,
  round(total_exec_time::numeric, 2) AS total_ms,
  left(query, 500) AS query
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
  AND query ILIKE '%user_events%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

> 接口级 p95 以 HTTP 耗时或访问日志为准；数据库 p95 只能解释 SQL 层瓶颈，不能覆盖 Node 计算、网络和序列化开销。

## 演进路径

### 第一级：PostgreSQL 原生优化（先做）

| 项 | 做法 |
|----|------|
| 分区 | 将 `user_events` 改为按月 `RANGE (created_at)` 分区；后续视规模再评估 `analytics_sessions.started_at` 分区 |
| 索引 | 每个分区保留必要 B-tree 索引；对 `created_at` 增加 BRIN 索引，降低超大时间序列表索引体积 |
| 分区裁剪 | 现有分析查询基本都带 `created_at` / `started_at` / `statDate` 范围条件，天然可触发分区裁剪；新增分析 SQL 必须保留时间范围条件 |
| Rollup | `analyticsRollupDaily` 只扫描最近完整自然日，月分区后扫描范围更稳定 |
| Retention | 保留清理从 `DELETE ... WHERE created_at < ...` 演进为 `DROP PARTITION`，避免大事务、膨胀和长时间锁表 |

分区表示例：

```sql
CREATE TABLE user_events_p (
  LIKE user_events INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES
) PARTITION BY RANGE (created_at);

CREATE TABLE user_events_2026_07
  PARTITION OF user_events_p
  FOR VALUES FROM ('2026-07-01 00:00:00') TO ('2026-08-01 00:00:00');

CREATE INDEX user_events_2026_07_created_brin
  ON user_events_2026_07 USING BRIN (created_at);
```

迁移策略：

1. 新建分区表与未来月份分区，补齐唯一约束、索引和默认值。
2. 采集服务并行写旧表与新表，验证 `eventId` 幂等、会话聚合、rollup 结果一致。
3. 按月份回填历史数据，分批校验行数与核心指标。
4. 切换读路径到分区表，保留旧表只读观察一个保留周期。
5. 确认后归档或删除旧表。

### 第二级：写入队列 + OLAP（后做）

只有第一级优化后仍命中阈值，才进入该级别。

| 组件 | 作用 |
|------|------|
| Redis Stream / Kafka | 采集入口快速落队列，削峰填谷；消费者批量写 PostgreSQL / OLAP |
| ClickHouse / Doris | 承接高基数、多维聚合、长周期扫描和高并发分析查询 |
| 查询路由 | 近实时、明细详情、管理操作继续读 PostgreSQL；大范围趋势、分布、漏斗、留存读 OLAP |
| 双写校验 | 按小时/天对账事件数、UV、关键事件名计数，发现偏差后重放队列或回填 |

前置条件与成本：

- 写入峰值长期超过 2000 events/s，或分区后分析查询 p95 仍持续超过 3s。
- 增加队列、消费者、OLAP 集群、备份和容量监控的运维成本。
- 需要处理至少一次投递、重复消费、乱序到达和回填重放；`eventId` 仍作为跨存储幂等键。
- OLAP SQL 方言、时间函数、JSON 查询与 PostgreSQL 不完全一致，报表中心数据集和分析接口需维护查询语义差异。

## 暂不立项能力

### 可视化圈选埋点

| 结论 | 理由 |
|------|------|
| 暂不立项 | 圈选依赖 CSS 选择器 / DOM 路径，Semi Design 组件升级、布局调整、文案变化都会造成版本漂移 |
| 替代方案 | 当前 `data-track` / `elementKey` 声明式埋点已覆盖稳定元素标识，自动点击采集可补足普通交互热度 |
| 重新评估 | 非研发角色需要独立配置关键转化事件，且一个季度内出现多次“发版等待埋点”的阻塞时再评估 |

### Session Replay

| 结论 | 理由 |
|------|------|
| 暂不立项 | 回放数据量远高于事件流，存储、检索、回放链路会显著抬高成本 |
| 隐私合规 | `maskInputs` 只能处理输入值，不足以覆盖页面文本、表格数据、附件预览等回放场景的敏感信息 |
| 运维成本 | 自建 rrweb 需要录制采样、资源裁剪、版本兼容、回放播放器与数据脱敏审计 |
| 替代方案 | 用户时间线、错误面包屑、页面停留、点击分布已能覆盖轻量行为回溯 |
| 重新评估 | 客服/风控/故障排查明确需要“像素级复盘”，且已完成敏感页面分级与回放脱敏策略后再评估 |
