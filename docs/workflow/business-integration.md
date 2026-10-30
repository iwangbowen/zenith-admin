# 业务模块接入工作流

业务模块接入工作流适合已有独立实体、Service、列表页和状态机的业务。业务数据保存在业务表，工作流负责审批编排，并通过 `bizType + bizId` 建立关联。业务表单打开时同时展示业务资料和流程信息：提交前预览审批链路，提交后查看实际审批轮次、处理人、流转记录和流程图。

## 接入模式

| 模式 | 数据存储 | 发起入口 | 适用场景 |
| --- | --- | --- | --- |
| `designer` | 流程实例 `formData` | 发起工作台 | 标准审批表单 |
| `custom` | 流程实例 `formData`；内置业务适配器可同时维护领域账本 | 发起工作台 | 自定义 React 表单；需要领域账本时通过稳定业务类型接入 |
| `external` | 业务模块自有表 | 业务模块页面 | 已有业务实体，需要接审批 |

### 内置权限申请适配器

权限申请继续在发起工作台使用 `custom` 表单，但以 `customForm.businessType = identity.access_request` 识别业务，不依赖 React 组件路径。发起和草稿提交先由权限域展开权限包、读取带版本的有效策略并解析独立审批人；申请、权限预约、实际审批计划与 `bizType/bizId` 在流程提交事务内一起保存。

实际执行链根据已解析的审批策略冻结，支持策略自动批准、部门负责人、部门负责人加安全审批、部门负责人加两名独立安全审批。预览复用同一评估与选人逻辑。审批需要检查策略版本、人员存活、职责分离、有效期与当次 MFA，不能用修改通用流程定义来绕过领域要求。

审批终态在同一事务内回写权限申请并入队 `access_grant_apply` 作业；该作业使用唯一业务键和租约保护发放授权，并维护可见的失败原因。通知与业务同事务写入 Outbox，再统一触达，不承担申请创建或授权发放。逐项授权、复核和后台任务见[权限治理](./access-governance.md)。

## 自定义业务表单与公共容器边界

`WorkflowLaunchForm`、公共审批窗口和流程页面不识别特定业务类型或字段。业务表单通过 `getFormApi` 提供 `getValues()` / `validate()`，通过 `onValuesChange` 通知容器重新计算预览。流程图始终展示完整定义，实例图沿用公共组件按任务运行态高亮实际路径、置灰未命中分支的逻辑，不把审批链路预览替换为裁剪后的流程图。审批链路接口继续返回节点数组，业务适配器提供的完整执行定义与预览共用路径规划。

业务需要额外审批输入时，在 `customForm.actionComponent` 配置独立组件。公共审批窗口以 `mode="action"` 挂载它，校验结果作为 `businessInput` 传给后端；这些临时值不混入实例 `formData`，审批契约关闭请求体审计。组件可通过 `onActionSuccess()` 刷新自身领域查询。权限申请的当次 MFA 输入位于权限业务组件中，公共审批窗口不读取 `mfaRequired` 或验证码字段。

后端公共运行层仅调用 `lib/workflow-business-types.ts` 的领域适配器接口；`bootstrap/workflow-business-adapters.ts` 声明装配。领域模块负责预览与提交归一化、冻结执行计划、同事务业务关联、终态回写、审批前校验、事务内再次验证、改派约束与删除限制。不能通过移到普通异步事件订阅来替代必须同事务完成的授权规则。

## 后端桥接 API

`packages/server/src/lib/workflow-biz-bridge.ts` 提供以下入口：

| 函数 | 说明 |
| --- | --- |
| `startWorkflowForBiz` | 保存业务数据后发起流程，并写入 `bizType`、`bizId`、路由变量和优先级 |
| `onWorkflowResult` | 监听指定 `bizType` 的创建、通过、驳回、撤回事件，回写业务状态 |
| `getWorkflowStatusByBiz` | 按业务键批量查询工作流状态（每个 bizId 取最新一条实例） |
| `resolveBizDefinitionId` | 按名称、已发布状态和表单类型解析定义；多条匹配时选 ID 最大的定义并记录警告 |

幂等与重新发起语义：

