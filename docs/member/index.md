# 会员中心

会员中心提供前台 C 端会员体系与后台运营管理体系。前台会员存储在 `members` 表，后台管理员存储在 `users` 表，两套账号、认证中间件、Token 语义、Redis 会话前缀与前端入口均相互隔离。

---

## 双用户体系与认证隔离

| 维度 | 后台管理员 | 前台会员 |
|------|------------|----------|
| 用户表 | `users` | `members` |
| 认证接口 | `/api/auth/*` | `/api/member/auth/*` |
| 中间件 | `authMiddleware` | `memberAuthMiddleware` |
| 请求上下文 | `currentUser()` | `currentMember()` / `currentMemberId()` |
| 前端入口 | `index.html` | `member.html` |
| Token 存储 | `zenith_token` | `zenith_member_token` / `zenith_member_refresh_token` |

会员 Access Token 的 payload 固定包含 `type: 'member'`、`memberId`、`identifier`、`tenantId`、`jti`。`memberAuthMiddleware` 强制校验 `type: 'member'`，管理员 `authMiddleware` 会反向拒绝带 `type: 'member'` 的 Token，避免会员 Token 访问后台管理接口。

会员会话使用独立 Redis key：

| 用途 | Redis key |
|------|-----------|
| 在线会话 | `{REDIS_KEY_PREFIX}member-session:{jti}` |
| 强制下线黑名单 | `{REDIS_KEY_PREFIX}member-blacklist:{jti}` |

会员会话 TTL 为 8 小时，请求经过 `memberAuthMiddleware` 时会刷新活跃时间；黑名单 TTL 为 2 小时，与会员 Access Token 有效期一致。

---

## 会员认证

会员认证路由挂载在 `/api/member/auth`。

| 接口 | 说明 | 保护 |
|------|------|------|
| `POST /sms-code` | 发送短信验证码，场景为 `register` / `login` / `reset` | `sensitiveRateLimit` |
| `POST /register` | 会员注册，支持手机号验证码注册，也可设置密码 | `sensitiveRateLimit` |
| `POST /login` | 会员登录 | `authRateLimit` |
| `POST /refresh` | 使用 Refresh Token 刷新 Access Token | 公开 |
| `POST /reset-password` | 手机号 + 验证码重置密码 | `sensitiveRateLimit` |
| `POST /logout` | 退出登录并删除会员会话 | `memberAuthMiddleware` |
| `GET /me` | 获取当前会员资料 | `memberAuthMiddleware` |
| `PUT /profile` | 修改昵称、头像、性别、生日、邮箱 | `memberAuthMiddleware` |
| `PUT /password` | 修改登录密码 | `memberAuthMiddleware` |

登录支持 4 种凭证组合：

- 手机号 + 短信验证码：`loginType = 'sms'`
- 手机号 + 密码：`loginType = 'password'`，`account` 填手机号
- 邮箱 + 密码：`loginType = 'password'`，`account` 填邮箱
- 用户名 + 密码：`loginType = 'password'`，`account` 填用户名

密码使用 `bcryptjs`，hash 强度为 `10`。会员注册与后台创建会员都会在事务内初始化 `member_point_accounts` 与 `member_wallets`。

短信验证码存储在 Redis：

| 用途 | Redis key | TTL |
|------|-----------|-----|
| 验证码 | `{REDIS_KEY_PREFIX}member:smscode:{scene}:{phone}` | 5 分钟 |
| 发送间隔 | `{REDIS_KEY_PREFIX}member:smscode-interval:{phone}` | 60 秒 |

验证码校验成功后立即删除，防止重放。非生产环境接口会返回 `devCode` 便于联调，生产环境不返回验证码明文。

---

## 会员等级

会员等级配置存储在 `member_levels` 表，用于维护等级序号、成长值门槛、折扣与权益展示。

