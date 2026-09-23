import { useEffect, useState } from 'react';
import { Empty } from '@douyinfe/semi-ui';
import BusinessWorkflowPanel from '@/components/workflow/BusinessWorkflowPanel';
import WorkflowSideSheet from '@/components/workflow/WorkflowSideSheet';
import {
  useCmsContentWorkflowContext,
  useCmsContentWorkflowPreview,
  useCmsContentWorkflowRecord,
  useCmsContentApprovalDetail,
} from '@/hooks/queries/cms';
import { ContentApprovalDetails } from './ContentApprovalView';

/** 从业务列表查看内容及审批记录，不要求流程定义管理权限。 */
export default function CmsContentWorkflowSheet({ contentId, title, onClose }: Readonly<{
  contentId: number;
  title: string;
  onClose: () => void;
}>) {
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>();
  const detailQuery = useCmsContentWorkflowRecord(contentId);
  const contextQuery = useCmsContentWorkflowContext(contentId, selectedInstanceId ?? undefined);
  const approvalQuery = useCmsContentApprovalDetail(contentId, contextQuery.data?.instance?.id);
  const content = contextQuery.data?.instance ? approvalQuery.data : detailQuery.data;
  useEffect(() => {
    if (selectedInstanceId !== undefined || !contextQuery.data) return;
    // 查看审批默认打开最近一轮；编辑草稿页才默认显示本次提审预览。
    setSelectedInstanceId(contextQuery.data.instance?.id ?? contextQuery.data.previousInstances[0]?.id ?? null);
  }, [contextQuery.data, selectedInstanceId]);
  const previewQuery = useCmsContentWorkflowPreview({
    siteId: content?.siteId ?? 0,
    channelId: content?.channelId ?? 0,
    title: content?.title,
  }, contextQuery.isSuccess && selectedInstanceId !== undefined && !contextQuery.data?.instance);

  return (
    <WorkflowSideSheet title={`内容审批：${title}`} visible onCancel={onClose} variant="split">
      <BusinessWorkflowPanel
        context={contextQuery.data}
        preview={previewQuery.data}
        formContent={content ? <ContentApprovalDetails content={content} /> : <Empty title="无法加载内容详情" />}
        loading={detailQuery.isLoading || approvalQuery.isLoading || contextQuery.isLoading || previewQuery.isLoading}
        error={approvalQuery.error ?? detailQuery.error ?? contextQuery.error ?? (contextQuery.data?.instance ? null : previewQuery.error)}
        onRetry={() => { void detailQuery.refetch(); void contextQuery.refetch(); if (contextQuery.data?.instance) void approvalQuery.refetch(); if (!contextQuery.data?.instance) void previewQuery.refetch(); }}
        selectedInstanceId={selectedInstanceId ?? undefined}
        onSelectInstance={(next) => setSelectedInstanceId(next ?? null)}
      />
    </WorkflowSideSheet>
  );
}
