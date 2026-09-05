# 智能对话

前端页面菜单路径为 `/ai/chat`，是 AI 能力的核心入口。对话由内置 Mastra Agent `zenith-chat` 承载，模型、提示词、工具与记忆按请求动态注入。

---

## 页面与交互

页面采用左右主从布局：

- 左侧为会话列表，按「置顶 / 今天 / 昨天 / 近 7 天 / 更早」分组，增量加载；支持按标题或消息内容搜索、标签过滤、归档查看、新建 / 重命名 / 置顶 / 归档 / 标签维护 / 分享 / 导出 / 删除。进入页面默认不选中会话，展示欢迎页。
- 右侧为对话区：思维链以可折叠面板展示在回答上方；每条回复的标题行标注**实际使用的模型**（降级切换后为切换目标）与完整时间。
- 空会话显示引导问题；智能体会话展示智能体开场白与建议问题。
- 输入区配置项：**模型选择**（系统配置 `{configId}:{model}` 与个人配置 `user-{id}:{model}` 逐模型展开）、**推理力度**、**知识库挂载**、**智能体选择**；vision 模型显示图片上传入口。

## 推理力度

输入区「推理力度」下拉共七档：跟随配置（默认空值）、`provider-default`、`none`、`minimal`、`low`、`medium`、`high`、`xhigh`。

- 优先级：**会话选择 > 智能体 modelSettings > 服务商配置**。
- 档位翻译为 providerOptions 的 `reasoningEffort` / `thinking` 请求字段；支持思维链回传的网关将思考过程实时流入折叠面板并持久化（`ai_messages.reasoning`）。

## 流式输出

聊天接口为 `POST /api/ai/conversations/{id}/chat`，以 SSE 返回事件：

| SSE 事件 | 说明 |
| --- | --- |
| `gen` | 首个事件，返回生成任务 `genId`（停止与续传凭据） |
| `delta` | 增量正文文本 |
| `reasoning` | 思维链增量，前端折叠面板实时展示 |
| `tool_call` | 函数调用过程（工具名 / 参数 / 结果），折叠卡片展示 |
| `references` | 知识库检索命中的引用（文档名 / 片段 / 相关度） |
| `failover` | 降级链切换时返回 `from` / `to` 模型标识 |
| `done` | 返回 `tokensInput` / `tokensOutput` |
| `saved` | 返回落库的 `assistantMsgId` / `userMsgId` 与实际模型 |
| `title` | 首轮完成后返回 LLM 自动生成的会话标题 |
| `error` | 错误信息 |

前端对生成中的正文与思维链执行流式 Markdown 自愈，补全未闭合的粗体、斜体、行内代码与链接，完成后按原文渲染。工具调用与知识库引用随 assistant 消息持久化，刷新、续传完成后的回显与审计 / 反馈回放均复用同一套折叠卡片和引用块渲染。

请求体要点：

| 字段 | 说明 |
| --- | --- |
| `message` | 用户消息；`regenerate = true` 时可省略 |
| `regenerate` | 重新生成：基于激活路径重答，新回复保存为旧回复的兄弟分支 |
| `parentMsgId` | 编辑重发：新 user 消息挂到该父节点形成兄弟分支 |
| `model` | 模型标识（系统 / 个人配置逐模型展开后的选择） |
| `reasoning` | 会话级推理档位 |
| `images` | vision 图片；经统一文件存储持久化（`ai_messages.images` 存文件引用），刷新后以稳定 URL 回显，支持粘贴截图直接上传 |

上下文由 **Mastra Memory** 承载：近 20 条消息 + 语义召回（配置 embedding 模型后启用，topK 4）。接口按用户限流（内置规则 `ai_chat_send`），并受运行时设置 `ai.dailyTokenQuota` 每日配额约束。

## 生成与连接解耦（断线续传）

1. 生成任务后台运行，SSE 事件先写 Redis 缓冲，响应流只是缓冲的实时 tail。
2. 断开连接不中断生成；重新进入会话时探测 `GET .../active-generation`，发现进行中任务则 `GET /api/ai/generations/{genId}/stream?offset=N` 续传。
3. 「停止生成」调用 `POST /api/ai/generations/{genId}/cancel` 协作式停止，已生成部分仍保存。
4. 同一会话同时只允许一个生成任务。

## 消息分支树

消息模型对齐 ChatGPT：`ai_messages.parent_id` 组成树，`ai_conversations.active_leaf_msg_id` 指定激活分支叶子。

- **重新生成**：新回复保存为旧回复的兄弟分支，旧回复完整保留。
- **编辑重发**：新 user 消息挂到被编辑消息的父节点。
- **分支切换**：兄弟分支消息出现「‹ i/n ›」切换器，切换后沿最新子分支下探到叶子并激活。
- **消息删除**：支持删除单条 assistant 回复或整个子树；激活叶子位于被删子树内时自动回退。
- 导出 Markdown / JSON 仅导出当前激活分支路径；业务消息账本与 Memory thread 确定性映射，分支操作自动重建镜像。

## 记忆与个性化

头部设置入口打开 **AI 设置**弹窗，两个 Tab：

- **个人指令**：「关于我」与「回答风格」两个文本字段，启用后注入对话系统提示词。
- **AI 记忆**：开关 + 记忆画像编辑。开启后 Mastra working memory（`scope=resource`，按用户物理隔离）由模型自动从对话中维护跨对话画像（称呼 / 职业 / 技术栈 / 偏好 / 长期目标，约束不记录敏感信息），画像可随时查看、编辑、清空。

存储：`ai_user_settings`（用户 1:1，JSONB 稀疏文档）。

## 语音交互

- **TTS 朗读**：assistant 消息操作栏喇叭按钮，浏览器 `speechSynthesis` 朗读（再次点击停止）。
- **STT 语音输入**：麦克风按钮启动浏览器 `SpeechRecognition`，识别文本进入可编辑草稿条。

均为纯浏览器能力，不经过服务端。

## 分享与竞技场

- **对话分享**：会话菜单生成只读分享链接（有效期 0–365 天，0 = 永久；同一会话仅保留一个有效分享，可随时撤销），免登录访问 `/public/ai-chat/{token}`，展示正文 / 思维链 / 模型标注，按 IP 限流。
- **模型竞技场（Arena）**：双栏对比，同一提问并行发给两个模型流式对比（不保存对话、不带历史上下文），投票（A / B / 平局）写入 `ai_arena_votes`。
- **消息反馈**：点赞 / 点踩（可选原因），进入[反馈闭环](./operations.md)。

## 相关文档

- [模型接入](./providers.md) — 模型选择器背后的配置形态
- [智能体](./agents.md) — 以智能体预设开启对话
- [知识库 RAG](./knowledge.md) — 对话挂载知识库
