# 通知中心

本页描述 Zenith Admin 当前通知中心实现：通知事件目录、`notify()` 统一派发、站内信/邮件/短信/App 推送/Webhook/聊天卡片渠道、偏好矩阵、免打扰、摘要与投递留痕。事实来源以 `packages\shared\src\messaging`、`packages\server\src\services\messaging`、`packages\server\src\lib\notification`、`packages\server\src\routes\messaging` 为准。

## 模块边界

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 事件与类型 | `packages\shared\src\messaging\notification-events.ts`、`constants.ts`、`types.ts` | 通知事件目录、渠道枚举、收件人类型、偏好/策略/派发日志契约 |
| 派发入口 | `packages\server\src\services\messaging\notification-outbox.service.ts` | `notify()`、`notifyWithin()`、Outbox、补投、摘要聚合 |
| 派发引擎 | `packages\server\src\lib\notification` | 策略解析、免打扰/摘要/频控、渠道适配器注册与实际投递 |
| 业务渠道 | `packages\server\src\services\messaging` | 邮件、短信、站内信、公告、频道、客服、策略与偏好服务 |
| HTTP 路由 | `packages\server\src\routes\messaging` | `/api/notification-*`、`/api/in-app-*`、`/api/email-*`、`/api/sms-*`、`/api/channels`、`/api/announcements` |
| 前端页面 | `packages\web\src\pages\system`、聊天相关页面 | 通知策略、偏好、模板、收件记录、频道管理、客服工作台、公告等 |

## 统一通知模型

通知中心采用“事件声明 + Outbox + 渠道适配器”的模型：

1. 业务域只调用 `notify(eventKey, input)` 或在事务中调用 `notifyWithin(executor, eventKey, input)`。
2. `eventKey` 必须存在于 `NOTIFICATION_EVENTS`，变量形状由 TypeScript 约束。
3. `notifyWithin()` 写入 `notification_outbox`；事务回滚时通知不会发出。
4. 非定时通知在写入后调用 `flushNotification(id)` 异步派发；定时、免打扰延后与摘要行由系统任务扫描。
5. 派发时展开为“收件人 × 渠道”，每个结论写入 `notification_dispatches`。
6. 单个渠道或收件人失败不影响同一事件的其他渠道/收件人。

### 补投与并发边界

系统任务「补投通知事件」每分钟运行一次 `dispatchPendingNotifications()`：

- **批量认领**：`UPDATE … WHERE id IN (SELECT id … ORDER BY id LIMIT 32 FOR UPDATE SKIP LOCKED) RETURNING *`，一条语句完成取行与认领，按入队顺序处理；多实例各取互不重叠的一批，没有重复扫描与认领竞争。
- **有界并发**：一批内最多 8 行同时派发；派发引擎另有进程级限流器把「收件人 × 渠道」的在飞投递总数钉在 32（`NOTIFICATION_DELIVERY_CONCURRENCY`），跨补投与请求内立即派发两个入口共用——一次 300 人的群发不会同时打开 300 个 SMTP / HTTP 连接。
- **循环排空**：认领 → 派发 → 再认领，直到没有可认领的行或用完 45 s 预算，不再受单轮扫描条数限制；下一分钟的任务与仍在运行的上一轮互不干扰（行已被认领）。
- **失败重试**：单行失败只影响自身，`attempts + 1` 且保留认领时间，因此下一次重试要等认领超时（5 分钟）；5 次仍失败置 `failed`。认领超时同时兜住实例崩溃：崩溃时已认领未完成的行（最多一批 32 行）在 5 分钟后重新可认领。
- **SMTP 连接池**：`lib/email.ts` 按 SMTP 配置指纹缓存一个 nodemailer 连接池（5 连接、每连接 200 封后轮换、连接 / 握手 10 s、socket 30 s 超时），配置变更即换池；邮件不再逐封握手，超出池容量的发送在池内排队。

