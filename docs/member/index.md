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

系统种子等级包括普通会员、银卡会员、金卡会员、钻石会员，成长值门槛分别为 `0`、`1000`、`5000`、`20000`，折扣分别为 `100`、`98`、`95`、`90`。

---

## 积分体系

积分账户表为 `member_point_accounts`，一名会员对应一个账户；流水表为 `member_point_transactions`。

| 表 | 关键字段 |
|----|----------|
| `member_point_accounts` | `member_id`、`balance`、`frozen`、`total_earned`、`total_spent`、`version` |
| `member_point_transactions` | `member_id`、`type`、`amount`、`balance_after`、`biz_type`、`biz_id`、`operator_id` |

积分为整数。流水类型为 `earn` / `redeem` / `expire` / `adjust` / `refund`。

`changePoints()` 是统一记账入口：在数据库事务中读取账户，计算余额，使用 `version` 乐观锁更新账户，并原子写入流水。余额不足时返回业务错误，乐观锁冲突通过 `withOptimisticRetry()` 重试。

后台管理员可通过 `POST /api/member-points/adjust` 手动调整积分，权限码为 `member:point:adjust`，流水 `bizType` 为 `admin_adjust`，并记录操作人 `operatorId`。

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

后台支持手动调整余额与退款入账：

- `POST /api/member-wallets/adjust`：权限码 `member:wallet:adjust`，流水 `bizType = 'admin_adjust'`
- `POST /api/member-wallets/refund`：权限码 `member:wallet:refund`，流水 `bizType = 'admin_refund'`

---

## 优惠券

优惠券模板存储在 `coupons` 表，会员领券记录存储在 `member_coupons` 表。

| 表 | 关键字段 |
|----|----------|
| `coupons` | `type`、`face_value`、`threshold`、`max_discount`、`total_quantity`、`issued_quantity`、`per_limit`、`valid_type`、`valid_start`、`valid_end`、`valid_days`、`status` |
| `member_coupons` | `coupon_id`、`member_id`、`code`、`status`、`received_at`、`used_at`、`expire_at`、`biz_type`、`biz_id` |

券模板类型：

- `amount`：满减券，`face_value` 为减免金额（分）
- `percent`：折扣券，`face_value` 为折扣百分比，`90` 表示 9 折，`max_discount` 为最高减免金额（分）

有效期类型为 `fixed` / `relative`，模板状态为 `draft` / `active` / `paused` / `expired`。会员券状态为 `unused` / `used` / `expired` / `frozen`。

发券使用事务内原子库存扣减：`issued_quantity + 1` 与库存条件在同一条 `UPDATE` 中完成，`total_quantity = 0` 表示不限量；同时校验 `per_limit` 每人限领数量。券码以 `CP` 开头并全局唯一。

前台会员可查看可领取优惠券、领取优惠券、查看自己的卡券列表；后台可管理模板、发券给指定会员、查看领券记录、作废未使用券码。服务层提供 `redeemCoupon(code)` 核销入口，会将可用券更新为 `used` 并写入 `used_at`、`biz_type`、`biz_id`。

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

执行签到时，系统在事务内写入签到记录；若奖励积分大于 0，会原子累加积分账户 `balance`、`total_earned` 与 `version`，并写入 `bizType = 'checkin'` 的积分流水。经验奖励累加到 `members.experience`。

前台签到接口 `POST /api/member/checkin` 带 `idempotencyGuard({ ttlSeconds: 5 })`。

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
| `/api/member` | `GET /coupons` | 我的优惠券 |
| `/api/member` | `POST /coupons/receive` | 领取优惠券 |
| `/api/member` | `GET /checkin/status` | 今日签到状态 |
| `/api/member` | `POST /checkin` | 执行签到 |
| `/api/member` | `GET /checkin/history` | 我的签到历史 |
| `/api/member` | `GET /login-logs` | 我的登录历史 |

### 后台管理接口与权限码

| 路由 | 接口 | 权限码 |
|------|------|--------|
| `/api/members` | `GET /`、`GET /{id}`、`GET /{id}/overview` | `member:member:list` |
| `/api/members` | `POST /` | `member:member:create` |
| `/api/members` | `PUT /{id}`、`PUT /{id}/status`、`POST /{id}/reset-password`、`PUT /batch-status`、`PUT /batch-level` | `member:member:update` |
| `/api/members` | `DELETE /{id}` | `member:member:delete` |
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
