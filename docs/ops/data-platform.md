# 数据库、缓存与保留策略

本页描述数据库管理台、数据库备份、Redis 缓存管理与数据保留策略。

---

## 数据库管理

「数据库管理」（`/system/db-admin`）是页面内 PostgreSQL 工作台，接口前缀为 `/api/db-admin`。权限码按操作分级：

| 权限码 | 说明 |
| --- | --- |
| `system:db-admin:view` | 表结构 / 数据浏览、总览、ER 图、索引健康、对象、查询历史与收藏 |
| `system:db-admin:query` | 执行只读 SQL、取消查询、EXPLAIN |
| `system:db-admin:export` | 表数据与查询结果导出 |
| `system:db-admin:write` | 行级插入 / 更新 / 删除、批量变更、导入、TRUNCATE |
| `system:db-admin:maintain` | 活动连接取消 / 终止、表维护、物化视图刷新 |
| `system:db-admin:terminal` | SQL 控制台内嵌 psql 终端；psql 的 `\!` / `\copy` 等价于服务器 shell，因此同时要求 `system:terminal:execute`（读写模式额外要求 `system:db-admin:write`） |

### 安全边界

- 用户提交的 SQL（控制台、EXPLAIN、CSV / JSON 导出、原生 WHERE 片段）全部在 `BEGIN; SET LOCAL TRANSACTION READ ONLY; SET LOCAL ROLE zenith_readonly; ... ROLLBACK;` 中执行：只读事务由数据库拒绝写语句；`zenith_readonly` 是迁移 0007 创建的 NOLOGIN 最小权限角色（仅 SELECT，无 `pg_read_server_files` / `pg_execute_server_program` 等特权），由 PostgreSQL 自身拒绝 `pg_read_file`、`COPY ... TO PROGRAM`、`lo_export`、`pg_authid` 等越权访问，不依赖应用层正则。
- 提交前经统一闸门（`lib/report-sql-safety.ts` 的 `assertNoDangerousSqlFunctions`）拦截危险函数（服务器端文件 / 程序、`set_config` 篡改角色或超时、`table_to_xml` / `query_to_xml` 按名读表、dblink、后台进程控制等），含引号 / Unicode 转义 / 可执行注释绕过；控制台在此基础上要求每条语句以 SELECT / WITH / EXPLAIN / SHOW / TABLE / VALUES 开头。报表数据集与数据质量自定义 SQL 复用同一套闸门与只读角色。
- 只读角色需要应用数据库用户具备 `CREATEROLE`（或为 superuser）才能在迁移中创建；不满足时迁移只打 WARNING、服务端首次执行用户 SQL 时打 warn 并降级为「只读事务 + 闸门」。运行期新建的 schema 由服务端在首次使用角色前自动补齐 `USAGE` / `SELECT` 授权。
- 每次查询设置 `statement_timeout`（60 秒），防止长查询拖垮数据库。
- 单次查询最多返回 5000 行，超出自动截断。
- 表数据浏览接口对 schema、表、列名做白名单校验，原生 WHERE 片段经语句拼接、注释绕过与危险函数拦截。
- 写入接口拒绝系统 schema（`pg_catalog`、`information_schema` 等）与内置敏感表。

### 能力

- **总览与对象**：数据库版本、大小、连接数等总览（`GET /overview`）；序列、函数、触发器、枚举、扩展清单（`GET /objects`）。
- **表浏览与行编辑**：表列表、表结构、分页行数据（支持原生 WHERE 过滤与排序）；插入、更新、删除行；`POST /batch-mutate` 在单事务中批量插入、更新、删除；`POST /truncate` 截断表。
- **SQL 查询台**：执行只读 SQL（分页返回）、`POST /query/cancel` 取消执行中的查询、`POST /explain` 查看执行计划；查询历史与 SQL 收藏夹 CRUD。
- **psql 终端**：SQL 控制台标签栏可新建「数据库终端」，经 Web 终端基建（`/api/ws/terminal?shell=db-psql`，读写为 `db-psql:rw`）在服务端启动 psql 会话；连接参数由服务端从 `DATABASE_URL` 构造、凭据经环境变量注入 PTY，不下发前端。只读模式以 `PGOPTIONS` 设置 `default_transaction_read_only=on` 并切换到 `zenith_readonly` 角色（防误操作默认值，非权限边界——会话内可 `RESET ROLE`），真正的权限边界是 `system:terminal:execute` + `system:db-admin:terminal`。会话以 `kind='db'` 落库，复用终端会话的录制审计、断线重连、配额与管理员旁观 / 接管。`GET /terminal-availability` 探测服务端 psql 客户端（可用 `PSQL_PATH` 环境变量指定路径）；Demo 模式不可用。
- **导入导出**：`POST /tables/{schema}/{name}/import` 批量导入 CSV / JSON；`GET .../export.csv`、`GET .../export.sql` 导出表数据；`POST /query/export.csv`、`POST /query/export.json` 导出查询结果。
- **ER 图**：`GET /er-diagram` 返回所有外键关系，`GET /er-schema` 返回表、列与外键完整模式。
- **健康与维护**：`GET /index-health` 索引健康；`GET /maintenance/tables` 表维护统计；`POST .../maintenance` 执行 VACUUM / ANALYZE / REINDEX；`POST .../refresh` 刷新物化视图。
- **活动连接**：`GET /activity` 查看 `pg_stat_activity` 活动连接，`POST /activity/{pid}/cancel` 取消查询，`POST /activity/{pid}/terminate` 终止连接。
- **Schema 漂移**：`GET /schema-drift` 将数据库实际结构与 Drizzle schema 对照。

