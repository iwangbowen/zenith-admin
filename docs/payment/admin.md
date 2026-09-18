# 后台管理页面

支付中心在后台「支付中心」目录下共 **20 个页面**，页面组件位于 `packages/web/src/pages/payment/`。权限码清单见[安全设计](./security.md#权限与数据权限)。支付 Webhook 页面复用 Open Platform 的订阅、签名、投递和重试内核，只展示显式的支付/退款事件；开放平台页面继续承载全部应用事件。

## 页面一览

| 分组 | 页面 | 路由 | 核心功能 |
| --- | --- | --- | --- |
| 交易 | 支付渠道 | `/payment/channels` | 渠道配置 CRUD、测试连接、设为默认 |
| 交易 | 支付订单 | `/payment/orders` | 订单查询、手动下单、主动查单、关单、退款、模拟支付、统计分析 |
| 交易 | 退款记录 | `/payment/refunds` | 退款查询、退款状态同步、大额退款审批 |
| 交易 | 支付方式 | `/payment/methods` | 收银台支付方式启停、排序与展示配置 |
| 交易 | 回调日志 | `/payment/logs` | 渠道回调报文、请求头、验签结果与处理结果查询 |
| 资金 | 资金台账 | `/payment/ledger` | 双分录账户、资金凭证、冲正与资金预占 |
| 资金 | 费率管理 | `/payment/fee-rules` | 手续费费率规则 CRUD |
| 资金 | 结算管理 | `/payment/settlements` | 结算批次生成、状态流转与结算确认 |
| 资金 | 分账管理 | `/payment/sharing` | 分账接收方、分账单、渠道派发与失败重试 |
| 资金 | 转账管理 | `/payment/transfers` | 转账/代付发起、四眼审批、查单与结果收敛 |
| 资金 | 财务报表 | `/payment/reports` | KPI 汇总、按应用/商户账户/币种/渠道分组报表与环比 |
| 对账风控 | 对账中心 | `/payment/recon` | 账单上传/自动拉取、差异处理 |
| 对账风控 | 风控中心 | `/payment/risk-rules` | 风控规则、拦截记录、人工审核队列 |
| 对账风控 | 交易投诉 | `/payment/disputes` | 投诉列表、智能分流、时间线、回复/完结/退款 |
| 进阶交易 | 签约代扣 | `/payment/contracts` | 扣款计划、签约协议、暂停/恢复/解约、手动补扣 |
| 进阶交易 | 预授权 | `/payment/preauths` | 冻结、转支付、解冻 |
| 生态 | 支付链接 | `/payment/links` | 免开发收款链接、公开收银台、token 轮换 |
| 生态 | 应用管理 | `/payment/apps` | OAuth2 client 与三渠道配置绑定 |
| 可观测 | 支付事件 | `/payment/events` | Outbox 事件查询、重派、链路健康指标 |

## 交易

### 支付渠道

- 支持微信、支付宝、云闪付多配置并存；
- 表单按渠道展示密钥字段，敏感字段只显示已配置状态，留空不修改；
- 「测试连接」调用适配器 `testConnectivity`；
- 「设为默认」控制统一下单缺省配置；
- 沙箱配置不外呼真实渠道，适合演示完整链路。

### 支付订单

- 列表支持关键字、状态、渠道、时间范围筛选，并受数据权限约束；
- 「手动下单」使用 `payment:order:create`，返回二维码、跳转链接或支付参数；
- 行操作包含详情、主动查单、关闭订单、发起退款、模拟支付；
- 详情为侧边抽屉，展示订单、金额、手续费/净额、应用归属、渠道信息和关联退款；
- 「统计分析」Tab 使用 `GET /api/payment/stats` 与 `GET /api/payment/trend?days=N`。

### 退款记录

- 列表含退款状态与审批状态；
- 行操作可主动同步渠道退款结果；
- 达到审批阈值的退款需 `payment:refund:approve` 审批，通过后执行渠道退款，驳回后置失败；
- 退款弹窗按剩余可退余额限制金额，退款原因可选。

### 支付方式

- 管理 7 种收银台方式：启停、排序、展示名、图标；
- 被禁用方式不会出现在公开收银台，并会被统一下单拒绝。

### 回调日志

- 查询 `payment_notify_logs`；
- 行内展开展示原始报文与请求头；
- 支持按订单号追溯某笔交易的全部回调。

## 资金

### 资金台账

- 查询 `payment_ledger_accounts`、`payment_journals` 与 `payment_fund_reservations`；
- 所有凭证强制借贷平衡，且按应用、商户配置、币种和租户隔离；
- 已过账凭证不可编辑，只能通过带原因的反向凭证冲正；
- 转账等资金流出操作先创建 reservation，成功核销、明确失败或驳回释放，版本号用于并发控制。

### 费率管理

- 费率规则按渠道与支付方式匹配，`payMethod` 精确匹配优先，再按 `priority` 降序；
- 公式：`fee = clamp(amount × rateBps / 10000 + fixedFee, minFee, maxFee)`；
- 支付成功后自动回写订单手续费/净额并写双分录手续费凭证；退款成功后按比例冲销手续费。

### 结算管理

- 手动生成或由 `generateDailySettlements` 生成 T+1 结算批次；
- 净额 = 收款 − 手续费 − 退款 − 分账；含未计费订单时备注提示；净额为负按 0 结算并备注；
- 同租户 + 渠道 + 账期唯一约束保证幂等；
- 标记结算后写结算双分录凭证，并将对应的 merchant_available 凭证行原子归集到结算批次。

### 分账管理

- 接收方 Tab 维护商户/个人账号与默认比例；
- 分账单 Tab 对成功订单发起分账，单号 `SHR{订单号}R{接收方ID}` 确定性生成；
- 微信调用真实分账 API；支付宝为模拟实现；
- `retryFailedSharing` 定时重试渠道未受理且未达 3 次上限的失败单，并同步处理中分账单。

### 转账管理

- 支持微信零钱与支付宝账户转账，写接口必须携带幂等键；
- 达到审批阈值的申请只冻结资金，不调用渠道；申请人与审批人必须不同，审批通过后才提交渠道；
- 明确失败释放 reservation，未知结果保留 reservation 并只能通过查单收敛，禁止原单重发；
- `syncPaymentTransfers` 定时恢复已审批未执行单并同步处理中/未知单。

### 财务报表

- 汇总收款、手续费、退款、净额、笔数；
- 支持按 `day`、`application`、`merchantAccount`、`currency`、`channel` 分组；
- `compare=true` 时返回上一等长周期对比；
- 所有日期范围统一实时聚合 Journal，避免日切快照与凭证事实漂移。

## 对账与风控

### 对账中心

- 账期页提交交易/资金账单下载或受控导入；
- 微信、支付宝支持 `trade` / `fund`；云闪付支持 `trade`（ZM/ZME），资金余额需其他资金来源；
- 原件、版本、摘要、标准明细和解析错误均可追溯；沙箱账单与人工导入独立标识。
- 批次记录 `manual_upload`、`sandbox_generated`、`provider_download` 三种服务端派生来源；
- 人工上传和沙箱模拟账单只能挂账归档或忽略，只有渠道适配器下载的账单可在人工核验后直接调账并写双分录凭证。

### 风控中心

三个 Tab：

- **限额规则**：维护 L1 原生规则，作用域为全局/渠道/业务类型；黑名单字段引用黑/灰名单库 key，白名单字段只引用白名单库 key；动作 `block` 或 `review`。
- **拦截记录**：查询 `payment_risk_hits`，包含 L2 决策表命中（`dimension=decision`）与 L1 原生规则命中。
- **审核队列**：处理 `review` 动作生成的挂起订单；放行后用户重新下单继续支付，拒绝则本地关单。

页面顶部说明 L2 `payment_risk` 决策表优先接管，未命中回退 L1；规则中心执行记录可在 `/rules/evaluation` 查看。

### 交易投诉

- 列表展示投诉类型、状态、分流路由、优先级、SLA 与超时状态；
- 筛选支持关键字、状态、类型、渠道与分流路由；
- 详情侧边栏展示订单摘要与处理时间线；
- `dispute_triage` 决策表输出 `urgent`、`manual`、`auto_refund_suggest`，并写 system 时间线；
- `auto_refund_suggest` 只显示建议徽标并预填退款金额/原因，资金动作需人工点击确认；
- 支持回复、完结与投诉退款，投诉退款复用统一退款与审批链路；
- `syncPaymentDisputes` 定时拉取/模拟投诉，`POST /api/payment/disputes/simulate` 可手动生成演示数据。

## 进阶交易

### 签约代扣

- 扣款计划接口：`/api/payment/deduct-plans`；协议接口：`/api/payment/contracts`；
- 计划包含周期（日/周/月/自定义）、金额与最大重试次数；
- 协议状态：`pending → signed ⇄ paused → terminated`；
- 支持创建签约、暂停、恢复、解约、手动补扣；
- `executeDueDeductions` 每分钟扫描到期协议，使用 `wechat_papay` 或 `alipay_cycle` 生成扣款订单；支付成功事件推进下次扣款时间，失败次日重试，达上限自动暂停。

### 预授权

- `POST /api/payment/preauths` 发起冻结；
- `POST /api/payment/preauths/{id}/capture` 转支付，可部分转支付；
- `POST /api/payment/preauths/{id}/release` 解冻；
- 状态：`pending`、`frozen`、`captured`、`released`、`failed`；
- 冻结/解冻联动渠道账户 `frozen` 快照。

## 生态开放

### 支付链接

- 后台接口：`/api/payment/links`；公开接口：`/api/public/payment/link/{token}`、`/{token}/pay`、`/{token}/sessions/{sessionToken}`；
- 支持固定金额或用户填写金额、固定支付方式或聚合方式、最大使用次数、过期时间；
- 公开收银台按 UA 推荐支付方式；
- 「轮换 token」使旧链接失效。

### 应用管理

- 每个应用绑定一个 OAuth2 client；开放 API 使用客户端凭证与 HMAC 签名，不接受外部伪造应用 ID；
- 可分别绑定微信、支付宝、云闪付渠道配置；
- 下单由服务端根据已认证的 OAuth2 client 路由到应用绑定配置，订单记录 `appId`。

## 可观测

### 支付事件

- 查询 `payment_events`，支持查看 payload、错误信息与处理时间；
- failed 死信可重派；
- 健康指标接口 `GET /api/payment/ops/health` 返回 Outbox 积压/死信、Open Platform Webhook 待投/失败、处理中分账/转账、待处理对账差异。

## 统计接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/payment/stats` | 订单概览：累计/今日收款与笔数、成功率、退款汇总、状态分布 |
| `GET /api/payment/trend?days=N` | 近 N 天收款趋势 |
| `GET /api/payment/reports/summary` | 财务报表汇总；支持 `groupBy=day/application/merchantAccount/currency/channel` 与 `compare=true` |
| `GET /api/payment/ops/health` | 支付链路健康指标 |
