# AI 能力

本文档介绍**产品内置的 AI 智能对话功能**；面向开发者的 AI 协作（AGENTS.md、Zenith Skill）见 [AI 辅助开发](../ai/index.md)。

---

## 能力总览

| 能力 | 当前实现 |
| --- | --- |
| 智能对话 | 独立「智能对话」页面，支持多轮对话、SSE 流式输出、停止生成、重新生成、编辑后重发、消息删除、会话导出 |
| 服务商管理 | 管理系统级 AI 服务商配置，字段包括供应商类型、API 地址、API Key、模型、系统提示词、最大 Token、温度、默认与启用状态；支持连接测试 |
| 个人 AI 偏好 | 通过 `ai_allow_user_custom_key` 系统配置控制是否展示「我的 AI 配置」入口；用户可维护自己的模型端点与 API Key |
| 使用统计 | 按日期范围统计对话数、消息数、输入 / 输出 Token、活跃用户、模型分布、用户 Top 10 与按日趋势 |
| 提示词模板 | 支持系统级与用户私有模板，包含名称、内容、描述、分类、排序、启停和内置标记；聊天页可将模板应用为当前对话角色 |
| 反馈管理 | 用户可对 AI 回复点赞 / 点踩；点踩可选择原因；管理员可按反馈类型与处理状态筛选并维护处理备注 |
| 聊天机器人 | Webhook 机器人属于即时通讯模块，用于向聊天会话投递卡片消息，详见 [即时通讯](../chat/index.md) |

> AI 对话需要可用的系统服务商配置；未指定具体配置时使用启用的系统默认配置。允许用户自带 Key 时，也可以选择有效的个人配置。

---

## 智能对话

### 页面与交互

前端页面菜单路径为 `/ai/chat`。页面采用左右主从布局：

- 左侧为会话列表，支持按标题或消息内容搜索、查看已归档会话、新建会话、重命名、置顶、归档、删除、导出 Markdown / JSON。
- 右侧为对话区，支持双侧气泡、无气泡、用户气泡三种展示模式，以及左右对齐 / 左对齐切换。
- 空会话显示引导问题，包括「介绍一下你能做什么」「帮我写一封简短的请假邮件」等快捷入口。
- 输入区使用 Semi Design `AIChatInput`，支持选择模型和停止生成。模型选择器数据来自 `GET /api/ai/models`（所有登录用户可访问的轻量列表，仅包含启用配置的 `id`、`name`、`model`、`provider`、`isDefault` 字段，不暴露密钥与 API 地址）。

### 流式输出

聊天接口为 `POST /api/ai/conversations/{id}/chat`，注册在 `/api/ai/conversations` 下。接口使用 `streamSSE` 返回服务端事件：

| SSE 事件 | 说明 |
| --- | --- |
| `delta` | 返回增量文本片段，前端实时追加到当前 AI 回复 |
| `done` | 返回 `tokensInput`、`tokensOutput`，表示本次生成结束 |
| `saved` | 返回 `assistantMsgId`，前端据此把临时消息 ID 替换为数据库消息 ID |
| `error` | 返回错误信息，前端将当前回复标记为失败 |

请求体包含：

| 字段 | 说明 |
| --- | --- |
| `message` | 用户消息，长度 1–8192；`regenerate = true` 时可省略 |
| `regenerate` | 可选，重新生成模式：不追加、不保存新的 user 消息，基于已有历史重新回答（要求历史末条为 user 消息，即旧的 assistant 回复已删除），完成后仅保存 assistant 消息 |
| `configSource` | 可选，`system` / `user`，表示使用系统配置或个人配置 |
| `configId` | 可选，指定系统服务商配置 ID 或个人配置 ID；指定已禁用的系统配置会返回 400 |

服务端会校验会话归属，读取历史消息并按 Token 预算保留最近上下文。历史消息默认最多读取 50 条，裁剪预算默认 6000 Token。用户主动断开或停止生成时，上游请求会被中断；生成中途出错或中断时，已生成的部分 AI 回复仍会保存。接口按用户限流（内置规则 `ai_chat_send`，默认 15 次 / 分钟，可在「限流规则」页调整）。

### 消息与会话管理

对话保存在 `ai_conversations`，消息保存在 `ai_messages`。每次成功生成会写入一条 `user` 消息和一条 `assistant` 消息（重新生成模式只写入 `assistant` 消息）；助手消息会记录生成所用模型、输入 Token、输出 Token。上游未返回 usage 时（部分兼容网关不支持 `stream_options.include_usage`），服务端按字符数估算 Token 兜底。会话标题默认为「新对话」，当首轮提问完成后，服务端用用户消息前 30 个字符更新标题。

支持的会话与消息操作包括：