| 字段 | 说明 |
|------|------|
| `level` | 等级序号，数字越大等级越高，全局唯一 |
| `growth_threshold` | 升至该等级所需成长值 |
| `discount` | 等级折扣，百分比整数，`100` 表示原价，`95` 表示 95 折 |
| `benefits` | 权益描述数组 |
| `status` | `enabled` / `disabled` |

前台通过 `GET /api/member/levels` 查看启用等级权益；后台通过 `/api/member-levels` 管理等级。

### 会员标签（运营分群）

标签存储在 `member_tags` 表，绑定关系在 `member_tag_bindings`（`member_id + tag_id` 唯一，均级联删除）。

- 标签管理：`/api/member-tags`（列表带各标签会员数；增删改权限码 `member:member:update`，带审计）。前端入口在会员管理页「标签管理」弹窗。
- 会员打标：`PUT /api/members/{id}/tags`（覆盖式）、`PUT /api/members/batch-tags`（批量追加，`onConflictDoNothing` 跳过已有绑定）。
- 会员列表 / 详情 / 概览通过 RQB `tagBindings.tag` 附带 `tags` 数组；列表与导出支持 `tagId` 筛选。

系统种子等级包括普通会员、银卡会员、金卡会员、钻石会员，成长值门槛分别为 `0`、`1000`、`5000`、`20000`，折扣分别为 `100`、`98`、`95`、`90`。

### 成长值与自动定级

成长值（`members.growth_value`）驱动等级：任何成长值变动都会在同一事务内按 `growth_threshold` 匹配「最高满足档」自动升降级，低于所有阈值时等级置空，成长值下限钳制为 `0`。

- **签到 / 补签**：规则中的 `experience` 奖励在累加 `members.experience` 的同时，等额累加成长值并自动重定级（`applyGrowthDeltaInTx()`，与签到同事务）。
- **后台调整**：`POST /api/members/{id}/growth`（权限码 `member:member:update`，带审计与 `idempotencyGuard`），`delta` 可正可负，调整原因记入操作审计。
- **手动指定等级**：后台编辑会员或批量调整等级时，系统会把成长值抬升至目标等级门槛（`GREATEST(growth_value, threshold)`），避免后续成长值变动时被自动定级回退。

---

## 积分体系

积分账户表为 `member_point_accounts`，一名会员对应一个账户；流水表为 `member_point_transactions`。

| 表 | 关键字段 |
|----|----------|
| `member_point_accounts` | `member_id`、`balance`、`frozen`、`total_earned`、`total_spent`、`version` |
| `member_point_transactions` | `member_id`、`type`、`amount`、`balance_after`、`biz_type`、`biz_id`、`operator_id` |

积分为整数。流水类型为 `earn` / `redeem` / `expire` / `adjust` / `refund`。

`changePoints()` 是统一记账入口：在数据库事务中读取账户，计算余额，使用 `version` 乐观锁更新账户，并原子写入流水。余额不足时返回业务错误，乐观锁冲突通过 `withOptimisticRetry()` 重试。

后台管理员可通过 `POST /api/member-points/adjust` 手动调整积分，权限码为 `member:point:adjust`，流水 `bizType` 为 `admin_adjust`，并记录操作人 `operatorId`。该接口带 `idempotencyGuard({ ttlSeconds: 10 })` 防止双击/网络重试导致重复入账。

---

## 钱包体系

钱包账户表为 `member_wallets`，流水表为 `member_wallet_transactions`。金额单位统一为**分**（整数）。

| 表 | 关键字段 |
|----|----------|
| `member_wallets` | `member_id`、`balance`、`frozen`、`total_recharge`、`total_consume`、`version` |
| `member_wallet_transactions` | `member_id`、`type`、`amount`、`balance_after`、`biz_type`、`biz_id`、`payment_order_id`、`operator_id` |

钱包流水类型为 `recharge` / `consume` / `refund` / `adjust`。

`changeWallet()` 是统一记账入口：在事务中计算余额，使用 `version` 乐观锁更新账户，并写入永久流水。余额不足时拒绝扣减。

会员前台通过 `POST /api/member/wallet/recharge` 发起充值，该接口带 `idempotencyGuard({ ttlSeconds: 10 })`。充值会调用支付中心创建支付单：

