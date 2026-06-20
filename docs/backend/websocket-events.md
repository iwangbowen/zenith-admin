# WebSocket 事件清单

服务端通过 `/api/ws` 提供单一 WebSocket 端点，前端 `useWebSocket` 维护单例连接并将所有消息按类型分发。所有事件 payload 类型集中定义于 [`packages/shared/src/types.ts`](https://github.com/) 的 `WsMessage` 联合类型，前后端共享。

## 推送 API

服务端在 `packages/server/src/lib/ws-manager.ts` 暴露三种推送方式：

| 函数 | 用途 |
| --- | --- |
| `broadcast(message)` | 广播给所有在线连接 |
| `sendToUser(userId, message)` | 推送给单个用户的所有会话 |
| `scheduleSendToUsers(members, message)` | 批量推送给一组用户（含 sender 去重） |

**约定**：所有 WS 推送都应在 DB 事务提交之后执行，并尽量包裹在 `setImmediate(() => ...)` 中，避免阻塞 HTTP 响应。详见 [数据库事务](./database-transactions.md)。

## 事件清单

### 公告（announcement）

| 事件 | 触发场景 | 推送范围 | Payload |
| --- | --- | --- | --- |
| `announcement:new` | 公告创建/更新后发布状态变为 `published` | `targetType=all` 广播；否则推送给受众用户集 | `Announcement` |
| `announcement:updated` | 已发布公告的内容/标题等被更新（非状态变更） | 同上 | `Announcement` |
| `announcement:deleted` | 公告被删除（单条或批量） | 删除前根据原 `targetType` 解析的受众集合 | `{ id }` |
| `announcement:read` | 当前用户将某条公告标记为已读 | 仅当前用户的其他会话 | `{ id }` |
| `announcement:read-all` | 当前用户全部标为已读 | 仅当前用户的其他会话 | `{}` |

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
| `session:force-logout` | 管理员在“在线会话”中强制下线某 tokenId | 被强制下线的具体会话 | `{ reason }` |

### 即时聊天（chat）

| 事件 | 触发场景 | Payload 摘要 |
| --- | --- | --- |
| `chat:message` | 新消息送达 | `ChatMessage` |
| `chat:edit` | 消息内容被编辑 | `ChatMessage` |
| `chat:recall` | 消息被撤回 | `{ conversationId, messageId }` |
| `chat:read` | 对方已读位移变更 | `{ conversationId, userId, readAt }` |
| `chat:reaction` | 表情反应变更 | `{ conversationId, messageId, reactions }` |
| `chat:typing` | 对方正在输入 | `{ conversationId, userId, nickname }` |
| `chat:vote-update` | 投票数据变更 | `{ conversationId, messageId, voteData }` |
| `chat:presence` | 用户上线/下线 | `{ userId, online, lastSeen }` |
| `chat:member-join` | 群成员加入 | `{ conversationId, user }` |
| `chat:member-leave` | 群成员退出 | `{ conversationId, userId }` |
| `chat:group-update` | 群名称/公告变更 | `{ conversationId, name?, announcement? }` |

### 音视频通话信令（rtc）

WebRTC 通话（1v1 / 群语音 / 视频 / 屏幕共享）的信令复用本 WebSocket 端点中继，媒体走 P2P。服务端在 `packages/server/src/routes/ws.ts` 按以下规则转发：**`payload.to` 为定向用户（`sendToUser`），否则按 `conversationId` 广播给会话其他成员**；群通话房间状态由 `packages/server/src/lib/rtc-manager.ts` 维护。

| 事件 | 触发场景 | Payload 摘要 |
| --- | --- | --- |
| `rtc:invite` | 发起通话邀请（1v1 定向 / 群广播） | `{ callId, conversationId, callType, mode, from, to?, conversationName? }` |
| `rtc:accept` | 被叫接听（1v1） | `{ callId, to, from }` |
| `rtc:reject` | 被叫拒绝 | `{ callId, to, reason? }` |
| `rtc:busy` | 被叫忙线（已在通话中） | `{ callId, to }` |
| `rtc:cancel` | 呼叫方在接通前取消 | `{ callId, conversationId, to? }` |
| `rtc:join` | 加入群通话房间（服务端登记） | `{ callId, conversationId, from }` |
| `rtc:room-participants` | 服务端回送房间现有成员（给加入者） | `{ callId, participants[] }` |
| `rtc:leave` | 离开 / 挂断 | `{ callId, conversationId, from, to? }` |
| `rtc:offer` / `rtc:answer` | SDP 协商 | `{ callId, to, from, sdp }` |
| `rtc:ice` | ICE candidate 交换 | `{ callId, to, from, candidate }` |

> 完整通话流程、拓扑（1v1 / mesh）、ICE 配置与排错见 [WebRTC 音视频通话](./webrtc-calls.md)。

## 前端分发

前端在 `packages/web/src/layouts/AdminLayout.tsx` 的 `handleWsMessage` 中集中处理所有事件：

- **站内消息**：直接更新 `inAppMessages` / `unreadCount` 状态
- **公告**：所有 5 个事件统一转发为 `window` 上的 `announcement:refresh` CustomEvent，由各公告页（用户收件箱、后台列表）监听后重新拉取当前页
- **聊天**：转入 chat 模块自身状态
- **强制下线**：弹出通知并在短延时后调用 `onLogout()`

> 这种 CustomEvent 桥接模式让公告/消息相关页面无需自己建立 WS 监听，统一通过 AdminLayout 转发，避免重复连接与状态分散。
