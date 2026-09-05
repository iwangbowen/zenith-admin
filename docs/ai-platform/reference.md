# 数据模型与接口速查

AI 域的表结构、权限码与配置速查。业务表位于主 schema（`db/schema/ai.ts`），Mastra 运行数据位于独立 `mastra` schema。

---

## 业务表

| 表 | 用途 |
| --- | --- |
| `ai_provider_configs` | 系统服务商配置：providerId / baseUrl / apiKey / headers / models / defaultModel / modelSettings / providerOptions / fallbacks / capabilities / 定价 / 并发上限 |
| `user_ai_configs` | 个人 AI 配置（与系统配置同构的用户子集） |
| `ai_conversations` | 会话：标题 / 标签 / 知识库与智能体绑定 / 系统提示词覆盖 / 激活分支叶子 |
| `ai_messages` | 消息树：parent_id 分支结构 / 思维链 reasoning / 图片引用 images / 工具调用 tool_calls / 知识库引用 kb_references / token 计数 / ttft / trace / 反馈 |
| `ai_user_settings` | 用户 AI 偏好（1:1，JSONB 稀疏文档）：个人指令（关于我 / 回答风格）、记忆开关 |
| `ai_shared_conversations` | 对话分享链接与过期控制 |
| `ai_arena_votes` | 竞技场投票记录 |
| `ai_knowledge_bases` / `ai_kb_documents` / `ai_kb_chunks` | 知识库 / 文档（状态与统计）/ 分块文本（向量在 PgVector） |
| `ai_agents` | 自定义智能体（Mastra AgentConfig 形态） |
| `ai_http_tools` | HTTP 函数调用工具 |
| `ai_prompt_templates` / `ai_prompt_template_versions` | 提示词模板与版本快照 |

## mastra schema

| 内容 | 说明 |
| --- | --- |
| PgVector 向量 | 知识库检索（索引 `kb_{kbId}`）与语义召回 |
| Memory threads / resources | 会话消息镜像与 working memory 用户画像 |
| datasets / experiments | 评测数据集与实验 |
| 日志与 traces | PinoLogger debug 全量与执行链路 spans |

## 权限码

| 权限码 | 说明 |
| --- | --- |
| `ai:provider:list/create/edit/delete` | 服务商配置管理 |
| `ai:kb:list/create/edit/delete` | 知识库管理 |
| `ai:tool:list/manage` | HTTP 工具 |
| `ai:prompt:list/create/edit/delete` | 提示词模板 |
| `ai:eval:list/manage` | 评测数据集与实验 |
| `ai:feedback:view/handle` | 反馈查看与处理 |
| `ai:audit:view` | 对话审计 |
| `ai:usage:view` | 用量统计 |
| `ai:studio:access` | Mastra Studio（`/api/mastra/*`） |

对话、消息、自定义智能体、个人配置、个人设置为用户私有数据，按归属校验，无独立 RBAC 权限码。

## 环境变量与运行时设置

| 项 | 类型 | 说明 |
| --- | --- | --- |
| `AI_OUTBOUND_PRIVATE_ALLOWLIST` | 环境变量 | 出站 SSRF 内网放行清单 |
| `AI_STREAM_IDLE_TIMEOUT_MS` | 环境变量 | 上游流式空闲超时（默认 90 秒） |
| `MASTRA_STUDIO_ALLOW_ANONYMOUS` | 环境变量 | Studio 开发免鉴权（生产强制失效） |
| `FIELD_ENCRYPTION_KEY` | 环境变量 | API Key 加密密钥（64 位 hex，按数据库共享；开发模式缺省用内置开发密钥，其他环境必填） |
| `ai.embeddingModel` | 运行时设置 | 向量化模型（知识库 + 语义召回） |
| `ai.imageModel` | 运行时设置 | 文生图模型（空 = 关闭） |
| `ai.dailyTokenQuota` | 运行时设置 | 每用户每日 token 配额 |
| `ai.contentFilterEnabled` | 运行时设置 | 敏感词过滤开关（词库在字典「AI 敏感词」） |

## 接口挂载点

| 挂载 | 内容 |
| --- | --- |
| `/api/ai/providers*`、`/api/ai/models` | 服务商配置与聊天模型列表 |
| `/api/ai/conversations*`、`/api/ai/generations*` | 会话、消息树、流式对话与续传 |
| `/api/ai/agents*` | 智能体 |
| `/api/ai/knowledge-bases*` | 知识库 |
| `/api/ai/http-tools*` | HTTP 工具 |
| `/api/ai/prompt-templates*` | 提示词模板 |
| `/api/ai/eval/*` | 评测 |
| `/api/ai/arena/*` | 竞技场 |
| `/api/ai/usage`、`/api/ai/audit`、`.../feedback*` | 用量、审计、反馈 |
| `/api/ai/user-configs*`、`/api/ai/settings*` | 个人配置与个人 AI 设置 |
| `/api/ai/public/chat/{token}` | 分享只读页（免登录） |
| `/api/mastra/*` | Mastra 标准 API（Studio 后端） |

## 前端页面

| 路径 | 页面 |
| --- | --- |
| `/ai/chat` | 智能对话 |
| `/ai/providers` | AI 服务商 |
| `/ai/agents` | 智能体 |
| `/ai/knowledge` | 知识库 |
| `/ai/tools` | AI 工具 |
| `/ai/prompts` | 提示词模板 |
| `/ai/eval` | 模型评测 |
| `/ai/usage` | 用量统计 |
| `/ai/audit` | 对话审计 |
| `/ai/feedback` | AI 反馈 |
| `/public/ai-chat/{token}` | 对话分享只读页（免登录） |