- `bizType = 'member_recharge'`
- `bizId = String(memberId)`
- `subject = '会员钱包充值'`
- 过期时间为 30 分钟

支付成功后，`paymentEventBus` 触发 `payment.succeeded` 事件，`payment-subscribers.ts` 监听 `bizType = 'member_recharge'` 并调用 `creditWalletOnRecharge()` 入账。入账按支付单号做幂等校验：若 `member_wallet_transactions` 中已存在 `biz_type = 'member_recharge'` 且 `biz_id = orderNo` 的流水，则不重复入账。

后台支持手动调整余额与退款入账（两个接口均带 `idempotencyGuard({ ttlSeconds: 10 })` 防重复提交）：

- `POST /api/member-wallets/adjust`：权限码 `member:wallet:adjust`，流水 `bizType = 'admin_adjust'`
- `POST /api/member-wallets/refund`：权限码 `member:wallet:refund`，流水 `bizType = 'admin_refund'`

---

## 会员软删除

后台删除会员（`DELETE /api/members/{id}`）为**软删除**：仅设置 `members.deleted_at` 并强制下线全部会话，积分/钱包账户与流水、券码、签到与登录日志全部保留，用于审计与财务对账。

- `phone` / `email` / `username` 的唯一约束为**部分唯一索引**（`WHERE deleted_at IS NULL`），删除后同一标识符可再次注册。
- 已删除会员对列表、详情、下拉、导出、看板统计全部不可见；无法登录、无法刷新 Token；资金调整、发券、补签等操作会返回 404。

---

## 例行维护任务与数据导出

系统周期任务 `member-housekeeping`（每天 02:10，调度中心可手动执行）依次处理：

1. **优惠券过期**：`member_coupons` 中已过 `expire_at` 的未使用券批量置为 `expired`，保证统计与展示口径准确。
2. **积分不活跃过期**：由 system_config `member_point_expire_days` 控制（默认 `0` 不启用）；账户超过 N 天无任何积分变动时，余额通过 `changePoints(type='expire')` 清零并写 `bizType = 'points_inactive_expire'` 流水，可审计可对账。
3. **生日礼发放**：见「生日礼自动发放」章节。
4. **登录日志清理**：由 system_config `member_login_log_retention_days` 控制（默认 `180`，`0` 不清理），删除超期的 `member_login_logs`（表带 `(member_id, created_at)` 复合索引）。

会员域已注册 6 个导出中心实体（execution 为 `auto`，大数据量自动转异步任务）：

| 实体 | 页面 | 权限码 |
|------|------|--------|
| `member.members` | 会员管理 | `member:member:list` |
| `member.point-transactions` | 积分管理 | `member:point:list` |
| `member.wallet-transactions` | 钱包管理 | `member:wallet:list` |
| `member.coupon-records` | 领券记录 | `member:coupon:list` |
| `member.checkins` | 签到记录 | `member:checkin:log:list` |
| `member.recharges` | 充值记录 | `member:recharge:list` |
| `member.login-logs` | 登录日志 | `member:loginlog:list` |

---

## 优惠券

优惠券模板存储在 `coupons` 表，会员领券记录存储在 `member_coupons` 表。

| 表 | 关键字段 |
|----|----------|
| `coupons` | `type`、`face_value`、`threshold`、`max_discount`、`total_quantity`、`issued_quantity`、`per_limit`、`valid_type`、`valid_start`、`valid_end`、`valid_days`、`exchange_points`、`status` |
| `member_coupons` | `coupon_id`、`member_id`、`code`、`status`、`received_at`、`used_at`、`expire_at`、`biz_type`、`biz_id` |

券模板类型：

- `amount`：满减券，`face_value` 为减免金额（分）
- `percent`：折扣券，`face_value` 为折扣百分比，`90` 表示 9 折，`max_discount` 为最高减免金额（分）

