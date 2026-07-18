# 自定义智能体

「智能体」页菜单路径为 `/ai/agents`，对标 GPTs / Coze Bot：把提示词、模型、知识库与工具组合成可复用、可分享的 AI 助手。

---

## 智能体组成

| 字段 | 说明 |
| --- | --- |
| `name` / `avatar` / `description` | 名称、emoji 头像与一句话介绍（市场展示） |
| `systemPrompt` | 系统提示词（必填，最大 8192 字符），定义角色、能力边界与回答风格 |
| `configId` + `model` | 指定服务商配置与具体模型（留空 = 跟随系统默认配置） |
| `temperature` | 温度覆盖（可空） |
| `knowledgeBaseId` | 绑定知识库（软引用，须为创建者本人的知识库） |
| `tools` | 启用的工具名集合（内置 + HTTP 工具，见[工具文档](./tools.md)）；空数组 = 不启用工具 |
| `openingMessage` | 开场白（新对话空状态展示） |
| `suggestedQuestions` | 建议问题（最多 6 条，点击直接发送） |

## 上架审核流

智能体状态机：`private`（私有）→ `pending`（待审核）→ `published`（已上架）/ `rejected`(已驳回)。

- 创建者提交上架（`POST /{id}/publish`）后进入待审核；可随时撤回（`POST /{id}/unpublish`）。
- 具备 `ai:agent:review` 权限的管理员在「上架审核」tab 通过 / 驳回（`POST /{id}/review`）。
- 已上架智能体修改提示词 / 工具 / 知识库等核心内容后自动回到私有状态，需重新提交审核。

## 智能体市场

- 「智能体市场」tab 展示全部已上架且启用的智能体（按使用次数排序，展示创建者）。
- 任何用户可直接与市场智能体对话，或**克隆**为自己的私有副本（`POST /{id}/clone`；不复制知识库绑定，因属主不同）。

## 对话集成

- 智能体卡片「对话」按钮跳转 `/ai/chat?agentId={id}`，自动以该智能体创建新会话（会话标题取智能体名称，`usage_count` +1）。
- 智能体会话生成时自动应用全部预设：系统提示词（对话级角色模板优先）、指定配置与模型、温度、绑定知识库检索、工具白名单。
- 空会话展示智能体头像、开场白与建议问题；标题栏展示智能体徽标。
- 删除智能体后关联对话保留，但不再应用预设（降级为普通对话）。

## 接口一览

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| `GET` | `/api/ai/agents` | 我的智能体列表 | 登录用户 |
| `GET` | `/api/ai/agents/market` | 智能体市场（已上架） | 登录用户 |
| `GET` | `/api/ai/agents/pending` | 待审核列表 | `ai:agent:review` |
| `GET` | `/api/ai/agents/{id}` | 详情（本人任意状态 / 他人仅已上架） | 登录用户 |
| `POST` | `/api/ai/agents` | 创建智能体 | 登录用户 |
| `PUT` | `/api/ai/agents/{id}` | 更新（仅创建者） | 登录用户 |
| `DELETE` | `/api/ai/agents/{id}` | 删除（仅创建者） | 登录用户 |
| `POST` | `/api/ai/agents/{id}/publish` | 提交上架审核 | 登录用户 |
| `POST` | `/api/ai/agents/{id}/unpublish` | 撤回上架 / 取消审核 | 登录用户 |
| `POST` | `/api/ai/agents/{id}/review` | 审核通过 / 驳回 | `ai:agent:review` |
| `POST` | `/api/ai/agents/{id}/clone` | 克隆市场智能体 | 登录用户 |

数据表：`ai_agents`（状态枚举 `ai_agent_status`），会话通过 `ai_conversations.agent_id` 软引用。
