# 埋点采集 SDK

埋点 SDK 位于独立 workspace 包 `packages/analytics-sdk`（`@zenith/analytics-sdk`）。管理后台在 `App` 中调用 `initTracker()`，会员端入口在完成运行时配置后调用 `initTracker()`，用于启动自动采集、远程配置、错误上报联动与离线重试。

## SDK 独立包

`@zenith/analytics-sdk` 承载框架无关的 tracker、error-reporter 与 breadcrumbs 核心逻辑；`packages/web/src/utils/tracker.ts`、`error-reporter.ts`、`breadcrumbs.ts` 保留 Web 运行时默认值注入与 re-export，业务侧统一从 `@/utils/tracker`、`@/utils/error-reporter`、`@/utils/breadcrumbs` 导入。

SDK 不直接读取 Vite 环境变量。Web 适配层在初始化时注入 `apiBase`（默认 `VITE_API_BASE_URL || '/api'`）、`sdkVersion`（`VITE_APP_VERSION || '0.0.0'`）、`environment` 与构建级 `deploymentId`（来自 `VITE_DEPLOYMENT_ID`）；会员端通过 `configureTracker()` 覆盖 `tokenKey/source/appId/rootSelector/consentProvider` 等运行时参数。SDK 的 localStorage/sessionStorage key 均按 `zenith:{deploymentId}:analytics:{key}:{appId}` 隔离，`appId` 继续表示 admin/member 入口，不替代 deployment ID。

## 自动采集（零代码）

初始化后默认开启以下全自动采集，**无需在业务页面写任何埋点代码**：

| 能力 | 说明 |
|------|------|
| 页面浏览 | `AdminLayout` 全局接入 `usePageTracker`，所有后台页面自动记录 `$pageview` 进入 + `$pageleave` 离开（含可见停留时长与最大滚动深度 `scrollDepth`），标题取自菜单；会员端初始化同一 SDK |
| 元素点击 | 全局捕获 `button` / `a` / `[role=button]` / `[role=tab]` / `[role=menuitem]` / `[role=option]` / `input[type="submit"]` / `input[type="button"]` / `[data-track]` 点击，上报 `$autocapture`（按钮文案作为 `elementLabel`） |
| Rage Click | 同一元素 2 秒内连续点击 ≥3 次时上报 `$rage_click` 事件并记录 warning 面包屑，用于定位「点了没反应」的挫败交互 |
| 滚动深度 | 持续记录页面级最大滚动百分比，随 `$pageleave` 上报 `scrollDepth` |
| Web Vitals | 自动采集 `LCP` / `INP` / `CLS` / `FCP` / `TTFB`，上报为 `perf` 事件（`eventName=$web_vitals`） |
| API 监控 | 拦截 `fetch` / `XHR`，记录慢请求（>2s）与 4xx/5xx，上报 `api_request`；5xx / 网络失败额外转为 `http_error` 错误上报 |
| 白屏检测 | 启动 6 秒后检查 `rootSelector` 对应根节点是否有可见内容；无内容时上报 `white_screen` |
| 会话回放 | `trackReplay` 开启后按需加载 rrweb 录制器：错误触发模式平时仅内存缓冲，报错/暴躁点击/手动触发时上传错误前约 60s 现场并继续录制；亦可按采样率全程录制。详见 [会话回放](./session-replay) |

### 声明式埋点（data-track）

给元素加 `data-*` 属性可控制自动采集的标识，便于稳定统计：

```tsx
<Button
  data-track="user-export"          // 稳定 elementKey
  data-track-label="导出用户"        // 展示用 elementLabel
  data-area="user-toolbar"          // componentArea 区域
>
  导出
</Button>
```

元素或其祖先带 `data-sensitive` 属性时，自动采集不会读取其文本内容（只保留元素结构标识）。

## 公开 API 与手动埋点

SDK 从 `@zenith/analytics-sdk` 导出 tracker、error-reporter 与 breadcrumbs API；Web 侧适配层从同名路径 re-export。常用公开 API 如下：

