import { useCreateWorkflowInstance } from './workflow-instances';

export const workflowLaunchKeys = {
  all: ['workflow', 'launch'] as const,
};

/** 发起工作台提交：与「我的申请」发起共用契约操作与 ['workflow'] 失效范围，幂等键由调用方按表单指纹传入 */
export const useLaunchWorkflowInstance = useCreateWorkflowInstance;