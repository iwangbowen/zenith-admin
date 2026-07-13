# 群发、模板消息与带参二维码

面向运营触达的三类能力：**群发消息**（一对多）、**模板消息**（结构化通知）与**带参二维码**（渠道引流 + 扫码送积分）。

---

## 群发消息

群发任务保存在 `mp_broadcasts`：

| 字段 | 说明 |
| --- | --- |
| `msg_type` | `text` / `image` / `mpnews`（图文素材） |
| `target` | `all` 全部粉丝 / `tag` 指定标签 |
| `tag_id` | 群发标签（`target = tag` 时；要求标签已同步到微信） |
| `content` / `media_id` | 文本内容 / 素材 media_id |
| `scheduled_at` | 定时发送时间（为空表示立即手动发送） |
| `status` | `draft` / `sent` / `failed` |
| `wechat_msg_id` | 微信返回的群发 msg_id |

### 发送、预览与结果

| 能力 | 微信接口 | 说明 |
| --- | --- | --- |
| 发送 | `message/mass/sendall` | 按全部 / 标签群发，回填 `wechat_msg_id`；发送接口带幂等防重 |
| 预览 | `message/mass/preview` | 发送给指定测试 openid，发送前检查效果 |
| 发送结果 | `message/mass/get` | 查询群发状态与 `total/filter/sent/error` 计数 |

### 定时群发

创建群发时设置 `scheduled_at`，系统定时任务 `mp-broadcast-tick`（每分钟）执行 `runDueMpBroadcasts`，扫描到期（`scheduled_at <= now`）且仍为草稿的群发自动发送。发送前若账号开启内容安全校验会先做敏感词检测。

---

## 模板消息

模板库保存在 `mp_message_templates`，发送日志保存在 `mp_template_send_logs`：

| 能力 | 微信接口 | 说明 |
| --- | --- | --- |
| 同步模板库 | `template/get_all_private_template` | 从微信拉取已添加模板并 upsert |
| 设置 / 获取行业 | `template/api_set_industry` / `get_industry` | 设置账号所属行业（每月 1 次） |
| 单条发送 | `message/template/send` | 向单个 openid 发送，落发送日志 |
| 批量发送 | 逐条 `template/send` | 对多个 openid（单次最多 500）逐一下发并落库，返回成功 / 失败计数 |

### 送达回执

模板消息为异步送达，微信通过 `TEMPLATESENDJOBFINISH` 事件回传送达结果。[回调](./callback.md)中 `handleTemplateSendReceipt` 按 `account_id + msg_id` 匹配发送日志，依据 `Status` 回写最终状态（`success` / `failed`）。

---

## 带参二维码

带参二维码保存在 `mp_qrcodes`，用于渠道来源标识与引流：

| 字段 | 说明 |
| --- | --- |
| `type` | `temporary` 临时 / `permanent` 永久 |
| `scene_str` | 场景值（渠道标识） |
| `name` | 备注名称 |
| `ticket` / `url` | 微信 ticket / 二维码图片 URL |
| `expire_seconds` | 临时二维码有效期 |
| `scan_count` | 累计扫码次数（回调事件累加） |
| `reward_points` | 扫码关注奖励积分 |

### 扫码计数与送积分

[回调](./callback.md)收到 `SCAN`（已关注扫码）或 `subscribe`（扫码关注）事件时：

1. `incrementQrcodeScan` 按 `account_id + scene_str` 累加 `scan_count`；
2. `rewardScanPoints`：若该二维码配置了 `reward_points` 且扫码粉丝已绑定会员，则为会员入账积分（走[会员积分记账](../member/index.md)，`biz_type = mp_scan_reward`）。

---

## 接口一览

| 方法 | 路由 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/mp/broadcasts` | `mp:broadcast:list` | 群发列表 |
| `POST` | `/api/mp/broadcasts` | `mp:broadcast:create` | 创建群发草稿（可含定时） |
| `PUT` | `/api/mp/broadcasts/{id}` | `mp:broadcast:update` | 更新群发草稿 |
| `POST` | `/api/mp/broadcasts/{id}/send` | `mp:broadcast:send` | 发送群发 |
| `POST` | `/api/mp/broadcasts/{id}/preview` | `mp:broadcast:send` | 群发预览 |
| `GET` | `/api/mp/broadcasts/{id}/result` | `mp:broadcast:list` | 查询发送结果 |
| `DELETE` | `/api/mp/broadcasts/{id}` | `mp:broadcast:delete` | 删除群发 |
| `GET` | `/api/mp/templates` | `mp:template:list` | 模板列表 |
| `GET` | `/api/mp/templates/logs` | `mp:template:list` | 发送记录 |
| `GET` / `PUT` | `/api/mp/templates/industry` | `mp:template:list` / `mp:template:sync` | 获取 / 设置所属行业 |
| `POST` | `/api/mp/templates/sync` | `mp:template:sync` | 从微信同步模板 |
| `POST` | `/api/mp/templates/send` | `mp:template:send` | 发送模板消息 |
| `POST` | `/api/mp/templates/batch-send` | `mp:template:send` | 批量发送模板消息 |
| `DELETE` | `/api/mp/templates/{id}` | `mp:template:delete` | 删除本地模板记录 |
| `GET` | `/api/mp/qrcodes` | `mp:qrcode:list` | 二维码列表 |
| `POST` | `/api/mp/qrcodes` | `mp:qrcode:create` | 生成二维码（可设奖励积分，接口带幂等防重） |
| `DELETE` | `/api/mp/qrcodes/{id}` | `mp:qrcode:delete` | 删除二维码 |

---

## 前端页面

| 页面 | 路径 | 主要能力 |
| --- | --- | --- |
| 群发消息 | `/mp/broadcasts` | 群发增删改、发送、预览、发送结果、定时发送 |
| 模板消息 | `/mp/template-messages` | 模板列表 / 同步、行业设置、单条 / 批量发送、发送记录 |
| 带参二维码 | `/mp/qrcodes` | 二维码生成（含奖励积分）、列表、删除 |
