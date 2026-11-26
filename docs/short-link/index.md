# 短链

短链能力提供管理端创建与治理，以及无需登录的公开跳转入口。短码解析、有效期、启停状态和访问上限均由服务端执行。

## 使用入口

| 场景 | 入口 |
| --- | --- |
| 管理短链 | 管理 API 由 `packages/server/src/routes/short-link/short-links.ts` 提供 |
| 公开跳转 | `/s/{code}`，由 `redirect.ts` 处理 |
| 开放平台调用 | 开放网关提供短链创建和访问统计操作 |

创建短链时可设置目标地址、短码、标题、有效期和访问次数上限。失效、过期或达到访问上限的链接由公开入口返回相应状态页面。短链管理操作仍受管理端权限控制，公开跳转不要求登录。

业务服务位于 `packages/server/src/services/short-link/`，共享契约位于 `packages/shared/src/short-link/`。接口参数与响应以共享契约和 `/api/docs` 为准。

相关文档：[开放平台](../open-platform/)、[安全体系](../backend/security.md)。
