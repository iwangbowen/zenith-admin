# 即时通讯

Zenith Admin 的即时通讯模块提供后台用户之间的单聊、群聊、消息搜索、媒体消息、表情回应、投票、卡片消息、Webhook 机器人和 WebSocket 实时同步能力。后端路由挂载在 `/api/chat`、`/api/chat-bots`、`/api/public/chat/webhook` 与 `/api/ws`，前端页面位于 `packages/web/src/pages/chat/ChatPage.tsx`，浮动快捷入口由 `QuickChatButton` 提供。

---

## 能力总览

| 能力 | 当前实现 |
| --- | --- |
| 会话 | 支持 `direct` 单聊与 `group` 群聊；会话成员关系记录置顶、星标、免打扰、最后已读时间 |
| 群管理 | 创建群聊、添加成员、移除成员、退出会话、群主转移、群名称与群公告维护、群公告历史 |
| 消息能力 | 消息类型为 `text`、`image`、`file`、`system`、`forward`、`vote`、`voice`、`card`；支持回复、撤回、编辑、转发、收藏、置顶、删除对自己可见消息、表情回应、投票 |
| 草稿与状态 | 输入草稿保存在浏览器 `localStorage` 的 `zenith_chat_drafts`；会话列表展示未读数、@我未读、在线状态与最近在线时间 |
| 媒体库 | 通过会话内消息搜索聚合图片、文件与链接；图片使用预览灯箱，文件支持可预览类型的预览入口 |
| 搜索 | 支持会话内搜索、上下文定位、收藏消息列表、跨会话全局搜索 |
| 快捷聊天 | 非 `/chat` 页面展示浮动快捷聊天按钮，支持未读角标、快捷面板与跳转完整聊天页 |
| 实时通信 | `GET /api/ws?token=...` 维护共享 WebSocket 连接，推送消息、撤回、编辑、已读、输入中、成员变化、群信息变化、表情、投票与在线状态 |

---

## 数据模型

聊天核心表定义在 `packages/server/src/db/schema/chat.ts`。

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `chat_conversations` | `id`、`type`、`name`、`announcement`、`created_by`、`updated_by`、`tenant_id`、`created_at`、`updated_at` | 会话主表；`type` 使用 `chat_conversation_type`：`direct` / `group` |
| `chat_conversation_members` | `conversation_id`、`user_id`、`role`、`is_pinned`、`is_starred`、`is_muted`、`last_read_at`、`joined_at` | 会话成员表；主键为 `conversation_id + user_id`；`role` 使用 `chat_member_role`：`owner` / `member` |
| `chat_messages` | `id`、`conversation_id`、`sender_id`、`type`、`content`、`reply_to_id`、`is_recalled`、`is_edited`、`extra`、`created_at`、`updated_at` | 消息表；`type` 使用 `chat_message_type`：`text`、`image`、`file`、`system`、`forward`、`vote`、`voice`、`card` |
| `chat_message_reactions` | `id`、`message_id`、`user_id`、`emoji`、`created_at` | 表情回应表；`message_id + user_id + emoji` 唯一 |
| `chat_webhooks` | `id`、`name`、`avatar`、`description`、`token`、`conversation_id`、`enabled`、`last_used_at`、`created_by`、`updated_by`、`tenant_id`、`created_at`、`updated_at` | 入站 Webhook 机器人配置表；`token` 唯一 |

`chat_messages.extra` 承载消息扩展数据，包括：

- `asset`：图片、文件、语音元数据，`kind` 为 `image` / `file` / `voice`
- `linkPreview`：链接预览信息，链接消息仍以 `text` 类型存储
- `mentions`：@提及用户列表
- `isFavorited`、`isPinned`：消息收藏与消息置顶状态
- `announcementHistory`：群公告历史系统消息元数据
- `forwardedMessages`、`forwardSourceConvName`：合并转发内容与来源会话名
- `hiddenFor`：对指定用户隐藏的消息 ID 过滤依据
- `voteData`：投票问题、选项、投票记录、截止时间与关闭状态
- `card`、`bot`：卡片消息与机器人展示身份

---

## 会话与群组

### 单聊

单聊通过 `POST /api/chat/conversations/direct` 创建或获取。服务端会校验目标用户存在，并在当前用户与目标用户之间复用已有 `direct` 会话。用户搜索接口 `GET /api/chat/users` 只返回启用状态、非机器人用户，并排除当前登录用户。

