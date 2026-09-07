# Scope 与限流

Scope 决定应用可访问的资源范围，限流套餐决定生产环境的调用额度。

---

## API Scope

API Scope 存储在 `api_scopes`，字段包括 `code`、`name`、`description`、`scopeGroup`、`status`。

编码规则：

- 必须以小写字母开头。
- 只能包含小写字母、数字、冒号、点、下划线和短横线。
- 最大长度 64。
- 被应用引用的 Scope 会返回 `usedByAppCount`，引用数大于 0 时不能删除。

默认种子：

| Scope | 分组 | 说明 |
| --- | --- | --- |
| `openid` | `user` | 确认用户身份 |
| `profile` | `user` | 读取昵称、头像等基础资料 |
| `email` | `user` | 读取邮箱地址 |
| `offline_access` | `user` | 允许刷新令牌 |
| `user:read` | `user` | 读取开放平台用户资源 |
| `data:read` | `data` | 调用只读数据类接口 |
| `data:write` | `data` | 调用写入 / 变更类接口 |
| `order:read` | `order` | 读取订单数据 |
| `cms:read` | `data` | 读取 CMS 栏目与已发布内容 |
| `cms:write` | `data` | 创建 / 更新 CMS 内容并提交审核 |
| `cms:publish` | `data` | 直接发布 CMS 内容 |
| `rules:evaluate` | `data` | 调用规则中心统一求值 |
| `drive:read` | `data` | 读取被授权网盘空间的目录与文件元数据、下载内容（还需空间授权） |
| `drive:write` | `data` | 向被授权网盘空间上传文件（授权角色需为可编辑） |

推荐分组：`general`、`user`、`order`、`payment`、`member`、`data`、`system`。

## Scope 管理 API

挂载前缀：`/api/api-scopes`。

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/api-scopes` | `open:scope:view` | 分页查询 Scope |
| `GET` | `/api/api-scopes/options` | 登录 | 获取启用 Scope 列表 |
| `GET` | `/api/api-scopes/{id}` | `open:scope:view` | 获取 Scope 详情 |
| `POST` | `/api/api-scopes` | `open:scope:manage` | 创建 Scope |
| `PUT` | `/api/api-scopes/{id}` | `open:scope:manage` | 更新 Scope |
| `DELETE` | `/api/api-scopes/batch` | `open:scope:manage` | 批量删除 Scope |
| `DELETE` | `/api/api-scopes/{id}` | `open:scope:manage` | 删除 Scope |

## 限流套餐

限流套餐存储在 `rate_plans`。

| 字段 | 说明 |
| --- | --- |
| `qpsLimit` | 每秒请求上限，`0` 表示不限 |
| `dailyQuota` | 每日调用配额，`0` 表示不限 |
| `monthlyQuota` | 每月调用配额，`0` 表示不限 |
| `isDefault` | 应用未绑定套餐时的回退套餐 |
| `status` | `enabled` / `disabled` |

默认种子：

| code | 名称 | QPS | 日配额 | 月配额 |
| --- | --- | ---: | ---: | ---: |
| `free` | 免费版 | 5 | 10000 | 200000 |
| `pro` | 专业版 | 50 | 500000 | 10000000 |
| `enterprise` | 企业版 | 500 | 0 | 0 |

## 限流行为

- 仅生产环境执行套餐限流。
- 应用绑定套餐时使用绑定套餐；未绑定时使用默认套餐。
- QPS 计数 key 按秒过期，超限返回 429 并附带 `Retry-After: 1`。
- 日配额按 `YYYY-MM-DD` 计数，月配额按 `YYYY-MM` 计数。
- 日 / 月用量达到 80% 时触发 `app.quota.warning`。
- QPS / 日 / 月超限时触发 `app.quota.exceeded`，同一应用与周期内带冷却节流。
- `OPEN_RATE_LIMIT_FAIL_CLOSED=true` 时，限流服务异常返回 503；否则放行请求。

## 限流套餐 API

挂载前缀：`/api/rate-plans`。

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/rate-plans` | `open:rate-plan:view` | 分页查询套餐 |
| `GET` | `/api/rate-plans/options` | 登录 | 获取启用套餐列表 |
| `GET` | `/api/rate-plans/{id}` | `open:rate-plan:view` | 获取套餐详情 |
| `POST` | `/api/rate-plans` | `open:rate-plan:manage` | 创建套餐 |
| `PUT` | `/api/rate-plans/{id}` | `open:rate-plan:manage` | 更新套餐 |
| `DELETE` | `/api/rate-plans/{id}` | `open:rate-plan:manage` | 删除套餐 |

