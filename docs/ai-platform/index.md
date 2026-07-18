# AI 能力

本文档介绍**产品内置的 AI 智能对话功能**；面向开发者的 AI 协作（AGENTS.md、Zenith Skill）见 [AI 辅助开发](../ai/index.md)。

---

## 能力总览

| 能力 | 当前实现 |
| --- | --- |
| 智能对话 | 独立「智能对话」页面，支持多轮对话、SSE 流式输出、思维链展示（推理模型）、停止生成、重新生成、编辑后重发、消息删除、会话导出、LLM 自动命名、会话按日期分组与增量加载 |
| 服务商管理 | 管理系统级 AI 服务商配置，字段包括供应商类型、API 地址、API Key、模型、系统提示词、最大 Token、温度、输入/输出单价（成本估算）、默认与启用状态；支持连接测试 |
| 个人 AI 偏好 | 通过 `ai_allow_user_custom_key` 系统配置控制是否展示「我的 AI 配置」入口；用户可维护自己的模型端点与 API Key |
| 使用统计 | 按日期范围统计对话数、回复消息数、输入 / 输出 Token、预估成本、平均首字延迟、请求成功率、活跃用户、模型分布、用户 Top 10 与按日趋势 |
| 提示词模板 | 支持系统级与用户私有模板，包含名称、内容（支持 `{{变量}}` 占位符）、描述、分类、排序、启停、内置标记与使用次数统计；聊天页可将模板应用为当前对话角色 |
| 反馈管理 | 用户可对 AI 回复点赞 / 点踩；点踩可选择原因；管理员可按反馈类型 / 处理状态 / 模型 / 时间筛选，查看反馈人、所属对话与提问上下文，回放对话片段，导出 CSV，并维护处理备注 |
| 用量配额 | 通过 `ai_daily_token_quota` 系统配置设置每用户每日 token 上限（0 = 不限制），超限当日返回 429 |
| 多供应商 | OpenAI Compatible / Anthropic（`/v1/messages`）/ Gemini（`streamGenerateContent`）原生流式适配；一个服务商配置多模型（附加模型 + `/models` API 自动发现）；模型能力标签（vision / tools / 上下文窗口） |
| Function Calling | `capabilities.tools` 开启后模型可调用内置工具（当前时间、我的用量、系统概览），执行过程以折叠卡片展示，最多 5 轮循环；仅 openai_compatible |
| 图片理解 | `capabilities.vision` 开启后聊天输入区出现图片按钮（≤3 张 / 单张 ≤2MB，base64 当轮上下文，不落库） |
| 个人指令 | 用户级 Custom Instructions（关于我 / 回答风格），自动追加到所有对话的 system prompt 末尾 |
| 对话分享 | 生成只读分享链接（永久 / 7 天 / 30 天），免登录访问 `/public/ai-chat/{token}`，按 IP 限流 |
| 模型对比 | Arena 双栏：同一提问并行发给两个模型流式对比，投票结果落库（`ai_arena_votes`） |
| 知识库 RAG | 个人知识库 + 纯文本 / txt / md 文档 / URL 网页抓取，自动分块；配置 `ai_embedding_model` 后向量化（pgvector 可用时走 SQL 向量检索，否则 JS 余弦），混合检索（向量 0.7 + 关键词 0.3 加权），关键词兜底；对话挂载后回答注入引用并展示溯源 |
| 安全合规 | API Key AES-256-GCM 加密存储（`enc:v1:` 前缀，兼容存量明文）；输入侧敏感词过滤（字典「AI 敏感词」+ `ai_content_filter_enabled` 开关）；「对话审计」页跨用户检索消息内容并查看生成调用链 Trace |
| 自定义智能体 | 「智能体」页创建助手：预设提示词 + 指定模型 + 绑定知识库 + 勾选工具 + 开场白与建议问题；支持上架审核（`ai:agent:review`）、智能体市场与一键克隆；从智能体发起的对话自动应用全部预设 |
| HTTP API 工具 | 「AI 工具」页（`ai:tool:list/manage`）把企业内部 / 第三方 HTTP API 注册为 Function Calling 工具（参数 schema + query/body/path 位置映射），与内置工具统一命名空间，出站走 SSRF 防护 |
| 消息分支树 | 对齐 ChatGPT 的消息分支模型（parentId + activeLeafMsgId）：重新生成 / 编辑重发不再删除旧内容而是创建兄弟分支，消息标题行出现「‹ i/n ›」切换器可回看任意分支 |
| 断线续传 | 生成与连接解耦：生成任务后台运行并写入 Redis 缓冲（TTL 10min），刷新页面 / 断网后自动恢复实时输出（`/api/ai/generations/{genId}/stream`）；停止按钮通过 cancel 端点通知服务端保存已生成部分 |
| 对话标签 | 会话菜单可维护最多 10 个自定义标签，标题栏展示，列表接口支持按标签过滤 |
| 模型评测 | 「模型评测」页（`ai:eval:list/manage`）维护评测集（问题 + 期望要点），通过任务中心异步逐题调用指定模型，记录回答 / 耗时 / token，多次运行可对比回归效果 |
| 提示词版本 | 模板内容变更自动留档历史版本，版本抽屉支持查看与一键恢复（恢复前当前内容也会留档） |
| 主备与并发 | 服务商配置支持「降级配置」（首字前失败自动切换一次并推送 failover 事件）与「并发流上限」（超限排队 15s 后报错） |
| 语音交互 | 浏览器原生 TTS 朗读回复（消息操作栏喇叭按钮）与 STT 语音输入（识别结果可编辑后发送）；Chrome / Edge 支持最佳 |
| 图片生成 | 配置 `ai_image_model` 后注册内置 `generate_image` 工具，模型可按需调用系统默认服务商的 `/images/generations` 生成配图 |
| 聊天机器人 | Webhook 机器人属于即时通讯模块，用于向聊天会话投递卡片消息，详见 [即时通讯](../chat/index.md) |

