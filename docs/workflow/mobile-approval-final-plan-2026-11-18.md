# 移动审批代码复核与最终分阶段方案

日期：2026-11-18；审查基线：`4b8061171`（实际工作区代码）。本文收敛并替代《mobile-approval-review-2026-11-18.md》中的实施顺序与未经限定的结论；前文保留为浏览器体验记录。

> **实施进展（截至 `e5f32d938`）**：阶段 1 的会话隔离、阶段 3 的草稿 intent/revision/恢复稿与本人草稿删除、阶段 5 的列表服务端分页/筛选、滚动恢复、任务节点标识与连续审批已落地；同时补齐了移动端自定义权限申请、协作人员分页搜索、审批动作附件/协办/前后并加签/退回等基础能力。仍待关闭：草稿编辑时下拉值回填与首次自动保存失败、恢复稿原生 `confirm`、草稿详情直接提交、抄送未读标识、纯申请人默认页，以及 375/390/430 真机和复杂业务表单全量验收。

## 审查结论

原评估 F01–F10 的核心现象均有现有实现支持，但并不意味着十项都是流程引擎缺陷：F01 是前端身份缓存隔离缺陷，F02/F03 是移动操作闭环缺失，F04/F05/F06/F07/F09/F10 是展示、权限、导航或动作编排不一致，F08 是预测结果解释错误。服务端已有任务归属、流程状态、节点按钮、附件要求、签名证据、轮次席位计票与事务锁，不能因为移动展示缺失而重写这些机制。

原改造方向总体合理，最终实施需要作以下调整：

1. 把会话隔离列为独立首阶段，覆盖全部 QueryClient 缓存、迟到响应、刷新令牌和同源后台切换；只清 ['approval'] 不足够。
2. 在复杂动作扩展前收口状态投影与动作规则。服务端读能力和写前校验复用同一规则，不并排新增一份 allowedActions 规则引擎。
3. 直接复用已经存在的 workbenchSummary、pendingDefinitionOptions、approvalActivations、signGroups.canReduce 等接口/字段，不另建同义概览和计票接口。
4. 本人消息已读应与管理员批量管理分清；不以给所有移动用户补管理权限作为修复。
5. 列表先采用现有 page/pageSize + useInfiniteQuery，不必为移动审批先改造整个系统的 cursor 协议。
6. 草稿版本/并发/完整意图必须前后端一起设计。不能只增加本地缓存，也不能只在返回详情上增加“编辑”按钮。
7. 真机布局和手势仍需后续实测；本轮代码复核不能把此前未完成的真机、相机和离线测试标成通过。

本轮只修改评估文档，不修改实现、不提交代码、不新增或变更数据库测试数据。复核覆盖前端页面/hooks、Shared 契约、Server 路由/服务/锁及现有测试，不以注释或原报告代替代码。

## 证据与问题逐项裁定

下列位置均相对于仓库根目录；区分“已复现”与“源码推导”，不把未执行的场景声称为浏览器复现。

### F01：切换账号展示旧数据——确认，最高优先级

- approval/lib/query-client.ts 是模块单例，staleTime=15 秒；approval/lib/queries.ts:24–39 的 key 无身份范围。通知、代理使用 contractKey，根甚至不在 ['approval'] 下。
- TaskListPage.tsx:245 退出只删 access/refresh token 并导航；LoginPage.tsx:40–42 写入 token 后直接导航；App-approval.tsx:27–30 只判断本地是否有 token。均未清旧 QueryClient，也没有身份就绪门禁。
- main-approval.tsx 没有装配后台 AuthProvider。因此后台 AuthProvider.tsx:148 的身份缓存清理和 storage 监听不会保护此入口。
- 前轮页面复现与代码相符；不能声称服务端绕过权限。另一个直接后果是旧 me 可短暂参与 actionable 计算，但服务器仍会校验任务归属。

**最终修复**：轻量 ApprovalSessionBoundary 管理身份与 session generation；身份变化时卸载全部个人页面、撤销旧请求并销毁/清空整个本入口 QueryClient，再加载 /me；不要只清 approval 前缀。请求、mutation 完成回调和 refresh 在回写缓存/凭证或导航前检查 session generation；普通 token 轮换不等于身份变化。同源后台账号切换广播、token 槽位变化和主动退出走同一边界。复用/提取 AuthProvider 的底层会话与清理逻辑，不把后台壳和所有 Provider 导入移动入口。

