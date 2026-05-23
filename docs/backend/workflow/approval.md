# 审批方式与驳回策略

## 审批方式（`WorkflowApproveMethod`）

挂载位置：`WorkflowNodeConfig.approveMethod`（定义于 `packages/shared/src/types.ts`）。

| 取值 | 行为 |
| --- | --- |
| `and` | 会签：所有审批人通过后节点才通过 |
| `or` | 或签：任一审批人通过即节点通过 |
| `sequential` | 顺序会签：按 `approvers` 顺序逐一审批 |
| `auto` | 自动通过：不生成审批任务，进入节点立即放行 |

## 驳回策略（`WorkflowRejectStrategy`）

挂载位置：`WorkflowNodeConfig.rejectStrategy`。

| 取值 | 行为 |
| --- | --- |
| `terminate` | 终止流程，实例 `status = rejected` |
| `returnPrev` | 退回上一个审批节点 |
| `returnStart` | 退回发起人（重新发起） |
| `returnToNode` | 退回指定节点；目标由 `rejectToNodeKey` 指定 |

> `rejectToNodeKey` 当且仅当 `rejectStrategy === 'returnToNode'` 时生效，值为目标节点的 `key`（参见 [节点标识](./node-types.md)）。

## 撤回

实例发起人可在 `status === 'running'` 时撤回，触发：

1. 实例状态转为 `withdrawn`；
2. 所有未完成任务标记为 `withdrawn`；
3. 触发 `instance.withdrawn` 事件。
