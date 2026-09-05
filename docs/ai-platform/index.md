# AI 能力

Zenith Admin 的 AI 域基于 **[Mastra](https://mastra.ai/) 框架**构建：模型接入、上下文记忆、RAG 检索、智能体与评测均由 Mastra 运行时承载，业务数据落主库，Mastra 运行数据落同库独立 `mastra` schema。官方 **Mastra Studio** 可直接对接本系统作为调试与观测界面。

> AI 对话需要至少一个启用的系统服务商配置；未指定时使用系统默认配置。用户也可维护个人 AI 配置（与系统配置同构），在聊天中作为私有模型使用。

---

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [智能对话](./chat.md) | 页面交互、SSE 流式、断线续传、消息分支树、推理力度、图片消息、记忆与个性化、分享与竞技场 |
| [模型接入](./providers.md) | Mastra 模型目录、多模型配置、降级链、providerOptions、连接测试、个人 AI 配置 |
| [智能体](./agents.md) | 创建即注册的 Mastra Agent、参数字段、内置智能体、对话集成 |
| [知识库 RAG](./knowledge.md) | 文档 / URL 入库、分块与向量化、PgVector 检索、关键词退化、对话挂载 |
| [工具与函数调用](./tools.md) | HTTP API 工具、内置工具、文生图 |
| [提示词模板](./prompts.md) | 模板管理、`{{变量}}` 占位符、版本管理 |
| [模型评测](./eval.md) | Mastra Datasets / Experiments、打分器（含 LLM-as-judge）、结果对比 |
| [Mastra Studio 与可观测性](./studio.md) | Studio 挂载与鉴权、开发 / 生产部署、traces 与日志 |
| [运营与治理](./operations.md) | 用量统计、反馈闭环、对话审计 |
| [安全与合规](./security.md) | API Key 加密、SSRF 防护、敏感词过滤、限流配额、分享安全 |
| [数据模型与接口速查](./reference.md) | 表结构、权限码、环境变量、接口挂载点 |

---

## 架构总览

```text
前端聊天页 ──POST /api/ai/…/chat──▶ 路由层 ──▶ zenith-chat (Mastra Agent)
                                              │  requestContext 动态注入:
                                              │  模型链 / 提示词 / 工具 / Memory
                                              ├─▶ 模型链(主模型 + fallbacks 逐级降级)
                                              ├─▶ Mastra Memory(近程消息 + 语义召回 + 用户画像)
                                              ├─▶ PgVector(知识库检索)
                                              └─▶ 工具执行(HTTP 工具 / 内置工具)
Mastra Studio ──/api/mastra/*(标准 API)──▶ agents / datasets / experiments / traces
```

- **`zenith-chat`**：系统内置对话 Agent，模型、提示词、工具经 requestContext 按请求动态注入。
- **`agent-{id}`**：业务自定义智能体，CRUD 时同步注册到 Mastra 注册表，可作评测目标、可在 Studio 调试。
- **存储**：`PostgresStoreVNext` + `PgVector` 使用独立连接池，数据落 `mastra` schema。

## 能力总览

| 能力 | 当前实现 |
| --- | --- |
| 智能对话 | 多轮流式对话、思维链展示、停止生成、重新生成、编辑重发、消息分支树、断线续传、LLM 自动命名、标签 / 置顶 / 归档 / 搜索 |
| 模型接入 | Mastra 模型目录（14 个常用服务商 + `custom` 私有 OpenAI 兼容网关）、一个配置多模型、能力标签（vision / tools / contextWindow） |
| 降级链 | 配置级 `fallbacks` 多级级联，每级独立重试次数；5xx / 限流 / 超时自动切换并推送 `failover` 事件 |
| 推理力度 | 七档推理档位（跟随配置 / 厂商默认 / 关闭 / minimal→xhigh），会话级选择 > 智能体设置 > 服务商配置 |
| 记忆 | Mastra Memory：近 20 条消息 + 语义召回（需 embedding 模型）+ working memory 跨对话用户画像（可编辑可清空） |
| 图片消息 | vision 模型图片输入（含粘贴截图），经统一文件存储持久化，刷新后回显 |
| 知识库 RAG | 文本 / URL 入库自动分块，PgVector 向量检索（索引 `kb_{kbId}`），无 embedding 时退化关键词检索，回答注入并持久化引用溯源 |
| 智能体 | instructions / modelSettings / maxSteps / 知识库 / 工具组合，创建即注册为一等 Mastra Agent |
| 函数调用 | HTTP API 工具（管理员零代码注册）+ 内置工具，过程以语义化折叠卡片展示并随消息持久化 |
| 模型评测 | Mastra Datasets / Experiments：数据集版本化、异步实验、code 与 LLM-as-judge 双类打分器 |
| Studio | `/api/mastra/*` 标准 API（鉴权 + `ai:studio:access` 门控），全链路 traces 落库可查 |
| 个性化 | 个人指令（关于我 / 回答风格）、AI 记忆开关与画像编辑、个人 AI 配置 |
| 对话分享 | 只读分享链接（0–365 天，0 = 永久），免登录访问，按 IP 限流 |
| 模型竞技场 | 双栏并行流式对比投票，结果落库 |
| 语音交互 | 浏览器 TTS 朗读与 STT 语音输入（纯前端能力） |
| 运营治理 | 用量统计（消息 / Token / 成本，按模型与用户）、反馈闭环、跨用户对话审计 |
| 安全合规 | API Key AES-256-GCM 加密、出站 SSRF 防护、敏感词过滤、限流与每日 Token 配额 |

## 快速上手

1. **配置服务商**：「AI 服务商」页新建配置——从目录选择服务商（或 `custom` 填私有网关地址），拉取或填写模型清单，测试连接后设为默认并启用。
2. **开始对话**：「智能对话」页发送消息；推理模型自动展示思维链。
3. **进阶能力**（按需开启）：

| 目标 | 操作 |
| --- | --- |
| 函数调用 | 服务商配置勾选 `tools` 能力标签，「AI 工具」页注册 HTTP API |
| 图片理解 | 勾选 `vision` 能力标签 |
| 知识库问答 | 配置 `ai.embeddingModel` → 建知识库传文档 → 对话挂载 |
| 语义召回 / 用户画像 | 配置 `ai.embeddingModel` 后自动启用（画像可在个人设置关闭） |
| 自定义智能体 | 「智能体」页组合 instructions / 模型 / 知识库 / 工具 |
| 模型评测 | 「模型评测」页建数据集 → 发起实验 |
| Studio 调试 | `npm run dev:studio`，详见 [Mastra Studio](./studio.md) |

## 运行时设置速查

模块 `ai`（通用设置页 `/system/settings?module=ai`，服务端 `getSettings('ai')`；机制见[运行时设置](../backend/settings.md)）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `dailyTokenQuota` | `0` | 每用户每日 token 配额（0 = 不限制） |
| `contentFilterEnabled` | `false` | 输入侧敏感词过滤开关 |
| `embeddingModel` | 空 | 向量化模型（知识库检索与语义召回；空 = 关键词检索） |
| `imageModel` | 空 | 图片生成模型（空 = 关闭 generate_image 工具） |

## 相关文档

- [AI 辅助开发](../ai/index.md)（面向开发者的 AGENTS.md / Skill 说明，与本模块无关）
- [即时通讯](../chat/index.md)（Webhook 机器人属于即时通讯模块）
- [功能模块](../product/features.md)