### 群聊

群聊通过 `POST /api/chat/conversations/group` 创建，创建者写入 `chat_conversation_members.role = owner`，并写入一条 `system` 消息。群成员上限为 20 人。

群管理能力包括：

- `GET /api/chat/conversations/{id}/members`：查看群成员，群主优先排序
- `POST /api/chat/conversations/{id}/members`：添加群成员
- `DELETE /api/chat/conversations/{id}/members/{userId}`：群主移除成员
- `POST /api/chat/conversations/{id}/transfer`：群主转让给群内成员
- `PATCH /api/chat/conversations/{id}/group-info`：群主修改群名称或群公告
- `GET /api/chat/conversations/{id}/announcement-history`：查看群公告历史
- `DELETE /api/chat/conversations/{id}/announcement-history/{messageId}`：群主删除公告历史

群成员变更与群信息变更会通过 `chat:member-join`、`chat:member-leave`、`chat:group-update` 推送到相关用户。

### 会话状态

会话成员表按用户保存：

- `is_pinned`：置顶会话，列表排序时置顶会话优先
- `is_starred`：星标会话
- `is_muted`：免打扰；前端收到 @我消息时会参考该状态决定提示
- `last_read_at`：最后已读时间，用于未读数与已读回执

---

## 消息能力

### 消息类型

| 类型 | 来源与用途 |
| --- | --- |
| `text` | 普通文本消息；可携带 `mentions` 与 `linkPreview` |
| `image` | 图片消息；前端先上传到 `/api/files/upload-one`，再以文件 URL 作为 `content` |
| `file` | 文件消息；前端先上传到 `/api/files/upload-one`，再发送文件元数据 |
| `system` | 系统消息，用于群事件、公告历史、通话记录等 |
| `forward` | 合并转发消息，`extra.forwardedMessages` 保存原消息摘要 |
| `vote` | 投票消息，`extra.voteData` 保存选项、投票记录与截止时间 |
| `voice` | 语音消息，浏览器 `MediaRecorder` 录制后上传文件，最长录制 60 秒 |
| `card` | 卡片消息，用于系统机器人、工作流审批、系统告警、Webhook 推送等 |

用户直接发送接口 `POST /api/chat/conversations/{id}/messages` 接受 `text`、`image`、`file`、`forward`、`vote`、`voice`。`system` 由服务端写入，`card` 由机器人或 Webhook 服务写入。

### 文本、链接与 @提及

文本消息 `content` 最大长度为 4096。前端会识别首个 URL 并调用 `GET /api/chat/link-preview` 获取预览信息；服务端只允许 `http` / `https` 链接，并拒绝 `localhost`、`.local` 与内网地址预览。

@提及保存到 `extra.mentions`。会话列表通过未读消息中的 `mentions` 计算 `hasMentionUnread`，实时收到 @我消息时在非免打扰会话中展示提示。

### 图片、文件与语音

图片、文件、语音都通过文件上传接口得到 URL 后发送聊天消息：

- 图片：`type = image`，`extra.asset.kind = image`，记录名称、大小、MIME、扩展名、宽高与缩略图 URL
- 文件：`type = file`，`extra.asset.kind = file`，记录 `fileId`（`managed_files.id`，UUIDv7 字符串）以便服务端预览接口鉴权
- 语音：`type = voice`，`extra.asset.kind = voice`，记录 `duration`

前端支持粘贴图片、选择图片、选择文件、上传进度占位、发送失败提示与可预览文件入口。

### 回复、撤回与编辑

- 回复使用 `replyToId`，服务端返回 `replyToMessage` 快照
- 撤回接口为 `PATCH /api/chat/messages/{id}/recall`，仅发送者本人可撤回，时间限制为发送后 2 分钟内；撤回后 `is_recalled = true`，`content = 消息已撤回`
- 编辑接口为 `PATCH /api/chat/messages/{id}/edit`，仅发送者本人可编辑，消息必须是未撤回的 `text` 类型，时间限制为发送后 24 小时内；编辑后 `is_edited = true`

撤回与编辑分别广播 `chat:recall`、`chat:edit`。

### 转发、收藏、置顶与删除

转发接口为 `POST /api/chat/messages/forward`，支持：

- `mode = merge`：发送一条 `forward` 消息，`extra.forwardedMessages` 保存原消息摘要
- `mode = individual`：逐条发送原消息，跳过撤回消息以及 `system`、`forward`、`card` 类型

