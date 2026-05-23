# 触发器节点

触发器节点在流程进入该节点时（`node.entered` 事件）执行预定义动作，由 `trigger` 订阅者处理。

## 支持的触发器类型

| `triggerType` | 状态 | 说明 |
| --- | --- | --- |
| `webhook` | ✅ 已实现 | 向外部 URL 发起 HTTP 请求 |
| `callback` | ✅ 已实现 | 同 webhook，语义上区分为「需要回调推进流程」 |
| `updateData` | ✅ 已实现 | 将 `fieldKeys` 中字段按 `fieldValues` 模板（支持 <code v-pre>{{form.x}}</code>）写回到当前实例 `formData` |
| `deleteData` | ✅ 已实现 | 删除当前实例 `formData` 中 `fieldKeys` 列出的字段 |

## 配置字段（`WorkflowTriggerNodeConfig`）

定义于 `packages/shared/src/types.ts`：

| 字段 | 说明 |
| --- | --- |
| `triggerType` | 见上表 |
| `url` | webhook/callback 目标地址 |
| `method` | HTTP 方法 |
| `headers` | 自定义请求头 |
| `body` | 请求体模板（支持表单字段引用） |
| `fieldKeys` | `updateData / deleteData` 操作的字段 key 列表 |
| `fieldValues` | `updateData` 每个字段的新值模板（支持 <code v-pre>{{form.x}}</code> 占位） |
| `onFailure` | `'continue' \| 'retry' \| 'block'`：失败后行为 |
| `maxRetries` | 最大重试次数（`onFailure === 'retry'` 生效） |
| `timeoutMs` | 单次请求超时，默认 `10_000` |

## 执行记录

每次触发器调用写入 `workflow_trigger_executions` 表，包含：实例 ID、节点 key、状态（`pending / running / success / failed / retrying`）、响应数据、尝试次数、错误信息。

UI：「工作流 → 触发器执行」页面，支持按状态、实例 ID、节点 key 过滤，并通过侧边抽屉查看完整请求/响应。
