// 工作流实例服务 — 已按业务域拆分至 instances/ 子模块。
// 本文件仅保留 re-export，保证既有 `workflow-instances.service` 引用路径稳定。

export {
  mapTask,
  mapInstance,
} from './instances/mapping';
export {
  buildChildFormData,
  resolveMultiItems,
  reconcileMultiSubProcess,
  maybeSpawnSubProcessChild,
  applySubProcessOutputAndResume,
  resumeParentSubProcess,
} from './instances/subprocess';
export {
  resumeInstanceForCompensation,
  handleNodeExecutionError,
} from './instances/failure-policy';
export {
  listMyInstances,
  listPendingMine,
  listMyCc,
  countMyCcUnread,
  countPendingMine,
  listRelationOptions,
  listMyHandled,
  listAllInstances,
  getInstanceDetail,
} from './instances/queries';
export {
  markCcRead,
  forwardInstance,
  urgeTask,
  listTaskUrges,
  listInstanceUrges,
  urgeInstance,
  addInstanceCc,
} from './instances/cc-urge';
export {
  getInstanceExecutionTokens,
  getInstanceRuntimeDiagnostics,
  getInstanceTrace,
  exportInstanceDiagnosticBundle,
} from './instances/diagnostics';
export {
  getWorkflowInstanceBeforeAudit,
  getWorkflowTaskBeforeAudit,
  getWorkflowTaskForAdminAudit,
  getInstanceForAdminAudit,
} from './instances/audit';
export {
  createInstance,
  withdrawInstance,
  cancelInstance,
  deleteInstance,
  updateInstanceDraft,
  submitDraftInstance,
  resubmitInstance,
} from './instances/lifecycle';
export {
  listTaskSelectableNextApprovers,
  approveTask,
  approveTaskByCallback,
  approveTaskCore,
  rejectTask,
  rejectTaskByCallback,
  rejectTaskCore,
} from './instances/task-actions';
export type { ApproveResult } from './instances/task-actions';
export {
  transferTask,
  systemTransferTaskToManager,
  delegateTask,
  addSignTask,
  reduceSignTask,
  returnTask,
} from './instances/task-routing';
export {
  batchApproveTasks,
  batchRejectTasks,
  batchWithdrawInstances,
  batchUrgeInstances,
} from './instances/batch';
export {
  jumpInstance,
  reassignTask,
  recallTask,
  skipStuckToken,
  replayFromToken,
  batchSkipStuckTokens,
} from './instances/admin-ops';
