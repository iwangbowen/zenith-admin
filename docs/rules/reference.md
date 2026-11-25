# 接口与数据模型速查

本页汇总规则中心的 API、权限码、数据表、枚举和种子数据。字段以 `packages\shared\src\rules` 与 `packages\server\src\db\schema\rules.ts` 为准。

## API 路径

### 决策表

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/rules/decision-tables` | 分页列表 |
| GET | `/api/rules/decision-tables/{id}` | 详情 |
| POST | `/api/rules/decision-tables` | 创建 |
| PUT | `/api/rules/decision-tables/{id}` | 更新 |
| DELETE | `/api/rules/decision-tables/{id}` | 删除 |
| DELETE | `/api/rules/decision-tables/batch` | 批量删除 |
| POST | `/api/rules/decision-tables/{id}/publish` | 发布，可选灰度 |
| POST | `/api/rules/decision-tables/{id}/toggle` | 启用 / 停用 |
| POST | `/api/rules/decision-tables/{id}/gray` | 灰度转正 / 放弃 |
| POST | `/api/rules/decision-tables/{id}/submit-review` | 申请发布 |
| POST | `/api/rules/decision-tables/{id}/review` | 审批发布 |
| POST | `/api/rules/decision-tables/{id}/test` | 编辑态测试求值 |
| POST | `/api/rules/decision-tables/evaluate` | 按 key 手动求值 |
| GET | `/api/rules/decision-tables/{id}/versions` | 版本列表 |
| GET | `/api/rules/decision-tables/{id}/diff` | 版本对比 |
| POST | `/api/rules/decision-tables/{id}/rollback/{version}` | 回滚历史版本 |
| GET | `/api/rules/decision-tables/{id}/usages` | 引用分析 |
| GET | `/api/rules/decision-tables/{id}/stats` | 命中分析 |
| POST | `/api/rules/decision-tables/{id}/shadow-run` | 影子对比 |
| POST | `/api/rules/decision-tables/{id}/simulate` | 批量仿真 |
| GET | `/api/rules/decision-tables/{id}/cases` | 测试用例列表 |
| POST | `/api/rules/decision-tables/{id}/cases` | 新增测试用例 |
| PUT | `/api/rules/decision-tables/{id}/cases/{caseId}` | 更新测试用例 |
| DELETE | `/api/rules/decision-tables/{id}/cases/{caseId}` | 删除测试用例 |
| POST | `/api/rules/decision-tables/{id}/cases/run` | 批量运行用例 |

### 决策流

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/rules/decision-flows` | 分页列表 |
| GET | `/api/rules/decision-flows/{id}` | 详情 |
| POST | `/api/rules/decision-flows` | 创建 |
| PUT | `/api/rules/decision-flows/{id}` | 更新 |
| DELETE | `/api/rules/decision-flows/{id}` | 删除 |
| DELETE | `/api/rules/decision-flows/batch` | 批量删除 |
| POST | `/api/rules/decision-flows/{id}/publish` | 发布 |
| POST | `/api/rules/decision-flows/{id}/toggle` | 启用 / 停用 |
| POST | `/api/rules/decision-flows/{id}/test` | 编辑态测试求值 |
| POST | `/api/rules/decision-flows/evaluate` | 按 key 手动求值 |
| GET | `/api/rules/decision-flows/{id}/versions` | 版本历史 |
| POST | `/api/rules/decision-flows/{id}/rollback/{version}` | 回滚历史版本 |

### 评分卡

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/rules/scorecards` | 分页列表 |
| GET | `/api/rules/scorecards/{id}` | 详情 |
| POST | `/api/rules/scorecards` | 创建 |
| PUT | `/api/rules/scorecards/{id}` | 更新 |
| DELETE | `/api/rules/scorecards/{id}` | 删除 |
| POST | `/api/rules/scorecards/{id}/publish` | 发布 |
| POST | `/api/rules/scorecards/{id}/toggle` | 启用 / 停用 |
| POST | `/api/rules/scorecards/{id}/evaluate` | 编辑态测试求值 |
| POST | `/api/rules/scorecards/evaluate-by-key` | 按 key 运行时求值 |
| GET | `/api/rules/scorecards/{id}/versions` | 版本历史 |
| POST | `/api/rules/scorecards/{id}/rollback/{version}` | 回滚历史版本 |

### 名单库

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/rules/lists` | 分页列表 |
| POST | `/api/rules/lists/check` | 命中检测 |
| POST | `/api/rules/lists` | 创建名单 |
| PUT | `/api/rules/lists/{id}` | 更新名单 |
| DELETE | `/api/rules/lists/{id}` | 删除名单 |
| GET | `/api/rules/lists/{id}/usages` | 引用分析 |
| GET | `/api/rules/lists/{id}/items` | 条目分页列表 |
| POST | `/api/rules/lists/{id}/items` | 新增条目 |
| POST | `/api/rules/lists/{id}/items/batch` | 批量导入条目 |
| DELETE | `/api/rules/lists/{id}/items/{itemId}` | 删除条目 |
| POST | `/api/rules/lists/{id}/items/purge-expired` | 清理过期条目 |

