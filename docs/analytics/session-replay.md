# 会话回放

会话回放页面（`/analytics/replays`，权限 `monitor:replay:list`）以 rrweb 像素级录像还原用户操作现场，与错误监控、意见反馈双向联动。录制由 SDK 按远程配置自动执行，默认**错误触发**模式：平时零上报，报错时才把错误前约 60 秒的现场上传成录像。

## 录制模式与触发方式

SDK 内部是一条统一的分段流式采集流水线，两种启动模式：

| 模式 | 行为 | 何时启用 |
|------|------|----------|
| `buffer`（缓冲） | rrweb 持续录制，事件仅保留在内存环形缓冲（最近 2 个 checkout 窗口 ≈ 30–60s），**不产生任何上报**；触发器命中时缓冲整体作为首批分片上传，并转为持续上传直到会话结束 | 「错误触发回放」开启（默认） |
| `stream`（全程） | 会话进入即持续录制上传，每 10 秒或 800 事件切一个分片 | 会话命中「全程录制采样率」（默认 0%） |

触发器（`buffer` → 持续上传的时机）：

| 触发方式 | 说明 |
|----------|------|
| `error`（错误触发） | JS 错误、Promise 异常、HTTP 5xx、白屏等错误上报时联动触发；错误事件同时记录当前回放 ID，实现精确互跳 |
| `sampled`（采样录制） | 会话被全程录制采样率命中，从进入即录 |
| `manual`（手动开启） | 代码调用 `startManualReplay()` 主动开始上传。内置接入点：**意见反馈**——用户提交反馈瞬间自动附带回放，管理员在反馈管理「查看回放」直达提交前的操作现场 |
| `rage_click`（暴躁点击） | 同一元素 2 秒内连点 ≥3 次（用户明显被卡住），无需报错即触发，用于发现「没报错但用不下去」的体验问题 |
| `white_screen`（白屏） | 白屏检测命中（走错误上报链路，本质是 error 触发的 fatal 场景） |

## 回放列表与统计卡

- **统计卡**：存储占用（对照配额）、配额使用率（75% / 90% 变色预警）、今日新增、回放总数。
- **筛选**：状态（录制中 / 已完成 / 已超时）、触发方式、来源（管理后台 / 会员前台）、关键词（用户名 / 页面 / 回放 ID）、仅看有错误。
- 列表列含时长、错误数、翻页数、点击数、体积、浏览器 / 系统等聚合信息，支持勾选批量删除与操作列单行删除（权限 `monitor:replay:manage`）。
- 支持 `?replay={id}` 深链直达某条回放详情（错误监控与意见反馈的跳转入口即通过深链打开）。

## 播放器

详情侧栏内嵌 rrweb-player（惰性加载独立 chunk，不进入主包）：

- **时间轴标注条**：错误（红）/ 页面跳转（蓝）/ 行为信号（橙，如 rage click）打点渲染在播放器下方，点击任意打点直接 seek 到对应时刻。行为面包屑（导航 / 点击 / HTTP / console）经 rrweb 自定义事件写入录制流，是打点的数据来源。
- **实时旁观**：`recording` 状态的会话打开详情即进入 live 模式——详情每 3 秒轮询新分片并增量 `addEvent` 追流（不重建播放器），左上角显示红色「实时旁观」呼吸指示灯。
- **点击热点**：已完成的回放可开启「点击热点」开关，把本次会话全部点击坐标按录制视口归一化后叠加半透明热点层（纯前端从已加载事件流提取，无额外上报）；热点为视口相对位置的近似还原。
- **关联错误**：详情列出该回放期间发生的全部错误，点击跳转错误监控对应 Issue 详情（`?issue={groupId}` 深链）。

## 与错误监控 / 意见反馈的联动

- **错误 → 回放**：错误上报时 SDK 自动注入当前活跃回放 ID（`error_events.replay_id`），错误监控的 Issue 详情「最近事件」与事件详情弹窗展示「查看会话回放」按钮。
- **回放 → 错误**：回放详情的关联错误列表反向跳转 Issue 详情，双向闭环。
- **反馈 → 回放**：意见反馈提交时调用 `startManualReplay()` 并携带回放 ID（`user_feedbacks.replay_id`），反馈管理操作列提供「查看回放」。

## 隐私与脱敏

- **输入框永久打码**：rrweb 录制层面 `maskAllInputs` 恒开，密码框强制打码，与采集设置的 `maskInputs` 联动。
- **全文本打码**：`replayMaskAllText` 开启后页面全部文本脱敏（适合含大量敏感数据的系统）。
- **屏蔽选择器**：`replayBlockSelector` 配置 CSS 选择器，命中的元素整块不录制（如 `.sensitive-area`）。
- **远程熔断**：回放配置随采集设置热更新（WebSocket + 60s 轮询），关闭总开关后所有在线 SDK 停止录制；关闭状态下 rrweb 代码不会被加载（动态 import，零体积零开销）。

