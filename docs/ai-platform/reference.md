# 数据模型与接口速查

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
| `ai_agent_status` | `private` / `pending` / `published` / `rejected` | 智能体发布状态 |

### 表结构速查

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `ai_provider_configs` | `provider`、`base_url`、`api_key`（加密）、`model`、`models`、`capabilities`、`price_input_per_m`、`price_output_per_m`、`fallback_config_id`、`max_concurrent`、`is_default`、`is_enabled` | 系统级 AI 服务商配置 |
| `ai_conversations` | `user_id`、`title`、`provider_snapshot`、`is_archived`、`is_pinned`、`system_prompt_override`、`knowledge_base_id`、`agent_id`、`tags`、`active_leaf_msg_id` | 用户 AI 对话主表 |
| `ai_messages` | `conversation_id`、`parent_id`（分支树）、`role`、`content`、`reasoning`、`model`、`tokens_input/output`、`ttft_ms`、`duration_ms`、`feedback*`、`trace` | 对话消息、反馈与调用链 |
| `user_ai_configs` | `user_id`、`provider`、`base_url`、`api_key`、`model`、`temperature`、`max_tokens`、`system_prompt`、`is_enabled` | 用户个人 AI 配置 |
| `ai_prompt_templates` | `name`、`content`、`category`、`scope`、`user_id`、`is_builtin`、`sort`、`usage_count`、`is_enabled` | 提示词模板 |
| `ai_prompt_template_versions` | `template_id`、`version`、`name`、`content`、`created_by` | 模板历史版本快照 |
| `ai_user_preferences` | `user_id`（唯一）、`about_me`、`reply_style`、`is_enabled` | 个人指令（Custom Instructions） |
| `ai_shared_conversations` | `token`（唯一）、`conversation_id`、`user_id`、`expires_at` | 对话分享链接 |
| `ai_arena_votes` | `user_id`、`question`、`model_a`、`model_b`、`winner` | 模型对比投票 |
| `ai_knowledge_bases` | `name`、`user_id`、`embedding_model` | 个人知识库 |
| `ai_kb_documents` | `kb_id`、`name`、`source_url`、`status`、`chunk_count`、`char_count` | 知识库文档 |
| `ai_kb_chunks` | `kb_id`、`doc_id`、`content`、`embedding`（real[]）、`embedding_vec`（pgvector，条件迁移） | 知识库分块 |
| `ai_agents` | `user_id`、`name`、`avatar`、`system_prompt`、`config_id`、`model`、`knowledge_base_id`、`tools`、`opening_message`、`suggested_questions`、`status`、`usage_count` | 自定义智能体 |
| `ai_http_tools` | `name`（唯一）、`description`、`method`、`url_template`、`headers`、`params`、`is_enabled` | HTTP API 工具 |
| `ai_eval_sets` | `name`、`items`（问题 + 期望要点） | 评测集 |
| `ai_eval_runs` | `set_id`、`config_id`、`model`、`status`、`results`、`avg_duration_ms`、`total_tokens` | 评测运行记录 |

对外时间字段通过 `formatDateTime` / `formatNullableDateTime` 输出，格式为 `YYYY-MM-DD HH:mm:ss`。

### Redis Key

| Key | 说明 |
| --- | --- |
| `ai:quota:{userId}:{date}` | 每日 token 配额计数 |
| `ai:req:{date}` / `ai:err:{date}` | 请求 / 失败按日计数（成功率，保留 40 天） |
| `ai:gen:{genId}:events` / `:meta` / `:cancel` | 生成缓冲（SSE 断线续传，TTL 10min） |
| `ai:gen:active:{conversationId}` | 会话进行中的生成任务指针 |

---

## 接口一览

所有 AI 接口均挂载到 `/api/ai/*`。各子域接口详表见对应文档页，此处为挂载点速查：

| 挂载点 | 说明 | 详见 |
| --- | --- | --- |
| `/api/ai/conversations` | 对话 / 消息 / 聊天流 / 分支 / 标签 / 分享 / 知识库挂载 | [智能对话](./chat.md) |
| `/api/ai/generations` | 生成恢复流与停止 | [智能对话](./chat.md) |
| `/api/ai/agents` | 智能体 CRUD / 上架审核 / 市场 / 克隆 | [自定义智能体](./agents.md) |
| `/api/ai/providers`、`/api/ai/models`、`/api/ai/user-configs` | 服务商与个人配置 | [服务商与个人配置](./providers.md) |
| `/api/ai/knowledge-bases` | 知识库与文档 | [知识库 RAG](./knowledge.md) |
| `/api/ai/http-tools` | HTTP 工具 | [工具与函数调用](./tools.md) |
| `/api/ai/prompt-templates` | 提示词模板与版本 | [提示词模板](./prompts.md) |
| `/api/ai/usage`、`/api/ai/audit`、`/api/ai/eval` | 统计 / 审计 / 评测 | [运营与治理](./operations.md) |
| `/api/ai/preferences` | 个人指令 | [智能对话](./chat.md) |
| `/api/ai/arena` | 模型对比（Arena） | [智能对话](./chat.md) |
| `/api/ai/public` | 分享只读页（免登录） | [安全与合规](./security.md) |