### 执行记录与开放平台

| 方法 | 路径 | 说明 | 权限 / scope |
| --- | --- | --- | --- |
| GET | `/api/rules/executions` | 规则执行记录分页 | `rule:table:list` |
| POST | `/api/open/v1/rules/evaluate` | 开放平台统一求值 | `rules:evaluate` |

## 权限码

| 菜单 | 权限码 | 说明 |
| --- | --- | --- |
| 决策表 | `rule:table:list` | 查询决策表；执行记录页也复用该权限 |
| 决策表 | `rule:table:create` | 新增决策表 |
| 决策表 | `rule:table:update` | 编辑决策表、回滚、测试用例维护 |
| 决策表 | `rule:table:delete` | 删除决策表、批量删除 |
| 决策表 | `rule:table:publish` | 发布、启停、灰度操作、申请发布 |
| 决策表 | `rule:table:evaluate` | 求值测试、测试矩阵运行、仿真、影子对比 |
| 决策表 | `rule:table:approve` | 审批发布 |
| 决策流 | `rule:flow:list` | 查询决策流 |
| 决策流 | `rule:flow:create` | 新增决策流 |
| 决策流 | `rule:flow:update` | 编辑 / 回滚决策流 |
| 决策流 | `rule:flow:delete` | 删除 / 批量删除决策流 |
| 决策流 | `rule:flow:publish` | 发布 / 启停决策流 |
| 决策流 | `rule:flow:evaluate` | 决策流求值测试 |
| 名单库 | `rule:list:list` | 查询名单、条目与引用，执行名单检测 |
| 名单库 | `rule:list:create` | 新增名单 |
| 名单库 | `rule:list:update` | 编辑名单、启停 |
| 名单库 | `rule:list:delete` | 删除名单 |
| 名单库 | `rule:list:item` | 新增、批量导入、删除、清理名单条目 |
| 评分卡 | `rule:scorecard:list` | 查询评分卡与版本 |
| 评分卡 | `rule:scorecard:create` | 新增评分卡 |
| 评分卡 | `rule:scorecard:update` | 编辑、启停、回滚评分卡 |
| 评分卡 | `rule:scorecard:delete` | 删除评分卡 |
| 评分卡 | `rule:scorecard:publish` | 发布评分卡 |
| 评分卡 | `rule:scorecard:evaluate` | 评分卡求值测试 |
| 开放平台 | `rules:evaluate` | 调用开放平台统一求值 |

## 枚举值

| 枚举 | 值 |
| --- | --- |
| 资产类型 `RuleRefKind` | `table`、`flow`、`scorecard`、`list` |
| 执行来源 `RuleExecutionSource` | `runtime`、`manual`、`test`、`open` |
| 决策表命中策略 `RuleHitPolicy` | `first`、`unique`、`priority`、`collect`、`any` |
| 决策表状态 `RuleDecisionStatus` | `draft`、`published`、`disabled` |
| 字段类型 `RuleFieldType` | `string`、`number`、`boolean`、`date` |
| collect 聚合 `RuleCollectAggregate` | `list`、`sum`、`min`、`max`、`count`、`distinct` |
| 求值原因 `RuleEvaluateReason` | `no_match`、`unique_conflict`、`any_conflict` |
| 名单类型 `RuleListType` | `black`、`white`、`grey` |
| 名单匹配 `RuleListMatchMode` | `exact`、`prefix`、`regex` |
| 评分卡分段 `RuleScorecardBandOp` | `range`、`eq`、`in`、`default` |

## 数据表

### `rule_decision_tables`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `key` | 租户内唯一资产键 |
| `name` / `description` | 名称与描述 |
| `category_id` | 工作流分类 ID，可为空 |
| `status` | `draft` / `published` / `disabled` |
| `hit_policy` | 命中策略 |
| `inputs` / `outputs` / `rules` / `settings` | 决策表编辑态 JSON |
| `version` | 当前版本号 |
| `published_at` | 发布时间 |
| `gray_percent` / `gray_dimension` / `gray_version` | 灰度发布配置 |
| `review_status` / `review_requested_by` / `review_requested_at` / `review_comment` | 发布审批状态 |
| `tenant_id` | 租户 ID，空表示平台级 |
| `created_by` / `updated_by` / `created_at` / `updated_at` | 审计字段 |

唯一约束：`(tenant_id, key)`。

### `rule_decision_table_versions`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `table_id` | 决策表 ID |
| `version` | 快照版本 |
| `name` / `description` | 快照名称与描述 |
| `hit_policy` | 快照命中策略 |
| `inputs` / `outputs` / `rules` / `settings` | 发布快照 JSON |
| `published_at` / `published_by` | 发布信息 |
| `tenant_id` | 租户 ID |