> AI 对话需要可用的系统服务商配置；未指定具体配置时使用启用的系统默认配置。允许用户自带 Key 时，也可以选择有效的个人配置。

---

## 智能对话

### 页面与交互

前端页面菜单路径为 `/ai/chat`。页面采用左右主从布局：

- 左侧为会话列表，按「置顶 / 今天 / 昨天 / 近 7 天 / 更早」分组展示，增量加载（每页 30 条，底部「加载更多」）；支持按标题或消息内容搜索、查看已归档会话、新建会话、重命名、置顶、归档、删除、导出 Markdown / JSON。
- 右侧为对话区，支持双侧气泡、无气泡、用户气泡三种展示模式，以及左右对齐 / 左对齐切换；推理模型（DeepSeek-R1 等）的思维链以可折叠面板展示在回答上方。
- 空会话显示引导问题，包括「介绍一下你能做什么」「帮我写一封简短的请假邮件」等快捷入口。
- 输入区使用 Semi Design `AIChatInput`，支持选择模型和停止生成。模型选择器数据来自 `GET /api/ai/models`（所有登录用户可访问的轻量列表，仅包含启用配置的 `id`、`name`、`model`、`provider`、`isDefault` 字段，不暴露密钥与 API 地址）。

### 流式输出

聊天接口为 `POST /api/ai/conversations/{id}/chat`，注册在 `/api/ai/conversations` 下。接口使用 `streamSSE` 返回服务端事件：

| SSE 事件 | 说明 |
| --- | --- |
| `delta` | 返回增量文本片段，前端实时追加到当前 AI 回复 |
| `reasoning` | 返回推理模型思维链增量（`reasoning_content` / Anthropic thinking），前端在折叠面板中实时展示 |
| `tool_call` | function calling 执行过程（工具名 / 参数 / 结果），前端以折叠卡片展示 |
| `references` | 知识库检索命中的引用（文档名 / 片段 / 相关度），前端展示在回答下方 |
| `done` | 返回 `tokensInput`、`tokensOutput`，表示本次生成结束 |
| `saved` | 返回 `assistantMsgId`，前端据此把临时消息 ID 替换为数据库消息 ID |
| `title` | 首轮对话完成后返回 LLM 自动生成的会话标题 |
| `error` | 返回错误信息，前端将当前回复标记为失败 |

