# 业务模块接入工作流

业务模块接入工作流适合已有独立实体、Service、列表页和状态机的业务。业务数据保存在业务表，工作流只负责审批编排，并通过 `bizType + bizId` 建立关联。

## 接入模式

| 模式 | 数据存储 | 发起入口 | 适用场景 |
| --- | --- | --- | --- |
| `designer` | 流程实例 `formData` | 发起工作台 | 标准审批表单 |
| `custom` | 流程实例 `formData` | 发起工作台 | 需要自定义 React 表单，但无独立业务表 |
| `external` | 业务模块自有表 | 业务模块页面 | 已有业务实体，需要接审批 |

## 后端桥接 API

`packages/server/src/lib/workflow-biz-bridge.ts` 提供三类函数：

| 函数 | 说明 |
| --- | --- |
| `startWorkflowForBiz` | 保存业务数据后发起流程，并写入 `bizType`、`bizId`、路由变量和优先级 |
| `onWorkflowResult` | 监听指定 `bizType` 的创建、通过、驳回、撤回事件，回写业务状态 |
| `getWorkflowStatusByBiz` | 按业务键批量查询工作流状态（每个 bizId 取最新一条实例） |

幂等与重新发起语义：

- 同一业务键（`bizType + bizId`）**同时只允许一个活跃实例**（草稿/运行中/挂起）。重复调用 `startWorkflowForBiz` 会直接返回已存在的活跃实例（含并发下的数据库唯一约束兜底）。
- 流程到达终态（通过/驳回/撤回/取消）后不再占用业务键：业务记录可修改后**再次调用 `startWorkflowForBiz` 发起全新实例**（如「驳回 → 重新编辑 → 重新提交」），`getWorkflowStatusByBiz` 始终返回最新实例。
- 发起守卫：若流程节点按 `formUser` / `formDepartment` 解析审批人且未配置空审批人兜底策略，对应路由变量缺失时发起会返回 400 并说明缺失变量，避免节点被默认「自动通过」静默跳过。

## 接入步骤

### 1. 业务表保存状态

业务表建议保留：

| 字段 | 说明 |
| --- | --- |
| `workflowInstanceId` | 关联流程实例 ID |
| `workflowStatus` | 冗余流程状态，便于列表筛选和展示 |
| 业务状态 | 业务自己的状态，如 `draft`、`pending`、`approved`、`rejected` |

### 2. 提交时发起流程

```ts
import { startWorkflowForBiz } from '../lib/workflow-biz-bridge';

const instance = await startWorkflowForBiz({
  definitionId,
  title: `请假申请 - ${applicant}`,
  bizType: 'biz_leave',
  bizId: leave.id,
  variables: {
    days: leave.days,
    leaveType: leave.leaveType,
  },
  priority: 'normal',
});
```

`variables` 写入流程实例 `formData`，用于条件分支、审批人解析和触发器模板。完整业务数据仍从业务表读取。

### 3. 订阅流程结果

```ts
import { onWorkflowResult } from '../lib/workflow-biz-bridge';

export function registerBizLeaveSubscribers() {
  onWorkflowResult('biz_leave', {
    onApproved: (instance) => updateStatus(instance.bizId, 'approved'),
    onRejected: (instance) => updateStatus(instance.bizId, 'rejected'),
    onWithdrawn: (instance) => updateStatus(instance.bizId, 'cancelled'),
  });
}
```

订阅器在服务启动时注册，与其它事件订阅者一起响应 `instance.*` 事件。

### 4. 配置流程定义

流程定义选择 `formType = external`，并配置：

| 配置 | 说明 |
| --- | --- |
| 查看组件 | 审批页和详情页渲染业务数据的 React 组件 |
| 变量声明 | 条件分支和审批人解析可读取的业务变量 |

审批查看组件通过实例关联的 `bizType + bizId` 拉取业务详情。业务详情接口应允许发起人、任务处理人、抄送人和监控管理员读取。

### 5. 前端跳转

业务列表页可展示冗余 `workflowStatus`，并跳转到内置流程详情：

```text
/workflow/instance/{workflowInstanceId}
```

## 参考实现

完整的端到端范例见内置的「请假申请」演示模块（`biz-leave`），覆盖业务保存、提交发起流程、审批结果回写业务状态、驳回/取消后「重新编辑」（`POST /api/biz/leaves/{id}/reopen` 转回草稿并重新提交发起新流程）与前端审批查看的全部环节。
