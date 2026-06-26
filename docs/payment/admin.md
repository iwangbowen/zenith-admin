# 后台管理页面

支付中心提供覆盖渠道配置、订单管理、退款管理、回调排查的后台管理页面，并内置收款趋势统计看板；B 档进一步扩展费率、结算、分账、支付链接、风控、支付方式与财务报表。所有列表页遵循统一布局规范（`SearchToolbar` + `ConfigurableTable`，操作列右固定）。

## 页面一览

| 页面 | 路径 | 功能 |
| --- | --- | --- |
| 支付渠道配置 | `/payment/channels` | CRUD + 密钥掩码 + 沙箱开关 + 连通性测试 + 一键设为默认 |
| 支付订单 | `/payment/orders` | 列表 / 详情 / 查单 / 手动退款；渠道·方式·状态·金额区间·创建时间范围多维筛选；订单详情含复制单号、交易时间轴、关联退款明细；「统计分析」Tab 收款趋势看板 |
| 退款记录 | `/payment/refunds` | 列表 / 详情；时间范围筛选；退款查单同步（处理中→成功/失败，回调兜底） |
| 回调日志 | `/payment/logs` | 排查回调与验签问题；渠道·场景·验签结果·时间范围筛选；详情展示请求头 + 原始 Body |

## 支付渠道配置

- 微信 / 支付宝渠道的增删改查，密钥字段以 `hasXxx` 掩码显示、留空不修改（见 [渠道适配与配置](./channels)）；
- **状态开关**：行内 Switch 直接启用 / 停用；
- **连通性测试**：上线前校验商户凭据（探测不存在订单号，"订单不存在"即凭据有效）；
- **一键设为默认**：同渠道互斥，自动启用，业务下单不指定渠道时使用默认配置。

## 支付订单

- **多维筛选**：订单号 / 标题关键字、业务类型、渠道、支付方式、订单状态、金额区间（元）、创建时间范围；
- **行操作**：详情、查单（主动同步状态）、关闭、手动退款（按权限与状态显隐）；
- **手动下单**：后台直接发起支付，弹窗展示二维码 / 跳转链接 / APP 调起串，并每 3s 轮询订单详情；
- **订单详情**：复制订单号 / 商户单号 / 渠道交易号；**交易时间轴**（创建 → 支付 → 退款 → 关闭）；**关联退款明细**表；
- **统计分析 Tab**：收款趋势看板（见下）。

## 退款记录

- 按退款单号 / 订单号、渠道、状态、创建时间范围筛选；
- **退款查单同步**：对处理中 / 待处理的退款单调渠道查单接口，纠正本地状态（成功 → 联动订单状态，失败 → 回滚订单为 `success`），作为退款回调的兜底；
- 退款详情可复制单号、查看渠道退款号与错误信息。

## 回调日志

- 按订单号、渠道、场景（支付 / 退款回调）、验签结果（通过 / 失败）、时间范围筛选；
- 详情弹窗展示**请求头 + 原始 Body**（JSON 美化），用于排查验签失败与对账争议（见 [异步通知与对账](./callback)）。

## 统计与导出接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/payment/stats` | 概览：累计 / 今日成功金额与笔数、支付成功率、退款率、成功笔均、渠道 / 状态分布 |
| `GET /api/payment/trend?days=N` | 收款趋势：近 N 天（默认 30，最大 365）按天聚合成功金额 / 笔数 / 退款金额，无数据日期补 0 |
| `POST /api/payment/channels/{id}/default` | 设为该渠道默认（同租户同渠道互斥，自动启用） |
| `POST /api/payment/refunds/{id}/query` | 退款主动查单并同步本地状态 |

支付订单与退款记录导出统一通过导出中心创建任务，筛选条件沿用当前列表提交的查询参数。

### 收款趋势看板

「支付订单 → 统计分析」Tab 以图表形式呈现：

- **KPI 卡**：累计 / 今日成功金额、成功率、累计退款、退款率、成功笔均；
- **收款趋势面积图**：近 7 / 30 / 90 天收款与退款金额双曲线；
- **渠道成功金额分布**（柱状）+ **订单状态分布**（环图）。

> 趋势按天聚合时使用 `to_char(timezone(APP_TIME_ZONE, paid_at), 'YYYY-MM-DD')` 并 `GROUP BY 1`（按序号分组），与后端 `formatDate` 时区一致、缺口补 0。

## 支付中心扩展 · B 档

在基础支付能力之上，B 档补齐对标主流支付平台的运营与资金能力：手续费、结算、分账、支付链接、风控、支付方式与财务报表。所有页面遵循统一布局规范，金额一律以「分」为单位存储、以「元」展示与录入，时间统一 `YYYY-MM-DD HH:mm:ss`。

### 页面一览（B 档）