主动退出还应复用 authContract.logout 吊销当前会话，再清本地身份；当前轻页只清凭证，既有服务器会话需等待过期。后台与轻页既然共享 token 槽位，就应明确共同的账号/退出语义，不能为修缓存擅自改为两套凭证。退出请求失败也应完成本地退出，并保证旧 refresh 不能把凭证写回来。

### F02：退回后不能修改重提——确认，后端已有能力

TaskDetailPage.tsx:472/650 仅为 draft 显示编辑；returned 没有操作条。lifecycle.ts:379 的 updateInstanceDraft 明确允许 draft/returned，:406 的 submitDraftInstance 复用同实例、保留业务编号、清理旧活动任务，并推进新轮。

**最终修复**：returned 提供“修改并重新提交”，复用原 id 的编辑/提交。rejected/withdrawn 的“重新申请”使用 lifecycle.ts:496 的 resubmitInstance 克隆草稿，并遵守 allowResubmit 及 bizType/bizId 业务入口限制。allowResubmit 不应被套在所有 returned 路径上；当前后端将 returned 修正提交与终态克隆分开处理。

### F03：必传审批附件阻断——确认，而且覆盖六种动作

TaskDetailPage.tsx:249 仅在 approve+required 时提示桌面处理；:289–325 的 approve/reject/transfer/delegate/add-sign/return 都没有发送 attachments。task-actions.ts:78 与 task-routing.ts 在服务端对各动作强制附件策略。评论附件正常不代表动作附件已支持。

**最终修复**：为六种动作提供共用附件状态与上传区，遵守 hidden/optional/required；复用 FileAttachment、workflowAttachmentContract 与服务端文件绑定校验；动作取消/切换不得复用上一动作附件。保留签名现有证据体系；不能以图片代替签名对象。上传随 approvalRequest 会话发送，不能误走后台 request。

### F04：禁止撤回仍出现按钮——确认，服务端正确拒绝

TaskDetailPage.tsx:172 仅用 running+发起人判断，:694 无条件渲染撤回。mapping.ts:82 已返回 allowWithdraw，lifecycle.ts:298 已强制执行。

**最终修复**：立即消费 detail.allowWithdraw；公共实例动作投影同时考虑用户权限、状态、本人关系和业务限制。催办与撤回独立控制，不因禁撤回隐藏催办。

### F05：普通申请人首页报网络错误——确认，有可复用接口

queries.ts:71 用 Promise.all 同时取待办计数、抄送、草稿；任一 403 整体失败。TaskListPage 默认 pending，登录/发起成功均导航 '/'；失败页统一称网络错误。

**最终修复**：复用现有 workflowInstanceContract.workbenchSummary（instances.ts:583）和 queries.ts 服务端 getWorkbenchSummary:328；该接口已按权限返回 null。列表 hooks 按权限启用，不再为无权限项发请求。默认页：可 handle→待办，否则可 list→我的申请，否则可 create→发起；create-only 的草稿/详情相关权限组合单独按真实契约验收，不能假设有 create 即有 list。空权限给明确状态，不抛网络提示。

### F06：通知已读失败阻断跳转——确认，涉及 messaging 公共契约

TaskListPage.tsx:355 先 await markRead，无 catch，失败后不执行 navigate；in-app-messages.ts 契约 list/detail/unreadCount 为 authenticated，但 markRead/markAllRead/markReadBatch 需要 system:in-app-message:read。服务 markAsRead:223 和批量接口均已按收件人+租户限定。

