# 工作流事件总线

工作流引擎在状态变化的关键点统一通过 `workflow-event-bus.ts` 发出事件。该总线基于 Node 内置 `EventEmitter`，每次 `emit()` 内部使用 `queueMicrotask()` 异步隔离分发，单个监听器抛错不会影响其他监听器。

## 事件类型清单

`WorkflowEventType`（定义于 `packages/shared/src/types.ts`）：

| 事件 | 触发时机 |
| --- | --- |
| `instance.created` | 流程实例创建 |
| `instance.approved` | 流程整体通过 |
| `instance.rejected` | 流程整体驳回 |
| `instance.withdrawn` | 实例发起人撤回 |
| `node.entered` | 进入某个节点 |
| `node.left` | 离开某个节点 |
| `task.created` | 审批/办理任务创建 |
| `task.assigned` | 任务被指派 |
| `task.approved` | 任务被通过 |
| `task.rejected` | 任务被拒绝 |
| `task.skipped` | 任务被跳过（条件不匹配等） |
| `task.transferred` | 任务被转交 |

## Payload 结构

所有事件都继承 `WorkflowEventBase`：

```ts
interface WorkflowEventBase {
  eventId: string;          // UUID
  type: WorkflowEventType;
  occurredAt: string;       // YYYY-MM-DD HH:mm:ss
  instanceId: number;
  definitionId: number;
  tenantId: number | null;
  actor?: WorkflowEventActor;
}
```

不同事件附加字段：

| Payload | 附加字段 |
| --- | --- |
| `WorkflowInstanceEventPayload` | `instance: WorkflowInstance` |
| `WorkflowNodeEventPayload` | `nodeKey: string`、`nodeName: string`、`nodeType: WorkflowNodeType \| null` |
| `WorkflowTaskEventPayload` | `task: WorkflowTask`、`comment?: string \| null` |

## 内置订阅者

模块启动时自动注册的订阅者位于 `packages/server/src/lib/workflow-subscribers/`：

| 文件 | 监听事件 | 作用 |
| --- | --- | --- |
| `trigger.ts` | `node.entered` | 执行触发器节点的 HTTP 调用 |
| `external-approver.ts` | `task.created` | 派发外部审批请求 |
| `webhook.ts` | 全部 | 按 `workflow_event_subscriptions` 配置投递到外部 URL |
| `ws.ts` | 全部 | 通过 WebSocket 推送到在线用户 |

## 在代码侧订阅事件

```ts
import { workflowEventBus } from './lib/workflow-event-bus';

workflowEventBus.on('node.entered', (e) => {
  if (e.nodeKey === 'risk_review') {
    // 自定义副作用
  }
});
```

> 节点级别过滤通过 `e.nodeKey` 判断；前提是在设计器里给目标节点设置了稳定的 `key`，参见 [节点标识](./node-types.md)。
