# 流程级自动化

流程级自动化（Workflow Automations）用于在**流程实例结束**时自动触发副作用，例如自动发起下一个流程、自动给发起人/相关人员发送站内信，等等。它与节点级监听器（[node listeners](./node-config.md)）和事件订阅（[event subscriptions](./event-subscriptions.md)）的差别如下：

| 能力                       | 触发粒度       | 适用场景                                                       |
| -------------------------- | -------------- | -------------------------------------------------------------- |
| 节点监听器 Node Listeners  | 节点进入/离开  | 在某个节点上挂载脚本/HTTP 调用（强耦合到具体节点）             |
| 事件订阅 Event Subscriptions | 全部事件       | 推送给外部系统（HMAC 签名 + Webhook + 投递重试）               |
| **流程自动化 Automations** | **流程实例结束** | 在 zenith 内部联动：发起新流程、推送站内信，纯无代码配置        |

> 自动化规则在流程实例 **approved / rejected / withdrawn** 三种状态变更时执行；规则按 `sort` 升序串行执行，单个动作失败不中断后续动作。

---

## 数据模型

表：`workflow_automations`

| 字段           | 类型                                              | 说明                                                              |
| -------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| `id`           | serial                                            | 主键                                                              |
| `definition_id`| integer FK → workflow_definitions                 | 规则绑定的流程定义                                                |
| `name`         | varchar(128)                                      | 规则名称                                                          |
| `trigger`      | enum `approved` \| `rejected` \| `withdrawn`      | 触发时机                                                          |
| `actions`      | jsonb                                             | 动作数组（最多 10 个）                                            |
| `status`       | enum `enabled` \| `disabled`                      | 启停                                                              |
| `sort`         | integer                                           | 同 trigger 下按此值升序执行（默认 0）                             |
| `tenant_id`    | integer FK → tenants                              | 租户隔离                                                          |
| `created_at`、`updated_at`、`created_by`、`updated_by` | 审计列 | 通用审计                                                          |

---

## 动作类型

### 1. 发起流程 `startWorkflow`

| 字段             | 类型                              | 说明                                                                   |
| ---------------- | --------------------------------- | ---------------------------------------------------------------------- |
| `type`           | `'startWorkflow'`                 | 固定值                                                                 |
| `definitionId`   | number                            | 目标流程定义 ID                                                        |
| `titleTemplate`  | string?                           | 新实例标题模板，支持模板变量，默认 `"自动触发：{{title}}"`             |
| `formMapping`    | `Record<string, string>?`         | 表单字段映射，value 中可写模板变量，渲染后作为新流程的 `formData`      |

### 2. 发送站内信 `sendMessage`

| 字段           | 类型                                                       | 说明                                                              |
| -------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `type`         | `'sendMessage'`                                            | 固定值                                                            |
| `title`        | string                                                     | 标题，支持模板变量                                                |
| `content`      | string                                                     | 内容，支持模板变量                                                |
| `messageType`  | `'info' \| 'success' \| 'warning' \| 'error'`              | 站内信类型，默认 `info`                                           |
| `recipients`   | `'initiator' \| { userIds: number[] }`                     | 收件人，默认 `initiator`（流程发起人）                            |
| `buttons`      | `Array<{ text: string; url: string }>?`                    | 渲染为内容末尾的 markdown 链接，便于跳转                          |

---

## 模板变量

`titleTemplate`、`formMapping` 的 value、`sendMessage` 的 `title`/`content` 均支持 `{{var}}` 占位符。

| 变量名                  | 含义                                  |
| ----------------------- | ------------------------------------- |
| `{{instanceId}}`        | 当前流程实例 ID                       |
| `{{title}}`             | 当前流程实例标题                      |
| `{{status}}`            | 当前流程实例最终状态                  |
| `{{initiator}}`         | 发起人显示名（昵称/用户名）           |
| `{{initiatorId}}`       | 发起人用户 ID                         |
| `{{formData.<key>}}`    | 发起人提交的表单字段值                |

未匹配的占位符将渲染为空字符串。

---

## REST API

所有接口位于 `/api/workflows/automations`，需要 `workflow:definition:list`（读）或 `workflow:definition:edit`（写）权限：

| 方法   | 路径                                       | 说明                            |
| ------ | ------------------------------------------ | ------------------------------- |
| GET    | `/api/workflows/automations`               | 分页列表，支持 `definitionId` / `trigger` / `status` 过滤 |
| GET    | `/api/workflows/automations/:id`           | 详情                            |
| POST   | `/api/workflows/automations`               | 新建                            |
| PUT    | `/api/workflows/automations/:id`           | 更新                            |
| DELETE | `/api/workflows/automations/:id`           | 删除                            |
| POST   | `/api/workflows/automations/batch-delete`  | 批量删除                        |

---

## 实现说明

- 服务启动时通过 `registerWorkflowAutomationSubscribers()`（[`packages/server/src/services/workflow-automations.service.ts`](../../../packages/server/src/services/workflow-automations.service.ts)）订阅 `workflowEventBus` 的 `instance.approved` / `instance.rejected` / `instance.withdrawn` 事件
- 单个动作内部抛出的异常会被 `try/catch` 捕获并记录到日志，不会阻塞后续动作或主流程
- `startWorkflow` 动作复用 `createInstance(data, actor)`，新流程的 `initiator` 沿用上一流程的发起人
- `sendMessage` 动作直接写入 `in_app_messages` 表，发送者为系统（`source = 'system'`）

---

## 前端页面

「工作流 → 流程自动化」（`/workflow/automations`），列表页 + 弹窗表单：

- 顶部筛选：所属流程、触发时机、状态
- 动作配置区支持「添加发起流程」「添加站内信」两类动作的可视化编辑
- Demo 演示模式下数据由 MSW handler（`packages/web/src/mocks/handlers/workflow-automations.ts`）提供
