# AI 服务商与个人配置

系统级服务商配置页面菜单路径为 `/ai/providers`。

---

## 支持的供应商类型

供应商类型由 `ai_provider` 枚举定义：

| 枚举值 | 前端显示 | 状态 |
| --- | --- | --- |
| `openai_compatible` | OpenAI Compatible | 原生支持（tools / vision / reasoning 全能力） |
| `anthropic` | Anthropic | 原生支持（`/v1/messages` + `x-api-key`，支持 vision / thinking） |
| `gemini` | Google Gemini | 原生支持（`models/{model}:streamGenerateContent?alt=sse`，支持 vision） |
| `baidu` | 百度千帆 | 暂未适配（表单中禁用，请通过 OpenAI 兼容网关接入） |

当前流式适配器位于 `packages/server/src/lib/ai/adapters/`。`openai_compatible` 按 `/chat/completions` 协议发送 `stream: true` 的 SSE 请求，并携带 `stream_options: { include_usage: true }` 获取 Token 用量（对不支持该字段的老网关自动降级重试）。

## 多模型与能力标签

每个配置支持「附加模型」列表（同一服务商多模型，聊天下拉展开为多个条目，发送时通过 `model` 字段指定），可通过 `POST /api/ai/providers/fetch-models` 从供应商 `/models` API 自动发现。

能力标签（`capabilities`）声明 `vision` / `tools` / `contextWindow`，作为聊天页图片入口与函数调用的开关依据。

## 配置字段

| 字段 | 说明 |
| --- | --- |
| `name` | 配置名称，最大 100 字符 |
| `provider` | 供应商类型，默认 `openai_compatible` |
| `baseUrl` | API 地址，最大 500 字符 |
| `apiKey` | API Key，最大 1000 字符；接口返回时脱敏，AES-256-GCM 加密入库 |
| `model` | 默认模型名称，最大 100 字符 |
| `models` | 附加可选模型列表（最多 50 个） |
| `capabilities` | 能力标签（vision / tools / contextWindow） |
| `systemPrompt` | 系统提示词，最大 4096 字符 |
| `maxTokens` | 最大 Token，范围 1–128000，默认 4096 |
| `temperature` | 温度参数，数字字符串，默认 `0.7` |
| `priceInputPerM` / `priceOutputPerM` | 输入 / 输出单价（分 / 百万 token），可空；用于用量统计的成本估算 |
| `fallbackConfigId` | 降级配置 ID：首字前失败自动切换（见下文可靠性） |
| `maxConcurrent` | 并发流上限（空 / 0 = 不限制） |
| `isDefault` | 是否默认服务商 |
| `isEnabled` | 是否启用 |

当某个系统配置被设为默认时，服务端会取消其他配置的默认状态。聊天接口未指定配置时使用启用状态下的系统默认配置；没有可用默认配置时返回 503。

## 可靠性：主备切换与并发控制

- **主备切换（failover）**：配置了 `fallbackConfigId` 的服务商，在**首个内容 token 产出前**失败（连接错误 / 5xx / 网关异常）时自动切换到降级配置重试一次，并向前端推送 `failover` SSE 事件。降级配置自身的 fallback 不再链式生效；不允许指向自身。
- **并发信号量**：配置了 `maxConcurrent` 的服务商，同时进行的生成流超过上限时新请求排队等待，最长 15 秒后返回「当前模型并发繁忙」错误。信号量为进程内实现（按配置 ID 隔离）。

## 连接测试

`POST /api/ai/providers/test-connection`（需要 `ai:provider:edit` 权限）使用给定配置向 `{baseUrl}/chat/completions` 发送非流式测试请求，请求内容为一条 `Hi` 消息，`max_tokens` 为 10，超时时间为 15 秒。编辑已有配置时，如果 API Key 为空或为脱敏值，后端会按配置 ID 读取真实密钥进行测试。

## 个人 AI 配置

个人配置接口挂载路径为 `/api/ai/user-configs`。

聊天页启动时会读取系统配置 `ai_allow_user_custom_key`：

- `false`：页面只加载系统模型列表，不展示「我的 AI 配置」按钮；服务端同样拒绝 `configSource = user` 的聊天请求（403）。
- `true`：页面展示「我的 AI 配置」入口，并把启用且填写模型的个人配置加入模型选择器。

个人配置字段包括 `name`、`provider`、`baseUrl`、`apiKey`、`model`、`temperature`、`maxTokens`、`systemPrompt`、`isEnabled`。聊天时选择个人配置会传入 `configSource = user` 与对应 `configId`，服务端只允许读取当前登录用户自己的配置，并要求配置启用且包含 API 地址、API Key 和模型名称；个人配置中的 `temperature`、`maxTokens`、`systemPrompt` 会在聊天时生效（对话级角色模板优先于个人 `systemPrompt`）。

> 个人配置的接口响应会对 API Key 做脱敏展示；保存时若提交的是脱敏值，服务端保留原始密钥。

## 接口一览

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| `GET` | `/api/ai/providers` | 配置列表 | `ai:provider:list` |
| `GET` | `/api/ai/providers/{id}` | 配置详情 | `ai:provider:list` |
| `POST` | `/api/ai/providers` | 创建配置 | `ai:provider:create` |
| `PUT` | `/api/ai/providers/{id}` | 更新配置 | `ai:provider:edit` |
| `DELETE` | `/api/ai/providers/{id}` | 删除配置 | `ai:provider:delete` |
| `POST` | `/api/ai/providers/{id}/set-default` | 设为默认 | `ai:provider:edit` |
| `POST` | `/api/ai/providers/test-connection` | 连接测试 | `ai:provider:edit` |
| `POST` | `/api/ai/providers/fetch-models` | 自动发现模型列表 | `ai:provider:edit` |
| `GET` | `/api/ai/models` | 聊天模型轻量列表（不含密钥） | 登录用户 |
| `GET/POST/PUT/DELETE` | `/api/ai/user-configs*` | 个人配置 CRUD | 登录用户 |