消息收藏与置顶分别写入 `extra.isFavorited`、`extra.isPinned`。删除消息接口 `POST /api/chat/messages/batch-delete` 仅对当前用户隐藏消息，通过 `extra.hiddenFor` 过滤列表与搜索结果。

### 表情回应与投票

表情回应通过 `POST /api/chat/messages/{id}/reactions` 切换，服务端按 `emoji` 聚合为 `{ emoji, count, userIds }` 并广播 `chat:reaction`。

投票消息使用 `extra.voteData`，包含：

- `question`：问题
- `options`：2 到 10 个选项
- `isMultiple`：是否多选
- `isAnonymous`：是否匿名
- `expireAt`：截止时间，格式为 `YYYY-MM-DD HH:mm:ss` 或 `null`
- `votes`：投票记录
- `isClosed`：是否关闭

参与投票通过 `POST /api/chat/messages/{id}/vote`，同一用户重复投票会覆盖原有选择；投票更新广播 `chat:vote-update`。

---

## 实时通信

### 连接与心跳

前端 `useWebSocket` 使用一个共享 WebSocket 连接：

```text
GET /api/ws?token=<accessToken>
```

服务端在握手时校验 JWT，并检查 session blacklist。鉴权失败关闭连接，关闭码为 `4001`。连接建立后，`ws-manager` 按 `tokenId` 精确保存连接，并按 `userId` 维护用户的多端连接集合。

心跳机制：

- 前端每 25 秒发送 `{ "type": "ping" }`
- 服务端收到后返回 `{ "type": "pong" }`
- 前端 5 秒内未收到 `pong` 会主动断开并触发重连
- 重连退避从 1 秒开始，最大 30 秒

### 断线重连与消息补拉

WebSocket 断开期间仍可通过 HTTP 接口发送消息。重连成功后，聊天页会主动刷新会话列表，并在当前会话不处于上下文定位模式时补拉最新消息；如果当前会话位于底部，还会重新标记已读。

快捷聊天按钮也会在重连后刷新未读总数，避免断线期间遗漏角标更新。

### 聊天事件

| 事件 | 方向 | 说明 |
| --- | --- | --- |
| `chat:message` | 服务端 → 客户端 | 新消息，payload 为 `ChatMessage` |
| `chat:recall` | 服务端 → 客户端 | 消息撤回，包含 `conversationId`、`messageId` |
| `chat:edit` | 服务端 → 客户端 | 消息编辑或卡片状态变化，payload 为 `ChatMessage` |
| `chat:read` | 服务端 → 客户端 | 已读回执，包含 `conversationId`、`userId`、`readAt` |
| `chat:member-join` | 服务端 → 客户端 | 群成员加入 |
| `chat:member-leave` | 服务端 → 客户端 | 群成员离开或被移除 |
| `chat:group-update` | 服务端 → 客户端 | 群名称、群公告或群主状态变化 |
| `chat:typing` | 客户端 → 服务端 → 客户端 | 输入中状态，服务端转发给会话内其他成员 |
| `chat:reaction` | 服务端 → 客户端 | 表情回应聚合结果变化 |
| `chat:vote-update` | 服务端 → 客户端 | 投票数据变化 |
| `chat:presence` | 服务端 → 客户端 | 用户上线 / 下线状态，包含 `lastSeen` |

### 已读回执与在线状态

已读状态由 `chat_conversation_members.last_read_at` 保存。前端在进入会话、滚动到底部、收到当前会话新消息并自动阅读时调用 `POST /api/chat/conversations/{id}/read`。成员已读状态通过 `GET /api/chat/conversations/{id}/read-states` 查询。

在线状态由 `ws-manager` 的连接集合维护：

- 用户至少存在一个活跃连接时为在线
- 用户全部连接断开时记录 `lastSeen`
- 上线 / 下线广播 `chat:presence`
- 批量查询接口为 `GET /api/chat/presence?userIds=1,2,3`

### WebRTC 信令

聊天 WebSocket 同时承载音视频通话信令。`routes/platform/ws.ts` 会处理 `rtc:*` 消息，优先按 `payload.to` 定向发送；没有 `to` 但包含 `conversationId` 时，转发给会话内其他成员。

