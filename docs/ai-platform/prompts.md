# 提示词模板

提示词模板页面菜单路径为 `/ai/prompts`。

---

## 模板管理

模板范围由 `ai_prompt_scope` 枚举定义：

| 枚举值 | 说明 |
| --- | --- |
| `system` | 系统级模板（所有人可见） |
| `user` | 用户私有模板 |

模板字段包括 `name`、`content`、`description`、`category`、`scope`、`userId`、`isBuiltin`、`sort`、`usageCount`、`isEnabled`。管理列表支持分页、范围筛选与名称 / 描述关键词搜索。

内置模板种子数据来自 `SEED_AI_PROMPT_TEMPLATES`（通用助手 / 翻译助手 / 编程助手 / 文案写作 / 内容总结），`isBuiltin = true`，服务端禁止删除。

## 应用为对话角色

聊天页通过 `GET /api/ai/prompt-templates/available` 获取所有启用且当前用户可见的模板，并可将模板内容应用为当前会话的 `systemPromptOverride`。

模板内容支持 `{{变量}}` 占位符（如「请把以下内容翻译成{{目标语言}}」）：聊天页应用含变量的模板时会弹出表单逐项填写，替换后再写入对话角色。每次应用会调用 `POST /api/ai/prompt-templates/{id}/use` 累计 `usageCount`。

## 版本管理

模板**内容**变更时自动把旧内容快照为历史版本（`ai_prompt_template_versions`，版本号自增，记录操作人与时间）：

- 列表操作列「版本」打开历史抽屉，逐版本查看内容。
- 「恢复此版本」把历史内容回写为当前内容——恢复前当前内容也会自动留档，不会丢失任何版本。

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| `GET` | `/api/ai/prompt-templates/{id}/versions` | 历史版本列表 | `ai:prompt:list` |
| `POST` | `/api/ai/prompt-templates/{id}/versions/{versionId}/restore` | 恢复到历史版本 | `ai:prompt:edit` |

## 接口一览

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| `GET` | `/api/ai/prompt-templates` | 模板列表 | `ai:prompt:list` |
| `GET` | `/api/ai/prompt-templates/available` | 聊天页可用模板 | 登录用户 |
| `POST` | `/api/ai/prompt-templates/{id}/use` | 记录使用一次 | 登录用户 |
| `GET` | `/api/ai/prompt-templates/{id}` | 模板详情 | `ai:prompt:list` |
| `POST` | `/api/ai/prompt-templates` | 创建模板 | `ai:prompt:create` |
| `PUT` | `/api/ai/prompt-templates/{id}` | 更新模板（内容变更自动留档） | `ai:prompt:edit` |
| `DELETE` | `/api/ai/prompt-templates/{id}` | 删除模板（内置模板禁止） | `ai:prompt:delete` |
