import { useRef, useState } from 'react';
import { Button, Form, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import {
  WORKFLOW_APPROVAL_SLOT_STATUS_LABELS, WORKFLOW_APPROVE_METHOD_LABELS,
  WORKFLOW_SIGN_GROUP_STATUS_LABELS, WORKFLOW_SIGN_POSITION_LABELS,
  type WorkflowNodeActivation, type WorkflowSignGroup,
} from '@zenith/shared/workflow';
import { AppModal } from '@/components/AppModal';
import { useReduceWorkflowSignGroup } from '@/hooks/queries/workflow-tasks';

interface Props {
  activations: WorkflowNodeActivation[];
  allowActions?: boolean;
}

/** 直接展示服务端轮次/席位/组读模型，任务记录和委派建议不计作基础票。 */
export function WorkflowApprovalGroupsPanel({ activations, allowActions = true }: Readonly<Props>) {
  const [groupId, setGroupId] = useState<number | null>(null);
  const formApi = useRef<FormApi | null>(null);
  const reduce = useReduceWorkflowSignGroup();
  const group = activations.flatMap((activation) => activation.signGroups).find((item) => item.id === groupId);
  const candidates = group?.slots.filter((slot) => slot.status === 'pending') ?? [];
  const openReduce = (item: WorkflowSignGroup) => {
    setGroupId(item.id);
    formApi.current?.setValues({ targetSlotIds: [], comment: '' });
  };
  const submit = async () => {
    if (!group || !group.canReduce || !candidates.length) return;
    try {
      const body = await formApi.current?.validate() as { targetSlotIds: number[]; comment?: string };
      await reduce.mutateAsync({ params: { groupId: group.id }, body });
      Toast.success('已减签');
      setGroupId(null);
    } catch { /* 字段校验与请求层显示错误，保留当前选择以便修正。 */ }
  };

  return (
    <>
      <Space vertical align="start" spacing={16} style={{ width: '100%' }}>
        {activations.map((activation) => (
          <div key={activation.id} style={{ width: '100%' }}>
            <Space wrap>
              <Typography.Text strong>{activation.nodeName}</Typography.Text>
              <Tag>{activation.approveMethod ? WORKFLOW_APPROVE_METHOD_LABELS[activation.approveMethod] : '自动处理'}</Tag>
              <Typography.Text>基础意见 {activation.baseApproved}/{activation.baseTotal}，需 {activation.baseRequired} 票</Typography.Text>
              {activation.baseSatisfied && <Tag color="green">基础条件已满足</Tag>}
            </Space>
            <div style={{ marginTop: 8 }}>
              <Space wrap>
                {activation.slots.filter((slot) => slot.origin === 'base').map((slot) => (
                  <Tag key={slot.id}>
                    {slot.assigneeName ?? `用户#${slot.currentAssigneeId ?? ''}`} · {WORKFLOW_APPROVAL_SLOT_STATUS_LABELS[slot.status]}
                    {slot.mandatory ? ' · 必须处理' : ''}
                  </Tag>
                ))}
              </Space>
            </div>
            {activation.signGroups.map((item) => (
              <div key={item.id} style={{ marginTop: 12, paddingLeft: 12, borderLeft: '2px solid var(--semi-color-border)' }}>
                <Space wrap>
                  <Typography.Text strong>{WORKFLOW_SIGN_POSITION_LABELS[item.position]}</Typography.Text>
                  <Tag>{WORKFLOW_SIGN_GROUP_STATUS_LABELS[item.status]}</Tag>
                  <Typography.Text type="tertiary">{WORKFLOW_APPROVE_METHOD_LABELS[item.signMode]}，本组为补充意见关卡</Typography.Text>
                  {allowActions && item.canReduce && item.slots.some((slot) => slot.status === 'pending') && (
                    <Button size="small" theme="borderless" onClick={() => openReduce(item)}>减签</Button>
                  )}
                </Space>
                <div style={{ marginTop: 6 }}>
                  <Space wrap>{item.slots.map((slot) => <Tag key={slot.id}>
                    {slot.assigneeName ?? `用户#${slot.currentAssigneeId ?? ''}`} · {WORKFLOW_APPROVAL_SLOT_STATUS_LABELS[slot.status]}
                  </Tag>)}</Space>
                </div>
              </div>
            ))}
          </div>
        ))}
      </Space>
      <AppModal title="减签" visible={groupId !== null} closeOnEsc fullscreenable={false}
        onCancel={() => setGroupId(null)} onOk={() => void submit()} okText="确认" okButtonProps={{ loading: reduce.isPending, disabled: !candidates.length }}>
        <Form key={groupId ?? 'closed'} labelPosition="left" labelWidth={120} getFormApi={(api) => { formApi.current = api; }}>
          <Form.CheckboxGroup field="targetSlotIds" label="未办加签人" rules={[{ required: true, message: '请选择未处理的加签人' }]}
            options={candidates.map((slot) => ({ value: slot.id, label: slot.assigneeName ?? `用户#${slot.currentAssigneeId ?? ''}` }))} />
          <Form.TextArea field="comment" label="减签说明" rows={3} />
        </Form>
        <Typography.Paragraph type="tertiary">已办意见及原始审批人保留。移除全部未办成员会解除本组关卡，不会产生同意票。</Typography.Paragraph>
      </AppModal>
    </>
  );
}