- 会话列表、详情、创建、删除
- 消息历史读取
- 会话重命名、置顶 / 取消置顶、归档 / 取消归档
- 对话级提示词设置与清除
- 导出 Markdown / JSON
- 删除单条 assistant 消息用于重新生成
- 删除指定消息及其之后所有消息

---

## AI 服务商管理

系统级服务商配置页面菜单路径为 `/ai/providers`。

### 支持的供应商类型

供应商类型由 `ai_provider` 枚举定义：

| 枚举值 | 前端显示 | 状态 |
| --- | --- | --- |
| `openai_compatible` | OpenAI Compatible | 原生支持 |
| `anthropic` | Anthropic | 暂未适配（表单中禁用，请通过 OpenAI 兼容网关接入） |
| `gemini` | Google Gemini | 暂未适配（表单中禁用，请通过 OpenAI 兼容网关接入） |
| `baidu` | 百度千帆 | 暂未适配（表单中禁用，请通过 OpenAI 兼容网关接入） |

当前流式适配器位于 `packages/server/src/lib/ai/adapters/`。`openai_compatible` 按 `/chat/completions` 协议发送 `stream: true` 的 SSE 请求，并携带 `stream_options: { include_usage: true }` 获取 Token 用量（对不支持该字段的老网关自动降级重试）；`anthropic` / `gemini` / `baidu` 因协议不兼容会直接返回明确错误，待后续按需扩展适配器。

### 配置字段

| 字段 | 说明 |
| --- | --- |
| `name` | 配置名称，最大 100 字符 |
| `provider` | 供应商类型，默认 `openai_compatible` |
| `baseUrl` | API 地址，最大 500 字符 |
| `apiKey` | API Key，最大 1000 字符；接口返回时脱敏 |
| `model` | 模型名称，最大 100 字符 |
| `systemPrompt` | 系统提示词，系统配置最大 4096 字符 |
| `maxTokens` | 最大 Token，范围 1–128000，默认 4096 |
| `temperature` | 温度参数，数字字符串，默认 `0.7` |
| `isDefault` | 是否默认服务商 |
| `isEnabled` | 是否启用 |

当某个系统配置被设为默认时，服务端会取消其他配置的默认状态。聊天接口未指定配置时使用启用状态下的系统默认配置；没有可用默认配置时返回 503。

### 连接测试

`POST /api/ai/providers/test-connection`（需要 `ai:provider:edit` 权限）使用给定配置向 `{baseUrl}/chat/completions` 发送非流式测试请求，请求内容为一条 `Hi` 消息，`max_tokens` 为 10，超时时间为 15 秒。编辑已有配置时，如果 API Key 为空或为脱敏值，后端会按配置 ID 读取真实密钥进行测试。

---

## 个人 AI 配置

个人配置接口挂载路径为 `/api/ai/user-configs`。

聊天页启动时会读取系统配置 `ai_allow_user_custom_key`：

- `false`：页面只加载系统模型列表，不展示「我的 AI 配置」按钮；服务端同样拒绝 `configSource = user` 的聊天请求（403）。
- `true`：页面展示「我的 AI 配置」入口，并把启用且填写模型的个人配置加入模型选择器。

个人配置字段包括 `name`、`provider`、`baseUrl`、`apiKey`、`model`、`temperature`、`maxTokens`、`systemPrompt`、`isEnabled`。聊天时选择个人配置会传入 `configSource = user` 与对应 `configId`，服务端只允许读取当前登录用户自己的配置，并要求配置启用且包含 API 地址、API Key 和模型名称；个人配置中的 `temperature`、`maxTokens`、`systemPrompt` 会在聊天时生效（对话级角色模板优先于个人 `systemPrompt`）。

> 个人配置的接口响应会对 API Key 做脱敏展示；保存时若提交的是脱敏值，服务端保留原始密钥。

---

## 提示词模板

提示词模板页面菜单路径为 `/ai/prompts`。

模板范围由 `ai_prompt_scope` 枚举定义：

| 枚举值 | 说明 |
| --- | --- |
| `system` | 系统级模板 |
| `user` | 用户私有模板 |

模板字段包括 `name`、`content`、`description`、`category`、`scope`、`userId`、`isBuiltin`、`sort`、`isEnabled`。管理列表支持分页、范围筛选与名称 / 描述关键词搜索。聊天页通过 `GET /api/ai/prompt-templates/available` 获取所有启用且当前用户可见的模板，并可将模板内容应用为当前会话的 `systemPromptOverride`。

内置模板种子数据来自 `SEED_AI_PROMPT_TEMPLATES`，包括：

- 通用助手
- 翻译助手
- 编程助手
- 文案写作
- 内容总结

内置模板 `isBuiltin = true`，服务端禁止删除。

---

## 使用统计

