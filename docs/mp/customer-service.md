# 多客服会话治理

多客服在「客服账号管理」之上叠加了一套**实时会话状态机**，实现接入、转接、超时自动路由、会话分配、满意度评价与数据报表。会话事件通过 WebSocket 实时推送到后台工作台。

---

## 客服账号

客服账号保存在 `mp_kf_accounts`，对应微信多客服 `kf_account`：

| 字段 | 说明 |
| --- | --- |
| `kf_account` | 微信客服账号（形如 `kf2001@gh_xxx`） |
| `nickname` / `avatar` | 昵称 / 头像 |
| `kf_id` | 微信侧客服 id |
| `invite_status` / `invite_wx` | 绑定微信号邀请状态 / 绑定的微信号 |
| `status` | `enabled` / `disabled` |

CRUD 操作均**先调微信**（`customservice/kfaccount/add|update|del`）成功后再落地本地；`POST /api/mp/kf-accounts/sync` 从微信 `getkflist` 按 `kf_account` upsert。

---

## 会话状态机

会话治理由三张表组成：

| 表 | 说明 |
| --- | --- |
| `mp_kf_sessions` | 会话主体（粉丝 openid × 客服）：`waiting` 排队 → `active` 进行 → `closed` 结束；含 `priority` 优先级、`unread_count` 未读、各时间戳、`close_reason`、`rating` 满意度 |
| `mp_kf_session_events` | 事件流水：`create` / `assign` / `accept` / `transfer` / `reroute` / `close`，支撑转接历史与时间线 |
| `mp_kf_routing_configs` | 每公众号一份路由治理配置：策略、单客服最大并发、排队超时、空闲超时、自动结束开关、欢迎语 |

> `(account_id, openid) where status <> 'closed'` 部分唯一索引保证同一粉丝在同一公众号下至多一个未结束会话。

### 状态流转

```
[粉丝来消息] → waiting（排队）
waiting --人工接入 accept / 自动分配 assign--> active
active --转接 transfer--> active（改派客服）
active --结束 close--> closed
waiting --排队超时--> reroute（重新路由分配）
active --空闲超时 + 开启自动结束--> closed（idle_timeout）
```

---

## 会话分配（路由策略）

`mp_kf_routing_configs.strategy` 决定如何在「启用 + 未满容量」的客服中挑选：

| 策略 | 说明 |
| --- | --- |
| `manual` | 不自动分配，等待人工抢单 |
| `round_robin` | 轮询：最久未被分配者优先 |
| `least_active` | 负载最小：当前进行中会话最少者优先 |

容量上限由 `max_concurrent`（单客服最大并发会话数）控制。粉丝绑定会员时按会员等级提升排队 `priority`（**VIP 优先接入**）。

---

## 接入 / 转接 / 结束 / 回复

| 操作 | 说明 |
| --- | --- |
| **接入** | 粉丝实质消息触发 `onFanInboundMessage`：已有未结束会话则累加未读；无会话则建排队会话，策略非 `manual` 时尝试自动分配。人工接入走 `accept` 指定客服 |
| **转接** | `transfer` 将进行中会话改派给另一名客服，落 `transfer` 事件（含 from/to 客服 + 备注） |
| **结束** | `close` 关闭会话（`close_reason = manual`） |
| **回复** | 会话内 `reply` 调微信下发客服消息（开启内容安全时先校验），更新 `last_kf_msg_at` 并清零未读 |

接入 / 转接时若配置了欢迎语，通过 `setImmediate` 异步最佳努力下发（不阻塞回调）。

---

## 超时自动路由

系统定时任务 `mp-kf-session-tick`（`registerSystemRecurringJob`，每分钟）执行 `runMpKfSessionTimeouts`：

- **排队超时**：`waiting` 会话等待超过 `wait_timeout_minutes` 时尝试重新路由（`reroute`）分配客服；无可用客服则提升优先级。
- **空闲超时**：`active` 会话 `last_msg_at` 超过 `idle_timeout_minutes` 且开启 `auto_close_enabled` 时自动结束（`close_reason = idle_timeout`）。

---

## 满意度与会话报表

- **满意度**：会话结束后 `POST /api/mp/kf-sessions/{id}/rate` 记录 1–5 星评分与备注（`rating` / `rating_remark`）；概览统计返回今日 `avgRating`。
- **会话报表**：`GET /api/mp/kf-sessions/report?days=N` 返回近 N 天每日新建 / 结束会话量、平均接入等待秒数、平均评分。

---

## 实时推送

会话变更通过 `ws-manager` 广播以下 WebSocket 事件，前端工作台按 `accountId` 过滤实时刷新：

| 事件 | 触发 |
| --- | --- |
| `mp-kf:session-new` | 新建排队会话 |
| `mp-kf:session-update` | 状态 / 承接客服 / 满意度变更 |
| `mp-kf:session-message` | 会话内新消息（入站 / 出站） |

---

## 接口一览

| 方法 | 路由 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/mp/kf-accounts` | `mp:kf:list` | 客服账号列表 |
| `POST` | `/api/mp/kf-accounts` | `mp:kf:create` | 添加客服账号 |
| `PUT` | `/api/mp/kf-accounts/{id}` | `mp:kf:update` | 修改客服昵称 |
| `DELETE` | `/api/mp/kf-accounts/{id}` | `mp:kf:delete` | 删除客服账号 |
| `POST` | `/api/mp/kf-accounts/sync` | `mp:kf:sync` | 从微信同步客服 |
| `GET` | `/api/mp/kf-sessions` | `mp:kf:session:list` | 会话列表（工作台） |
| `GET` | `/api/mp/kf-sessions/stats` | `mp:kf:session:list` | 会话概览统计 |
| `GET` | `/api/mp/kf-sessions/report` | `mp:kf:session:list` | 会话数据报表 |
| `GET` | `/api/mp/kf-sessions/config` | `mp:kf:session:list` | 获取路由治理配置 |
| `PUT` | `/api/mp/kf-sessions/config` | `mp:kf:session:config` | 保存路由治理配置 |
| `GET` | `/api/mp/kf-sessions/{id}` | `mp:kf:session:list` | 会话详情（消息 + 事件时间线） |
| `POST` | `/api/mp/kf-sessions/{id}/accept` | `mp:kf:session:accept` | 接入会话 |
| `POST` | `/api/mp/kf-sessions/{id}/transfer` | `mp:kf:session:transfer` | 转接会话 |
| `POST` | `/api/mp/kf-sessions/{id}/close` | `mp:kf:session:close` | 结束会话 |
| `POST` | `/api/mp/kf-sessions/{id}/reply` | `mp:kf:session:reply` | 会话内回复 |
| `POST` | `/api/mp/kf-sessions/{id}/rate` | `mp:kf:session:close` | 记录满意度 |

---

## 前端页面

| 页面 | 路径 | 主要能力 |
| --- | --- | --- |
| 多客服 | `/mp/kf-accounts` | 客服账号 CRUD + 从微信同步 |
| 会话工作台 | `/mp/kf-sessions` | 概览卡片 + 客服负载、队列（待接入 / 进行中 / 已结束）、详情（消息气泡 + 事件时间线 + 接入 / 转接 / 结束 / 回复 / 满意度）、路由治理配置、WebSocket 实时刷新 |

---

## 相关文档

- [WebSocket 事件清单](../backend/websocket-events.md)
- [定时任务](../backend/cron-jobs.md)
