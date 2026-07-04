# WebSocket 事件清单

服务端通过 `/api/ws` 提供后台实时消息 WebSocket 端点，前端 `useWebSocket` 维护单例连接并将所有消息按类型分发。业务事件 payload 类型集中定义于 [`packages/shared/src/types.ts`](https://github.com/) 的 `WsMessage` 联合类型，前后端共享。

Web 终端使用独立端点 `/api/ws/terminal` 与 `/api/ws/terminal-monitor`，消息类型为 `TerminalMessage` 和监控端专用消息，不混入 `/api/ws` 的 `WsMessage`。

## 推送 API

服务端在 `packages/server/src/lib/ws-manager.ts` 暴露以下推送与连接管理方法：

| 函数 | 用途 |
| --- | --- |
| `broadcast(message)` | 广播给所有在线连接 |
| `sendToUser(userId, message)` | 推送给单个用户的所有会话 |
| `sendToToken(tokenId, message)` | 精确推送给某个 token 会话 |
| `closeTokenConnection(tokenId, reason?)` | 关闭指定 token 对应的 WebSocket 连接 |
| `closeUserConnections(userId, reason?)` | 关闭指定用户的全部 WebSocket 连接 |
| `scheduleSendToUsers(members, message)` | 在下一次 I/O tick 批量推送给一组用户 |

**约定**：所有 WS 推送都应在 DB 事务提交之后执行，并尽量包裹在 `setImmediate(() => ...)` 中，避免阻塞 HTTP 响应。详见 [数据库事务](./database-transactions.md)。

## 连接与心跳

- `/api/ws?token=<accessToken>` 通过查询参数携带后台 Access Token。
- Token 无效或会话已在黑名单中时关闭连接，关闭码为 `4001`。
- 前端每 25 秒发送 `{ type: 'ping' }`，服务端立即返回 `{ type: 'pong' }`；5 秒未收到 pong 时前端主动断开并按指数退避重连，最大间隔 30 秒。
- 用户首个连接建立时广播 `chat:presence` 在线事件；最后一个连接断开时记录 `lastSeen` 并广播离线事件。

## 事件清单

### 公告（announcement）

| 事件 | 触发场景 | 推送范围 | Payload |
| --- | --- | --- | --- |
| `announcement:new` | 公告发布 | `targetType=all` 广播；否则推送给受众用户集 | `Announcement` |
| `announcement:updated` | 已发布公告内容更新 | 同上 | `Announcement` |
| `announcement:deleted` | 公告被删除（单条或批量） | 删除前根据原 `targetType` 解析的受众集合 | `{ id }` |
| `announcement:read` | 当前用户将某条公告标记为已读 | 当前用户的所有会话 | `{ id }` |
| `announcement:read-all` | 当前用户全部标为已读 | 当前用户的所有会话 | `{}` |

> 受众解析由 `resolveAnnouncementAudience` 完成，规则：`targetType=all` 时全员；`specific` 时合并 user / role 关联用户 / dept 下用户（按租户过滤）。

### 站内消息（in-app-message）

| 事件 | 触发场景 | 推送范围 | Payload |
| --- | --- | --- | --- |
| `in-app-message:new` | 新站内消息送达 | 接收人 | `InAppMessage` |
| `in-app-message:read` | 单条标记已读 | 接收人的所有会话 | `{ id }` |
| `in-app-message:read-all` | 全部标记已读 | 当前用户 | `{}` |
| `in-app-message:deleted` | 接收人或管理员删除某条消息 | 接收人 | `{ id }` |

### 会话（session）

| 事件 | 触发场景 | 推送范围 | Payload |
| --- | --- | --- | --- |
| `session:force-logout` | 管理员在“在线会话”中强制下线某 tokenId 或用户全部会话 | 被强制下线的会话 | `{ reason }` |

### 即时聊天（chat）

| 事件 | 触发场景 | Payload 摘要 |
| --- | --- | --- |
| `chat:message` | 新消息、AI 回复、系统消息或通话记录送达 | `ChatMessage` |
| `chat:edit` | 消息内容或卡片状态被更新 | `ChatMessage` |
| `chat:recall` | 消息被撤回 | `{ conversationId, messageId }` |
| `chat:read` | 会话已读位移变更 | `{ conversationId, userId, readAt }` |
| `chat:reaction` | 表情反应变更 | `{ conversationId, messageId, reactions }` |
| `chat:typing` | 客户端输入状态经服务端转发给会话其他成员 | `{ conversationId, userId, nickname }` |
| `chat:vote-update` | 投票数据变更 | `{ conversationId, messageId, voteData }` |
| `chat:presence` | 用户上线/下线 | `{ userId, online, lastSeen }` |
| `chat:member-join` | 群成员加入 | `{ conversationId, user }` |
| `chat:member-leave` | 群成员退出 | `{ conversationId, userId }` |
| `chat:group-update` | 群名称/公告或群资料变更 | `{ conversationId, name?, announcement? }` |

### 音视频通话信令（rtc）

WebRTC 通话（1v1 语音 / 视频、群语音、屏幕共享）的信令复用 `/api/ws` 中继，媒体走 P2P。服务端在 `packages/server/src/routes/platform/ws.ts` 按以下规则转发：`payload.to` 为定向用户（`sendToUser`），否则按 `conversationId` 广播给会话其他成员；`rtc:join` 会登记到 `packages/server/src/lib/rtc-manager.ts` 的内存房间并向加入者返回现有成员。

| 事件 | 触发场景 | Payload 摘要 |
| --- | --- | --- |
| `rtc:invite` | 发起通话邀请（1v1 定向 / 群广播） | `{ callId, conversationId, callType, mode, from, to?, conversationName? }` |
| `rtc:accept` | 被叫接听（1v1） | `{ callId, to, from }` |
| `rtc:reject` | 被叫拒绝 | `{ callId, to, reason? }` |
| `rtc:busy` | 被叫忙线（1v1） | `{ callId, to }` |
| `rtc:cancel` | 呼叫方在接通前取消 | `{ callId, conversationId, to? }` |
| `rtc:join` | 加入群通话房间（服务端登记） | `{ callId, conversationId, from }` |
| `rtc:room-participants` | 服务端回送房间现有成员（给加入者） | `{ callId, participants }` |
| `rtc:leave` | 离开 / 挂断；断线时服务端也会通知剩余成员 | `{ callId, conversationId, from, to? }` |
| `rtc:offer` / `rtc:answer` | SDP 协商 | `{ callId, to, from, sdp }` |
| `rtc:ice` | ICE candidate 交换 | `{ callId, to, from, candidate }` |

> 完整通话流程、拓扑（1v1 / mesh）、ICE 配置与排错见 [WebRTC 音视频通话](./webrtc-calls.md)。

### 工作流（workflow）

| 事件 | 触发场景 | 推送范围 | Payload |
| --- | --- | --- | --- |
| `workflow:taskCreated` | 待办任务创建 | 任务办理人 | `{ instanceId, taskId, instanceTitle, nodeName }` |
| `workflow:taskFinished` | 待办任务审批或拒绝 | 任务办理人 | `{ instanceId, taskId, decision }` |
| `workflow:instanceFinished` | 流程通过、拒绝或撤回 | 流程发起人 | `{ instanceId, status, title }` |

### 支付（payment）

| 事件 | 触发场景 | 推送范围 | Payload |
| --- | --- | --- | --- |
| `payment:success` | 支付事件总线收到 `payment.succeeded` | 支付用户 | `{ orderNo, bizType, bizId, amount }` |
| `payment:refunded` | 支付事件总线收到 `refund.succeeded` | 支付用户 | `{ orderNo, refundNo, refundAmount }` |

### 任务中心（task）

| 事件 | 触发场景 | 推送范围 | Payload |
| --- | --- | --- | --- |
| `task:progress` | 异步任务状态或进度变更（领取执行、progress 上报、成功/失败/取消，进度上报有 300ms 节流） | 任务创建者 | `AsyncTask` |

### Web 终端（terminal）

Web 终端不走 `/api/ws` 主连接，而是使用独立端点：

| 端点 | 用途 | 主要消息 |
| --- | --- | --- |
| `/api/ws/terminal` | 当前用户执行本地 / SSH / Docker 终端 | `terminal:input`、`terminal:resize`、`terminal:close`、`terminal:output`、`terminal:exit`、`terminal:error`、`terminal:reconnected`、`terminal:terminated` |
| `/api/ws/terminal-monitor` | 管理员监控或接管终端会话 | `monitor:attached`、`monitor:not-found`、`terminal:output`、`terminal:input`、`terminal:ended` |

## 前端分发

前端通过 `packages/web/src/hooks/useWebSocket.ts` 复用一个共享连接，不同模块注册自己的监听器：

- **`AdminLayout`**：处理站内消息、公告刷新、`chat:message` 未读数和 `session:force-logout`
- **聊天模块**：处理聊天消息、已读、输入状态、成员变更、表情、投票等聊天事件
- **`CallOverlayHost`**：接收所有 `rtc:*` 信令并交给 `callManager.handleSignal()`
- **终端页面**：为 `/api/ws/terminal` 和 `/api/ws/terminal-monitor` 建立独立 WebSocket 连接

> 这种单例连接 + 多监听器模式避免重复连接，同时允许聊天、通话、公告和会话管理按模块各自维护状态。
