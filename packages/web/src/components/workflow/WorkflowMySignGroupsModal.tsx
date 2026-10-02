import { Button, List, Tag, Typography } from '@douyinfe/semi-ui';
import { WORKFLOW_SIGN_POSITION_LABELS, WORKFLOW_SIGN_GROUP_STATUS_LABELS, WORKFLOW_INSTANCE_STATUS_LABELS } from '@zenith/shared/workflow';
import { AppModal } from '@/components/AppModal';
import { ListPagination } from '@/components/ListPagination';
import { usePagination } from '@/hooks/usePagination';
import { useMyWorkflowSignGroups } from '@/hooks/queries/workflow-tasks';

export function WorkflowMySignGroupsModal({ visible, onClose, onOpenInstance }: Readonly<{
  visible: boolean; onClose: () => void; onOpenInstance: (instanceId: number) => void;
}>) {
  const { page, pageSize, buildPagination } = usePagination({ pageSize: 10, resetKey: visible });
  const groups = useMyWorkflowSignGroups(page, pageSize, visible);
  return <AppModal title="我的加签" visible={visible} onCancel={onClose} footer={null} closeOnEsc>
    <Typography.Paragraph type="tertiary">查看你创建或负责的未完成加签组。原任务等待或已办后，可从申请详情的「审批明细」继续减签。</Typography.Paragraph>
    <List loading={groups.isFetching} dataSource={groups.data?.list ?? []} emptyContent="暂无未完成加签组"
      renderItem={(group) => <List.Item main={<div>
        <Typography.Text strong>{group.title}</Typography.Text>
        <div style={{ marginTop: 6 }}>
          <Tag>{group.nodeName}</Tag> <Tag>{WORKFLOW_SIGN_POSITION_LABELS[group.position]}</Tag>{' '}
          <Tag>{WORKFLOW_SIGN_GROUP_STATUS_LABELS[group.status]}</Tag>{' '}
          {group.instanceStatus === 'suspended' && <Tag>{WORKFLOW_INSTANCE_STATUS_LABELS.suspended}</Tag>}
        </div>
      </div>} extra={<Button theme="borderless" onClick={() => { onClose(); onOpenInstance(group.instanceId); }}>打开申请</Button>} />} />
    <ListPagination pagination={buildPagination(groups.data?.total ?? 0)} />
  </AppModal>;
}