| API | 说明 |
|-----|------|
| `configureTracker(next)` | 注入或覆盖 `apiBase`、`tokenKey`、`source`、`appId`、`environment`、`sdkVersion`、`rootSelector`、`consentProvider`、`siteKey`；变更 `appId` / `siteKey` / `tokenKey` 时清空实验缓存 |
| `initTracker()` | 启动自动点击、Web Vitals、API 监控、白屏检测、滚动深度、远程配置、定时 flush 与离线队列重试 |
| `trackPageView(pagePath, pageTitle?)` / `trackPageLeave()` | 页面进入 / 离开生命周期；离开事件由 SDK 统一计算可见停留时长与滚动深度 |
| `flushPageLifecycleForUnload()` / `onPageVisibilityChange(hidden)` | 页面卸载与可见性变化辅助函数，供 SDK 内部和宿主生命周期兜底使用 |
| `trackEvent(eventName, properties?)` | 自定义语义事件，`eventType='custom'` |
| `trackFeature(elementKey, elementLabel, componentArea?)` | 手动功能点击，`eventName='$feature'` |
| `trackAreaClick(event, containerEl, componentArea)` | 区域点击坐标，按容器归一化到 0–100 |
| `identify(userId, username?)` / `identifyMember(memberId, displayName?)` | 管理员 / 会员身份识别，触发 `$identify` |
| `prepareTrackerLogout()` / `resetIdentity()` | 退出前发送身份缓冲并重置身份、会话、采样状态 |
| `reloadTrackerConfig()` / `invalidateConfigCache()` | 重新拉取 `/analytics/config` |
| `applyRemoteConfig(config)` | 宿主实时通道直接应用远程配置对象 |
| `fetchExperimentAssignments()` / `getVariant(expKey)` | 获取实验分流；`getVariant` 命中时自动上报会话内去重的曝光事件 |
| `getMaxScrollDepth()` / `resetScrollDepth()` | 读取 / 重置页面最大滚动深度 |
| `reportError(type, message, options?)` | 手动错误上报；`crash` 用于业务严重崩溃 |
| `configureErrorReporterRuntime(next)` / `configureErrorReporting(policy)` / `getRelease()` | 独立使用错误上报器时配置运行时、同步采集开关并读取 release |
| `addBreadcrumb(b)` / `getBreadcrumbs()` / `clearBreadcrumbs()` | 管理错误面包屑环形缓冲 |
| `startManualReplay()` / `getActiveReplayId()` / `stopReplay()` / `configureReplayRuntime(next)` | 会话回放：手动开始持续录制（返回回放 ID）、读取当前活跃回放 ID、停止并送出终包、独立配置回放运行时 |

需要**语义化业务事件**（如转化、关键操作）时，显式调用：

```ts
import { trackEvent, trackFeature, trackAreaClick, identify, resetIdentity } from '@/utils/tracker';

// 自定义事件（带属性袋）
trackEvent('order_submit', { amount: 199, channel: 'wechat' });

// 功能点击（稳定 key + 标签 + 区域）
trackFeature('export-btn', '导出', 'search-toolbar');

// 区域点击（点击分布）
const ref = useRef<HTMLDivElement>(null);
<div ref={ref} onClick={(e) => ref.current && trackAreaClick(e, ref.current, 'table')}>…</div>
```

> 由于点击已被 autocapture 全量采集，业务页一般**无需**再写 `trackFeature`；它主要用于需要稳定 key 的关键转化点。

后台 404 与 403 页面使用 `trackEvent('page_not_found', { path })`、`trackEvent('page_forbidden', { path })` 上报导航失败语义事件，事件字典中提供对应 system 分类种子。

## 身份识别

- 管理员登录后自动 `identify(userId, username)`；会员端使用 `identifyMember(memberId)`。退出前先携带退出前 token 尽力发送身份缓冲，再重置会话与采样状态，避免共享设备上的跨账号数据串写。
- 未登录时使用持久化的 `anonymousId`（localStorage）；登录后事件携带 `distinctId = u:{userId}`（会员为 `m:{memberId}`），实现匿名 → 登录的身份合并。
- 服务端按优先级解析 `distinctId`：JWT 管理员身份 `u:{userId}` > 会员身份 `m:{memberId}` > 客户端声明的 `distinctId`（拒绝伪造 `u:` / `m:` 前缀）> `anonymousId` > `sessionId` 兜底。登录请求的身份最终由服务端 JWT 强制生成，客户端无法伪造其他登录用户。
- `$identify` 写入 `analytics_identity_map`：同一 `anonymousId` 首次绑定到权威身份后，匿名批次会前向合并，历史匿名 `user_events` / `analytics_sessions` / `analytics_user_profiles` 会 best-effort 回溯合并。

## 上报字段与接口

埋点统一批量上报到 `POST /api/analytics/events`，请求体为 `{ "events": [...] }`（单批 1–100 条）。每条事件包含：

