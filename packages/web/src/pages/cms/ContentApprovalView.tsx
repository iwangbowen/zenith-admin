import { Empty, Spin } from '@douyinfe/semi-ui';
import type { WorkflowBusinessFormProps } from '@/components/workflow/BusinessFormHost';
import { useCmsContentApprovalDetail } from '@/hooks/queries/cms';
import type { CmsContent } from '@zenith/shared/cms';
import { ContentRevisionViewer } from './ContentRevisionViewer';

/** 审批接口按 instanceId 返回送审时冻结的完整修订。 */
export default function ContentApprovalView({ bizId, instanceId }: Readonly<WorkflowBusinessFormProps>) {
  const query = useCmsContentApprovalDetail(bizId ? Number(bizId) : undefined, instanceId);
  if (query.isLoading) return <Spin />;
  if (!query.data) return <Empty title="无法加载送审稿件" />;
  return <ContentApprovalDetails content={query.data} />;
}

export function ContentApprovalDetails({ content }: Readonly<{ content: CmsContent }>) {
  return <ContentRevisionViewer content={content} heading="内容审核" />;
}
