# 埋点采集 SDK

埋点 SDK 位于独立 workspace 包 `packages/analytics-sdk`（`@zenith/analytics-sdk`），在应用启动时由 `App` 调用 `initTracker()` 自动初始化，对标 PostHog autocapture / 神策全埋点。

## SDK 独立包

`@zenith/analytics-sdk` 承载框架无关的 tracker、error-reporter 与 breadcrumbs 核心逻辑；`packages/web/src/utils/tracker.ts`、`error-reporter.ts`、`breadcrumbs.ts` 仅保留薄适配层并继续 re-export SDK API，因此业务侧仍从 `@/utils/tracker` 等旧路径导入。

SDK 不直接读取 Vite 环境变量。Web 适配层在初始化时注入 `apiBase`（默认 `VITE_API_BASE_URL || '/api'`）、`sdkVersion`（`VITE_APP_VERSION || '0.0.0'`）与 `environment`；会员端继续通过 `configureTracker()` 覆盖 `tokenKey/source/appId/rootSelector/consentProvider` 等运行时参数。

## 自动采集（零代码）

初始化后默认开启以下全自动采集，**无需在业务页面写任何埋点代码**：

| 能力 | 说明 |
|------|------|
| 页面浏览 | `AdminLayout` 全局接入 `usePageTracker`，所有后台页面自动记录 `$pageview` 进入 + `$pageleave` 离开（含停留时长），标题取自菜单 |
| 元素点击 | 全局捕获 `button` / `a` / `[role=button]` / `input[type="submit"]` / `input[type="button"]` / `[data-track]` 点击，上报 `$autocapture`（按钮文案作为 `elementLabel`） |
| Web Vitals | 自动采集 `LCP` / `INP` / `CLS` / `FCP` / `TTFB`，上报为 `perf` 事件（`eventName=$web_vitals`） |
| API 监控 | 拦截 `fetch` / `XHR`，记录慢请求（>2s）与 4xx/5xx，上报 `api_request`；5xx / 网络失败额外转为 `http_error` 错误上报 |

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

## 手动埋点 API

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

## 身份识别

- 登录后自动 `identify(userId, username)`；退出前先使用旧 token 尽力发送旧身份缓冲，再重置会话与采样状态，避免共享设备上的跨账号数据串写。
- 未登录时使用持久化的 `anonymousId`（localStorage）；登录后事件携带 `distinctId = u:{userId}`，实现匿名 → 登录的身份合并。
- 登录请求的 `distinctId` 最终由服务端 JWT 身份强制生成，客户端无法伪造其他登录用户。

## 上报字段与接口

埋点统一批量上报到 `POST /api/analytics/events`，请求体为 `{ "events": [...] }`（单批最多 100 条）。每条事件包含：

- 幂等、身份与会话：`eventId`（UUID）、`sessionId`、`anonymousId`、`distinctId`
- 事件：`eventType`（`page_view` / `page_leave` / `feature_use` / `area_click` / `custom` / `perf` / `api_request` / `identify`）、`eventName`
- 页面与元素：`pagePath`、`pageTitle`、`elementKey`、`elementLabel`、`componentArea`
- 行为数值：`clickX` / `clickY`（0–100 归一化坐标）、`scrollDepth`、`durationMs`
- 属性与来源：`properties`、`referrer`、`utmSource` / `utmMedium` / `utmCampaign` / `utmTerm` / `utmContent`
- 环境与性能：`screenW`、`screenH`、`language`、`metricName`、`metricValue`

服务端根据请求 IP 与 UA 补充浏览器、操作系统、设备类型、IP 与地域字段。

## 会话与停留

- `sessionId` 存于 sessionStorage，闲置超过 `sessionTimeoutMinutes`（默认 30 分钟）自动开启新会话。
- 服务端按 `sessionId` 聚合维护 `analytics_sessions`：页数、事件数、入口/出口页、时长、是否跳出。