**最终修复**：本人已读三个操作按 authenticated+收件人所有权执行；管理员 /admin/*、发送和删除权限不放开。修改契约后同步 PC、Mock、OpenAPI/领域快照。通知导航与已读副作用解耦：合法目标在服务端独立授权；已读失败提示可重试，但不妨碍进入有权访问的任务。先处理 401/会话失效，不能绕过登录边界。

### F07：必填意见仍快捷同意——确认，不能直接禁掉所有批量

TaskListPage.tsx:80 的 quickable 不检查意见；:287 总发送 comment=''。服务 queries.ts:219 的 requiresIndividual 检查业务动作表单、现场签名、必传附件、下级自选，没把意见必填计入；task-actions.ts:155 正确拒绝空意见。

**最终修复**：区分 canQuickApprove、canBatchApprove 和输入 requirements。意见必填任务可以在填写公共意见后批量处理，不应被统一降为不可批量。业务 actionComponent、现场手写、逐任务选人/附件等仍按实际能力要求逐条。列表元数据不包含完整 formData/定义；只有轻量动作摘要。

### F08：预览混入未经过分支——确认，是客户端解释错误

LaunchFormPage.tsx:58 只排除 start，未排除 excluded，也未显示 reason、approverReason、automaticAction。PC WorkflowApprovalChainPanel.tsx:166 已默认隐藏 excluded，保留 unknown 及预选规则。服务 workflow-preview.service.ts:88 确认 excluded 时 selectionRequired=false；initiator-select.ts:45–66 明确未知的未来可变路径仍需预选。

**更正原建议**：默认保留 matched+unknown，unknown 明确待条件确认并保留必要预选；excluded 折叠。不能机械地“只显示 matched”，否则把后端仍要求预选的未知节点隐藏。复用预测展示模型和选择校验，不将 PC Select 原样搬到移动抽屉。

### F09：同实例多任务不易区分，连续处理漏选——确认

服务 listPendingMine:195 按任务计数，未去重，正确；响应只有 pendingTaskId/pendingTaskNodeType，没有具体任务 nodeKey/nodeName/round。移动卡片只显示实例信息。queries.ts:329–337 只取前五条并排除整个 instanceId；TaskDetailPage:339 及其后的逻辑在没有 next 时不论 remaining 都显示“待办清零”。

**最终修复**：待办读模型补 pendingTask 的 nodeKey/nodeName/activationId/round/taskKind/slotOrigin/waitReason 等最小身份；保留 taskId 行粒度。连续处理排除当前 taskId，优先本实例剩余本人可办任务；随后按稳定任务顺序取下一项。不能用“前五条找不到”等同总数零；remaining>0 必须返回列表或明确提示。加签创建后原任务仍可能可办，不能把所有动作一律当“任务已完成”自动跳走。

### F10：实例深链不带 taskId 就没有操作——确认

TaskDetailPage.tsx:165–170 中 taskId 缺失就 currentTask=null。节点字段权限也依赖该 currentTask。详情接口本身按可见性/参与人规则授权，问题不是 API 完全缺失任务。

**最终修复**：无 taskId 时解析当前用户可操作任务：一条定位；多条选择；没有则只读。taskId 过期/已转交时刷新并解释，不能自动对另一任务提交。区分只读已办视图与可操作入口，避免改写用户明确打开的历史任务。

## 原报告需修正及新增发现

| 项目 | 审查结论 | 最终处理 |
| --- | --- | --- |
| “全部复杂流程状态落后于 PC” | 范围过大。移动已复用 ApprovalTimeline，已有建议状态、signPosition、轮次部分识别；缺 approvalActivations/childInstances 传参和组面板 | 补齐当前读模型，不重写时间线/计票引擎 |
| “已退回显示已驳回” | 真问题，但 ApprovalTimeline.tsx:146 的共享标签只看 task.status；并非移动专属 | 公共展示优先 decision.action，PC/移动一起回归 |
| “加签人不能再加签” | 移动 canAddSign 只看 taskKind，新增席位也为 approval；后端 task-routing.ts:160–171 检查 slot.origin=base，能拦截 | 真实错误入口，不是已证明的服务端越权；复用基础席位事实/动作能力隐藏 |
| “选人必须新增全组织接口” | 多余。selectableUsers 已提供有限协作字段，departmentName 也已存在；下级自选已有远程搜索 | 通用协作选人新增分页搜索能力并复用现有 owner API；保留现有节点范围，不调用管理用户接口 |
| “MFA/强制改密都转桌面” | 不准确。所有非 token 登录结果均显示同一提示，包括验证码、MFA、会话冲突；requirePasswordChange 实际位于含 token 的 LoginResponse 中，被轻页忽略 | 复用身份域完整登录状态机：验证码→MFA→会话冲突→改密/会话就绪，并保留受限站内 returnTo |
| custom/external 只能只读、不能动作 | 部分错误。详情正文只读，但 TaskDetailPage.tsx:724 已挂载 BusinessFormHost mode=action 并提交 businessInput | 已有 action 能力保留；custom 发起按注册能力逐个适配；external 坚持业务模块主导，不能通用发起 |
| 文档说“无 @/附件/回复” | 文档过时。TaskDetailPage 已有 mentions/attachments/parentId | 同步文档，不重复开发已有评论功能 |

### R01：固定幂等键阻止连续合法动作——新增，代码与既有测试确认

移动 queries.ts:137 使用 approval-`action`-`taskId` 固定键；PC workflow-tasks.ts 的单动作和批量已使用确认意图 UUID。服务 idempotency.ts:158–175 在成功后 10 秒缓存；同 key 不同内容返回 409，同内容回放旧结果。原始席位允许创建多组加签，因此一次成功后再次加签会出现合法意图被误判；失败响应会释放键，不能误称首次校验失败后必然被锁十秒。

**最终修复**：一次明确确认创建意图 id；同次网络重试复用，同任务下一次合法确认生成新 id。按钮 pending 同步阻止重复提交；响应未知先查询状态，禁止自动换 key 重试破坏性操作。复用现有中间件与锁，不改成完全取消幂等。

### R02：草稿意图丢失与并发保存——新增，代码确认

createInstance 在 asDraft 分支先返回，selectedInitiatorApprovers 不写 snapshot，也没有独立 draft 输入字段；ccUserIds 的创建抄送在非草稿分支之后，草稿不保留。updateDraft 仅 title/formData/priority；编辑页隐藏抄送，选择状态也不回填。自动保存只在 isEditingDraft 下运行；离线事件仅改变 online，没有重连触发补传。保存进行中新的变化被直接跳过，没有 dirty 尾随写队列。

服务已有 lockUnchangedWorkflowDraft 的事务内比较，不等于浏览器携带 revision 的跨请求并发控制：陈旧客户端可以在前一次写完成后发起下一次请求并覆盖，标题/优先级也不在该比较中。

**最终修复**：新增专用 draft intent 持久化（ccUserIds、selectedInitiatorApprovers）和 draftRevision，不混入业务 formData；完整保存/回填，选人提交前重新鉴权、按路径裁剪。串行 latest-wins 保存+dirty 尾随写，保存成功后再提交，expectedRevision 防覆盖；离线只保存恢复稿，不自动审批/提交。不得把草稿抄送提前发出去。

### R03：快照编辑与最新定义预览/提交不一致——新增，代码确认

LaunchFormPage.tsx:168 优先旧 definitionSnapshot；previewFlow 从当前已发布定义与当前表单取数；submitDraftInstance:411–435 同样重新加载当前定义/表单。前端可能按旧字段编辑，却按新规则预览/提交。

**最终规则**：新发起及每次草稿/returned 提交以当前已发布定义和当前表单为准；运行中的历史轮次仍使用该轮冻结快照。编辑进入时服务端给出当前 editor context；若与保存草稿的 definitionVersion/formRevision 不同，保留草稿并明确展示升级差异，重新确认选人与签名后再保存。请求带 expectedDefinitionVersion/expectedFormRevision，提交时再次检查并在同一事务内验证/物化。不能因“不兼容历史”而删除运行态证据快照，也不能无声更新用户草稿。

### R04：同实例切任务可能复用旧字段权限与值——新增，结构性缺陷，待专门浏览器验收

TaskDetailPage.tsx:437 的渲染 key 只含 instanceId 和 edit/read；同一实例从一个 edit 节点跳到另一个 edit 节点不换 key。use-form-linkage.ts:46 的初始值只在挂载时采样，动作状态 reset 不重置业务表单。调整连续审批后更易触发。

**最终修复**：编辑会话键明确包含 taskId/activationId/表单版本，任务切换先处理未保存编辑；无脏改动才同步后台刷新，有脏改动则提示冲突。不能简单将 updatedAt 加进 key，让每次轮询冲掉正在输入的内容。

### R05：筛选与分页确为正确性缺陷——确认，先使用现有分页契约

TaskListPage.tsx:213–225 过滤已加载页并从该页构造流程选项；queries.ts:44 固定 page=1、增大 pageSize；api-schemas.ts:73 上限 200，setSize 每次+10没有上限。我的申请后端已有 status/priority/definitionId；待办已有 definitionId 及跨分页 pendingDefinitionOptions；已办/抄送需扩展契约以支持新增的筛选。服务端排序增加唯一 taskId/id 兜底，处理导致列表移动时重置/刷新已加载页并按任务 id 合并，避免重复漏行。

### R06：附件要求、建议与自动预览语义必须共用事实

移动对上传要求只检查同意，建议任务的按钮与成功文案仍为“同意/拒绝/已同意”，与建议回执不一致；预览的 automaticAction/approverReason 未消费。修复应使用服务端决策/结果与 shared 元数据，不在手机端再次猜测“无人/自动跳过/正式完成”。不改变既有建议是否需要签名、意见及业务校验的服务端政策。

### R07：普通发起人不能删除自己的草稿——新增，契约确认

TaskDetailPage:650 对所有本人 draft 展示删除；queries.ts:246 调用 workflowInstanceContract.remove；该操作 instances.ts:602 要求 workflow:instance:delete，是全局实例管理权限。普通创建者即使能保存和编辑，也会在删除时被路由拒绝。上一轮未验证草稿删除成功，不能将草稿全生命周期标为全部通过。

**最终修复**：新增专用本人草稿删除操作，要求 workflow:instance:create，并在服务层强制 initiatorId=当前用户、status=draft、租户和业务删除约束；同一事务中检查状态、释放附件并删除，提交和删除竞争只能一个成功。不要放宽通用 remove 的管理权限，也不允许此操作删除 returned 或任何已提交实例。create-only 的草稿列表/编辑上下文采用同样的本人资源边界，避免为了草稿给用户补审批或管理权限。

## 最终架构取舍

### 会话与缓存

独立轻量会话边界 + 每个认证会话独立的 QueryClient 生命周期，沿用 contractKey 作为域 key；无需同时再为每个 key 手抄 userId/tenantId 前缀。请求携带当前 session generation，切换时清理所有身份查询和 mutation，补 AbortSignal 的有效传递。跨标签页处理身份广播；不要把正常 access token 刷新误判为切账号。最近使用和本地恢复稿按 deployment+tenant+user 隔离，退出清理，不跨身份恢复签名及附件内容。

### 工作流规则与动作

以实例、task、activation、slot、signGroup 为事实来源：Server 内提取可复用的动作判定/要求投影，让读取和执行校验共享规则。保留事务内新鲜状态检查。实例动作和任务动作分开；group.canReduce 继续使用已有投影。轻量列表只返回当前任务身份+quick/batch/requirements 摘要，详情才返回完整能力和可编辑规则；退回候选、人员候选走按需查询。动态业务适配器不允许在只读能力查询中执行 prepareApproval 的副作用/写入，只给出可供渲染的声明，最终提交再校验。

能力投影和纯显示语义抽在 shared 或无 I/O 公共层；DB/权限/业务适配器仍在 Server。PC 和移动复用 headless hooks/转换/请求载荷，分别渲染 Modal/Sheet。不能直接搬入绑定后台客户端和失效键的 WorkflowApprovalGroupsPanel；需让视图接收数据和回调，移动命令继续使用 approvalRequest。

### 草稿与快照

草稿专用 typed intent + revision，业务表单数据仍为 formData；定义版本与表单 revision 单独校验。当前发布版编辑语义与服务端现状一致，升级有明确确认边界。returned 保留实例和编号，rejected/withdrawn 是新草稿；external 业务主导入口保持原边界。只为新增字段做新迁移，不重写已执行迁移、不要为历史载荷增加双读双写或兼容开关。

最终新增的草稿字段确定为 draftIntent（typed ccUserIds/selectedInitiatorApprovers）、draftRevision 及 editor context 中的 definitionVersion/formRevision；已有快照继续承载该轮不可变证据。草稿恢复只缓存允许恢复的字段值和文件引用，不存 access/refresh token、签名 PNG、File/Blob 或免确认的签名选择；按身份隔离、有有效期，退出清除。用现有表单类型派生，不再增加一个自定义历史载荷版本解析器。

### 页面与通讯

保留现有五入口与轻页打包边界，按权限隐藏不可用入口；列表以任务为单位，详情分申请/进度/沟通，动作按复杂度采用 Sheet 或全屏。普通视觉选择是产品改造，不作为现有实现“有缺陷”的证据。默认使用 page/pageSize，扩大规模后再根据真实查询/变动量决定是否引入 cursor；不在本轮扩为全局分页重构。消息已读修复限个人操作；不取消管理员门禁。

## 最终分阶段实施计划

每阶段独立可验收后再进入下一阶段；实现时按阶段提交（本轮只给方案，没有执行提交）。

| 阶段 | 范围与主要产物 | 完成/验收门槛 |
| --- | --- | --- |
| 1. 会话与入口正确性 | ApprovalSessionBoundary；旧请求/refresh 回写隔离；完整登录挑战与改密状态；权限感知首页；复用 workbenchSummary；消息个人已读授权/导航解耦 | 账号 A→B 和后台同源切换均无旧数据闪现；迟到 A 响应不写入 B；无权限不发待办请求；验证码/MFA/冲突/改密均有正确分支；登录保留受限深链；个人已读不能操作他人/跨租户消息 |
| 2. 统一任务上下文与动作规则 | Server 读写同源能力投影；轻量 pendingTask 身份；currentTask 自动定位/多任务选择；动作意图幂等；任务表单会话重置；quick/batch 分离；全局时间线 decision 标签；allowWithdraw 立即对齐 | 同实例多任务节点可区分；缺 taskId 进入可选择本人任务；过期链接不能误提交其它任务；新增加签席位无再加签入口；必填意见无空提交；新确认独立、同确认重试不重复；剩余待办不误报清零 |
| 3. 发起/退回/草稿闭环 | returned 编辑提交；终态克隆草稿；本人草稿查询/删除；draft intent/revision；编辑上下文/版本冲突；自动保存串行尾随写和离开保护；matched/unknown/excluded/automaticAction 预览；提交成功落回申请详情/我的申请 | returned 原 id/编号保留；重提只产生一个活动轮次；本人草稿可删除且无法借此删除已提交实例；草稿自选/抄送可恢复但未提交不通知；旧版本明确确认、陈旧 revision 返回 409；保存中继续输入不会丢；离线恢复不虚报保存；未知路径必要选人仍可见 |
| 4. 审批与协作全闭环 | 六动作附件；前/后/并加签+会签/或签与组级减签；合法退回目标；建议回执语义；协办发起/回复、撤回已办与动态抄送；轮次/基础席位/组/子流程展示；连续处理按 taskId | 手机可完成必传附件；建议不计基础票；加签不改基础分母，前后签等待正确；减签权限不依赖原任务仍 pending；合法退回与 PC 一致；同实例剩余任务可继续处理；状态冲突后保留输入并刷新 |
| 5. 工作台与移动交互完善 | useInfiniteQuery 真分页；服务端统一筛选/总数、跨页定义选项、草稿直达；列表状态持久到 URL/路由；主操作条简化、复杂动作全屏、移动表单与明细、人员远程搜索；可配置连续审批；催办明细与冷却 | 201+ 数据可翻页、筛选找得到后页记录；权限与计数一致；返回保持 Tab/筛选/滚动；375/390/430 宽和横屏可操作；同名人能按已有部门区分；未实际成功的批量/已读不能 Toast 全部成功 |
| 6. 业务适配与发布验收 | custom 业务表单注册移动 create/view/action 能力并逐个适配；external 从业务模块发起；iOS/Android/企业 WebView、相机文件/PDF、软键盘、断网、登录失效；生产包预算及权威文档 | 真机重复发起→审批→退回→重提→终审→抄送；重要业务 actionComponent 功能保留；签名无跨任务自动复用；相机/分享失败有可用回退；生产构建通过入口预算；共享 PC 独立复杂流程回归通过 |

### 建议提交划分与依赖

- 阶段 1 分为 1A 会话隔离、1B 登录/权限/个人消息契约；身份与 messaging 变更按项目要求跑完整服务端回归。
- 阶段 2 先提交共享投影/契约/服务端，再让 PC 与移动消费同一元数据；同一次改动中同步 Mock、OpenAPI 和路径快照。
- 阶段 3 分为 3A 草稿 schema/intent/revision，3B 编辑上下文及自动保存，3C 退回/克隆入口和预览；不先做本地恢复再补服务端版本，以免用户看到“已保存”却丢失选人。
- 阶段 3 同时补本人草稿查询/删除命令。服务端资源归属与状态检查保持在专用服务边界，不复用管理员通用删除授权，也不因 create-only 而开放其它人的详情。
- 阶段 4 按附件动作、加减签与退回、协办/已办撤回分提交；每个提交验证实际状态、事件事实和签名/附件身份。
- 阶段 5 不再动流程计票；阶段 6 只在业务显式支持的能力上开放移动发起。

退回目标候选应从现有“已通过的前序 approve/handler 节点 + 发起人”规则派生；多个目标按当前服务端取最早目标的既有语义明确展示，不借移动适配顺便改变控制流。前/后/并加签继续使用已有 position/signMode 合约；组级减签沿用 canReduce，不复制管理权限判断。

## 测试与验收边界

本轮执行了现有的相关测试：

- Server：idempotency、task-actions、approval-state、detail-sanitize，4 文件 / 52 用例通过。
- Web：workflow-tasks、workflow-instances 查询缓存及 use-form-linkage，3 文件 / 10 用例通过。
- Shared：path-planner 选定集，工具报告 2 文件 / 38 用例通过，类型检查无错误。

这些是已有单元/替身测试的当前基线，证明已有规则和边界可复用；**不能证明移动页面问题已修复，也不能替代真实数据库/worker/浏览器验证**。本轮未改业务代码，未跑全量构建、lint 或完整测试套件，未重复浏览器/真机操作。

实施新增测试集中在会话身份、权限、契约、query 失效、动作载荷、幂等意图、草稿并发/版本和流程计票等稳定业务边界。普通开合、DOM 结构、CSS、完整文案与手势外观用浏览器/真机验收，不新增样式或源码字符串单测。外部集成和数据库测试必须明确标出实际启用条件。

共享工作流改动完成后，必须用原测试角色外的独立复杂流程覆盖：并行、比例会签、顺序会签、子流程、退回新轮、代理建议与前后加签；对照 PC/移动读取同一实例的状态、基础分母、任务归属、事件、签名和附件。

## 主要代码证据索引

| 主题 | 位置 |
| --- | --- |
| 轻页会话与缓存 | packages/web/src/approval/App-approval.tsx:27；lib/query-client.ts:4；lib/queries.ts:24；pages/LoginPage.tsx:35；pages/TaskListPage.tsx:245 |
| 可复用后台身份边界 | packages/web/src/providers/AuthProvider.tsx:148、402；packages/web/src/utils/http-client.ts:163 |
| 已有权限概览 | packages/shared/src/workflow/contracts/instances.ts:378、583；packages/server/src/services/workflow/instances/queries.ts:328 |
| 任务元数据与快捷限制 | packages/server/src/services/workflow/instances/queries.ts:185、219；packages/web/src/approval/pages/TaskListPage.tsx:80、277 |
| 当前任务/连续处理 | packages/web/src/approval/pages/TaskDetailPage.tsx:165、339、437；lib/queries.ts:329 |
| 草稿/重提/版本 | packages/server/src/services/workflow/instances/lifecycle.ts:104、379、406、496；signature-concurrency.ts:10；packages/web/src/approval/pages/LaunchFormPage.tsx:168、209、278 |
| 附件与服务端强校验 | packages/web/src/approval/pages/TaskDetailPage.tsx:249、289；packages/server/src/services/workflow/instances/task-actions.ts:66、78、145 |
| 加减签/退回 | packages/server/src/services/workflow/instances/task-routing.ts:160、202、346；instances/approval-state.ts:16；packages/web/src/components/workflow/WorkflowApprovalDetailSheet.tsx:215 |
| 幂等 | packages/web/src/approval/lib/queries.ts:137；packages/web/src/hooks/queries/workflow-tasks.ts:78、171；packages/server/src/middleware/idempotency.ts:158 |
| 预测与选择 | packages/web/src/approval/pages/LaunchFormPage.tsx:58；packages/web/src/components/workflow/WorkflowApprovalChainPanel.tsx:166；packages/server/src/services/workflow/workflow-preview.service.ts:26、88；instances/initiator-select.ts:45 |
| 个人消息读写 | packages/shared/src/messaging/contracts/in-app-messages.ts:66；packages/server/src/services/messaging/in-app-messages.service.ts:76、223；packages/web/src/approval/pages/TaskListPage.tsx:355 |
| 共享时间线 | packages/web/src/components/ApprovalTimeline.tsx:146；packages/web/src/components/workflow/WorkflowInstanceDetailPanel.tsx:564；packages/web/src/approval/pages/TaskDetailPage.tsx:548 |
| 业务动作表单 | packages/web/src/approval/pages/TaskDetailPage.tsx:724；packages/web/src/components/workflow/BusinessFormHost.tsx:24 |

最终建议按 1→2→3→4→5→6 执行；先修能否安全、正确地完成任务，再完善复杂协作和移动展示。不新增历史数据兼容层，不扩大为整个工作流引擎/全站认证/全站分页重写。