- 同一业务键（`bizType + bizId`）**同时只允许一个活跃实例**（草稿/运行中/挂起/退回待重提）。重复调用 `startWorkflowForBiz` 会直接返回已存在的活跃实例。
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
import { startWorkflowForBiz } from '../../lib/workflow-biz-bridge';

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
import { onWorkflowResult } from '../../lib/workflow-biz-bridge';

export function registerBizLeaveSubscribers() {
  onWorkflowResult('biz_leave', {
    onApproved: (instance) => updateStatus(instance.bizId, 'approved'),
    onRejected: (instance) => updateStatus(instance.bizId, 'rejected'),
    onWithdrawn: (instance) => updateStatus(instance.bizId, 'cancelled'),
  });
}
```

订阅器在服务启动时注册，与其它事件订阅者一起响应 `instance.*` 事件。

`onWorkflowResult` 的回调只有 `onCreated`、`onApproved`、`onRejected`、`onWithdrawn`。需要订阅 `instance.returned` 时直接使用工作流事件总线。业务桥接通过持久化领域事件消费者执行，拥有独立回执和重试；业务模块仍应保证幂等并提供失败后的状态对账，不能把异步回写与提交事务视为同一次提交。

### 4. 配置流程定义

流程定义选择 `formType = external`，并配置：

| 配置 | 说明 |
| --- | --- |
| 查看组件 | 审批页和详情页中的业务内容组件，只渲染业务数据，不创建外层抽屉或重复嵌入流程详情 |
| 变量声明 | 条件分支和审批人解析可读取的业务变量 |

审批查看组件通过 `bizType + bizId + instanceId` 拉取指定审批轮次对应的当前业务资料。服务端必须校验实例与业务记录的关联、租户和实例可见性；发起人、任务处理人、抄送人和监控管理员沿工作流参与者权限读取，不能借任意实例 ID 绕过业务隔离。业务自己的编辑入口继续使用业务详情权限。

### 5. 在业务表单内展示流程

统一使用 `components/workflow/BusinessWorkflowPanel.tsx`，传入业务表单 `formContent`、预览 `preview`、实际流程上下文 `context` 和轮次选择状态。公共组件复用普通流程的 `WorkflowProcessLayout`、`WorkflowApprovalChainPanel`、`WorkflowInstanceDetailPanel` 和流程图；业务页面负责业务表单、取数和保存/提交动作。

| 状态 | 展示与操作 |
| --- | --- |
| 新建 / 可编辑草稿 | 左侧业务表单，右侧审批链路预览，可查看流程图。预览不保存业务数据、不创建流程实例；表单变量变化后更新预览 |
| 提交成功 | 保持当前表单容器，切换为实际实例；显示当前节点、真实处理人、状态和流转记录 |
| 已提交 / 已结束 | 业务资料与普通流程详情共用两栏布局；「表单 / 沟通 / 流转记录」页签及按数据出现的协办、子流程信息由公共详情组件提供 |
| 驳回 / 撤回后重提 | 业务模块控制重新编辑；当前草稿显示本次提审预览，过去轮次仍能通过「审批轮次」选择查看 |

轮次选择不会改变业务记录或发起新流程。切换过去轮次时，流程记录来自所选实例冻结的定义和任务，表单区域展示**当前业务资料**，界面明确提示该区别；业务数据并未因为选择过去轮次而变成历史快照。普通流程整页深链 `/workflow/instance/{id}` 继续用于独立访问。

公共流程面板不代替业务页面的保存和提交，也不向业务编辑页开放审批动作。`viewComponent` 保持内容组件，避免在普通审批详情中产生嵌套抽屉或重复审批链。

### 6. 预览、流程上下文与审批资料契约

接入业务在自己的契约内提供操作，前端 hooks 和 MSW 均绑定这些契约：

| 操作 | 请假 | CMS 内容 |
| --- | --- | --- |
| `workflowPreview` | `POST /api/biz/leaves/workflow-preview`，接收 `days? / leaveType?` | `POST /api/cms/contents/workflow-preview`，接收 `siteId / channelId / title?` |
| `workflowContext` | `GET /api/biz/leaves/{id}/workflow` | `GET /api/cms/contents/{id}/workflow` |
| `approvalDetail` | `GET /api/biz/leaves/{id}/detail?instanceId=…` | `GET /api/cms/contents/{id}/approval-detail?instanceId=…` |

`workflowPreview` 返回 `{ definition, nodes }`：定义摘要和流程图供预览使用，`nodes` 为当前可解析的审批链。CMS 简单审核模式返回 `{ definition: null, nodes: [] }`；已启用工作流但定义不可用时返回错误，不降级成简单审核。实际流转以提交时解析结果为准。

`workflowContext` 返回 `{ instance, previousInstances }`，支持可选查询参数 `instanceId` 指定轮次。`previousInstances` 按新到旧包含该业务的全部审批轮次，含当前轮次；请假草稿默认 `instance=null`，其他状态使用业务关联的实例；CMS 草稿/驳回默认 `instance=null`，其他状态使用最近实例。显式选择轮次时返回该实例，且必须属于当前业务。

保存、提交、重新编辑和审批结果变化后，业务详情、列表和流程上下文应一起刷新。预览失败应在流程区域显示可重试的错误，不能伪装成空审批链。

## 参考实现

内置两条 `external` 流程统一在 `packages/shared/src/seed/workflow.ts` 定义，DB 初始化与 Demo 的流程配置、路由变量和快照同源：

- **请假审批**：`LeavePage` 使用与普通流程一致的 1080 像素两栏侧边抽屉，覆盖保存草稿、原地提交切换流程详情、结果回写、驳回/取消后「重新编辑」（`POST /api/biz/leaves/{id}/reopen`）及轮次查看。路由变量为 `days / leaveType`。
- **CMS 内容审核**：内容编辑整页保留富文本编辑器，提供「内容 / 审批流程」页签和页头流程状态，工作流模式下「保存并提交审核」成功后原地查看实际流程；列表「查看审批」使用统一两栏侧边抽屉。路由变量为 `siteName / channelName / contentTitle`，审核双轨语义见 [CMS 内容流水线](../cms/content-pipeline.md#审核双轨制)。

两条种子流程均由业务模块发起，查看组件只呈现业务资料；实例内重提开关关闭，业务终态后的修改与重新提交由业务模块创建新轮次。Demo 覆盖单条/批量提审、实际任务、审批结果回写和往次记录，CMS 站点默认仍为简单审核。

## 受控附件与归档

审批上传使用 `workflowAttachmentContract.upload`。文件以 `restricted` 保存，对象存储强制 private ACL；`workflow_attachment_uploads` 记录专用上传来源、上传人和租户，禁止用其它模块的任意文件 ID 冒充审批附件。

提交附件的格式统一为 `[{ fileId }]`。任务动作、评论和设计器表单均由服务端读取文件元数据，保存 `{ id, fileId, name, size, mimeType, url }` 展示快照。`id` 是具体附件绑定 ID；`url` 是工作流专属受控读取地址，不是文件身份或授权凭据。

`workflow_attachment_links` 记录实例、任务或评论、表单字段路径与文件 FK；任务/评论使用含实例 ID 的复合 FK，数据库禁止来源串实例。附件绑定、去重、旧引用释放和文件引用计数与原业务写入在同一事务中提交。未绑定上传进入孤儿文件宽限期；绑定后上传者预览入口失效，后续读取必须从具体审批来源重新授权。删除流程先释放附件引用，引用归零后由统一 GC 回收文件。

设计器只遍历声明的 `attachment` / `image` 字段及明细、布局容器，不从任意 JSON 或 URL 字符串推测附件。同一明细字段内重排行可复用有权读取的现存文件；跨实例复制仅接受服务端确认的业务重提或父子流程来源，并建立新的绑定。

附件列表、详情与内容下载校验有效租户、流程参与关系及节点字段权限；隐藏表单字段不会经通用关联视图泄漏。归档原件继续使用实例的 `archiveFileId + archiveSha256`，明确通过 `workflowInstanceContract.print` 的 `source=archive` 读取，校验原件摘要；存在隐藏或需脱敏字段的查看者不能读取完整原件。

归档生成、打印来源与验真统一见[审批单打印与存证](./print-and-archive.md)。
