import type { QueryClient } from '@tanstack/react-query';
import { bizLeaveContract, type BizLeave } from '@zenith/shared/biz';
import { cmsContentContract } from '@zenith/shared/cms';
import { workflowInstanceContract, type WorkflowBusinessContext, type WorkflowInstance } from '@zenith/shared/workflow';
import { contractKey } from '@/lib/contract-query';

type BusinessRef = { type: 'biz_leave' | 'cms_content'; id: number };

/** 从已授权缓存反查业务归属，流程变化只刷新对应业务单据，不触碰其他业务的编辑器。 */
export function invalidateBusinessWorkflow(qc: QueryClient, instanceId?: number): void {
  void import('./identity-access-governance').then(({ invalidateAccessRequests }) => invalidateAccessRequests(qc));
  const refs = new Map<string, BusinessRef>();
  const add = (type: string | null | undefined, id: string | number | null | undefined) => {
    if ((type === 'biz_leave' || type === 'cms_content') && id && Number.isInteger(Number(id))) {
      refs.set(`${type}:${id}`, { type, id: Number(id) });
    }
  };
  const matches = (id: number) => instanceId === undefined || id === instanceId;
  for (const operation of [workflowInstanceContract.detail, workflowInstanceContract.list,
    workflowInstanceContract.pendingMine, workflowInstanceContract.handledMine,
    workflowInstanceContract.ccMine, workflowInstanceContract.monitor]) {
    for (const [, data] of qc.getQueriesData<Partial<WorkflowInstance> & {
      instance?: WorkflowInstance; list?: Partial<WorkflowInstance>[];
    }>({ queryKey: contractKey(operation) })) {
      if (!data) continue;
      for (const item of data.list ?? [data.instance ?? data]) {
        if (item.id && matches(item.id)) add(item.bizType, item.bizId);
      }
    }
  }
  for (const [type, operation] of [
    ['biz_leave', bizLeaveContract.workflowContext], ['cms_content', cmsContentContract.workflowContext],
  ] as const) {
    for (const [key, data] of qc.getQueriesData<WorkflowBusinessContext>({ queryKey: contractKey(operation) })) {
      if (!data) continue;
      if ((data.instance && matches(data.instance.id)) || data.previousInstances.some((item) => matches(item.id))) {
        const input = key[2] as { params: { id: number } };
        add(type, input.params.id);
      }
    }
  }
  // 请假列表自带实例 ID，即使尚未打开过详情也能在审批完成通知后更新状态列。
  for (const [, data] of qc.getQueriesData<{ list: BizLeave[] }>({ queryKey: contractKey(bizLeaveContract.list) })) {
    for (const item of data?.list ?? []) {
      if (item.workflowInstanceId && matches(item.workflowInstanceId)) add('biz_leave', item.id);
    }
  }
  for (const ref of refs.values()) {
    const contract = ref.type === 'biz_leave' ? bizLeaveContract : cmsContentContract;
    void qc.invalidateQueries({ queryKey: contractKey(contract.list) });
    void qc.invalidateQueries({ queryKey: contractKey(contract.detail, { params: { id: ref.id } }) });
    void qc.invalidateQueries({ queryKey: [...contractKey(contract.approvalDetail), { params: { id: ref.id } }] });
    void qc.invalidateQueries({ queryKey: [...contractKey(contract.workflowContext), { params: { id: ref.id } }] });
  }
}
