# 工具与函数调用

Function Calling 让模型在回答过程中调用工具获取实时数据或执行操作。仅 `openai_compatible` 供应商且配置声明 `capabilities.tools` 时启用，最多 5 轮循环，执行过程通过 `tool_call` SSE 事件以折叠卡片展示。

---

## 内置工具

| 工具名 | 说明 |
| --- | --- |
| `get_current_time` | 获取服务器当前日期时间与星期 |
| `get_my_ai_usage` | 查询当前用户今日 token 用量与每日配额 |
| `get_system_overview` | 查询系统基础运营概览（用户数 / 对话数） |
| `generate_image` | 文生图（可选）：配置系统参数 `ai_image_model` 后注册，调用系统默认服务商的 `/images/generations` 生成图片并以 Markdown 展示；留空则不注册 |

## HTTP API 工具

「AI 工具」页菜单路径为 `/ai/tools`（权限 `ai:tool:list` / `ai:tool:manage`），可把企业内部或第三方 HTTP API 注册为工具，无需写代码：

| 字段 | 说明 |
| --- | --- |
| `name` | 工具函数名（小写字母 / 数字 / 下划线，字母开头，全局唯一，与内置工具共用命名空间且不得冲突） |
| `description` | 工具描述（告诉模型能做什么、何时调用——写清楚可显著提升调用准确率） |
| `method` | GET / POST / PUT / DELETE |
| `urlTemplate` | URL 模板，支持 `{param}` 路径占位符 |
| `headers` | 附加请求头（JSON 对象，如认证头） |
| `params` | 参数定义列表：`name` / `type`（string / number / boolean）/ `description` / `required` / `location`（query / body / path） |

执行时参数按 `location` 组装到 URL 路径、查询串或 JSON body；出站请求启用 **SSRF 防护**（`AI_OUTBOUND_PRIVATE_ALLOWLIST` 放行可信内网地址），超时 10 秒，响应截断 4000 字符后喂回模型。

## 工具的启用范围

- **普通对话**：配置声明 `capabilities.tools` 后自动启用全部工具（内置 + 启用的 HTTP 工具）。
- **智能体对话**：仅启用智能体勾选的工具白名单（空 = 不启用）；智能体编辑器通过 `GET /api/ai/http-tools/available` 获取统一工具视图（内置 + HTTP）。

## 接口一览

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| `GET` | `/api/ai/http-tools` | HTTP 工具列表 | `ai:tool:list` |
| `GET` | `/api/ai/http-tools/available` | 可用工具统一视图（内置 + HTTP） | 登录用户 |
| `POST` | `/api/ai/http-tools` | 创建工具 | `ai:tool:manage` |
| `PUT` | `/api/ai/http-tools/{id}` | 更新工具 | `ai:tool:manage` |
| `DELETE` | `/api/ai/http-tools/{id}` | 删除工具 | `ai:tool:manage` |

数据表：`ai_http_tools`；执行注册表位于 `packages/server/src/lib/ai/tools/`。