请求体包含：

| 字段 | 说明 |
| --- | --- |
| `message` | 用户消息，长度 1–8192；`regenerate = true` 时可省略 |
| `regenerate` | 可选，重新生成模式：不追加、不保存新的 user 消息，基于已有历史重新回答（要求历史末条为 user 消息，即旧的 assistant 回复已删除），完成后仅保存 assistant 消息 |
| `configSource` | 可选，`system` / `user`，表示使用系统配置或个人配置 |
| `configId` | 可选，指定系统服务商配置 ID 或个人配置 ID；指定已禁用的系统配置会返回 400 |
| `model` | 可选，多模型配置下选择的具体模型（须在该配置的模型列表中） |
| `images` | 可选，vision 图片（data URL base64，≤3 张），仅当轮上下文生效不落库；需模型声明 `capabilities.vision` |

服务端会校验会话归属，读取历史消息并按 Token 预算保留最近上下文。历史消息默认最多读取 50 条，裁剪预算默认 6000 Token。用户主动断开或停止生成时，上游请求会被中断；生成中途出错或中断时，已生成的部分 AI 回复仍会保存。接口按用户限流（内置规则 `ai_chat_send`，默认 15 次 / 分钟，可在「限流规则」页调整）；另受 `ai_daily_token_quota` 每用户每日 token 配额约束（Redis 按自然日计数，0 = 不限制，超限返回 429）。

### 消息与会话管理

对话保存在 `ai_conversations`，消息保存在 `ai_messages`。每次成功生成会写入一条 `user` 消息和一条 `assistant` 消息（重新生成模式只写入 `assistant` 消息）；助手消息会记录生成所用模型、思维链内容（`reasoning`）、输入 / 输出 Token、首字延迟（`ttft_ms`）与总耗时（`duration_ms`）。上游未返回 usage 时（部分兼容网关不支持 `stream_options.include_usage`），服务端按字符数估算 Token 兜底。会话标题默认为「新对话」，首轮回答完成后由系统默认模型异步总结生成标题（不超过 15 字，失败回退为用户消息前 30 字），并通过 `title` 事件推送给前端。

支持的会话与消息操作包括：

- 会话列表（支持 `limit` / `offset` 增量分页）、详情、创建、删除
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
| `openai_compatible` | OpenAI Compatible | 原生支持（tools / vision / reasoning 全能力） |
| `anthropic` | Anthropic | 原生支持（`/v1/messages` + `x-api-key`，支持 vision / thinking） |
| `gemini` | Google Gemini | 原生支持（`models/{model}:streamGenerateContent?alt=sse`，支持 vision） |
| `baidu` | 百度千帆 | 暂未适配（表单中禁用，请通过 OpenAI 兼容网关接入） |

当前流式适配器位于 `packages/server/src/lib/ai/adapters/`。`openai_compatible` 按 `/chat/completions` 协议发送 `stream: true` 的 SSE 请求，并携带 `stream_options: { include_usage: true }` 获取 Token 用量（对不支持该字段的老网关自动降级重试）。

每个配置支持「附加模型」列表（同一服务商多模型，聊天下拉展开为多个条目，发送时通过 `model` 字段指定），可通过 `POST /api/ai/providers/fetch-models` 从供应商 `/models` API 自动发现。能力标签（`capabilities`）声明 vision / tools / 上下文窗口，作为聊天页图片入口与函数调用的开关依据。API Key 以 AES-256-GCM 加密入库（`enc:v1:` 前缀，历史明文兼容读取，重新保存时自动加密；密钥来自 `FIELD_ENCRYPTION_KEY`，未配置时从 `JWT_SECRET` 派生）。

所有指向供应商 `baseUrl` 的出站请求（聊天流、连接测试、模型发现、embedding）均启用 SSRF 防护，默认拒绝解析到内网地址的目标。本地部署模型（如 Ollama）等合法内网地址可通过环境变量 `AI_OUTBOUND_PRIVATE_ALLOWLIST` 放行（逗号分隔的主机名/IP 列表，默认 `127.0.0.1,localhost`）。

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
| `priceInputPerM` | 输入单价（分 / 百万 token），可空；用于用量统计的成本估算 |
| `priceOutputPerM` | 输出单价（分 / 百万 token），可空；用于用量统计的成本估算 |
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