| 页面 | 路径 | 权限码 | 功能 |
| --- | --- | --- | --- |
| 费率管理 | `/payment/fee-rules` | `payment:fee:list` | 费率规则 CRUD（按渠道 / 支付方式匹配，万分比 + 固定费，可设上下限与优先级）；支付成功自动算费 |
| 结算管理 | `/payment/settlements` | `payment:settlement:list` | 按渠道 + 账期聚合成功订单生成结算批次；状态机流转（待结算→结算中→已结算/失败） |
| 分账管理 | `/payment/sharing` | `payment:sharing:list` | 分账接收方管理 + 针对成功订单发起单笔分账，留存渠道分账单号与状态 |
| 支付链接 | `/payment/links` | `payment:link:list` | 生成可分享收款链接 / 收款码（固定或用户填写金额，可限次 / 限时），公开页下单 |
| 风控限额 | `/payment/risk-rules` | `payment:risk:list` | 全局 / 按渠道 / 按业务类型限额规则（单笔上限、当日累计、当日笔数、黑名单），下单前拦截 |
| 支付方式 | `/payment/methods` | `payment:method:list` | 管理可用支付方式（启停 / 排序 / 名称 / 图标），控制下单可选项 |
| 财务报表 | `/payment/reports` | `payment:report:view` | 按业务类型 / 渠道 / 日聚合收款·手续费·退款·净额·笔数，柱状图可视化 |

### 手续费 / 费率

- 规则按 **渠道 + 支付方式**（方式可留空表示该渠道全部方式）匹配，命中多条时取 **优先级最高** 且方式更精确者；
- 手续费 = `费率(万分比) × 实付 / 10000 + 固定费`，再按 `[最低, 最高]` 截断；
- 订阅 `payment.succeeded` 事件后自动结算：回写订单 `feeAmount` / `netAmount`，并记一条资金台账（`type=fee`, `direction=out`）。订单详情新增「手续费」「净额」展示。

### 结算管理

- **生成批次**：聚合指定渠道、账期内成功订单，`净额 = 收款(gross) − 手续费(fee) − 退款(refund)`；
- **状态机**：`pending → settling → settled / failed`，仅允许声明的合法流转；标记到账（settled）时记一条结算资金台账（`type=settlement`）。

### 分账 / 分润

- **接收方**：商户 / 个人两类，记录账号与默认分账比例（万分比，可在发起时覆盖）；
- **发起分账**：校验订单已支付成功、接收方启用，创建分账单（`processing`）后调用渠道适配器 `profitShare()`（微信 / 支付宝提供与现有 adapter 同档次的模拟实现），落地 `success / failed` 与渠道分账单号；状态机 `pending → processing → success / failed`。

### 支付链接 / 收款码

- 后台 CRUD，自动生成唯一 `token`；金额留空表示由用户填写，支持限制使用次数与失效时间；
- 列表内「收款码」按钮基于 `qrcode.react` 展示二维码并可复制链接；
- **公开端点**（无需登录，`security:[]`）：

| 接口 | 说明 |
| --- | --- |
| `GET /api/public/payment/link/{token}` | 获取链接展示信息（标题 / 金额 / 状态 / 剩余次数） |
| `POST /api/public/payment/link/{token}/pay` | 按链接下单，复用 `payment.service.createPayment`，校验有效期 / 次数后原子自增使用次数 |

### 风控限额

- 规则作用域：`global`（全局）/ `channel`（按渠道）/ `bizType`（按业务类型）；
- 下单前（`createPayment` 内）逐条校验命中规则：**单笔上限**、**当日累计金额**、**当日笔数**、**黑名单**（`openId` / `userId`），任一超限即抛 `HTTPException(400)` 拦截下单。

### 支付方式管理

- 管理 6 种内置支付方式的 **启停 / 排序 / 展示名称 / 图标**（`method` 全局唯一，种子数据预置）；
- `createPayment` 下单时校验方式是否启用（未配置则放行，向后兼容）；
- `GET /api/payment/methods/enabled` 提供启用方式列表，供下单选择。

### 财务报表

- `GET /api/payment/reports/summary?groupBy=bizType|channel|day&startTime&endTime`：基于资金台账聚合，返回每组 `{ key, label, gross, fee, refund, net, count }` 及总计；
- 前端以 KPI 卡 + 柱状图（收款 / 净额）+ 明细表呈现。

### 接口一览（B 档）

| 接口 | 说明 |
| --- | --- |
| `GET/POST /api/payment/fee-rules`，`GET/PUT/DELETE /api/payment/fee-rules/{id}` | 费率规则 CRUD |
| `GET /api/payment/settlements`，`POST /api/payment/settlements/generate`，`POST /api/payment/settlements/{id}/status`，`DELETE /api/payment/settlements/{id}` | 结算批次：列表 / 生成 / 状态流转 / 删除 |
| `GET/POST /api/payment/sharing/receivers`，`GET/PUT/DELETE /api/payment/sharing/receivers/{id}`，`GET/POST /api/payment/sharing/orders` | 分账接收方 CRUD 与分账单列表 / 发起 |
| `GET/POST /api/payment/links`，`GET/PUT/DELETE /api/payment/links/{id}` | 支付链接 CRUD |
| `GET/POST /api/payment/risk-rules`，`GET/PUT/DELETE /api/payment/risk-rules/{id}` | 风控规则 CRUD |
| `GET /api/payment/methods`，`GET /api/payment/methods/enabled`，`PUT /api/payment/methods/{id}` | 支付方式配置列表 / 可用列表 / 编辑 |
| `GET /api/payment/reports/summary` | 财务报表聚合 |
| `GET /api/public/payment/link/{token}`，`POST /api/public/payment/link/{token}/pay` | 支付链接公开展示与下单 |
