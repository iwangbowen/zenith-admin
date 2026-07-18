# 运营与治理

用量统计、反馈闭环、对话审计与模型评测，构成 AI 能力的运营治理闭环。

---

## 使用统计

用量统计页面菜单路径为 `/ai/usage`（权限 `ai:usage:view`）。

统计接口为 `GET /api/ai/usage/stats`，支持 `startDate` / `endDate`（`YYYY-MM-DD`）查询参数。

统计数据基于 `ai_messages.created_at` 聚合（消息数统一按 `assistant` 角色计），并通过 `ai_conversations` 关联会话用户与供应商快照。模型名称优先使用 `ai_messages.model`，其次使用 `ai_conversations.provider_snapshot->model`，兜底为「未知」。成本按服务商配置的输入 / 输出单价估算（未配置单价的模型不计入）；请求成功率来自 Redis 按日计数（`ai:req:*` / `ai:err:*`，保留 40 天）；首字延迟取 `ai_messages.ttft_ms` 平均值。

返回结构包括：

| 字段 | 说明 |
| --- | --- |
| `overview` | `totalConversations`、`totalMessages`（AI 回复数）、`tokensInput`、`tokensOutput`、`totalTokens`、`activeUsers`、`totalCostFen`（预估成本，分）、`avgTtftMs`、`successRate` |
| `byModel` | 按模型统计回复数、供应商、输入 / 输出 / 总 Token、平均首字延迟、预估成本 |
| `byUser` | 按用户统计 Top 10，包含用户、对话数、回复数、总 Token |
| `trend` | 按日统计回复数与总 Token |

## 用量配额

系统配置 `ai_daily_token_quota` 设置每用户每日 token 上限（输入 + 输出合计，0 = 不限制）。Redis 按自然日计数，超限当日发送消息返回 429。

## 反馈闭环

用户可在聊天消息操作区对 assistant 回复点赞或点踩。反馈写入 `ai_messages`：

| 字段 | 说明 |
| --- | --- |
| `feedback` | `1` 点赞 / `-1` 点踩 / `null` 未反馈 |
| `feedbackReason` | 点踩原因（前端预置 `inaccurate`、`irrelevant`、`harmful`、`other`） |
| `feedbackStatus` | 处理状态：`pending` / `resolved` / `ignored` |
| `feedbackRemark` | 管理员处理备注 |
| `feedbackHandledAt` | 处理时间 |

管理员页面菜单路径为 `/ai/feedback`（权限 `ai:feedback:view` / `ai:feedback:handle`）。列表关联展示反馈人、所属对话标题与该回复之前最近一条用户提问；支持按反馈类型、处理状态、模型与时间范围筛选。操作列提供：

- **上下文**：回放目标消息前 8 条 + 后 2 条的对话片段（被反馈消息高亮）。
- **处理**：更新反馈状态并填写处理备注。
- **导出**：按当前筛选导出 CSV（上限 10000 条）。

## 对话审计与 Trace

「对话审计」页菜单路径为 `/ai/audit`（权限 `ai:audit:view`），跨用户全量检索消息内容（关键词 / 用户 / 角色 / 时间过滤），用于内容合规检查。

assistant 消息记录生成调用链 **trace**（`ai_messages.trace` jsonb）：

| 步骤类型 | 说明 |
| --- | --- |
| `retrieval` | 知识库检索（耗时、命中分块数、top 相关度） |
| `tool_call` | 工具执行（工具名、耗时、参数摘要） |
| `failover` | 主备切换（from → to） |
| `llm_round` | LLM 生成（总耗时、模型、工具轮数、token） |

审计列表操作列「Trace」打开调用链抽屉，逐步骤查看耗时明细，配合首字延迟与总耗时定位性能瓶颈。

## 模型评测

「模型评测」页菜单路径为 `/ai/eval`（权限 `ai:eval:list` / `ai:eval:manage`），用于发版前回归与模型选型对比：

1. **评测集**：维护问题列表（每条含问题与可选期望要点，最多 50 条）。
2. **运行评测**：选择服务商配置与模型后提交，通过[任务中心](../backend/task-center.md)异步逐题调用（非流式，单题超时 60s），支持进度展示、断点续跑与取消；任务类型 `ai-eval-run`。
3. **结果对比**：运行记录保存逐题回答、耗时、token 与失败原因，附平均耗时与总 token；对同一评测集用不同模型分别运行即可横向对比。

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| `GET` | `/api/ai/eval/sets` | 评测集列表 | `ai:eval:list` |
| `POST` | `/api/ai/eval/sets` | 创建评测集 | `ai:eval:manage` |
| `PUT` | `/api/ai/eval/sets/{id}` | 更新评测集 | `ai:eval:manage` |
| `DELETE` | `/api/ai/eval/sets/{id}` | 删除（级联运行记录） | `ai:eval:manage` |
| `POST` | `/api/ai/eval/sets/{id}/run` | 提交评测运行 | `ai:eval:manage` |
| `GET` | `/api/ai/eval/runs` | 运行列表（最近 100 次，可按集过滤） | `ai:eval:list` |
| `GET` | `/api/ai/eval/runs/{id}` | 运行详情（逐题结果） | `ai:eval:list` |
| `DELETE` | `/api/ai/eval/runs/{id}` | 删除运行记录 | `ai:eval:manage` |

数据表：`ai_eval_sets` / `ai_eval_runs`。
