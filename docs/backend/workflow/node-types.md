# 节点类型与节点标识

## 节点类型清单

`FlowNodeType` 联合（[packages/web/src/pages/workflow/designer/types.ts](../../../packages/web/src/pages/workflow/designer/types.ts)）：

| 类型 | 含义 |
| --- | --- |
| `initiator` | 发起人节点（流程入口） |
| `approver` | 审批人节点 |
| `handler` | 办理人节点（任务执行型） |
| `cc` | 抄送节点 |
| `delay` | 延迟器节点 |
| `trigger` | 触发器节点（详见 [触发器节点](./trigger-nodes.md)） |
| `subProcess` | 子流程节点 |
| `conditionBranch` | 条件分支（互斥单走） |
| `parallelBranch` | 并行分支（全部走） |
| `inclusiveBranch` | 包容分支（满足条件的全部走） |
| `routeBranch` | 路由分支（按表达式路由） |

分支节点子集 `BranchNodeType`：`conditionBranch | parallelBranch | inclusiveBranch | routeBranch`。

## 节点标识（nodeKey）

每个节点除了系统生成的 `id` 外，还可以设置一个可读的 `key` 字段，用于：

- 在事件订阅的接收方代码中按节点过滤；
- 在 `WorkflowNodeConfig.rejectToNodeKey` 中作为驳回目标的稳定引用；
- 在 webhook payload 与外部审批回调中显示为 `nodeKey`。

约束（[NodeConfigDrawer.tsx](../../../packages/web/src/pages/workflow/designer/components/NodeConfigDrawer.tsx)）：

- 正则 `^[a-zA-Z][a-zA-Z0-9_]*$`，字母开头，仅字母/数字/下划线；
- 保留字 `start` / `end` 不允许；
- 同一流程内唯一；
- 留空时回退到节点 `id`（[utils.ts treeToFlat](../../../packages/web/src/pages/workflow/designer/utils.ts) 中 `node.key || node.id`）。

> 设置后保存的流程定义中 `process` 字段会保留 `node.key`；事件 payload 的 `nodeKey` 字段会优先使用它。
