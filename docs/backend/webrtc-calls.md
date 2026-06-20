# WebRTC 音视频通话

聊天模块内置 **1v1 语音 / 视频通话、屏幕共享、群语音**。信令复用现有 WebSocket（`/api/ws`），媒体走 P2P（群聊为 mesh 拓扑），服务端不转发媒体流。

## 架构概览

```
┌──────────┐   rtc:* 信令(WS 中继)   ┌──────────┐
│ 浏览器 A │ ──────────────────────▶ │  服务端  │ ──▶ 浏览器 B
│RTCPeerCon│ ◀────────────────────── │ (仅中继) │ ◀──
└────┬─────┘                         └──────────┘
     │   媒体（音视频/屏幕）P2P 直连，经 STUN/TURN 协商
     └──────────────────────────────────────────────▶ 浏览器 B
```

- **信令**：`offer` / `answer` / `ICE candidate` 通过 WebSocket 中继。事件清单见 [WebSocket 事件 · rtc](./websocket-events.md#音视频通话信令-rtc)。
- **媒体**：浏览器间 P2P。服务端**不经手媒体流**，仅做信令转发与群通话房间登记。
- **关键文件**：
  - 服务端：`routes/ws.ts`（信令中继）、`lib/rtc-manager.ts`（群通话房间）、`services/chat.service.ts`（`getRtcConfig` / `postCallRecord`）。
  - 前端：`webrtc/callManager.ts`（单例通话管理器）、`webrtc/CallOverlayHost.tsx`（全局来电/通话宿主，挂载于 `AdminLayout`）、`CallWindow.tsx` / `MediaTile.tsx`。

## 配置（ICE 服务器）

浏览器创建 `RTCPeerConnection` 需要 ICE 服务器做 NAT 穿透。服务端通过 `GET /api/chat/rtc/config` 下发，取值来自环境变量：

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `WEBRTC_STUN_URLS` | STUN 地址（逗号分隔），用于发现公网地址 | `stun:stun.l.google.com:19302` |
| `WEBRTC_TURN_URLS` | TURN 中继地址（逗号分隔） | 空 |
| `WEBRTC_TURN_USERNAME` | TURN 用户名 | 空 |
| `WEBRTC_TURN_CREDENTIAL` | TURN 凭证 | 空 |

```dotenv
# 仅 STUN：同 LAN / 本机可连通
WEBRTC_STUN_URLS=stun:stun.l.google.com:19302

# 跨 NAT / 公网需 TURN（自建 coturn 或云服务）
WEBRTC_TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
WEBRTC_TURN_USERNAME=zenith
WEBRTC_TURN_CREDENTIAL=your_turn_password
```

::: warning 必须配置 TURN 的场景
仅配 STUN 时，若双方处于对称型 NAT / 不同公网且无法直连，通话会**协商失败**。生产环境（跨公网用户）务必部署 TURN 中继服务器。
:::

::: tip 浏览器限制
`getUserMedia` / `getDisplayMedia` 仅在 **HTTPS 或 `localhost`** 下可用。生产环境必须启用 HTTPS，否则无法获取麦克风/摄像头/屏幕。
:::

## 通话流程

### 1v1（p2p）

1. 呼叫方点击「语音/视频通话」→ 获取本地媒体 → 广播 `rtc:invite`（定向被叫）。
2. 被叫弹出来电窗口；**接听** → 获取本地媒体 → 回 `rtc:accept`；**拒绝** → 回 `rtc:reject`；已在通话中 → 自动回 `rtc:busy`。
3. 呼叫方收到 `accept` 后建连并发 `rtc:offer`，被叫 `rtc:answer`，双方交换 `rtc:ice` → 连通。
4. 任一方挂断发 `rtc:leave`（呼叫前取消发 `rtc:cancel`）→ 结束并写入**通话记录系统消息**（时长 / 未接听 / 已拒绝）。

### 群语音（group，mesh）

1. 发起者建立房间，广播 `rtc:invite`（会话内所有成员）并 `rtc:join`。
2. 成员接听后 `rtc:join`；服务端回 `rtc:room-participants`（房间现有成员），**加入者主动向每个现有成员建连发 offer**（现有成员仅应答），因此天然无 glare。
3. 成员离开发 `rtc:leave`；**断线由服务端自动清理房间并通知其余成员**。

> 屏幕共享、纯语音升级为含视频轨等 renegotiation 场景，采用 **perfect-negotiation**（按 userId 决定 polite/impolite）处理协商冲突。

## 通话能力

| 能力 | 说明 |
| --- | --- |
| 语音 / 视频 | 单聊支持语音与视频；群聊为群语音 |
| 屏幕共享 | 通话中切换；有视频轨用 `replaceTrack`，纯语音用 `addTrack` + 重新协商 |
| 静音 / 关摄像头 | 切换本地轨道 `enabled` |
| 最小化 | 通话窗口可最小化为悬浮条，**远端音频持续播放**（独立 `<audio>` 元素） |
| 来电提示音 | WebAudio 合成，无需音频资源 |
| 通话记录 | 1v1 结束写入会话系统消息（`POST /api/chat/conversations/:id/call-record`） |

## 排错

| 现象 | 可能原因 |
| --- | --- |
| 无法获取麦克风/摄像头 | 非 HTTPS/localhost；或浏览器权限被拒 |
| 接通后听不到/看不到对方 | 缺少 TURN，双方无法 P2P 直连；检查 `WEBRTC_TURN_*` |
| 来电窗口不弹 | 对方 WebSocket 未连接（未登录/断线）；通话宿主仅在登录态挂载 |
| 群通话有人听不到新加入者 | 新加入者需向现有成员发起连接，确认 `rtc:join` 与 `rtc:room-participants` 往返正常 |

::: info 部署约束
群通话房间状态为**单进程内存**（与 WebSocket 连接管理同等约束）。多实例水平扩展时，需将 `rtc-manager` 的房间状态与 `ws-manager` 的连接路由改造为共享存储（如 Redis Pub/Sub）。
:::