## 远程配置

SDK 启动时拉取 `GET /api/analytics/config`，应用「数据管理 → 采集设置」中的配置：

- `enabled`：总开关
- `sampleRate`：采样率（按会话决定是否采集）
- `trackClicks` / `trackPerformance` / `trackApi`：点击、性能、API 自动监听开关
- `trackErrors`：API 5xx / 网络失败转报 `http_error` 的开关
- `blacklistPaths`：路径黑名单（命中则不采集）
- `respectDnt`：是否尊重浏览器 Do Not Track
- `sessionTimeoutMinutes`：会话闲置超时

错误监控使用同一组 `enabled` / `trackErrors` / `respectDnt` 开关；关闭采集或错误采集后不会继续上传堆栈和行为面包屑。

## 可靠性

- **批量缓冲**：内存缓冲满 50 条或每 15 秒自动 flush，减少请求次数。
- **离线缓存重试**：上报失败 / 断网时事件落 localStorage 队列（上限 500 条），启动时及每 15 秒周期性补传。
- **卸载兜底**：匿名事件优先使用 `sendBeacon` 分片；登录态事件使用带 Authorization 的 `fetch keepalive`，避免卸载事件丢失租户归属。
- **幂等重放**：每条新事件携带稳定 `eventId`，服务端重复接收时不会再次累计事件或会话。
- **兼容窗口**：旧离线队列中没有 `eventId` 的事件仍可接收，服务端会累计告警计数；确认旧队列归零后再收紧为必填。
- **不影响主应用**：所有采集逻辑包裹在 try/catch，异常静默丢弃，绝不阻塞业务。

## 隐私合规

- `maskInputs`：默认不采集输入框值。
- `respectDnt`：开启后遵循浏览器 DNT 信号停止采集。
- `blacklistPaths`：可排除登录页等敏感路径。

## 服务端权威事件（`source='server'`）

除客户端 SDK 采集（`source='web'`）外，行为中心还接入了**服务端权威语义事件**：由后端业务代码在关键动作成功后直接写入 `user_events`，不经过 HTTP 采集接口，天然免受客户端篡改/丢失影响，用于支付、审批流转、会员关键行为等对准确性要求更高的场景。

### 设计要点

- **不阻断业务**：`services/analytics/analytics-server-events.service.ts` 导出的 `trackServerEvent(input)` 调用后立即返回（`queueMicrotask` 异步执行），内部任何异常（治理拒绝、DB 失败、参数非法）都仅 `logger.warn/error` 记录后吞掉，绝不影响调用方的业务事务或事件总线投递。
- **幂等**：`eventId` 复用来源事件自身的 `eventId`（支付 `PaymentEvent.eventId` / 工作流 `WorkflowEvent.eventId`），无来源 `eventId` 时（如会员业务调用点）自动 `randomUUID()` 生成；写入走 `ON CONFLICT DO NOTHING`，与 SDK 事件共用同一条唯一索引语义。
- **身份优先级**：会员 `m:{memberId}` > 管理员 `u:{userId}` > 匿名兜底 `server:{appId}`；`memberId` / `userId` 互斥，不会同时携带。
- **固定字段**：`eventType='custom'`、`source='server'`、`pagePath='/server'` 或 `/server/<domain>`、`sessionId=eventId`（保证 36 字符恰好等于 `sessionId` 列长度）、`environment` 按 `NODE_ENV` 映射到 `production`/`development`（`test` 与其它取值一律归为 `development`，与共享类型 `AnalyticsEnvironment` 仅允许的 3 个取值对齐）。
- **属性白名单 + 安全裁剪**：所有调用点只传入业务标量字段白名单（订单号、金额、渠道、流程节点、任务状态、变更字段名等），不传递密钥、完整实体、`formData`/`attachments`。`trackServerEvent` 内部对 `properties` 做键数/嵌套深度/字节大小上限校验，超限直接丢弃为 `null` 而非截断，避免半截脏数据。
- **复用既有治理**：与 SDK 事件共用 `analytics-ingest-governance` 的 `evaluateEvents()`——全局屏蔽、租户覆盖、严格模式 Schema 校验、质量记录语义完全一致；HTTP 来源推断 helper（会拒绝 `server` 来源）不用于此路径。
- **不创建会话**：服务端事件不写 `analytics_sessions`，避免一个事件膨胀出一条会话；如需查看服务端事件序列，直接按 `eventName`/`distinctId` 在事件分析工作台或用户时间线中查询。