唯一约束：`(table_id, version)`。

### `rule_test_cases`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `table_id` | 决策表 ID |
| `name` | 用例名称，表内唯一 |
| `input` | 输入 JSON |
| `expected` | 期望输出 JSON |
| `tenant_id` | 租户 ID |
| `created_by` / `updated_by` / `created_at` / `updated_at` | 审计字段 |

唯一约束：`(table_id, name)`。

### `rule_executions`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `ref_kind` | `table` / `flow` / `scorecard` / `list` |
| `ref_id` | 资产行 ID，可为空 |
| `rule_key` | 资产 key |
| `version` | 求值版本，可为空 |
| `caller` | 调用方标识 |
| `biz_ref` | 业务关联对象 |
| `source` | `runtime` / `manual` / `test` / `open` |
| `matched` | 是否命中 |
| `hit_policy` | 决策表命中策略，可为空 |
| `input` / `outputs` / `matched_row_ids` | 输入、输出与命中行 |
| `created_by` / `tenant_id` / `created_at` | 创建人与租户信息 |

索引：`tenant_id`、`(ref_kind, ref_id)`、`caller`、`biz_ref`。

### `rule_asset_versions`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `ref_kind` | `flow` / `scorecard` |
| `ref_id` | 资产 ID |
| `version` | 快照版本 |
| `snapshot` | 发布快照 JSON |
| `published_by` / `published_at` | 发布信息 |
| `tenant_id` | 租户 ID |

唯一约束：`(ref_kind, ref_id, version)`。

### `rule_decision_flows`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `key` | 租户内唯一资产键 |
| `name` / `description` | 名称与描述 |
| `status` | `draft` / `published` / `disabled` |
| `steps` | 编辑态步骤 JSON |
| `published_steps` | 发布快照步骤 JSON |
| `version` / `published_at` | 版本与发布时间 |
| `tenant_id` | 租户 ID |
| `created_by` / `updated_by` / `created_at` / `updated_at` | 审计字段 |

唯一约束：`(tenant_id, key)`。

### `rule_lists`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `key` | 租户内唯一名单键 |
| `name` / `description` | 名称与描述 |
| `type` | `black` / `white` / `grey` |
| `status` | `enabled` / `disabled` |
| `tenant_id` | 租户 ID |
| `created_by` / `updated_by` / `created_at` / `updated_at` | 审计字段 |

唯一约束：`(tenant_id, key)`。

### `rule_list_items`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `list_id` | 名单 ID |
| `value` | 条目值 |
| `label` | 条目标签 |
| `match_mode` | `exact` / `prefix` / `regex` |
| `expires_at` | 过期时间，可为空 |
| `remark` | 备注 |
| `created_by` / `created_at` | 创建信息 |

唯一约束：`(list_id, value)`；索引：`list_id`。

### `rule_scorecards`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `key` | 租户内唯一评分卡键 |
| `name` / `description` | 名称与描述 |
| `status` | `draft` / `published` / `disabled` |
| `base_score` | 基础分 |
| `variables` / `grades` | 编辑态变量与等级 JSON |
| `published_snapshot` | 发布快照 JSON |
| `version` / `published_at` | 版本与发布时间 |
| `tenant_id` | 租户 ID |
| `created_by` / `updated_by` / `created_at` / `updated_at` | 审计字段 |

唯一约束：`(tenant_id, key)`。

## 菜单种子

规则中心使用 6000 段菜单 ID：

| ID | 标题 | 路由 / 权限 |
| --- | --- | --- |
| 6000 | 规则中心 | 目录 |
| 6010 | 决策表 | `/rules/tables` |
| 6020 | 执行记录 | `/rules/executions` |
| 6030 | 决策流 | `/rules/flows` |
| 6040 | 名单库 | `/rules/lists` |
| 6050 | 评分卡 | `/rules/scorecards` |

操作权限见本页「权限码」。

## 内置资产种子

| 类型 | key | 名称 | 说明 |
| --- | --- | --- | --- |
| 决策表 | `member_level` | 会员等级判定 | 按累计消费金额输出等级与折扣 |
| 决策表 | `payment_risk` | 支付风控策略 | 输出 `action` 与 `reason`，命中后接管支付风控裁决 |
| 决策表 | `dispute_triage` | 交易投诉分流 | 输出 `route`、`priority`、`slaHours` |
| 决策流 | `member_benefit_flow` | 会员权益决策流 | 示例步骤引用 `member_level` |
| 名单 | `risk_blacklist` | 风控黑名单 | 会员认证、支付风控、CMS 提交共用 |
| 名单 | `vip_whitelist` | VIP 白名单 | 可信主体示例 |
| 名单 | `cms_watchlist` | CMS 观察灰名单 | CMS 提交命中后标注观察 |
| 评分卡 | `credit_score` | 信用评分卡 | 基础分 300，按年龄、城市等级、逾期次数打分 |

开放平台 scope 种子包含：`rules:evaluate`（规则求值）。