- 幂等、身份与会话：`eventId`（UUID）、`sessionId`、`anonymousId`、`distinctId`
- 事件：`eventType`（`page_view` / `page_leave` / `feature_use` / `area_click` / `custom` / `perf` / `api_request` / `identify`）、`eventName`
- 多端平台：`source` / `appId` / `environment`（登录态由服务端按身份强制覆盖为 `web_admin` / `web_member`，匿名时只信任 `web_admin` / `web_member` 两个声明值；匿名带站点 siteKey 时强制使用站点 `appId`）
- 页面与元素：`pagePath`、`pageTitle`、`elementKey`、`elementLabel`、`componentArea`
- 行为数值：`clickX` / `clickY`（0–100 归一化坐标）、`scrollDepth`、`durationMs`
- 属性与来源：`properties`（最多 50 个 key、序列化后 ≤16KB）、`referrer`、`utmSource` / `utmMedium` / `utmCampaign` / `utmTerm` / `utmContent`
- 环境与性能：`screenW`、`screenH`、`language`、`metricName`、`metricValue`
- SDK：`sdkVersion`
- 客户端时间戳 `ts`：偏离服务器时间 ±24 小时以内时用于修正事件时间（离线补传场景），超出则回退服务器接收时间

服务端根据请求 IP 与 UA 补充浏览器、操作系统、设备类型、IP 与地域字段；租户设置开启 `anonymizeIp` 时先解析地域再匿名化存储 IP。

## 会话与停留

- `sessionId` 存于 sessionStorage，闲置超过 `sessionTimeoutMinutes`（默认 30 分钟）自动开启新会话。
- 服务端按 `sessionId` 聚合维护 `analytics_sessions`：页数、事件数、入口/出口页、时长、是否跳出；同一事务内同步 upsert `analytics_user_profiles` 用户画像。

## 远程配置与热更新

SDK 启动时拉取 `GET /api/analytics/config`（匿名可带 `X-Analytics-Site-Key` 请求头或 `?siteKey=` 参数），应用「数据管理 → 采集设置」中的配置：

- `enabled`：总开关
- `sampleRate`：采样率（按会话决定是否采集）
- `trackPageviews` / `trackClicks` / `trackPerformance` / `trackApi`：页面、点击、性能、API 自动监听开关
- `trackErrors`：错误监控与 API 5xx / 网络失败转报 `http_error` 的开关
- `maskInputs`：采集文本脱敏开关
- `blacklistPaths`：路径黑名单（命中则不采集）
- `respectDnt`：是否尊重浏览器 Do Not Track
- `sessionTimeoutMinutes`：会话闲置超时
- `trackReplay` / `replayOnError` / `replaySessionSampleRate` / `replayMaskAllText` / `replayBlockSelector`：会话回放开关、错误触发、全程采样率与打码策略（详见 [会话回放](./session-replay)）

错误忽略规则 `errorIgnorePatterns` 保存在采集设置中，由服务端错误上报入口按正则匹配 `message` 后丢弃，不属于 `/analytics/config` 下发给 SDK 的公开配置。

配置解析按身份归属：登录管理员 → 当前租户配置；会员 → 会员租户配置；匿名带 siteKey → 站点租户配置（并返回 `siteId` / `appId`）；租户无配置时回退平台级（`tenantId=null`）配置。错误监控使用同一组 `enabled` / `trackErrors` / `respectDnt` 开关。

**配置热更新**（保存设置后无需刷新页面）通过三条通道生效：

1. **WebSocket 广播**：设置保存后服务端广播 `analytics:config-updated`（仅携带 `tenantId`，不下发配置内容），`AdminLayout` 匹配当前租户视角后调用 `reloadTrackerConfig()` 重拉配置。
2. **兜底轮询 + 跨标签同步**：SDK 每 60 秒周期性重拉配置；重拉发现版本变化时写当前 deployment namespace 下的 localStorage 配置版本号（`ANALYTICS_CONFIG_VERSION_KEY`），其他同项目标签页通过 storage 事件同步重拉，不同派生项目不会互相触发。
3. **宿主直推**：宿主应用可调用 `applyRemoteConfig(config)` 通过自有实时通道直接下发配置对象。

**Pre-buffer**：远程配置返回前产生的事件先暂存（最多 100 条），配置就绪后按最终配置（开关/采样/黑名单）过滤重放；若页面在配置就绪前卸载，按默认全开配置放行发送，避免冷启动丢事件。