## 数据库备份

「数据库备份」（`/system/db-backups`）接口前缀为 `/api/db-backups`，记录存储在 `db_backups` 表。

| 权限码 | 说明 |
| --- | --- |
| `system:db-backup:list` | 备份列表 |
| `system:db-backup:create` | 创建备份 |
| `system:db-backup:delete` | 删除备份记录 |

备份类型包括 `pg_dump` 与 `drizzle_export`。创建后接口立即返回 `pending`，备份任务异步执行：置 `running`、生成备份文件（服务端 `storage/backups/` 目录）、上传到默认文件存储并登记 `managed_files`（无默认存储时仅保留本地文件）、置 `success` / `failed` 并记录文件大小与耗时。列表支持按状态（`pending` / `running` / `success` / `failed`）与类型筛选。

## Redis 缓存管理

「缓存管理」（`/system/cache`）接口前缀为 `/api/cache`，属于 platform 路由域。权限码：

| 权限码 | 说明 |
| --- | --- |
| `system:cache:list` | 查看 Redis 概览、缓存 key 列表与完整值 |
| `system:cache:update` | 修改字符串缓存值与 TTL |
| `system:cache:delete` | 删除单个、批量、分类或当前命名空间全部缓存 |

缓存服务只操作 `config.redis.keyPrefix` 命名空间内的 key。删除、修改 TTL、修改字符串值和清空操作均记录审计；跨命名空间 key 返回 403。

| 接口 | 说明 |
| --- | --- |
| `GET /api/cache/overview` | Redis 版本、运行时长、连接数、内存、命中率、总 key 数与 key 前缀 |
| `GET /api/cache?keyword=...` | 扫描当前命名空间 key，返回分类、类型、TTL、大小和字符串预览 |
| `GET /api/cache/value?key=...` | 获取完整值；字符串返回原值，hash/list/set/zset 序列化为 JSON 字符串 |
| `PUT /api/cache/ttl` | 修改 TTL，`-1` 表示永久，正整数为秒 |
| `PUT /api/cache/value` | 修改字符串类型缓存值，可保留原 TTL 或指定新 TTL |
| `DELETE /api/cache` | 删除指定 key |
| `DELETE /api/cache/batch` | 批量删除指定 key |
| `DELETE /api/cache/by-category` | 按首段 segment 删除分类缓存 |
| `DELETE /api/cache/all` | 清空当前命名空间所有缓存 |

内置分类覆盖会话 Token、强制下线黑名单、权限缓存、登录失败计数、登录锁定、接口限流计数、限流统计、幂等控制、AI 服务、开放平台限流 / 防重放 / 配额告警、OIDC / SAML 登录状态、工作流自动化 / 连接器、会员会话与安全、公众号凭证、报表中心、埋点分析等 key 前缀。

## 数据保留策略

「数据保留」（`/system/retention`）接口前缀为 `/api/retention-policies`，配置表为 `retention_policies`。策略清单由 `packages\server\src\lib\retention\policies.ts` 以代码声明为准；后台只负责运行期配置读写与手动触发。

| 权限码 | 说明 |
| --- | --- |
| `system:retention:view` | 查看策略与预览待清理行数 |
| `system:retention:edit` | 编辑启用状态、保留天数、单批行数 |
| `system:retention:run` | 立即执行策略 |

| 接口 | 说明 |
| --- | --- |
| `GET /api/retention-policies` | 策略列表 |
| `PUT /api/retention-policies/{key}` | 更新保留策略 |
| `GET /api/retention-policies/{key}/preview` | 预览待清理行数 |
| `POST /api/retention-policies/{key}/run` | 立即执行保留策略 |

清理模式包括：

| 模式 | 说明 |
| --- | --- |
| `age` | 按时间列裁剪超期行 |
| `ageAndCap` | 按时间裁剪后，再按分组列保留最近 N 行 |
| `expiresAt` | 按到期列裁剪；保留天数表示到期后的宽限天数 |
| `custom` | 删除逻辑委托给领域函数，适合跨表条件或文件副作用 |

保留天数 `0` 表示永久保留；单批行数范围为 100–50000。系统调度中的 `data-retention` 任务每天 03:00 统一执行。策略覆盖操作日志、登录日志、IP 拦截、登录风险、License、身份源同步、通讯录同步、维护记录、数据库查询历史、应用升级事件、终端会话、系统调度、定时任务、调度节点、系统指标采样、监控告警事件、通知中心、数据分析、支付中心、会员中心、开放平台、工作流、规则中心与报表中心等追加型或运行流水表。

终端录屏 `terminal_recordings` 由运行时设置 `terminal.recordingRetainDays` 与 `terminal.recordingMaxSizeMb` 双策略清理，不纳入 `retention_policies`。