模板字段包括 `name`、`content`、`description`、`category`、`scope`、`userId`、`isBuiltin`、`sort`、`usageCount`、`isEnabled`。管理列表支持分页、范围筛选与名称 / 描述关键词搜索。聊天页通过 `GET /api/ai/prompt-templates/available` 获取所有启用且当前用户可见的模板，并可将模板内容应用为当前会话的 `systemPromptOverride`。

模板内容支持 `{{变量}}` 占位符（如「请把以下内容翻译成{{目标语言}}」）：聊天页应用含变量的模板时会弹出表单逐项填写，替换后再写入对话角色。每次应用会调用 `POST /api/ai/prompt-templates/{id}/use` 累计 `usageCount`，管理列表展示使用次数。

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

统计数据基于 `ai_messages.created_at` 聚合（消息数统一按 `assistant` 角色计），并通过 `ai_conversations` 关联会话用户与供应商快照。模型名称优先使用 `ai_messages.model`，其次使用 `ai_conversations.provider_snapshot->model`，兜底为「未知」。成本按服务商配置的输入 / 输出单价估算（未配置单价的模型不计入）；请求成功率来自 Redis 按日计数（`ai:req:*` / `ai:err:*`，保留 40 天）；首字延迟取 `ai_messages.ttft_ms` 平均值。

返回结构包括：

| 字段 | 说明 |
| --- | --- |
| `overview` | `totalConversations`、`totalMessages`（AI 回复数）、`tokensInput`、`tokensOutput`、`totalTokens`、`activeUsers`、`totalCostFen`（预估成本，分）、`avgTtftMs`、`successRate` |
| `byModel` | 按模型统计回复数、供应商、输入 / 输出 / 总 Token、平均首字延迟、预估成本 |
| `byUser` | 按用户统计 Top 10，包含用户、对话数、回复数、总 Token |
| `trend` | 按日统计回复数与总 Token，日期格式为 `YYYY-MM-DD` |

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

管理员页面菜单路径为 `/ai/feedback`。列表关联展示反馈人（用户名 / 昵称）、所属对话标题与该回复之前最近一条用户提问；支持按反馈类型、处理状态、模型与时间范围筛选。操作列提供：

- **上下文**：`GET /api/ai/conversations/admin/feedback/{msgId}/context` 回放目标消息前 8 条 + 后 2 条的对话片段（被反馈消息高亮标记）。
- **处理**：将反馈状态更新为「待处理」「已处理」或「已忽略」，同时填写处理备注。
- **导出**：`GET /api/ai/conversations/admin/feedback/export` 按当前筛选导出 CSV（上限 10000 条，含提问 / 回复 / 反馈人 / 处理信息）。

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
| 智能对话 | `/ai/chat` | 多轮对话、模型选择、提示词角色、知识库挂载、图片输入、模型对比、个人指令、分享、反馈、会话管理 |
| AI 服务商 | `/ai/providers` | 系统级服务商配置管理、启停、默认切换、连接测试 |
| AI 反馈 | `/ai/feedback` | 反馈筛选与处理 |
| 对话审计 | `/ai/audit` | 跨用户消息内容合规检索、上下文回放（权限 `ai:audit:view`） |
| 知识库 | `/ai/knowledge` | 个人知识库 CRUD、文档管理（粘贴 / txt / md）、分块与检索方式展示（权限 `ai:kb:*`） |
| 提示词模板 | `/ai/prompts` | 模板 CRUD、范围筛选、启停展示 |
| 用量统计 | `/ai/usage` | 概览卡片、趋势图、模型统计、用户 Top 10 |
| 分享只读页 | `/public/ai-chat/{token}` | 免登录只读对话回放（限流 `ai_share_view`） |
| 我的 AI 配置 | 智能对话页侧边弹窗 | 个人配置查看、创建、编辑、删除 |

---

## 相关文档

- [AI 辅助开发](../ai/index.md)
- [即时通讯](../chat/index.md)
- [功能模块](../product/features.md)
