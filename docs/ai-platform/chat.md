# 智能对话

前端页面菜单路径为 `/ai/chat`，是 AI 能力的核心入口。

---

## 页面与交互

页面采用左右主从布局：

- 左侧为会话列表，按「置顶 / 今天 / 昨天 / 近 7 天 / 更早」分组展示，增量加载（每页 30 条，底部「加载更多」）；支持按标题或消息内容搜索、按标签过滤、查看已归档会话、新建会话、重命名、置顶、归档、标签维护、分享、导出 Markdown / JSON、删除。
- 右侧为对话区，支持双侧气泡、无气泡、用户气泡三种展示模式，以及左右对齐 / 左对齐切换；推理模型（DeepSeek-R1 等）的思维链以可折叠面板展示在回答上方。
- 空会话显示引导问题（智能体会话则展示智能体开场白与建议问题）。
- 输入区使用 Semi Design `AIChatInput`，支持选择模型和停止生成。模型选择器数据来自 `GET /api/ai/models`（所有登录用户可访问的轻量列表，仅包含启用配置的 `id`、`name`、`model`、`provider`、`isDefault`、`capabilities` 字段，不暴露密钥与 API 地址）。

## 流式输出

聊天接口为 `POST /api/ai/conversations/{id}/chat`。接口使用 `streamSSE` 返回服务端事件：

| SSE 事件 | 说明 |
| --- | --- |
| `gen` | 首个事件，返回本次生成任务的 `genId`（停止生成与断线续传的凭据） |
| `user` | 断线续传回放时返回本轮用户消息内容（发起端已本地渲染，跳过） |
| `delta` | 返回增量文本片段，前端实时追加到当前 AI 回复 |
| `reasoning` | 返回推理模型思维链增量（`reasoning_content` / Anthropic thinking），前端在折叠面板中实时展示 |
| `tool_call` | function calling 执行过程（工具名 / 参数 / 结果），前端以折叠卡片展示 |
| `references` | 知识库检索命中的引用（文档名 / 片段 / 相关度），前端展示在回答下方 |
| `failover` | 主备切换发生时返回 `from` / `to` 模型标识，前端 Toast 提示 |
| `done` | 返回 `tokensInput`、`tokensOutput`，表示本次生成结束 |
| `saved` | 返回 `assistantMsgId` 与 `userMsgId`，前端据此把临时消息 ID 替换为数据库消息 ID |
| `title` | 首轮对话完成后返回 LLM 自动生成的会话标题 |
| `error` | 返回错误信息，前端将当前回复标记为失败 |

请求体包含：

| 字段 | 说明 |
| --- | --- |
| `message` | 用户消息，长度 1–8192；`regenerate = true` 时可省略 |
| `regenerate` | 可选，重新生成模式：不追加新的 user 消息，基于激活路径重新回答，新回复保存为旧回复的**兄弟分支** |
| `parentMsgId` | 可选，编辑重发模式：新 user 消息挂到该父节点形成兄弟分支（`null` = 作为根消息） |
| `configSource` | 可选，`system` / `user`，表示使用系统配置或个人配置 |
| `configId` | 可选，指定系统服务商配置 ID 或个人配置 ID；指定已禁用的系统配置会返回 400 |
| `model` | 可选，多模型配置下选择的具体模型（须在该配置的模型列表中） |
| `images` | 可选，vision 图片（data URL base64，≤3 张），仅当轮上下文生效不落库；需模型声明 `capabilities.vision` |

服务端会校验会话归属，按**当前激活分支路径**读取历史消息并按 Token 预算保留最近上下文（默认最多 50 条、6000 Token）。接口按用户限流（内置规则 `ai_chat_send`，默认 15 次 / 分钟）；另受 `ai_daily_token_quota` 每用户每日 token 配额约束（Redis 按自然日计数，0 = 不限制，超限返回 429）。

## 生成与连接解耦（断线续传）

生成任务与客户端连接完全解耦：