| 事件 | 说明 |
| --- | --- |
| `rtc:invite` | 发起通话邀请 |
| `rtc:accept` | 接受通话 |
| `rtc:reject` | 拒绝通话 |
| `rtc:busy` | 忙线 |
| `rtc:cancel` | 取消通话 |
| `rtc:join` | 加入群通话房间 |
| `rtc:room-participants` | 返回房间已有成员 |
| `rtc:leave` | 离开通话 |
| `rtc:offer` | WebRTC offer |
| `rtc:answer` | WebRTC answer |
| `rtc:ice` | ICE candidate |

ICE 配置通过 `GET /api/chat/rtc/config` 获取。通话结束后可调用 `POST /api/chat/conversations/{id}/call-record` 写入系统消息，入参包含 `callType`（`audio` / `video`）、`mode`（`p2p` / `group`）、`status`（`completed` / `missed` / `canceled` / `rejected`）和 `durationSec`。

---

## 聊天机器人与 Webhook

### 系统机器人

种子数据会写入系统机器人用户：

- `username = zenith-assistant`
- `nickname = Zenith 助手`
- `email = assistant@zenith.dev`
- `is_bot = true`

用户搜索会排除 `is_bot = true` 的用户。`chat-notify.service.ts` 通过系统机器人与目标用户建立单聊，并投递 `card` 类型消息，供工作流、告警等场景使用。

### Webhook 机器人

Webhook 机器人由后台页面 `packages/web/src/pages/system/chat-bots/ChatBotsPage.tsx` 管理，菜单路径为 `/system/chat-bots`，权限码为：

- `chat:bot:list`
- `chat:bot:create`
- `chat:bot:update`
- `chat:bot:delete`

管理接口挂载在 `/api/chat-bots`，支持列表、创建、更新、重置令牌和删除。创建时需要绑定目标群聊会话；前端只从 `/api/chat/conversations` 中筛选 `type = group` 作为目标会话选项。

公开入站接口：

```text
POST /api/public/chat/webhook/{token}
```

请求体使用 `chatWebhookPayloadSchema`：

```json
{
  "type": "text",
  "text": "构建完成"
}
```

或：

```json
{
  "type": "card",
  "card": {
    "title": "审批提醒",
    "text": "有新的流程任务待处理"
  }
}
```

`type` 支持 `text` / `card`。令牌命中且机器人启用时，服务端向目标会话投递消息；文本消息写入 `type = text`，卡片消息写入 `type = card`，发送者为 `senderId = null` 并在 `extra.bot` 中携带机器人名称与头像。投递成功后更新 `chat_webhooks.last_used_at`。

---

## 接口一览

### 聊天接口（`/api/chat`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/chat/users` | 搜索可聊天用户 |
| `GET` | `/api/chat/presence` | 批量查询在线状态，`userIds` 为逗号分隔 |
| `GET` | `/api/chat/rtc/config` | 获取 WebRTC ICE 配置 |
| `POST` | `/api/chat/conversations/{id}/call-record` | 写入通话记录系统消息 |
| `GET` | `/api/chat/conversations` | 我的会话列表 |
| `POST` | `/api/chat/conversations/direct` | 创建或获取单聊会话 |
| `POST` | `/api/chat/conversations/group` | 创建群聊 |
| `GET` | `/api/chat/conversations/{id}/messages` | 获取会话消息，游标参数为 `beforeId`、`limit` |
| `POST` | `/api/chat/conversations/{id}/messages` | 发送消息 |
| `GET` | `/api/chat/conversations/{id}/messages/search` | 搜索当前会话消息 |
| `GET` | `/api/chat/conversations/{id}/messages/{messageId}/context` | 获取目标消息上下文 |
| `GET` | `/api/chat/messages/global-search` | 跨会话全局消息搜索 |
| `GET` | `/api/chat/link-preview` | 获取链接预览 |
| `POST` | `/api/chat/conversations/{id}/read` | 标记会话已读 |
| `GET` | `/api/chat/conversations/{id}/read-states` | 获取会话成员已读状态 |
| `PATCH` | `/api/chat/conversations/{id}/pin` | 置顶或取消置顶会话 |
| `PATCH` | `/api/chat/conversations/{id}/star` | 标记或取消星标会话 |
| `PATCH` | `/api/chat/conversations/{id}/mute` | 免打扰或取消免打扰会话 |
| `DELETE` | `/api/chat/conversations/{id}` | 删除或退出会话 |
| `GET` | `/api/chat/conversations/{id}/members` | 获取群成员列表 |
| `POST` | `/api/chat/conversations/{id}/members` | 添加群成员 |
| `DELETE` | `/api/chat/conversations/{id}/members/{userId}` | 移除群成员 |
| `PATCH` | `/api/chat/conversations/{id}/group-info` | 更新群名称或公告 |
| `POST` | `/api/chat/conversations/{id}/transfer` | 转让群主 |
| `GET` | `/api/chat/conversations/{id}/announcement-history` | 获取群公告历史 |
| `DELETE` | `/api/chat/conversations/{id}/announcement-history/{messageId}` | 删除群公告历史 |
| `GET` | `/api/chat/conversations/{id}/pinned-messages` | 获取会话置顶消息 |
| `GET` | `/api/chat/conversations/{id}/favorite-messages` | 获取会话收藏消息 |
| `GET` | `/api/chat/favorite-messages` | 获取我的全局收藏消息 |
| `PATCH` | `/api/chat/messages/{id}/edit` | 编辑消息 |
| `PATCH` | `/api/chat/messages/{id}/recall` | 撤回消息 |
| `PATCH` | `/api/chat/messages/{id}/favorite` | 收藏或取消收藏消息 |
| `PATCH` | `/api/chat/messages/{id}/pin` | 置顶或取消置顶消息 |
| `POST` | `/api/chat/messages/forward` | 转发消息 |
| `POST` | `/api/chat/messages/batch-delete` | 批量删除消息，仅对自己隐藏 |
| `POST` | `/api/chat/messages/{id}/reactions` | 切换消息表情回应 |
| `POST` | `/api/chat/messages/{id}/vote` | 参与投票 |