有效期类型为 `fixed` / `relative`，模板状态为 `draft` / `active` / `paused` / `expired`。会员券状态为 `unused` / `used` / `expired` / `frozen`。

发券使用事务内原子库存扣减：`issued_quantity + 1` 与库存条件在同一条 `UPDATE` 中完成，`total_quantity = 0` 表示不限量；同时校验 `per_limit` 每人限领数量。券码以 `CP` 开头并全局唯一。

前台会员可查看可领取优惠券、领取优惠券、查看自己的卡券列表；后台可管理模板、发券给指定会员、查看领券记录、作废未使用券码。服务层提供 `redeemCoupon(code)` 核销入口，会将可用券更新为 `used` 并写入 `used_at`、`biz_type`、`biz_id`。

### 积分兑换优惠券

模板配置 `exchange_points > 0` 后即可被积分兑换（积分出口最小闭环）：

- `GET /api/member/coupons/exchangeable`：可兑换券列表（active + 有库存 + 未过期）。
- `POST /api/member/coupons/exchange`：兑换（带 `idempotencyGuard`）。事务内先**条件 UPDATE 扣积分**（`balance >= cost`，防超扣），写 `bizType = 'coupon_exchange'` 积分流水，再走 `grantCoupon()`（库存/限领校验），券记录标记 `bizType = 'points_exchange'`；任一步失败整体回滚。
- 前台 SPA「我的卡券 → 积分兑换」Tab 展示余额与兑换入口；后台券表单可配置「兑换积分」。

### 生日礼自动发放

每日例行维护任务在生日当天（`birthday` 的 MM-DD 匹配）为启用会员发放礼包，**按年幂等**（每年最多一次）：

- `member_birthday_points`（system_config，默认 `0` 不发）：积分礼，流水 `bizType = 'birthday'`、`bizId = 年份`，以流水查重防重发。
- `member_birthday_coupon_id`（system_config，默认 `0` 不发）：券礼，`member_coupons` 以同样标记查重；库存不足等业务异常跳过该会员不阻断整体。

### 券到期提醒

前台「我的卡券」对 7 天内到期的可用券展示「即将过期」红色标记（基于 `expireAt` 前端计算）；每日例行维护任务同时扫描 7 天内到期券并发送站内通知（以券记录 ID 防重，每张券仅提醒一次）。

### 券码核销工具

后台「领券记录」页提供核销入口（权限码 `member:coupon:update`，带审计与幂等）：

- `GET /api/coupons/code/{code}`：核销前预览券详情（券信息 / 持有会员 / 状态 / 有效期）。
- `POST /api/coupons/redeem`：核销（`redeemCoupon()` 原子条件更新防双花），核销来源标记 `bizType = 'manual_redeem'`。

---

## 站内通知 / 邀请裂变 / 账户注销

### 会员站内通知

通知存储在 `member_notifications` 表（`(member_id, created_at)` 索引 + `(type, biz_id)` 防重索引）。

- 发送入口：`createMemberNotification()`（带 `bizId` 时按 `(memberId, type, bizId)` 幂等）。已接入：生日礼、券到期提醒、管理员积分/余额调整、邀请奖励。
- 前台自助：`GET /api/member/notifications`（分页/`unreadOnly`）、`GET /notifications/unread-count`、`PUT /notifications/{id}/read`、`PUT /notifications/read-all`；消息中心页 `/messages`，侧边栏与移动端 TabBar 均带未读红点（60s 轮询）。

### 邀请裂变

- `members.invite_code`（部分唯一索引，首次访问邀请页懒生成）+ `invited_by`（邀请关系）。
- 注册接口支持 `inviteCode`（选填）：注册成功后绑定邀请关系，按 system_config `member_invite_reward_points`（默认 `0` 关闭）给邀请人发积分（流水 `bizType='invite'`、`bizId=新会员ID`，天然幂等）并发站内通知；处理为 best-effort，不阻断注册。
- 前台：邀请页 `/invite`（邀请码/邀请链接复制、已邀人数、累计奖励、最近邀请列表）；注册弹窗支持邀请码输入并可从链接 `#/?invite=CODE` 预填。