用量统计页面菜单路径为 `/ai/usage`。

统计接口为 `GET /api/ai/usage/stats`，支持查询参数：

| 参数 | 说明 |
| --- | --- |
| `startDate` | 起始日期，格式 `YYYY-MM-DD` |
| `endDate` | 结束日期，格式 `YYYY-MM-DD` |

统计数据基于 `ai_messages.created_at` 聚合，并通过 `ai_conversations` 关联会话用户与供应商快照。模型名称优先使用 `ai_messages.model`，其次使用 `ai_conversations.provider_snapshot->model`，兜底为「未知」。

返回结构包括：

| 字段 | 说明 |
| --- | --- |
| `overview` | `totalConversations`、`totalMessages`、`tokensInput`、`tokensOutput`、`totalTokens`、`activeUsers` |
| `byModel` | 按模型统计消息数、输入 Token、输出 Token、总 Token |
| `byUser` | 按用户统计 Top 10，包含用户、对话数、消息数、总 Token |
| `trend` | 按日统计消息数与总 Token，日期格式为 `YYYY-MM-DD` |

Token 数来自模型响应中的 `usage` 字段；服务商未返回 usage 信息时，对应 Token 计数为 0。

---

## 反馈闭环

用户可在聊天消息操作区对 assistant 回复点赞或点踩。反馈写入 `ai_messages`：

| 字段 | 说明 |
| --- | --- |
| `feedback` | `1` 表示点赞，`-1` 表示点踩，`null` 表示未反馈 |
| `feedbackReason` | 点踩原因；前端预置 `inaccurate`、`irrelevant`、`harmful`、`other` |
| `feedbackStatus` | 处理状态：`pending` / `resolved` / `ignored` |
| `feedbackRemark` | 管理员处理备注 |
| `feedbackHandledAt` | 处理时间 |

点踩时前端会先提交 `feedback = -1`，随后弹窗选择原因。服务端只允许对 assistant 消息提交反馈。点踩反馈默认进入 `pending`，点赞不会写入处理状态。

管理员页面菜单路径为 `/ai/feedback`。页面支持按反馈类型与处理状态筛选，并可将反馈状态更新为「待处理」「已处理」或「已忽略」，同时填写处理备注。

---

## 接口一览

所有 AI 接口均挂载到 `/api/ai/*`。`ai-chat` 与 `ai-conversations` 都挂载在 `/api/ai/conversations`，其中聊天接口为该路径下的流式子路由。

### 对话与消息

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| `GET` | `/api/ai/conversations` | 获取当前用户对话列表，支持 `archived`、`keyword` | 登录用户 |
| `POST` | `/api/ai/conversations` | 新建对话 | 登录用户 |
| `GET` | `/api/ai/conversations/{id}` | 获取对话详情 | 登录用户 |
| `DELETE` | `/api/ai/conversations/{id}` | 删除对话 | 登录用户 |
| `GET` | `/api/ai/conversations/{id}/messages` | 获取消息历史 | 登录用户 |
| `POST` | `/api/ai/conversations/{id}/chat` | SSE 流式对话 | 登录用户 |
| `PUT` | `/api/ai/conversations/{id}/rename` | 重命名对话 | 登录用户 |
| `PUT` | `/api/ai/conversations/{id}/pin` | 置顶 / 取消置顶 | 登录用户 |
| `PUT` | `/api/ai/conversations/{id}/archive` | 归档 / 取消归档 | 登录用户 |
| `PUT` | `/api/ai/conversations/{id}/system-prompt` | 设置对话级提示词 | 登录用户 |
| `GET` | `/api/ai/conversations/{id}/export` | 导出 Markdown / JSON | 登录用户 |
| `DELETE` | `/api/ai/conversations/{id}/messages/{msgId}` | 删除 assistant 消息 | 登录用户 |
| `DELETE` | `/api/ai/conversations/{id}/messages/{msgId}/cascade` | 删除指定消息及其之后所有消息 | 登录用户 |
| `PUT` | `/api/ai/conversations/{id}/messages/{msgId}/feedback` | 提交点赞 / 点踩反馈 | 登录用户 |

