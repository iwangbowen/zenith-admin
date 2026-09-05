# 即时通讯

Zenith Admin 的即时通讯模块提供后台用户之间的单聊、群聊、消息搜索、媒体消息、表情回应、投票、卡片消息、定时消息、常用语、自定义表情、Webhook 机器人和 WebSocket 实时同步能力。后端路由挂载在 `/api/chat`、`/api/chat-bots`、`/api/public/chat/webhook` 与 `/api/ws`，前端页面菜单为「消息中心」（路径 `/chat`），浮动快捷入口由 `QuickChatButton` 提供。

---

## 能力总览

| 能力 | 当前实现 |
| --- | --- |
| 会话 | 支持 `direct` 单聊与 `group` 群聊；会话成员关系记录置顶、星标、免打扰、归档、最后已读时间 |
| 群管理 | 创建群聊、添加 / 移除成员、退出会话、群主转移、群管理员、群名称与群公告维护、群公告历史、邀请链接、入群审批、成员禁言与全员禁言 |
| 消息能力 | 消息类型为 `text`、`image`、`file`、`system`、`forward`、`vote`、`voice`、`card`、`video`；支持回复、撤回、编辑、转发、个人收藏、会话级置顶、仅对自己隐藏、表情回应、投票 |
| 效率工具 | 常用语（快捷回复短语）、定时消息、自定义表情收藏 |
| 草稿与状态 | 输入草稿保存在浏览器 `localStorage` 的 `zenith_chat_drafts`；会话列表展示未读数、@我未读、在线状态与最近在线时间 |
| 媒体库 | 通过会话内消息搜索聚合图片、文件与链接；图片使用预览灯箱，文件支持可预览类型的预览入口 |
| 搜索与导出 | 支持会话内搜索、上下文定位、收藏消息列表、跨会话全局搜索；持 `chat:message:export` 权限可经导出中心导出会话聊天记录 |
| 快捷聊天 | 非 `/chat` 页面展示浮动快捷聊天按钮，支持未读角标、快捷面板与跳转完整聊天页 |
| 频道与客服 | 消息中心左侧同时承载「频道」（站内公众号）订阅与消息视图；`business` 运营号支持双向客服、底部菜单、会话评价与客服工作台，详见[通知中心 · 频道](../notification/index.md#频道、客服与数据看板) |
| 实时通信 | `GET /api/ws`（token 经 `Sec-WebSocket-Protocol` 子协议传递）维护共享 WebSocket 连接，推送消息、撤回、编辑、已读、输入中、成员变化、群信息变化、入群申请、会话解散、表情、投票、频道消息、在线状态与 WebRTC 信令 |

---

## 数据模型

聊天核心表定义在 `packages/server/src/db/schema/chat.ts`。

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `chat_conversations` | `id`、`type`、`name`、`announcement`、`mute_all`、`join_approval`、`created_by`、`updated_by`、`tenant_id` | 会话主表；`type` 使用 `chat_conversation_type`：`direct` / `group`；`mute_all` 为全员禁言开关，`join_approval` 为入群审批开关 |
| `chat_conversation_members` | `conversation_id`、`user_id`、`role`、`is_pinned`、`is_starred`、`is_muted`、`is_archived`、`muted_until`、`last_read_at`、`joined_at` | 会话成员表；主键为 `conversation_id + user_id`；`role` 使用 `chat_member_role`：`owner` / `admin` / `member`；`muted_until` 为禁言截止时间（`NULL` 且被禁言时为永久） |
| `chat_messages` | `id`、`conversation_id`、`sender_id`、`type`、`content`、`reply_to_id`、`is_recalled`、`is_edited`、`extra`、`created_at`、`updated_at` | 消息表；`type` 使用 `chat_message_type`：`text`、`image`、`file`、`system`、`forward`、`vote`、`voice`、`card`、`video` |
| `chat_message_reactions` | `id`、`message_id`、`user_id`、`emoji`、`created_at` | 表情回应表；`message_id + user_id + emoji` 唯一 |
| `chat_message_favorites` | `id`、`message_id`、`user_id`、`created_at` | 消息个人收藏表；`message_id + user_id` 唯一，列表实体按当前用户回填 `extra.isFavorited` |
| `chat_quick_replies` | `id`、`user_id`、`content`、`sort` | 用户私有常用语，每人最多 50 条 |
| `chat_scheduled_messages` | `id`、`conversation_id`、`sender_id`、`type`、`content`、`extra`、`scheduled_at`、`status`、`fail_reason`、`sent_message_id` | 定时消息；`status` 使用 `chat_scheduled_status`：`pending` / `sent` / `canceled` / `failed` |
| `chat_custom_emojis` | `id`、`user_id`、`url`、`file_id`、`name`、`width`、`height` | 用户自定义表情收藏，每人最多 100 个 |
| `chat_group_invites` | `id`、`conversation_id`、`token`、`created_by`、`expires_at`、`max_uses`、`used_count`、`enabled` | 群邀请链接；`token` 唯一 |
| `chat_group_join_requests` | `id`、`conversation_id`、`user_id`、`invite_id`、`status`、`message`、`handled_by`、`handled_at` | 入群申请；`status` 使用 `chat_join_request_status`：`pending` / `approved` / `rejected` |
| `chat_webhooks` | `id`、`name`、`avatar`、`description`、`token`、`conversation_id`、`enabled`、`last_used_at`、`created_by`、`updated_by`、`tenant_id` | 入站 Webhook 机器人配置表；`token` 唯一 |

`chat_messages.extra` 承载消息扩展数据，包括：

- `asset`：图片、文件、语音、视频元数据，`kind` 为 `image` / `file` / `voice` / `video`
- `linkPreview`：链接预览信息，链接消息仍以 `text` 类型存储
- `mentions`：@提及用户列表

> **URL 安全约束**：`image` / `file` / `voice` / `video` 消息的 `content`、`asset.thumbnailUrl`、卡片 `cover` 与 `link` 动作 `url` 只接受 `http(s)` URL 或站内路径（托管文件 `/api/files/{id}/content`）；`linkPreview.url` / `image` / `favicon` 只接受 `http(s)`。服务端在发送消息与 `/link-preview` 入口校验，前端渲染 href / src、`window.open` 前再经 `utils/safe-url` 过滤，桌面端 `shell.openExternal` 只放行 `http(s)` / `mailto`，杜绝 `javascript:` / `file:`（UNC）/ `data:` 链接。
- `isFavorited`：实体中回填的当前用户收藏标记（持久化在 `chat_message_favorites`）
- `isPinned`：会话级消息置顶状态（持久化在消息 `extra`）
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

群聊通过 `POST /api/chat/conversations/group` 创建，创建者写入 `chat_conversation_members.role = owner`，并写入一条 `system` 消息。群成员上限为 20 人（含群主）。添加成员时可通过 `GET /api/chat/org-users` 获取组织架构选人数据（部门树 + 用户）。

群角色分为群主（`owner`）、管理员（`admin`）与普通成员（`member`）：

- 群主可通过 `PATCH /api/chat/conversations/{id}/members/{userId}/role` 设置或取消管理员
- 群主与管理员可添加 / 移除成员、修改群名称与公告、管理邀请链接、审批入群申请、禁言成员
- 群主转让通过 `POST /api/chat/conversations/{id}/transfer`

群管理能力包括：

- `GET /api/chat/conversations/{id}/members`：查看群成员，群主优先排序
- `POST /api/chat/conversations/{id}/members`：添加群成员
- `DELETE /api/chat/conversations/{id}/members/{userId}`：移除成员（群主 / 管理员）
- `PATCH /api/chat/conversations/{id}/group-info`：修改群名称或群公告（群主 / 管理员）
- `GET /api/chat/conversations/{id}/announcement-history`：查看群公告历史
- `DELETE /api/chat/conversations/{id}/announcement-history/{messageId}`：删除公告历史（群主 / 管理员）

群成员变更与群信息变更会通过 `chat:member-join`、`chat:member-leave`、`chat:member-update`、`chat:group-update` 推送到相关用户。

### 邀请链接与入群审批

群主 / 管理员可生成群邀请链接（`POST /api/chat/conversations/{id}/invite`，已有有效链接时直接复用），默认 7 天有效、不限使用次数；`POST .../invite/reset` 重新生成令牌使旧链接失效。被邀请人通过 `GET /api/chat/invites/{token}` 查看群信息，`POST /api/chat/invites/{token}/join` 入群（校验链接有效期、使用次数与 20 人上限）。

会话开启入群审批（`PATCH /api/chat/conversations/{id}/join-approval`）后，通过链接加入会创建 `pending` 入群申请并实时通知群主 / 管理员；管理者在 `GET /api/chat/conversations/{id}/join-requests` 查看待审批列表，通过 `PATCH /api/chat/join-requests/{id}` 批准或拒绝。

### 成员禁言与全员禁言

- `PATCH /api/chat/conversations/{id}/members/{userId}/mute`：群主 / 管理员禁言或解除禁言成员，禁言时长以分钟为单位，不传时长即永久禁言（写入 `muted_until`）
- `PATCH /api/chat/conversations/{id}/mute-all`：群主 / 管理员开启或关闭全员禁言（`mute_all`），开启后普通成员不能发言，群主与管理员不受限

禁言状态变化通过 `chat:member-update` 推送。

### 会话状态

会话成员表按用户保存：

- `is_pinned`：置顶会话，列表排序时置顶会话优先
- `is_starred`：星标会话
- `is_muted`：免打扰；前端收到 @我消息时会参考该状态决定提示
- `is_archived`：归档会话（`PATCH /api/chat/conversations/{id}/archive`），从主列表折叠到归档分组
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
| `video` | 视频消息，上传视频文件后发送，`extra.asset` 记录时长与缩略图 |
| `card` | 卡片消息，用于系统机器人、工作流审批、系统告警、Webhook 推送等 |

用户直接发送接口 `POST /api/chat/conversations/{id}/messages` 接受 `text`、`image`、`file`、`forward`、`vote`、`voice`、`video`。`system` 由服务端写入，`card` 由机器人或 Webhook 服务写入。

### 文本、链接与 @提及

文本消息 `content` 最大长度为 4096。前端会识别首个 URL 并调用 `GET /api/chat/link-preview` 获取预览信息；服务端只允许 `http` / `https` 链接，并拒绝 `localhost`、`.local` 与内网地址预览。

@提及保存到 `extra.mentions`。会话列表通过未读消息中的 `mentions` 计算 `hasMentionUnread`，实时收到 @我消息时在非免打扰会话中展示提示。

### 图片、文件与语音

图片、文件、语音都通过文件上传接口得到 URL 后发送聊天消息：

- 图片：`type = image`，`extra.asset.kind = image`，记录名称、大小、MIME、扩展名、宽高与缩略图 URL
- 文件：`type = file`，`extra.asset.kind = file`，记录 `fileId`（`managed_files.id`，UUIDv7 字符串）以便服务端预览接口鉴权
- 语音：`type = voice`，`extra.asset.kind = voice`，记录 `duration`
- 视频：`type = video`，`extra.asset.kind = video`，记录时长与缩略图

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

消息收藏写入 `chat_message_favorites`，并在消息列表、收藏列表与搜索结果中按当前用户回填 `extra.isFavorited`；消息置顶写入 `extra.isPinned`，属于会话内共享视图。删除消息接口 `POST /api/chat/messages/batch-delete` 仅对当前用户隐藏消息，通过 `extra.hiddenFor` 过滤列表与搜索结果，并同步清理当前用户对这些消息的收藏。

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

### 常用语、定时消息与自定义表情

- **常用语**（`/api/chat/quick-replies`）：用户私有的快捷回复短语，支持增删改查与排序，每人最多 50 条，单条最长 500 字。
- **定时消息**（`POST /api/chat/conversations/{id}/scheduled-messages`）：预约在未来某时刻发送消息，定时时间须在 1 分钟之后、30 天以内，每人最多 20 条待发送；`GET /api/chat/scheduled-messages` 按状态（`pending` / `sent` / `canceled` / `failed`）查看，`PATCH /api/chat/scheduled-messages/{id}/cancel` 取消待发送消息。系统周期任务每分钟派发到期消息，成功后回填 `sent_message_id`，失败记录 `fail_reason`。
- **自定义表情**（`/api/chat/custom-emojis`）：把聊天图片收藏为自定义表情，支持添加与删除，每人最多 100 个。

### 聊天记录导出

持有 `chat:message:export` 权限（菜单按钮「导出聊天记录」）的用户可导出单个会话的聊天记录。导出经统一导出中心执行（实体 `chat.messages`，同步导出上限 5000 行）：导出人必须是会话成员，且只导出对其可见（未被自己删除隐藏）的消息。

---

## 实时通信

### 连接与心跳

前端 `useWebSocket` 使用一个共享 WebSocket 连接：

```text
GET /api/ws
Sec-WebSocket-Protocol: zenith-auth, <accessToken>
```

服务端在握手时按管理端口径校验 JWT（拒绝会员 / refresh token，实时校验用户与租户状态）并检查吊销黑名单。鉴权失败关闭连接，关闭码为 `4001`。入站帧经 zod 校验并限速，`chat:typing` 的发送者身份由服务端覆写且要求是会话成员，详见 [WebSocket 事件清单](../backend/websocket-events)。连接建立后，`ws-manager` 按 `tokenId` 精确保存连接，并按 `userId` 维护用户的多端连接集合。

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
| `chat:member-update` | 服务端 → 客户端 | 成员角色、禁言状态变化或入群申请动态 |
| `chat:join-request` | 服务端 → 客户端 | 新入群申请，客户端刷新审批列表 |
| `chat:conversation-removed` | 服务端 → 客户端 | 群聊已解散，客户端移除会话 |
| `chat:group-update` | 服务端 → 客户端 | 群名称、群公告或群主状态变化 |
| `chat:typing` | 客户端 → 服务端 → 客户端 | 输入中状态，服务端转发给会话内其他成员 |
| `chat:reaction` | 服务端 → 客户端 | 表情回应聚合结果变化 |
| `chat:vote-update` | 服务端 → 客户端 | 投票数据变化 |
| `chat:presence` | 服务端 → 客户端 | 用户上线 / 下线状态，包含 `lastSeen` |
| `channel:message` | 服务端 → 客户端 | 频道或客服消息实时追加 |
| `channel:message-retract` | 服务端 → 客户端 | 频道或客服消息撤回 |
| `channel:cs-message` | 服务端 → 客户端 | 客服工作台轻量刷新信号 |
| `rtc:*` | 客户端 → 服务端 → 客户端 | WebRTC 通话信令，包含邀请、接听、拒绝、忙线、取消、加入、离开、Offer / Answer / ICE |

### 已读回执与在线状态

已读状态由 `chat_conversation_members.last_read_at` 保存。前端在进入会话、滚动到底部、收到当前会话新消息并自动阅读时调用 `POST /api/chat/conversations/{id}/read`。成员已读状态通过 `GET /api/chat/conversations/{id}/read-states` 查询。

在线状态由 `ws-manager` 的连接集合维护：

- 用户至少存在一个活跃连接时为在线
- 用户全部连接断开时记录 `lastSeen`
- 上线 / 下线广播 `chat:presence`
- 批量查询接口为 `GET /api/chat/presence?userIds=1,2,3`

### WebRTC 信令

聊天 WebSocket 同时承载音视频通话信令：`routes/platform/ws.ts` 处理 `rtc:invite`、`rtc:accept`、`rtc:reject`、`rtc:busy`、`rtc:cancel`、`rtc:join`、`rtc:room-participants`、`rtc:leave`、`rtc:offer`、`rtc:answer`、`rtc:ice`。`rtc:invite` / `rtc:join` 把 `callId` 绑定到所属会话并要求发送者是会话成员，后续信令只在该会话成员之间中继（`payload.to` 必须是会话成员，否则丢弃；没有 `to` 时转发给会话内其他成员），`from` 由服务端按连接主体覆写；群通话 `rtc:join` 向加入者返回现有参与者。ICE 配置通过 `GET /api/chat/rtc/config` 获取；通话结束后可调用 `POST /api/chat/conversations/{id}/call-record` 写入系统消息，入参包含 `callType`（`audio` / `video`）、`mode`（`p2p` / `group`）、`status`（`completed` / `missed` / `canceled` / `rejected`）和 `durationSec`。

完整的信令流程、群通话房间管理与前端实现见 [WebRTC 音视频通话](../backend/webrtc-calls.md)。

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

Webhook 机器人由后台「聊天机器人」页面管理，菜单路径为 `/system/chat-bots`，权限码为：

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

### 频道客服

聊天页的频道视图复用消息气泡组件展示 `channel_messages`，并把 `news` 图文消息映射为 `card` 样式。系统号（`system`）只读接收通知；运营号（`business`）支持订阅用户与客服双向会话：

- 会员侧：`GET /api/channels/{id}/messages` 拉取消息，`POST /api/channels/{id}/send` 发送咨询，`GET /api/channels/{id}/menus` 获取底部菜单，`POST /api/channels/{id}/rate` 评价客服会话。
- 客服侧：`/api/channels/cs/*` 按 `channel:cs` 权限提供可服务频道、会话聚合、消息流、回复、指派 / 转接、解决会话、标签与快捷回复管理。
- 实时同步：`channel:message` 追加或更新会员侧消息，`channel:message-retract` 标记撤回，`channel:cs-message` 通知客服工作台刷新；客服待回复数按最近一次人工回复计算。

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
| `PATCH` | `/api/chat/conversations/{id}/archive` | 归档或取消归档会话 |
| `DELETE` | `/api/chat/conversations/{id}/disband` | 解散群聊（群主专属） |
| `DELETE` | `/api/chat/conversations/{id}` | 删除或退出会话 |
| `GET` | `/api/chat/org-users` | 获取组织架构选人数据（部门 + 用户） |
| `GET` | `/api/chat/conversations/{id}/members` | 获取群成员列表 |
| `POST` | `/api/chat/conversations/{id}/members` | 添加群成员 |
| `DELETE` | `/api/chat/conversations/{id}/members/{userId}` | 移除群成员（群主 / 管理员） |
| `PATCH` | `/api/chat/conversations/{id}/members/{userId}/role` | 设置 / 取消群管理员（群主专属） |
| `PATCH` | `/api/chat/conversations/{id}/members/{userId}/mute` | 禁言 / 解除禁言群成员（群主 / 管理员） |
| `PATCH` | `/api/chat/conversations/{id}/mute-all` | 开启 / 关闭全员禁言（群主 / 管理员） |
| `PATCH` | `/api/chat/conversations/{id}/group-info` | 更新群名称或公告（群主 / 管理员） |
| `POST` | `/api/chat/conversations/{id}/transfer` | 转让群主 |
| `POST` | `/api/chat/conversations/{id}/invite` | 获取 / 生成群邀请链接（群主 / 管理员） |
| `POST` | `/api/chat/conversations/{id}/invite/reset` | 重置群邀请链接（群主 / 管理员） |
| `GET` | `/api/chat/invites/{token}` | 查看邀请链接对应的群信息 |
| `POST` | `/api/chat/invites/{token}/join` | 通过邀请链接加入群聊 |
| `PATCH` | `/api/chat/conversations/{id}/join-approval` | 开启 / 关闭入群审批（群主 / 管理员） |
| `GET` | `/api/chat/conversations/{id}/join-requests` | 待审批入群申请列表（群主 / 管理员） |
| `PATCH` | `/api/chat/join-requests/{id}` | 审批入群申请（群主 / 管理员） |
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
| `GET` / `POST` | `/api/chat/quick-replies` | 我的常用语列表 / 新增常用语 |
| `PUT` / `DELETE` | `/api/chat/quick-replies/{id}` | 更新 / 删除常用语 |
| `POST` | `/api/chat/conversations/{id}/scheduled-messages` | 创建定时消息 |
| `GET` | `/api/chat/scheduled-messages` | 我的定时消息列表（可按状态筛选） |
| `PATCH` | `/api/chat/scheduled-messages/{id}/cancel` | 取消定时消息 |
| `GET` / `POST` | `/api/chat/custom-emojis` | 我的自定义表情列表 / 添加自定义表情 |
| `DELETE` | `/api/chat/custom-emojis/{id}` | 删除自定义表情 |

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
| `GET` | `/api/ws` | 聊天、通知、在线状态、WebRTC 信令共享连接（token 经 `Sec-WebSocket-Protocol` 传递） |

---

## 前端页面

### 聊天页

消息中心菜单路径为 `/chat`，组件为 `chat/ChatPage`。页面提供：

- 会话列表、未读数、@我标记、置顶 / 星标 / 免打扰 / 归档快捷操作
- 单聊用户搜索、组织架构选人与群聊创建面板
- 消息列表虚拟滚动、历史消息游标加载、上下文定位
- 文本、图片、文件、语音、视频、投票发送，常用语快捷插入，定时消息
- 链接预览、回复、撤回、编辑、转发、收藏、置顶、表情回应（含自定义表情）、删除对自己可见消息
- 群成员侧栏、群管理员设置、成员禁言 / 全员禁言、群公告、公告历史、邀请链接与入群审批
- 会话内搜索、全局搜索、收藏消息视图、聊天记录导出
- 图片 / 文件 / 链接媒体库
- 频道（站内公众号）订阅、发现与消息视图
- 音视频通话入口（详见 [WebRTC 音视频通话](../backend/webrtc-calls.md)）
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
