# 工作流模块总览

工作流模块负责流程定义、流程实例运行、审批与驳回、节点级别的事件分发与外部联动。模块由三部分组成：

| 层 | 主要位置 | 职责 |
| --- | --- | --- |
| 前端设计器 | `packages/web/src/pages/workflow/designer` | 树形流程编辑、节点配置、版本管理 |
| 后端运行时 | `packages/server/src/services/workflow-instances.service.ts` | 创建实例、推进节点、审批/驳回 |
| 事件总线 + 订阅者 | `packages/server/src/lib/workflow-event-bus.ts`、`packages/server/src/lib/workflow-subscribers/` | 节点/任务/实例变更的统一事件广播 |

## 数据库表

| 表 | 说明 |
| --- | --- |
| `workflow_categories` | 流程分类 |
| `workflow_definitions` | 流程定义（最新版本指针 + 当前 `flowData`） |
| `workflow_definition_versions` | 流程定义历史版本快照 |
| `workflow_instances` | 流程实例 |
| `workflow_tasks` | 审批/办理/抄送任务 |
| `workflow_event_subscriptions` | 事件订阅（HTTP webhook 投递配置） |
| `workflow_event_deliveries` | 投递记录与重试 |
| `workflow_trigger_executions` | 触发器节点执行日志 |

## 子文档

- [节点类型与节点标识](./node-types.md)
- [审批方式与驳回策略](./approval.md)
- [事件总线](./event-bus.md)
- [事件订阅](./event-subscriptions.md)
- [触发器节点](./trigger-nodes.md)
- [外部审批](./external-approval.md)