### 服务商、个人配置、模板与统计

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| `GET` | `/api/ai/providers` | 获取系统服务商配置列表 | `ai:provider:list` |
| `GET` | `/api/ai/providers/{id}` | 获取系统服务商配置详情 | `ai:provider:list` |
| `POST` | `/api/ai/providers` | 创建系统服务商配置 | `ai:provider:create` |
| `PUT` | `/api/ai/providers/{id}` | 更新系统服务商配置 | `ai:provider:edit` |
| `DELETE` | `/api/ai/providers/{id}` | 删除系统服务商配置 | `ai:provider:delete` |
| `POST` | `/api/ai/providers/{id}/set-default` | 设为默认服务商 | `ai:provider:edit` |
| `POST` | `/api/ai/providers/test-connection` | 测试服务商连接 | 登录用户 |
| `GET` | `/api/ai/user-configs` | 获取我的 AI 配置列表 | 登录用户 |
| `POST` | `/api/ai/user-configs` | 创建我的 AI 配置 | 登录用户 |
| `PUT` | `/api/ai/user-configs/{id}` | 更新我的 AI 配置 | 登录用户 |
| `DELETE` | `/api/ai/user-configs/{id}` | 删除我的 AI 配置 | 登录用户 |
| `GET` | `/api/ai/prompt-templates` | 获取提示词模板列表 | `ai:prompt:list` |
| `GET` | `/api/ai/prompt-templates/available` | 获取聊天页可用模板 | 登录用户 |
| `GET` | `/api/ai/prompt-templates/{id}` | 获取模板详情 | `ai:prompt:list` |
| `POST` | `/api/ai/prompt-templates` | 创建模板 | `ai:prompt:create` |
| `PUT` | `/api/ai/prompt-templates/{id}` | 更新模板 | `ai:prompt:edit` |
| `DELETE` | `/api/ai/prompt-templates/{id}` | 删除模板 | `ai:prompt:delete` |
| `GET` | `/api/ai/usage/stats` | 获取用量统计 | `ai:usage:view` |
| `GET` | `/api/ai/conversations/admin/feedback` | 管理员获取反馈列表 | `ai:feedback:view` |
| `PUT` | `/api/ai/conversations/admin/feedback/{msgId}` | 管理员处理反馈 | `ai:feedback:handle` |

---

## 数据模型

AI 模块表定义在 `packages/server/src/db/schema/ai.ts`。

### 枚举

| 枚举 | 值 | 说明 |
| --- | --- | --- |
| `ai_provider` | `openai_compatible` / `anthropic` / `gemini` / `baidu` | AI 供应商类型 |
| `ai_message_role` | `system` / `user` / `assistant` | 消息角色 |
| `ai_feedback_status` | `pending` / `resolved` / `ignored` | 反馈处理状态 |
| `ai_prompt_scope` | `system` / `user` | 提示词模板范围 |

### 表结构速查

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `ai_provider_configs` | `id`、`name`、`provider`、`base_url`、`api_key`、`model`、`system_prompt`、`max_tokens`、`temperature`、`is_default`、`is_enabled`、审计字段、`created_at`、`updated_at` | 系统级 AI 服务商配置 |
| `ai_conversations` | `id`、`user_id`、`tenant_id`、`title`、`provider_snapshot`、`is_archived`、`is_pinned`、`system_prompt_override`、`created_at`、`updated_at` | 用户 AI 对话主表 |
| `ai_messages` | `id`、`conversation_id`、`role`、`content`、`model`、`tokens_input`、`tokens_output`、`feedback`、`feedback_reason`、`feedback_status`、`feedback_remark`、`feedback_handled_at`、`created_at` | 对话消息与反馈记录 |
| `user_ai_configs` | `id`、`user_id`、`name`、`provider`、`base_url`、`api_key`、`model`、`temperature`、`max_tokens`、`system_prompt`、`is_enabled`、`created_at`、`updated_at` | 用户个人 AI 配置 |
| `ai_prompt_templates` | `id`、`name`、`content`、`description`、`category`、`scope`、`user_id`、`is_builtin`、`sort`、`is_enabled`、审计字段、`created_at`、`updated_at` | 提示词模板 |

用量统计由 `ai_messages`、`ai_conversations` 与 `users` 聚合产生；反馈闭环复用 `ai_messages` 字段，不使用独立反馈表。

对外时间字段通过 `formatDateTime` / `formatNullableDateTime` 输出，格式为 `YYYY-MM-DD HH:mm:ss`。

---

## 前端页面

| 页面 | 路由 | 说明 |
| --- | --- | --- |
| 智能对话 | `/ai/chat` | 多轮对话、模型选择、提示词角色、反馈、会话管理 |
| AI 服务商 | `/ai/providers` | 系统级服务商配置管理、启停、默认切换、连接测试 |
| AI 反馈 | `/ai/feedback` | 反馈筛选与处理 |
| 提示词模板 | `/ai/prompts` | 模板 CRUD、范围筛选、启停展示 |
| 用量统计 | `/ai/usage` | 概览卡片、趋势图、模型统计、用户 Top 10 |
| 我的 AI 配置 | 智能对话页侧边弹窗 | 个人配置查看、创建、编辑、删除 |

---

## 相关文档

- [AI 辅助开发](../ai/index.md)
- [即时通讯](../chat/index.md)
- [功能模块](../product/features.md)