### 账户自助注销

`POST /api/member/auth/deactivate`（限流保护）：已设密码的验证密码，否则验证手机短信验证码；通过后**软删除** + 强制下线全部会话。数据按软删除策略保留，标识符立即可重新注册。前台入口在「个人设置」危险区。

### 移动端适配

前台会员中心在 `≤768px` 视口下隐藏侧边导航，改用底部固定 TabBar（首页/卡券/签到/消息/我的），消息项带未读徽标。

### 等级折扣消费侧接入

`services/member/member-benefits.service.ts` 提供订单/支付链路的统一接入点：

- `getMemberDiscount(memberId)`：返回会员当前折扣百分比（无等级/等级停用 = 100）。
- `applyDiscount(amountFen, discount)`：按折扣计算应付金额（分）。
- 前台 `GET /api/member/benefits` 返回当前折扣、权益列表与下一等级升级差距；等级权益页展示升级进度条。

---

## 签到

签到规则存储在 `checkin_rules` 表，签到记录存储在 `member_checkins` 表。

| 表 | 关键字段 |
|----|----------|
| `checkin_rules` | `day_number`、`points`、`experience`、`remark` |
| `member_checkins` | `member_id`、`checkin_date`、`consecutive_days`、`points_awarded`、`experience_awarded` |

`checkin_rules.day_number` 唯一。会员每天只能签到一次，`member_checkins` 对 `member_id + checkin_date` 建立唯一约束。

签到奖励按连续天数匹配规则：

- 精确命中 `day_number` 时使用该规则
- 超过最大 `day_number` 时使用最后一条规则
- 未精确命中时使用不大于连续天数的最近规则

执行签到时，系统在事务内写入签到记录；若奖励积分大于 0，会原子累加积分账户 `balance`、`total_earned` 与 `version`，并写入 `bizType = 'checkin'` 的积分流水。经验奖励累加到 `members.experience`，并等额累加成长值触发自动定级（见「成长值与自动定级」）。

前台签到接口 `POST /api/member/checkin` 带 `idempotencyGuard({ ttlSeconds: 5 })`。

管理端补签（`POST /api/members/{id}/checkin/makeup`）**必须提供 `reason`**（2-256 字符），原因记入 `member_checkins.remark` 与操作审计；会员自助补签消耗设置中的积分，无需原因。

---

## 接口一览

### 前台会员接口

| 前缀 | 接口 | 说明 |
|------|------|------|
| `/api/member/auth` | `POST /sms-code` | 发送短信验证码 |
| `/api/member/auth` | `POST /register` | 注册并登录 |
| `/api/member/auth` | `POST /login` | 登录 |
| `/api/member/auth` | `POST /refresh` | 刷新 Access Token |
| `/api/member/auth` | `POST /reset-password` | 重置密码 |
| `/api/member/auth` | `POST /logout` | 退出登录 |
| `/api/member/auth` | `GET /me` | 当前会员资料 |
| `/api/member/auth` | `PUT /profile` | 修改资料 |
| `/api/member/auth` | `PUT /password` | 修改密码 |
| `/api/member` | `GET /points/account` | 我的积分账户 |
| `/api/member` | `GET /points/transactions` | 我的积分流水 |
| `/api/member` | `GET /wallet` | 我的钱包 |
| `/api/member` | `GET /wallet/transactions` | 我的钱包流水 |
| `/api/member` | `POST /wallet/recharge` | 发起钱包充值 |
| `/api/member` | `GET /levels` | 等级权益 |
| `/api/member` | `GET /coupons/available` | 可领取优惠券 |
| `/api/member` | `GET /coupons/exchangeable` | 可积分兑换优惠券 |
| `/api/member` | `GET /coupons` | 我的优惠券 |
| `/api/member` | `POST /coupons/receive` | 领取优惠券 |
| `/api/member` | `POST /coupons/exchange` | 积分兑换优惠券 |
| `/api/member` | `GET /checkin/status` | 今日签到状态 |
| `/api/member` | `POST /checkin` | 执行签到 |
| `/api/member` | `GET /checkin/history` | 我的签到历史 |
| `/api/member` | `GET /login-logs` | 我的登录历史 |

