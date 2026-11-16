import { Banner, SideSheet } from '@douyinfe/semi-ui';
import WorkflowInstanceDetailPanel from '@/components/workflow/WorkflowInstanceDetailPanel';
import { useGovernanceRequestWorkflow } from '@/hooks/queries/identity-access-governance';

export default function GovernanceWorkflowSheet({ requestId, onClose }: { readonly requestId: number | null; readonly onClose: () => void }) {
  const query = useGovernanceRequestWorkflow(requestId);
  return <SideSheet title="来源申请流程" width={1080} visible={requestId !== null} onCancel={onClose} closeOnEsc>
    {query.isError ? <Banner type="warning" description="无法读取来源流程，请刷新重试" /> : <WorkflowInstanceDetailPanel instance={query.data ?? null} readOnly loading={query.isFetching} />}
  </SideSheet>;
}