### 对话与消息接口详表

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| `GET` | `/api/ai/conversations` | 对话列表（`archived` / `keyword` / `tag` / `limit` / `offset`） | 登录用户 |
| `POST` | `/api/ai/conversations` | 新建对话（可带 `agentId`） | 登录用户 |
| `GET` | `/api/ai/conversations/{id}` | 对话详情 | 登录用户 |
| `DELETE` | `/api/ai/conversations/{id}` | 删除对话 | 登录用户 |
| `GET` | `/api/ai/conversations/{id}/messages` | 消息历史（含分支树 `parentId`） | 登录用户 |
| `POST` | `/api/ai/conversations/{id}/chat` | SSE 流式对话 | 登录用户 |
| `GET` | `/api/ai/conversations/{id}/active-generation` | 进行中的生成任务 | 登录用户 |
| `GET` | `/api/ai/generations/{genId}/stream` | 生成恢复流（断线续传） | 登录用户 |
| `POST` | `/api/ai/generations/{genId}/cancel` | 停止生成 | 登录用户 |
| `PUT` | `/api/ai/conversations/{id}/rename` | 重命名 | 登录用户 |
| `PUT` | `/api/ai/conversations/{id}/pin` | 置顶 / 取消置顶 | 登录用户 |
| `PUT` | `/api/ai/conversations/{id}/archive` | 归档 / 取消归档 | 登录用户 |
| `PUT` | `/api/ai/conversations/{id}/tags` | 更新标签 | 登录用户 |
| `PUT` | `/api/ai/conversations/{id}/active-branch` | 切换消息分支 | 登录用户 |
| `PUT` | `/api/ai/conversations/{id}/system-prompt` | 设置对话级提示词 | 登录用户 |
| `PUT` | `/api/ai/conversations/{id}/knowledge-base` | 挂载 / 取消挂载知识库 | 登录用户 |
| `GET/POST/DELETE` | `/api/ai/conversations/{id}/share` | 查询 / 生成 / 撤销分享 | 登录用户 |
| `GET` | `/api/ai/conversations/{id}/export` | 导出 Markdown / JSON（激活分支） | 登录用户 |
| `DELETE` | `/api/ai/conversations/{id}/messages/{msgId}/cascade` | 删除消息子树 | 登录用户 |
| `PUT` | `/api/ai/conversations/{id}/messages/{msgId}/feedback` | 点赞 / 点踩反馈 | 登录用户 |
| `GET` | `/api/ai/conversations/admin/feedback` | 管理员反馈列表 | `ai:feedback:view` |
| `PUT` | `/api/ai/conversations/admin/feedback/{msgId}` | 管理员处理反馈 | `ai:feedback:handle` |

---

## 前端页面

| 页面 | 路由 | 说明 |
| --- | --- | --- |
| 智能对话 | `/ai/chat` | 多轮对话、分支树、断线续传、模型选择、角色、知识库、图片、语音、Arena、个人指令、分享 |
| 智能体 | `/ai/agents` | 我的智能体 / 市场 / 上架审核 |
| AI 服务商 | `/ai/providers` | 系统级服务商配置、多模型、可靠性、连接测试 |
| AI 反馈 | `/ai/feedback` | 反馈筛选、上下文回放、处理与导出 |
| 对话审计 | `/ai/audit` | 跨用户消息检索、上下文回放、Trace 调用链 |
| 知识库 | `/ai/knowledge` | 知识库 CRUD、文档 / URL 入库、检索方式展示 |
| AI 工具 | `/ai/tools` | HTTP API 工具管理 |
| 提示词模板 | `/ai/prompts` | 模板 CRUD、变量占位符、版本历史 |
| 模型评测 | `/ai/eval` | 评测集维护、异步运行、结果对比 |
| 用量统计 | `/ai/usage` | 概览卡片、趋势图、模型统计、用户 Top 10 |
| 分享只读页 | `/public/ai-chat/{token}` | 免登录只读对话回放 |
