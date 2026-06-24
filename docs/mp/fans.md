# 粉丝、标签与会员打通

粉丝与标签能力围绕 `mp_fans`、`mp_tags` 两张表展开，并与系统的**会员体系**深度打通：粉丝可绑定 / 自动创建会员，扫码关注可发放积分，会员等级可决定客服接入优先级。

---

## 标签管理

标签保存在 `mp_tags`，维护本地标签与微信侧 `tagid` 的映射：

| 字段 | 说明 |
| --- | --- |
| `name` | 标签名称 |
| `wechat_tag_id` | 微信标签 ID；同步后回填，为空表示尚未同步 |
| `fans_count` | 该标签下粉丝数 |

`POST /api/mp/tags/sync` 从微信拉取标签并按名称 upsert 本地标签；按标签群发要求标签已同步（`wechat_tag_id` 非空）。

---

## 粉丝管理

粉丝保存在 `mp_fans`：

| 字段 | 说明 |
| --- | --- |
| `openid` | 粉丝唯一标识（账号内唯一） |
| `nickname` / `avatar` / `sex` / `country` / `province` / `city` / `language` | 微信资料 |
| `subscribe` | `subscribed` / `unsubscribed` |
| `remark` / `tag_ids` | 本地备注 / 本地标签 id 列表 |
| `unionid` | 开放平台 unionid（跨应用打通会员用） |
| `member_id` | 关联的会员 id（粉丝 ↔ 会员） |
| `blacklisted` | 是否在黑名单 |

`POST /api/mp/fans/sync` 通过 `user/get` + `user/info/batchget` 分页拉取粉丝并 upsert（不覆盖本地备注 / 标签）。粉丝列表支持按昵称 / openid / 备注关键词、关注状态、标签、黑名单状态筛选。

---

## 黑名单

对接微信 `tags/members` 黑名单接口：

| 操作 | 微信接口 | 说明 |
| --- | --- | --- |
| 拉黑 | `batchblacklist` | 调微信成功后本地标记 `blacklisted = true`（单次最多 20 个 openid） |
| 移出 | `batchunblacklist` | 调微信成功后本地标记 `blacklisted = false` |
| 同步 | `getblacklist` | 分页拉取远端黑名单，全量校正本地 `blacklisted` 标记 |

前端在粉丝列表提供「拉黑 / 移出黑名单」行操作、「同步黑名单」按钮与黑名单筛选。

---

## 会员体系打通

公众号粉丝与[会员中心](../member/index.md)通过 `mp_fans.member_id` 关联，支持三种方式：

| 能力 | 说明 |
| --- | --- |
| **手动绑定 / 创建** | 粉丝列表可「创建会员」（新建会员并绑定，默认等级 = 最低启用等级，同时建积分账户 / 钱包）或绑定到已有会员、解绑 |
| **关注自动建会员** | 账号开启 `auto_create_member` 后，粉丝首次关注（`subscribe` 事件）自动建会员并绑定（`autoCreateMemberOnSubscribe`） |
| **扫码送积分** | 带参二维码配置 `reward_points` 后，扫码关注的粉丝若已绑定会员，自动入账积分（`rewardScanPoints` 走会员积分记账，详见 [群发与二维码](./marketing.md#带参二维码)） |
| **VIP 优先接入** | 多客服会话接入时，按粉丝绑定会员的等级设置排队 `priority`，等级越高越优先（详见 [多客服](./customer-service.md)） |

会员相关写操作走会员体系的事务 + 乐观锁记账，金额单位为分、积分为整数。

---

## 接口一览

| 方法 | 路由 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/mp/tags` | `mp:tag:list` | 标签列表 |
| `POST` | `/api/mp/tags` | `mp:tag:create` | 新增标签 |
| `PUT` | `/api/mp/tags/{id}` | `mp:tag:update` | 编辑标签 |
| `DELETE` | `/api/mp/tags/{id}` | `mp:tag:delete` | 删除标签 |
| `POST` | `/api/mp/tags/sync` | `mp:tag:sync` | 从微信同步标签 |
| `GET` | `/api/mp/fans` | `mp:fan:list` | 粉丝列表（支持黑名单筛选） |
| `POST` | `/api/mp/fans/sync` | `mp:fan:sync` | 从微信同步粉丝 |
| `PUT` | `/api/mp/fans/{id}` | `mp:fan:update` | 更新粉丝备注 / 标签 |
| `POST` | `/api/mp/fans/blacklist` | `mp:fan:blacklist` | 批量拉黑 |
| `POST` | `/api/mp/fans/unblacklist` | `mp:fan:blacklist` | 批量移出黑名单 |
| `POST` | `/api/mp/fans/sync-blacklist` | `mp:fan:blacklist` | 从微信同步黑名单 |
| `POST` | `/api/mp/fans/{id}/create-member` | `mp:fan:bind` | 为粉丝创建并绑定会员 |
| `POST` | `/api/mp/fans/{id}/bind-member` | `mp:fan:bind` | 绑定粉丝到已有会员 |
| `POST` | `/api/mp/fans/{id}/unbind-member` | `mp:fan:bind` | 解绑粉丝会员 |

---

## 前端页面

| 页面 | 路径 | 主要能力 |
| --- | --- | --- |
| 标签管理 | `/mp/tags` | 标签列表 / 增删改 / 同步 |
| 粉丝管理 | `/mp/fans` | 粉丝列表、同步、备注 / 标签编辑、黑名单管理、会员绑定 / 创建 / 解绑 |
