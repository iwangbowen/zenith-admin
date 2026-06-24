# 数据统计与内容安全

数据能力分两部分：基于本地数据的**基础统计**，以及对接微信**数据立方**的多维分析。内容安全校验作为发送前的合规前置，归在本页一并说明。

---

## 基础统计

`GET /api/mp/stats?accountId=` 返回基于本地 `mp_*` 表聚合的概览：

| 指标 | 说明 |
| --- | --- |
| `fanTotal` / `fanSubscribed` / `fanUnsubscribed` | 粉丝总数 / 已关注 / 已取关 |
| `tagTotal` / `materialTotal` / `draftTotal` | 标签 / 素材 / 草稿数 |
| `messageIn` / `messageOut` | 入站 / 出站消息数 |
| `autoReplyTotal` | 自动回复数 |
| `fanTrend` | 粉丝按日增长趋势 |
| `messageTrend` | 消息按日（in / out）趋势 |

---

## 数据立方

`GET /api/mp/stats/datacube?accountId=&beginDate=&endDate=` 对接微信数据立方（`/datacube/*`）。微信限制查询跨度 ≤ 7 天，数据为 T+1，且需账号已认证并具备数据接口权限。

| 区块 | 微信接口 | 内容 |
| --- | --- | --- |
| 用户增减 | `getusersummary` | 按日各来源新增 / 取关 |
| 累计用户 | `getusercumulate` | 按日累计关注用户 |
| 消息概况 | `getupstreammsg` | 按日发送人数 / 消息条数 |
| 图文阅读 | `getarticlesummary` | 按日页面阅读数 |
| 图文分享转发 | `getusershare` | 按日转发次数 / 人数 |
| 接口分析 | `getinterfacesummary` | 按日调用次数 / 失败次数 / 平均与最大耗时 |

所有立方接口在服务端按 `ref_date` 聚合后返回，跨度超 7 天或日期非法时返回 400 校验错误。

---

## 内容安全校验

对接微信内容安全接口（`msg_sec_check`），用于群发 / 客服消息发送前的合规前置：

- **主动测试**：`POST /api/mp/security/check-text` 校验一段文本，返回 `{ pass, suggest }`。
- **发送前前置**：账号开启 `content_check_enabled` 后，群发发送（含定时）、客服消息下发、会话内回复均先调用 `assertContentSafe` 做敏感词检测，命中违规（微信 `87014`）抛 `400` 拦截发送；校验接口本身异常时放行（避免风控接口抖动阻断正常业务，最终仍由微信发送接口把关）。

实现位置：`lib/wechat/security.ts`（`msgSecCheck`）+ `services/mp-security.service.ts`（`checkMpContent` / `assertContentSafe`）。

---

## 接口一览

| 方法 | 路由 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/mp/stats` | `mp:statistics:view` | 基础统计概览 |
| `GET` | `/api/mp/stats/datacube` | `mp:statistics:view` | 数据立方多维分析 |
| `POST` | `/api/mp/security/check-text` | `mp:security:check` | 文本内容安全校验 |

---

## 前端页面

| 页面 | 路径 | 主要能力 |
| --- | --- | --- |
| 数据统计 | `/mp/statistics` | 基础统计卡片 + 趋势；数据立方多区块（用户 / 消息 / 图文 / 分享 / 接口分析） |

> 内容安全开关在「公众号账号」编辑表单中；账号页提供「内容安全检测」测试入口（`mp:security:check`）。