基准（`packages/server/scripts/bench-notification-outbox.ts`，假 webhook 适配器固定 300 ms 延迟，隔离数据库；原始数据 [`docs/backend/perf/`](https://github.com/iwangbowen/zenith-admin/tree/master/docs/backend/perf)）：

| 场景 | 排空耗时 | 吞吐 | 在飞投递峰值 |
| --- | --- | --- | --- |
| 200 行 × 1 收件人 | 64.1 s → **8.1 s** | 3.1 → 24.6 行/s | 1 → 8 |
| 40 行 × 25 收件人（1,000 次投递） | 12.8 s → 10.0 s | 3.1 → 4.0 行/s | 25（= 单行扇出，无上限）→ **32（硬上限）** |

单收件人场景此前一轮 200 行要 64 s，超过任务的 1 分钟周期；大扇出场景的收益不在耗时而在边界：并发从「随扇出无界增长」变为固定上限。

`NotificationRecipient` 支持：

- `{ type: 'user'; id }`：管理端用户，参与偏好与免打扰。
- `{ type: 'member'; id }`：会员身份，参与偏好与免打扰。
- `{ type: 'external'; channel; address }`：外部邮箱或 Webhook 地址，不绑定账号，不读取个人偏好，只按指定渠道投递。

`NotificationChannelPolicy` 可通过 `only`、`enable`、`disable` 调整单次派发候选渠道，常用于流程通知渠道、告警规则渠道等管理员配置场景。

## 事件目录

事件目录是代码中的唯一事实源，不落库；数据库只存管理员覆盖与用户偏好。事件定义包含分组、中文名、级别、默认渠道、可选渠道、必达、免打扰穿透、模板 code、频控与变量类型。

### 分组与事件

| 分组 | 事件 key |
| --- | --- |
| 知识中心 `wiki` | `wiki.doc.published`、`wiki.doc.commented`、`wiki.doc.mentioned`、`wiki.doc.reviewed`、`wiki.governance.maintenance_due`、`wiki.governance.review_due` |
| 工作流 `workflow` | `workflow.task.created`、`workflow.task.cc`、`workflow.task.urged`、`workflow.task.transferred`、`workflow.instance.approved`、`workflow.instance.rejected`、`workflow.instance.withdrawn`、`workflow.instance.returned`、`workflow.consult.invited`、`workflow.consult.replied`、`workflow.comment.mentioned`、`workflow.node.exception`、`workflow.automation.message` |
| 组织与租户 `identity` | `identity.tenant.expiring`、`identity.tenant.expired` |
| 运维与告警 `ops` | `ops.monitor.alert`、`ops.monitor.alert_test`、`ops.error.alert`、`ops.scheduler.job_failed`、`ops.scheduler.task_alert`、`ops.license.expiring`、`ops.license.invalid` |
| 开放平台 `open-platform` | `open-platform.app.review_requested`、`open-platform.app.reviewed`、`open-platform.webhook.delivery_failed`、`open-platform.quota.threshold_exceeded` |
| 报表中心 `report` | `report.dashboard.mentioned` |
| 平台服务 `platform` | `platform.feedback.handled`、`platform.export.finished` |
| 通知中心 `messaging` | `messaging.digest`（隐藏元事件，用于摘要邮件） |

### 级别与规则

| 字段 | 当前含义 |
| --- | --- |
| `severity` | `normal`、`important`、`critical`；`critical` 默认穿透免打扰 |
| `defaultChannels` | 收件人未配置偏好时默认开启的渠道 |
| `availableChannels` | 偏好矩阵允许用户开关的渠道；省略时等于默认渠道 |
| `mandatory` | 必达事件，用户不可关闭，派发时跳过个人偏好；仍允许管理员通过覆盖调整渠道 |
| `bypassQuietHours` | 直接投递，不受免打扰时段影响 |
| `templates` | 渠道模板 code；未配置时使用事件自带 title/content 模板 |
| `rateLimit` | 同一收件人、同一事件、同一渠道在窗口内的成功投递上限 |
| `hidden` | 不出现在偏好矩阵，例如 `messaging.digest` |

## 渠道

通知中心渠道枚举为 `inapp`、`email`、`sms`、`push`、`webhook`、`chat`。适配器通过 `registerNotificationAdapter()` 集中注册，未注册渠道会留下 `channel_unavailable` 结论，不会静默丢弃。

| 渠道 | 当前实现 |
| --- | --- |
| `inapp` | 写入 `in_app_messages`，支持模板、已读、批量已读、删除、管理端查看；消息可带 `link` 深链 |
| `email` | 使用 `email_configs` 的 SMTP 配置发送，支持 `email_templates` 与 `email_send_logs`；退订链接通过邮件渠道提供 |
| `sms` | 支持阿里云、腾讯云配置与模板，发送记录写 `sms_send_logs`；模板变量可显式指定以避免 JSON 键序影响服务商位置参数 |
| `push` | App 推送，经聚合供应商（极光）投递到移动/桌面客户端，按收件人查统一设备中心的在活绑定设备，发送记录写 `push_send_logs`，详见 [App 推送](./push) |
| `webhook` | 通过 `channelOptions.webhook.url/body` 投递，适合告警和外部接收人 |
| `chat` | 作为聊天卡片渠道接入通知适配器；系统调度告警等事件可声明可用 |

旧的独立能力仍保留：邮件模板/日志、短信模板/日志、站内信模板/收件记录、公告、频道与客服工作台。这些能力与通知中心共用消息域，但 `notify()` 是跨业务事件通知的统一入口。

## 偏好、策略、免打扰与摘要

### 策略覆盖

管理员通过 `/api/notification-policies/events` 读取事件目录与当前作用域覆盖，通过 `/api/notification-policies/overrides` 保存覆盖，通过 `/api/notification-policies/overrides/reset` 恢复默认。

覆盖存储在 `notification_event_overrides`，是稀疏表：只保存与代码默认值不同的 `eventKey + channel`。`tenantId = null` 表示平台级覆盖；租户视图读取平台覆盖与本租户覆盖，租户覆盖优先。`locked = true` 时用户偏好不能关闭该渠道。

### 个人偏好

用户通过 `/api/notification-preferences/matrix` 读取偏好矩阵，通过同路径 `PUT` 保存开关；全局设置由 `/api/notification-preferences/settings` 读写。

偏好存储在 `notification_preferences`，也是稀疏表：保存值等于“事件默认 + 平台/租户覆盖”的生效默认时会删行。全局设置存 `notification_recipient_settings`：

- `globalMuted`：全局免打扰，非必达事件被抑制。
- `timezone`：免打扰和每日摘要按收件人本地时区计算，默认 `Asia/Shanghai`。
- `quietStart` / `quietEnd`：`HH:mm`，支持跨零点窗口；命中时写 `deferred` 并按结束时间重投。
- `digestMode`：`realtime`、`hourly`、`daily`。
- `digestHour`：每日摘要投递小时，默认 9。

摘要只作用于邮件渠道，且不作用于必达或穿透免打扰的事件。摘要行带 `digestKey`，由 `aggregateNotificationDigests()` 聚合后通过 `notify('messaging.digest')` 发送一封邮件。

提示音不属于投递策略，是客户端播放偏好：「通知设置」Tab 的「提醒音效」开关与音色（清脆双音 / 单音提示 / 轻柔气泡）存在用户偏好（`UserPreferences.notificationSound` / `notificationSoundStyle`，随账号同步，无服务端字段），站内信与公告经 WebSocket 实时到达时由 `layouts/admin/useLayoutWs.ts` 调用 `utils/notification-sound.ts` 用 WebAudio 合成播放，聊天新消息提示音复用同一音色。全局静音与免打扰时段本就不推送站内信，音效随之静默。

### 派发归因

`notification_dispatches` 记录所有“收件人 × 渠道”的结果，包括成功、抑制、延后、去重和失败。决策与原因如下：

| decision | 含义 |
| --- | --- |
| `sent` | 已投递 |
| `suppressed` | 被偏好、全局免打扰、渠道不可用、不可达或频控抑制 |
| `deferred` | 因免打扰或摘要延后 |
| `deduped` | 幂等键命中，重复投递被忽略 |
| `failed` | 渠道投递失败 |

| reasonCode | 含义 |
| --- | --- |
| `preference_off` | 收件人关闭该事件/渠道，或 external 收件人与候选渠道不匹配 |
| `globally_muted` | 收件人开启全局免打扰 |
| `channel_unavailable` | 渠道未启用或没有适配器 |
| `unreachable` | 收件人缺少邮箱、手机号、Webhook 地址等可达地址 |
| `rate_limited` | 触发事件频控 |
| `quiet_hours` | 命中免打扰时段 |
| `digest` | 进入摘要队列 |
| `delivery_error` | 渠道发送异常 |

`GET /api/notification-policies/dispatches` 可按事件、渠道、决策、收件人类型、收件人 ID 与派发时间查询日志。

## 独立通知能力

### 站内信

| 表 | 说明 |
| --- | --- |
| `in_app_templates` | 模板：code、title、content、type、variables、status、remark、tenantId |
| `in_app_messages` | 收件记录：templateId、userId、title、content、type、isRead、readAt、source、senderId、link、dedupeKey、tenantId |

用户侧接口：`GET /api/in-app-messages`、`GET /api/in-app-messages/unread-count`、`GET /api/in-app-messages/{id}`、`POST /api/in-app-messages/send`、`POST /api/in-app-messages/{id}/read`、`POST /api/in-app-messages/read-all`、`POST /api/in-app-messages/batch-read`、`DELETE /api/in-app-messages/{id}`、`DELETE /api/in-app-messages/batch`。管理端接口：`GET /api/in-app-messages/admin`、`POST /api/in-app-messages/admin/read-all`、`POST /api/in-app-messages/admin/{id}/read`、`DELETE /api/in-app-messages/admin/{id}`。

### 公告

| 表 | 说明 |
| --- | --- |
| `announcements` | title、content、type、publishStatus、priority、targetType、publishTime、createBy、tenantId |
| `announcement_recipients` | 定向公告接收人：`user`、`role`、`dept` |
| `announcement_reads` | 用户已读记录 |

用户侧接口：`GET /api/announcements/published`、`GET /api/announcements/unread-count`、`GET /api/announcements/inbox`、`POST /api/announcements/{id}/read`、`POST /api/announcements/read-all`。管理端接口：`GET /api/announcements`、`GET /api/announcements/{id}`、`GET /api/announcements/{id}/read-stats`、`POST /api/announcements`、`PUT /api/announcements/{id}`、`DELETE /api/announcements/{id}`、`DELETE /api/announcements/batch`。

公告 `content` 为富文本 HTML：创建 / 更新时在服务端持久化边界经 `sanitizeCmsHtml`（与 CMS 正文同一白名单：剔除脚本、事件属性、`javascript:` 链接、iframe 等）净化落库，渲染端 DOMPurify 只是兜底；列表 / 首页摘要用 `stripHtml`（基于惰性 `DOMParser`，不会触发 `<img onerror>` 之类的解析期副作用）生成纯文本。

### 邮件与短信

| 能力 | API | 权限 |
| --- | --- | --- |
| 邮件配置 | `GET /api/email-config`、`PUT /api/email-config`、`POST /api/email-config/test` | `system:email-config:view`、`system:email-config:update` |
| 邮件模板 | `GET/POST /api/email-templates`、`GET/PUT/DELETE /api/email-templates/{id}` | `system:email-template:*` |
| 邮件日志 | `GET /api/email-send-logs`、`DELETE /api/email-send-logs/{id}`、`POST /api/email-send-logs/test-send` | `system:email-send-log:list`、`system:email-send-log:delete`、`system:email-config:update` |
| 短信配置 | `GET/POST /api/sms-configs`、`GET/PUT/DELETE /api/sms-configs/{id}`、`POST /api/sms-configs/{id}/default` | `system:sms-config:*` |
| 短信模板 | `GET/POST /api/sms-templates`、`GET/PUT/DELETE /api/sms-templates/{id}` | `system:sms-template:*` |
| 短信日志 | `GET /api/sms-send-logs`、`DELETE /api/sms-send-logs/{id}`、`POST /api/sms-send-logs/test-send` | `system:sms-send-log:*` |

### 频道、客服与数据看板

频道体系使用 `channels`、`channel_messages`、`channel_subscriptions`、`channel_message_targets`、`channel_menus`、`channel_auto_replies`、`channel_quick_replies`、`channel_conversations`、`channel_message_templates`。

主要能力：

- 用户侧：我的频道、频道消息、已读、可订阅频道、订阅/退订、用户向频道发消息、会话评价。
- 管理侧：频道 CRUD、订阅者管理、菜单配置、自动回复、群发、草稿/定时/撤回、消息模板、测试发送、受众估算。
- 客服侧：可服务频道、会话聚合、对话消息、回复、指派/转接、解决、标签、快捷回复、绩效统计。
- 看板：运营号数量、订阅数、消息数、今日推送、待处理会话、平均响应时长、趋势、已读率、排行、评分与自动回复命中分布。

主要权限：`channel:channel:list`、`channel:channel:create`、`channel:channel:update`、`channel:channel:delete`、`channel:message:publish`、`channel:menu:save`、`channel:reply:list`、`channel:reply:save`、`channel:reply:delete`、`channel:cs`、`channel:dashboard`。

## API 一览

| 根路径 | 主要能力 |
| --- | --- |
| `/api/notification-preferences` | `GET/PUT /matrix`、`GET/PUT /settings` |
| `/api/notification-policies` | `GET /events`、`PUT /overrides`、`POST /overrides/reset`、`GET /dispatches` |
| `/api/notification-unsubscribe/{token}` | 邮件退订页面读取与提交 |
| `/api/in-app-templates` | 站内信模板列表、详情、创建、更新、删除 |
| `/api/in-app-messages` | 我的站内信、未读数、已读、批量已读、删除、管理端收件记录 |
| `/api/email-config` | SMTP 配置读取、保存、测试 |
| `/api/email-templates` | 邮件模板 CRUD |
| `/api/email-send-logs` | 邮件发送记录、删除、测试发送 |
| `/api/sms-configs` | 短信配置 CRUD、设为默认 |
| `/api/sms-templates` | 短信模板 CRUD |
| `/api/sms-send-logs` | 短信发送记录、删除、测试发送 |
| `/api/announcements` | 公告发布、收件箱、已读、统计、管理 CRUD |
| `/api/channels` | 频道、订阅、消息、菜单、自动回复、客服工作台、消息模板、看板、受众估算 |

## 维护要求

- 新通知事件只改 `NOTIFICATION_EVENTS` 并在业务代码调用 `notify()` / `notifyWithin()`。
- 新渠道必须补充 `NotificationChannelAdapter` 并注册，否则只会留下 `channel_unavailable` 留痕。
- 管理员覆盖与个人偏好保持稀疏存储，不全量物化事件矩阵。
- 业务域不要直接调用邮件、短信、站内信发送函数来绕过通知中心。
