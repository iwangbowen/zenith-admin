# 消息与自动回复

消息能力覆盖**消息收发记录**、**客服消息主动下发**与**自动回复**（关注 / 关键词 / 默认）。自动回复支持富媒体内容、正则匹配、命中转人工与未命中热词收集。

---

## 消息记录

所有入站 / 出站消息保存在 `mp_messages`：

| 字段 | 说明 |
| --- | --- |
| `openid` | 对话粉丝 |
| `direction` | `in` 入站 / `out` 出站 |
| `msg_type` | `text` / `image` / `voice` / `video` / `shortvideo` / `location` / `link` / `event` |
| `content` / `media_id` / `media_url` / `event` | 文本内容 / 素材 id / 媒体 URL / 事件名 |
| `msg_id` | 微信消息 id，用于去重；事件消息无 `MsgId` 时按 `openid+event+key+time` 合成 sha1 |
| `status` | `received` / `sent` / `failed` |

入站消息由[公开回调](./callback.md)落库，依赖 `(account_id, msg_id)` 部分唯一索引原子去重（微信重试时不写重复记录）。消息列表支持按 openid、方向、类型、关键词筛选；会话视图按 openid 聚合，取每个会话最后一条消息 + 消息总数 + 粉丝资料。

---

## 客服消息

`POST /api/mp/messages/send` 主动下发客服消息（48 小时内有互动的粉丝），支持富媒体：

| 类型 | 内容 |
| --- | --- |
| `text` | 文本 `content` |
| `image` / `voice` | 素材 `media_id` |
| `video` | 素材 `media_id` + 标题 `content` |
| `news` | 图文素材 `media_id`（落库记为 text 摘要） |

下发前若账号开启了[内容安全校验](./statistics.md#内容安全校验)，会先做敏感词检测；下发成功后落库为出站消息。

---

## 自动回复

自动回复保存在 `mp_auto_replies`，分三类（`reply_type`）：

| 类型 | 触发 | 数量限制 |
| --- | --- | --- |
| `subscribe` 关注回复 | 粉丝关注事件 | 每账号 1 条 |
| `keyword` 关键词回复 | 文本消息命中关键词（按 `sort` 优先级） | 多条 |
| `default` 默认回复 | 文本消息未命中任何关键词 | 每账号 1 条 |

回复内容支持富媒体（`content_type`）：`text` / `image` / `voice` / `video` / `news`（图文 `news_articles` 数组）。

### 匹配方式

关键词回复的 `match_type` 支持三种：

| 匹配 | 说明 |
| --- | --- |
| `exact` | 全匹配（文本完全等于关键词） |
| `contain` | 包含匹配（文本包含关键词） |
| `regex` | 正则匹配（以关键词为正则表达式测试文本，非法正则自动跳过） |

### 命中转人工

关键词回复可设置 `transfer_to_kf`，命中后在回复内容（如「正在为您转接人工客服…」）之外，引导粉丝进入[多客服会话队列](./customer-service.md)。

### 未命中热词收集

文本消息未命中任何关键词时，系统按 `account + keyword` 累计写入 `mp_unmatched_keywords`（仅记录短文本，疑似关键词），便于运营优化关键词库。前端「未命中热词」弹窗按命中次数倒序展示并可删除。

> 自动回复匹配在[回调](./callback.md)中执行（`resolveAutoReply`）：关注事件 → 关注回复；文本消息 → 关键词回复（按优先级 + 匹配方式）→ 未命中则记录热词并回默认回复。被动回复 XML 在安全模式下会 AES 加密返回。

---

## 接口一览

| 方法 | 路由 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/mp/messages` | `mp:message:list` | 消息列表 |
| `GET` | `/api/mp/messages/conversations` | `mp:message:list` | 会话列表（按 openid 聚合） |
| `POST` | `/api/mp/messages/send` | `mp:message:send` | 发送客服消息 |
| `GET` | `/api/mp/auto-replies` | `mp:reply:list` | 自动回复列表 |
| `POST` | `/api/mp/auto-replies` | `mp:reply:create` | 新增自动回复 |
| `PUT` | `/api/mp/auto-replies/{id}` | `mp:reply:update` | 编辑自动回复 |
| `DELETE` | `/api/mp/auto-replies/{id}` | `mp:reply:delete` | 删除自动回复 |
| `GET` | `/api/mp/auto-replies/unmatched` | `mp:reply:list` | 未命中热词列表 |
| `DELETE` | `/api/mp/auto-replies/unmatched/{id}` | `mp:reply:delete` | 删除未命中热词 |

---

## 前端页面

| 页面 | 路径 | 主要能力 |
| --- | --- | --- |
| 消息管理 | `/mp/messages` | 会话列表、消息记录、发送客服消息（富媒体） |
| 自动回复 | `/mp/auto-replies` | 关注 / 关键词 / 默认回复增删改、富媒体、正则 / 转人工开关、未命中热词查看 |