### 首批事件清单（30 个）

| 来源 | 事件名 | 触发点 |
|------|--------|--------|
| 支付总线 `paymentEventBus` | `payment.succeeded` / `payment.closed` / `payment.failed` / `refund.succeeded` / `refund.failed` | `lib/payment-event-bus.ts` 的 5 种事件类型，`analytics-server-event-subscribers.ts` 通过 `onAny` 桥接，属性仅含 `orderNo`/`bizType`/`bizId`/`channel`/`amount`（退款事件另含 `refundNo`/`refundAmount`），不含 `outTradeNo` 等网关凭据 |
| 工作流总线 `workflowEventBus` | `workflow.instance.created/approved/rejected/withdrawn`、`workflow.node.entered/left`、`workflow.task.created/assigned/approved/rejected/skipped/transferred/addSigned/reduceSigned/urged`（共 15 种） | `WorkflowEventType` 全部 15 个类型，`analytics-server-event-subscribers.ts` 通过 `onAny` 桥接；`userId` 按 `actor.userId > instance.initiatorId > task.assigneeId` 兜底取值；属性仅含 `instanceId`/`nodeKey`/`taskId`/`status` 等标量，不展开 `task`/`formData` |
| 会员业务 | `member.registered` | `member-auth.service.ts::registerMember` 成功后（是否有手机号/邮箱的布尔标记，不传原值） |
| 会员业务 | `member.profile.updated` | `member-auth.service.ts::updateMyMemberProfile` 成功后（仅传变更字段名数组，不传变更后的值） |
| 会员业务 | `member.points.earned` / `redeemed` / `adjusted` / `expired` / `refunded` | `member-points.service.ts::changePoints` 按交易类型映射（`amount`/`balanceAfter`/`bizType`/`bizId`） |
| 会员业务 | `member.coupon.received` / `member.coupon.redeemed` | `coupons.service.ts::receiveCoupon` / `redeemCoupon` 成功后（`couponId`/`memberCouponId`/`bizType`/`bizId`） |
| 会员业务 | `member.checkin.completed` | `member-checkin.service.ts::doCheckin` 成功后（连续天数、奖励积分等已有返回标量） |

事件名常量统一定义于 `packages/shared/src/constants.ts`（`ANALYTICS_SEMANTIC_EVENT_NAMES` / `ANALYTICS_EVENT_NAMES` / `ANALYTICS_MEMBER_POINTS_EVENT_BY_TX_TYPE`），业务调用点**只引用常量**，禁止裸字符串拼写事件名。Tracking Plan 种子 `packages/shared/src/seed-data.ts` 的 `SEED_ANALYTICS_EVENT_META` 覆盖以上全部 30 个事件的 `displayName`/`category`/`propertySchema`（含 `required`/`type`/`pii` 标注），由 `db/seed.ts` 写入 `analytics_event_meta` 表，MSW Mock（`mocks/handlers/analytics.ts`）从同一常量派生初始数据，避免前后端/Mock 三处重复维护。

> 会员钱包充值走已有支付中心下单流程，由 `payment.succeeded` 覆盖，未在会员钱包模块单独重复打点；`exchangePointsForCoupon()` 等内部跨模块调用因无法安全界定"最外层业务成功"时机，暂未接入积分事件，落地范围以上述清单为准。
