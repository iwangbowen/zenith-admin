# 流程自动化与定时发起

流程自动化和定时发起用于把流程平台从「人工审批」扩展为「事件驱动」和「计划驱动」。

## 流程自动化

页面入口为 `工作流引擎 → 流程自动化`。自动化规则绑定某个流程定义，在实例创建或结束时执行动作。

新增规则的「所属流程」可选择所有已发布流程，包括业务系统主导（`external`）流程。
「发起流程」动作的目标仅可选择已发布且非 `external` 的流程；业务系统主导流程必须由对应业务模块发起。

### 触发时机

| 触发器 | 说明 |
| --- | --- |
| `created` | 实例创建 |
| `approved` | 实例通过 |
| `rejected` | 实例驳回 |
| `withdrawn` | 实例撤回 |

同一流程同一触发器下，规则按 `sort`、`id` 升序执行。单个动作失败不会阻断后续动作。

### 动作类型

| 动作 | 说明 |
| --- | --- |
| `startWorkflow` | 发起另一个流程，可用模板生成标题和表单数据 |
| `sendMessage` | 发送站内信给发起人或指定用户 |
| `webhook` | 发起 HTTP 请求 |
| `updateField` | 回写当前实例 `formData` 字段 |

### 模板变量

自动化动作支持 <code v-pre>{{var}}</code> 占位符：

::: v-pre
| 变量 | 说明 |
| --- | --- |
| `{{instanceId}}` | 当前实例 ID |
| `{{title}}` | 当前实例标题 |
| `{{status}}` | 当前实例状态 |
| `{{initiator}}` | 发起人显示名 |
| `{{initiatorId}}` | 发起人用户 ID |
| `{{字段key}}` | 当前实例表单字段 |
:::

未匹配变量渲染为空字符串。规则执行结果写入自动化运行记录，可通过 `GET /api/workflows/automations/runs` 查询。

## 定时发起

页面入口为 `工作流引擎 → 定时发起`。定时发起按 Cron 表达式由指定发起人自动创建流程实例。

| 配置 | 说明 |
| --- | --- |
| 流程定义 | 必须选择已发布流程 |
| 规则名称 | 定时规则显示名 |
| Cron 表达式 | 调度周期 |
| 时区 | 可选 IANA 时区（如 `America/New_York`），Cron 按该时区计算触发时间；留空默认 `Asia/Shanghai` |
| 发起人 | 用于权限、发起人上下文和审批人解析 |
| 标题模板 | 生成实例标题 |
| 表单数据 | 固定表单 JSON |
| 状态 | 启用 / 禁用 |

页面支持立即执行一次（手动触发，不影响下次调度时间），用于验证 Cron 规则和表单数据。列表展示每条规则的上次执行时间、结果与下次执行时间。

调度由系统任务 `workflow-schedule-tick` 每分钟扫描到期规则驱动（运行记录可在系统任务中心查看）。执行时先以行级锁占位（`FOR UPDATE SKIP LOCKED`）并推进下次执行时间，多副本部署或单副本 tick 重叠时同一规则不会重复发起。定时发起的表单数据沿用宽松语义，不强制必填校验。

## API 摘要

| 能力 | 路径 |
| --- | --- |
| 自动化规则 | `GET/POST /api/workflows/automations`、`GET/PUT/DELETE /api/workflows/automations/{id}`、`POST /api/workflows/automations/batch-delete` |
| 自动化运行记录 | `GET /api/workflows/automations/runs` |
| 定时发起 | `GET/POST /api/workflows/schedules`、`PUT/DELETE /api/workflows/schedules/{id}`、`POST /api/workflows/schedules/{id}/run` |

## 与事件订阅的区别

| 能力 | 触发粒度 | 执行动作 |
| --- | --- | --- |
| 节点监听器 | 单个节点 | 节点级 Webhook |
| 事件订阅 | 标准事件流 | 外部 Webhook 投递 |
| 流程自动化 | 实例创建/结束 | 内部发起流程、站内信、Webhook、回写字段 |
| 定时发起 | Cron 时间 | 自动创建流程实例 |