## 站点 siteKey（匿名采集）

面向非登录场景（官网、活动页、会员端匿名访问），SDK 可配置站点 `siteKey`（`zk_` 前缀），随上报/拉配置请求以 `X-Analytics-Site-Key` 头携带。匿名事件按站点归属租户，并受站点来源白名单与日配额约束。站点管理见 [数据管理 · 站点管理与 site key](./data-management#站点管理与-site-key)。

## A/B 实验分流

SDK 内置轻量实验客户端：

- `fetchExperimentAssignments()`：调用公开端点 `GET /api/analytics/experiments/assignments`（匿名可带 `?distinctId=`，同样拒绝伪造 `u:` / `m:` 前缀）获取运行中实验的分流结果，localStorage 缓存 5 分钟（`zenith_tracker_exp_assignments`）。
- `getVariant(expKey)`：返回命中的变体 key（未命中参与流量时为 `null`），命中时自动上报 `$experiment_exposure` 曝光事件；同一会话内同一 `expKey + variantKey` 只上报一次（sessionStorage 去重）。

实验配置、分流算法与报告口径见 [行为分析 · A/B 实验](./behavior#a-b-实验最小闭环)。

## 可靠性

- **批量缓冲**：内存缓冲满 50 条或每 15 秒自动 flush，减少请求次数。
- **离线缓存重试**：上报失败 / 断网时事件落 localStorage 队列（上限 500 条），启动时及每 15 秒周期性补传。
- **卸载兜底**：页面卸载时按每片 20 条分片发送，规避 `sendBeacon` / `keepalive` 的 64KB 载荷上限；仅在既无登录 token 也无站点 siteKey 时使用 `sendBeacon`，否则使用带 Authorization / siteKey 头的 `fetch keepalive`，避免卸载事件丢失租户归属。
- **幂等重放**：每条新事件携带稳定 `eventId`，服务端重复接收时不会再次累计事件或会话。
- **不影响主应用**：所有采集逻辑包裹在 try/catch，异常静默丢弃，绝不阻塞业务。

## 隐私合规

- `maskInputs`：默认不采集输入框值；开启时对采集到的元素文本执行敏感信息正则脱敏，手机号 / 邮箱 / 身份证号替换为 `***`。
- `data-sensitive`：元素级别的采集文本豁免标记（含祖先继承）。
- `respectDnt`：开启后遵循浏览器 DNT 信号停止采集。
- `blacklistPaths`：可排除登录页等敏感路径。
- `anonymizeIp`（服务端设置）：地域解析后匿名化存储 IP。
- 会员端支持 `consentProvider` 注入同意状态，未同意前不采集。

## 服务端权威事件（`source='server'`）

除客户端 SDK 采集外，行为中心还接入了**服务端权威语义事件**：由后端业务代码在关键动作成功后直接写入 `user_events`，不经过 HTTP 采集接口，天然免受客户端篡改/丢失影响，用于支付、审批流转、会员关键行为等对准确性要求更高的场景。

### 设计要点

- **不阻断业务**：`services/analytics/analytics-server-events.service.ts` 导出的 `trackServerEvent(input)` 调用后立即返回（`queueMicrotask` 异步执行），内部任何异常（治理拒绝、DB 失败、参数非法）都仅 `logger.warn/error` 记录后吞掉，绝不影响调用方的业务事务或事件总线投递。
- **幂等**：`eventId` 复用来源事件自身的 `eventId`（支付 `PaymentEvent.eventId` / 工作流 `WorkflowEvent.eventId`），无来源 `eventId` 时（如会员业务调用点）自动 `randomUUID()` 生成；写入走 `ON CONFLICT DO NOTHING`，与 SDK 事件共用同一条唯一索引语义。
- **身份优先级**：会员 `m:{memberId}` > 管理员 `u:{userId}` > 匿名兜底 `server:{appId}`；`memberId` / `userId` 互斥，不会同时携带。
- **固定字段**：`eventType='custom'`、`source='server'`、`pagePath='/server'` 或 `/server/<domain>`、落库 `sessionId=null`，`environment` 按 `NODE_ENV` 映射到 `production`/`development`（`test` 与其它取值一律归为 `development`，与共享类型 `AnalyticsEnvironment` 仅允许的 3 个取值对齐）。
- **属性白名单 + 安全裁剪**：所有调用点只传入业务标量字段白名单（订单号、金额、渠道、流程节点、任务状态、变更字段名等），不传递密钥、完整实体、`formData`/`attachments`。`trackServerEvent` 内部对 `properties` 做键数/嵌套深度/字节大小上限校验，超限直接丢弃为 `null` 而非截断，避免半截脏数据。
- **复用既有治理**：与 SDK 事件共用采集治理的 `evaluateEvents()`——全局屏蔽、租户覆盖、严格模式 Schema 校验、质量记录语义完全一致；HTTP 来源推断 helper（会拒绝 `server` 来源）不用于此路径。
- **不创建会话**：服务端事件不写 `analytics_sessions`，避免一个事件膨胀出一条会话；如需查看服务端事件序列，直接按 `eventName`/`distinctId` 在事件分析工作台或用户时间线中查询。

### 事件清单（33 个）

| 来源 | 事件名 | 触发点 |
|------|--------|--------|
| 客户端系统事件 | `$experiment_exposure`、`page_not_found`、`page_forbidden` | `getVariant()` 命中实验变体时自动曝光；404 / 403 页面组件分别上报导航失败事件 |
| 支付总线 `paymentEventBus` | `payment.succeeded` / `payment.closed` / `payment.failed` / `refund.succeeded` / `refund.failed` | `lib/payment-event-bus.ts` 的 5 种事件类型，`analytics-server-event-subscribers.ts` 通过 `onAny` 桥接，属性仅含 `orderNo`/`bizType`/`bizId`/`channel`/`amount`（退款事件另含 `refundNo`/`refundAmount`），不含 `outTradeNo` 等网关凭据 |
| 工作流总线 `workflowEventBus` | `workflow.instance.created/approved/rejected/withdrawn`、`workflow.node.entered/left`、`workflow.task.created/assigned/approved/rejected/skipped/transferred/addSigned/reduceSigned/urged`（共 15 种） | `WorkflowEventType` 全部 15 个类型，`analytics-server-event-subscribers.ts` 通过 `onAny` 桥接；`userId` 按 `actor.userId > instance.initiatorId > task.assigneeId` 兜底取值；属性仅含 `instanceId`/`nodeKey`/`taskId`/`status` 等标量，不展开 `task`/`formData` |
| 会员业务 | `member.registered` | `member-auth.service.ts::registerMember` 成功后（是否有手机号/邮箱的布尔标记，不传原值） |
| 会员业务 | `member.profile.updated` | `member-auth.service.ts::updateMyMemberProfile` 成功后（仅传变更字段名数组，不传变更后的值） |
| 会员业务 | `member.points.earned` / `redeemed` / `adjusted` / `expired` / `refunded` | `member-points.service.ts::changePoints` 按交易类型映射（`amount`/`balanceAfter`/`bizType`/`bizId`） |
| 会员业务 | `member.coupon.received` / `member.coupon.redeemed` | `coupons.service.ts::receiveCoupon` / `redeemCoupon` 成功后（`couponId`/`memberCouponId`/`bizType`/`bizId`） |
| 会员业务 | `member.checkin.completed` | `member-checkin.service.ts::doCheckin` 成功后（连续天数、奖励积分等已有返回标量） |

上述 3 个客户端系统事件与 30 个服务端权威事件共同构成语义事件清单 `ANALYTICS_SEMANTIC_EVENT_NAMES`。事件名常量统一定义于 `packages/shared/src/{业务域}/constants.ts`（`ANALYTICS_SEMANTIC_EVENT_NAMES` / `ANALYTICS_EVENT_NAMES` / `ANALYTICS_MEMBER_POINTS_EVENT_BY_TX_TYPE`），业务调用点**只引用常量**，禁止裸字符串拼写事件名。Tracking Plan 种子 `packages/shared/src/seed/{业务域}.ts` 的 `SEED_ANALYTICS_EVENT_META` 覆盖以上事件的 `displayName`/`category`/`propertySchema`（含 `required`/`type`/`pii` 标注），由 `db/seed.ts` 写入 `analytics_event_meta` 表，MSW Mock（`mocks/handlers/analytics.ts`）从同一常量派生初始数据，避免前后端/Mock 三处重复维护。

> 会员钱包充值走已有支付中心下单流程，由 `payment.succeeded` 覆盖，不在会员钱包模块单独重复打点；`exchangePointsForCoupon()` 等内部跨模块调用因无法安全界定"最外层业务成功"时机，不接入积分事件，落地范围以上述清单为准。
