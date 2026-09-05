# 工具与函数调用

AI 工具页面菜单路径为 `/ai/tools`。工具经 requestContext 注入 `zenith-chat` 与智能体，模型按需发起函数调用，执行过程随 assistant 消息持久化，并以折叠卡片展示在回答、审计与反馈回放中。

---

## HTTP API 工具

管理员零代码注册企业内外的 HTTP API 为可调用工具：

| 字段 | 说明 |
| --- | --- |
| `name` / `description` | 工具名与描述（模型据此决定是否调用） |
| `method` | GET / POST / PUT / DELETE |
| `urlTemplate` | 请求地址模板，支持 `{param}` 路径占位 |
| `headers` | 自定义请求头 |
| `params` | 参数定义：name / type（string / number / boolean）/ required / location（query / body / path） |
| `isEnabled` | 启用状态 |

模型生成的参数按 location 组装请求；出站请求经 [SSRF 防护](./security.md)。

## 内置工具

内置工具随系统注册；其中**文生图**工具 `generate_image` 由运行时设置 `ai.imageModel` 控制（配置模型名后启用，空 = 关闭）。

## 使用范围

- 聊天：服务商配置声明 `tools` 能力标签后，对话中自动可用；
- 智能体：按智能体 `tools` 白名单注入，步数受 `maxSteps` 约束。

## 接口一览

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| `GET` | `/api/ai/http-tools` | 工具列表 | `ai:tool:list` |
| `POST` | `/api/ai/http-tools` | 创建 | `ai:tool:manage` |
| `PUT` | `/api/ai/http-tools/{id}` | 更新 | `ai:tool:manage` |
| `DELETE` | `/api/ai/http-tools/{id}` | 删除 | `ai:tool:manage` |