### Webhook 机器人接口

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/chat-bots` | `chat:bot:list` | Webhook 机器人列表 |
| `POST` | `/api/chat-bots` | `chat:bot:create` | 创建 Webhook 机器人 |
| `PATCH` | `/api/chat-bots/{id}` | `chat:bot:update` | 更新 Webhook 机器人 |
| `POST` | `/api/chat-bots/{id}/regenerate-token` | `chat:bot:update` | 重置 Webhook 令牌 |
| `DELETE` | `/api/chat-bots/{id}` | `chat:bot:delete` | 删除 Webhook 机器人 |
| `POST` | `/api/public/chat/webhook/{token}` | 公开令牌 | 入站 Webhook 推送文本或卡片消息 |

### WebSocket 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/ws?token=<accessToken>` | 聊天、通知、在线状态、WebRTC 信令共享连接 |

---

## 前端页面

### 聊天页

聊天中心菜单路径为 `/chat`，组件为 `chat/ChatPage`。页面提供：

- 会话列表、未读数、@我标记、置顶 / 星标 / 免打扰快捷操作
- 单聊用户搜索与群聊创建面板
- 消息列表虚拟滚动、历史消息游标加载、上下文定位
- 文本、图片、文件、语音、投票发送
- 链接预览、回复、撤回、编辑、转发、收藏、置顶、表情回应、删除对自己可见消息
- 群成员侧栏、群公告、公告历史
- 会话内搜索、全局搜索、收藏消息视图
- 图片 / 文件 / 链接媒体库
- WebSocket 连接状态提示与重连后同步

### 浮动快捷聊天

`QuickChatButton` 在非 `/chat` 页面显示，使用 `FloatButton` 展示未读角标。首次打开时懒加载 `ChatPage`，并以 `variant = quick` 作为快捷面板运行。

快捷聊天支持：

- 展开 / 收起浮动聊天面板
- `Esc` 关闭面板
- 跳转完整聊天页，并携带当前会话 `conv` 查询参数
- WebSocket 收到 `chat:message` 时更新未读角标
- 当前不在 `/chat` 页面时展示；进入 `/chat` 后自动隐藏

### Webhook 机器人管理页

Webhook 机器人页面路径为 `/system/chat-bots`，组件为 `system/chat-bots/ChatBotsPage`。页面使用 `SearchToolbar` 与 `ConfigurableTable`，支持按机器人名称搜索、创建、编辑、重置令牌、复制 Webhook 地址 / 令牌、启停状态展示和删除。

---

## 相关文档

- [WebSocket 事件清单](../backend/websocket-events.md)
- [WebRTC 音视频通话](../backend/webrtc-calls.md)
- [功能模块](../product/features.md)