### 后台管理接口与权限码

| 路由 | 接口 | 权限码 |
|------|------|--------|
| `/api/members` | `GET /`、`GET /{id}`、`GET /{id}/overview` | `member:member:list` |
| `/api/members` | `POST /` | `member:member:create` |
| `/api/members` | `PUT /{id}`、`PUT /{id}/status`、`POST /{id}/reset-password`、`POST /{id}/growth`、`PUT /{id}/tags`、`PUT /batch-status`、`PUT /batch-level`、`PUT /batch-tags` | `member:member:update` |
| `/api/members` | `DELETE /{id}`（软删除） | `member:member:delete` |
| `/api/member-tags` | `GET /` | `member:member:list` |
| `/api/member-tags` | `POST /`、`PUT /{id}`、`DELETE /{id}` | `member:member:update` |
| `/api/member-levels` | `GET /`、`GET /{id}` | `member:level:list` |
| `/api/member-levels` | `POST /` | `member:level:create` |
| `/api/member-levels` | `PUT /{id}` | `member:level:update` |
| `/api/member-levels` | `DELETE /{id}` | `member:level:delete` |
| `/api/member-points` | `GET /transactions`、`GET /account/{id}` | `member:point:list` |
| `/api/member-points` | `POST /adjust` | `member:point:adjust` |
| `/api/member-wallets` | `GET /transactions`、`GET /account/{id}` | `member:wallet:list` |
| `/api/member-wallets` | `POST /adjust` | `member:wallet:adjust` |
| `/api/member-wallets` | `POST /refund` | `member:wallet:refund` |
| `/api/coupons` | `GET /`、`GET /{id}`、`GET /records` | `member:coupon:list` |
| `/api/coupons` | `POST /` | `member:coupon:create` |
| `/api/coupons` | `PUT /{id}` | `member:coupon:update` |
| `/api/coupons` | `DELETE /{id}` | `member:coupon:delete` |
| `/api/coupons` | `POST /{id}/issue` | `member:coupon:issue` |
| `/api/coupons` | `POST /records/{id}/revoke` | `member:coupon:revoke` |
| `/api/checkin-rules` | `GET /` | `member:checkin:rule:list` |
| `/api/checkin-rules` | `POST /` | `member:checkin:rule:create` |
| `/api/checkin-rules` | `PUT /{id}` | `member:checkin:rule:update` |
| `/api/checkin-rules` | `DELETE /{id}` | `member:checkin:rule:delete` |
| `/api/member-checkins` | `GET /` | `member:checkin:log:list` |

会员中心后台菜单种子位于 `SEED_MENUS` 的 800 段，包括会员管理、会员等级、积分管理、钱包管理、优惠券、领券记录、签到配置与签到记录。

---

## 前端

前台会员端是独立 SPA：

- HTML 入口：`packages/web/member.html`
- 代码目录：`packages/web/src/member/`（入口、认证 Provider、独立请求客户端、布局）
- 路由：`HashRouter`

`member-request.ts` 自动携带 `zenith_member_token`，遇到 401 会调用 `/api/member/auth/refresh` 刷新 Access Token；刷新失败时清理会员 Token 并跳转到 `member.html#/login`。

前台页面覆盖会员概览、我的积分、我的钱包、我的卡券、每日签到、等级权益、个人设置、编辑资料、修改密码与登录历史。钱包充值页将用户输入的元转换为分后提交。

后台管理页面位于 `packages/web/src/pages/member/`，覆盖会员管理、会员等级、积分管理、钱包管理、优惠券、领券记录、签到配置与签到记录，并按对应 `member:*` 权限码控制按钮展示。

---

## 相关文档

- [安全体系](../backend/security.md)
- [支付中心](../payment/index.md)