1. 聊天接口收到请求后启动后台生成任务，所有 SSE 事件先写入 Redis 缓冲（key 前缀 `ai:gen:*`，TTL 10 分钟），响应流只是缓冲的实时 tail。
2. 客户端断开（关闭页面 / 断网）不会中断生成；进入会话时前端探测 `GET /api/ai/conversations/{id}/active-generation`，发现进行中任务则调用 `GET /api/ai/generations/{genId}/stream?offset=N` 恢复实时输出。
3. 「停止生成」通过 `POST /api/ai/generations/{genId}/cancel` 通知服务端协作式停止，**已生成的部分内容仍会保存**。
4. 同一会话同时只允许一个生成任务（重复发送返回 429）。

## 消息分支树

消息模型对齐 ChatGPT：`ai_messages.parent_id` 组成树、`ai_conversations.active_leaf_msg_id` 指定当前激活分支的叶子，激活路径 = 叶子的祖先链。历史线性数据（`parent_id` 为空）按时间序推导隐式父节点兼容。

- **重新生成**：新回复保存为旧回复的兄弟分支（同一条 user 消息的多个回答），不再删除旧内容。
- **编辑重发**：新 user 消息挂到被编辑消息的父节点，旧分支完整保留。
- **分支切换**：存在兄弟分支的消息标题行出现「‹ i/n ›」切换器，`PUT /api/ai/conversations/{id}/active-branch` 以目标消息为起点沿最新子分支下探到叶子并激活。
- **消息删除**：`DELETE .../messages/{msgId}/cascade` 删除整个子树（所有后代分支）；若激活叶子位于被删子树内，自动回退到父链最新叶子。
- 导出 Markdown / JSON 仅导出当前激活分支路径。

## 消息与会话管理

对话保存在 `ai_conversations`，消息保存在 `ai_messages`。助手消息会记录生成所用模型、思维链内容（`reasoning`）、输入 / 输出 Token、首字延迟（`ttft_ms`）、总耗时（`duration_ms`）与生成调用链 `trace`。上游未返回 usage 时（部分兼容网关不支持 `stream_options.include_usage`），服务端按字符数估算 Token 兜底。

会话标题默认为「新对话」，首轮回答完成后由系统默认模型异步总结生成标题（不超过 15 字，失败回退为用户消息前 30 字），并通过 `title` 事件推送给前端。

会话支持最多 10 个自定义**标签**（`PUT /{id}/tags`），列表接口支持 `tag` 参数过滤。

## 语音交互

- **TTS 朗读**：assistant 消息操作栏提供喇叭按钮，使用浏览器 `speechSynthesis` 朗读回复（再次点击停止）。
- **STT 语音输入**：输入区麦克风按钮启动浏览器 `SpeechRecognition`（Chrome / Edge 支持最佳），识别结果进入可编辑草稿条，确认后发送。

两者均为纯浏览器能力，不经过服务端，不支持的浏览器会给出提示。

## 个性化与分享

- **个人指令（Custom Instructions）**：头部「个人指令」入口维护「关于我」与「回答风格」（`/api/ai/preferences`），启用后自动追加到所有对话的 system prompt 末尾。
- **对话角色**：头部「角色」下拉应用提示词模板为当前对话的 `systemPromptOverride`，含 `{{变量}}` 的模板会弹出填充表单，详见[提示词模板](./prompts.md)。
- **对话分享**：会话菜单生成只读分享链接（永久 / 7 天 / 30 天，可撤销），免登录访问 `/public/ai-chat/{token}`，按 IP 限流（`ai_share_view`）。
- **模型对比（Arena）**：头部入口打开双栏对比，同一提问并行发给两个模型流式对比，投票结果写入 `ai_arena_votes`。

## 相关文档

- [自定义智能体](./agents.md) — 以智能体预设开启对话
- [知识库 RAG](./knowledge.md) — 对话挂载知识库
- [工具与函数调用](./tools.md) — 对话中的工具执行