## 存储与配额治理

回放录像是全库单行体积最大的数据（gzip 后约 100–300KB/分钟），采用「保留期收敛 + 配额滚动淘汰 + 硬顶熔断」三层治理：

| 层 | 机制 |
|----|------|
| 保留期 | 「回放保留天数」（默认 30 天）纳入统一数据保留策略，每日 03:00 逐租户清理超期回放，录像分片随会话级联删除；总量收敛为「日增量 × 保留天数」的稳态 |
| 滚动淘汰 | 「回放存储配额」（默认 4096MB，0=不限）超限时异步清退到 90% 低水位（滞回防抖）；价值分级——**无错误回放最旧优先**，再淘汰有错误的旧回放；录制中的活跃会话不淘汰 |
| 硬顶熔断 | 用量超配额 120% 且清理跟不上时，静默丢弃纯采样分片（**错误触发现场永远接收**，保底排障能力不受配额影响） |

配套可观测：监控告警内置「数据分析」指标组的 `replayStorageMb` 指标与默认规则「回放存储接近配额」（≥ 配额 80% 时站内信告警），回放中心统计卡实时显示使用率。

另有**僵尸会话收尾**任务（每 5 分钟）：标签页被杀等场景下断流超 10 分钟的 `recording` 会话自动标记为已超时（`expired`），不删数据。

## 采集配置

「数据管理 → 采集设置」的会话回放配置组（保存后热更新，无需刷新页面）：

| 配置 | 说明 | 默认 |
|------|------|------|
| `trackReplay` | 回放总开关；关闭时 SDK 不加载 rrweb | 关 |
| `replayOnError` | 错误触发回放（buffer 模式） | 开 |
| `replaySessionSampleRate` | 全程录制采样率 0–1 | 0 |
| `replayMaskAllText` | 打码页面全部文本 | 关 |
| `replayBlockSelector` | 屏蔽元素 CSS 选择器 | 空 |
| `replayRetentionDays` | 保留天数 | 30 |
| `replayStorageQuotaMb` | 存储配额（MB，0=不限） | 4096 |

## 上报与存储链路

```text
SDK rrweb 录制（checkoutEveryNms=30s，懒加载）
  ↓ buffer 环形缓冲 → 触发器命中 → 转持续上传（10s / 800 事件一个分片）
  ↓ CompressionStream gzip → multipart POST /api/session-replays/segments
  ↓ （匿名/登录均可，replay-ingest IP 限流；pagehide 终包发原始 JSON + keepalive，服务端兜底压缩）
服务端校验（单分片 ≤2MB gz、单会话 ≤600 分片）→ 配额检查
  ↓ 首分片 upsert replay_sessions（客户端 UUID 幂等）
  ↓ 分片 bytea 直存 replay_segments（(replayId, seq) 唯一，重传幂等）
  ↓ 聚合列累加（分片数 / 字节 / 翻页 / 点击）；final 分片收尾会话
播放：GET /{id}/segments/{seq}/data 以 Content-Encoding: gzip 透传，浏览器自动解压
```

- 会话起止与分片时间戳均为客户端时钟（与 rrweb 事件时间戳同源，播放器偏移计算一致）；`lastActivityAt` 为服务端时钟（僵尸收尾判定不信任客户端）。
- 错误计数双路径回填：错误上报实时 +1；首分片到达时按 `error_events.replay_id` 重算（覆盖「错误先到、回放分片后到」的时序）。

## SDK API

| API | 说明 |
|-----|------|
| `startManualReplay()` | 手动开始持续录制上传，返回回放 ID（录制未启用时返回 `null`）；用于反馈联动等业务留证场景 |
| `getActiveReplayId()` | 当前处于持续上传阶段的回放 ID（buffer 缓冲阶段返回 `null`） |
| `stopReplay()` | 停止录制并尽力送出终包（登出等场景，`prepareTrackerLogout()` 已内置调用） |
| `configureReplayRuntime(next)` | 独立配置回放运行时参数（一般由 `configureTracker()` 自动转发同步） |

## 端点与权限

| 端点 | 说明 | 权限 |
|------|------|------|
| `POST /api/session-replays/segments` | 分片上报（multipart：meta JSON + gzip 二进制） | 匿名/登录均可，`replay-ingest` IP 限流 |
| `GET /api/session-replays` | 回放列表（状态/模式/触发/来源/关键词/仅看有错误） | `monitor:replay:list` |
| `GET /api/session-replays/stats` | 存储统计（容量看板） | `monitor:replay:list` |
| `GET /api/session-replays/{id}` | 详情（含分片清单与关联错误） | `monitor:replay:list` |
| `GET /api/session-replays/{id}/segments/{seq}/data` | 分片拉流（gzip 透传） | `monitor:replay:list` |
| `DELETE /api/session-replays/batch` | 批量删除 | `monitor:replay:manage` |
