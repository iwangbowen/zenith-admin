import { useMemo, useRef, useState } from 'react';
import { Button, Form, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import {
  WORKFLOW_APPROVAL_SLOT_STATUS_LABELS, WORKFLOW_APPROVE_METHOD_LABELS,
  WORKFLOW_SIGN_GROUP_STATUS_LABELS, WORKFLOW_SIGN_POSITION_LABELS,
  type WorkflowApprovalSlot, type WorkflowNodeActivation, type WorkflowSignGroup, type WorkflowTask, type WorkflowTaskConsult,
} from '@zenith/shared/workflow';
import { AppModal } from '@/components/AppModal';
import DateTimeText from '@/components/DateTimeText';
import { useReduceWorkflowSignGroup } from '@/hooks/queries/workflow-tasks';
import { taskStatusDisplay } from './workflow-runtime';

interface Props {
  activations: WorkflowNodeActivation[];
  tasks?: WorkflowTask[];
  /** 实例协办记录：按邀请任务折算到所属节点，挂在对应审批组下（找不到归属的不展示） */
  consults?: readonly WorkflowTaskConsult[];
  allowActions?: boolean;
}

/** 席位 / 协办行内时间：审批流转记录统一经 DateTimeText 渲染，无时间时不占位 */
function SlotTime({ value }: Readonly<{ value: string | null }>) {
  if (!value) return null;
  return <Typography.Text type="tertiary" size="small"><DateTimeText value={value} /></Typography.Text>;
}

/** 自动处理节点（抄送等）：无席位可挂时间，直接展示该节点下未被席位认领的任务时间 */
function ActivationAutoTasks({ nodeKey, tasks, slotTaskIds }: Readonly<{
  nodeKey: string;
  tasks: WorkflowTask[];
  slotTaskIds: ReadonlySet<number>;
}>) {
  const rows = tasks
    .filter((t) => t.nodeKey === nodeKey && !slotTaskIds.has(t.id))
    .sort((a, b) => a.id - b.id);
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <Space wrap>
        {rows.map((t) => {
          const display = taskStatusDisplay({ status: t.status, nodeType: t.nodeType });
          return (
            <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Tag color={display.color}>
                {t.assigneeName ?? (t.assigneeId != null ? `用户#${t.assigneeId}` : '系统')} · {display.text}
              </Tag>
              <SlotTime value={t.actionAt ?? t.activatedAt ?? t.createdAt} />
            </span>
          );
        })}
      </Space>
    </div>
  );
}

/** 基础席位区：无席位（如自动处理的抄送节点）时整块不渲染，避免空容器撑出间距 */
function ActivationBaseSlots({ slots, slotTime }: Readonly<{
  slots: WorkflowApprovalSlot[];
  slotTime: (slot: Pick<WorkflowApprovalSlot, 'currentTaskId'>) => string | null;
}>) {
  const baseSlots = slots.filter((slot) => slot.origin === 'base');
  if (baseSlots.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <Space wrap>
        {baseSlots.map((slot) => (
          <span key={slot.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Tag>
              {slot.assigneeName ?? `用户#${slot.currentAssigneeId ?? ''}`} · {WORKFLOW_APPROVAL_SLOT_STATUS_LABELS[slot.status]}
              {slot.mandatory ? ' · 必须处理' : ''}
            </Tag>
            <SlotTime value={slotTime(slot)} />
          </span>
        ))}
      </Space>
    </div>
  );
}

/** 直接展示服务端轮次/席位/组读模型，任务记录和委派建议不计作基础票。 */
export function WorkflowApprovalGroupsPanel({ activations, tasks = [], consults = [], allowActions = true }: Readonly<Props>) {
  const [groupId, setGroupId] = useState<number | null>(null);
  const formApi = useRef<FormApi | null>(null);
  const reduce = useReduceWorkflowSignGroup();
  // 协办只落库 taskId / nodeName，不含 nodeKey：先经邀请任务换算节点，换算不到时按节点名回退，仍无归属的跳过
  const consultsByNodeKey = useMemo(() => {
    const nodeKeyByTaskId = new Map(tasks.map((t) => [t.id, t.nodeKey]));
    const byNode = new Map<string, WorkflowTaskConsult[]>();
    for (const c of [...consults].sort((a, b) => a.id - b.id)) {
      const key = nodeKeyByTaskId.get(c.taskId) ?? activations.find((a) => a.nodeName === c.nodeName)?.nodeKey;
      if (!key) continue;
      const list = byNode.get(key) ?? [];
      list.push(c);
      byNode.set(key, list);
    }
    return byNode;
  }, [tasks, consults, activations]);
  const group = activations.flatMap((activation) => activation.signGroups).find((item) => item.id === groupId);
  const candidates = group?.slots.filter((slot) => slot.status === 'pending') ?? [];
  // 席位时间取其当前任务：已处理显示处理时间，未处理显示任务到达时间（激活→创建兜底）
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const slotTaskIds = useMemo(() => new Set(
    activations
      .flatMap((a) => [...a.slots, ...a.signGroups.flatMap((g) => g.slots)])
      .map((s) => s.currentTaskId)
      .filter((id): id is number => id != null),
  ), [activations]);
  const slotTime = (slot: Pick<WorkflowApprovalSlot, 'currentTaskId'>): string | null => {
    const task = slot.currentTaskId != null ? taskById.get(slot.currentTaskId) : undefined;
    return task?.actionAt ?? task?.activatedAt ?? task?.createdAt ?? null;
  };
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
              {activation.kind === 'approval' && activation.baseTotal > 0 ? <Typography.Text>基础意见 {activation.baseApproved}/{activation.baseTotal}，需 {activation.baseRequired} 票</Typography.Text> : <Typography.Text type="tertiary">{activation.kind === 'repair' ? '故障修复进入' : activation.kind === 'cc' ? '抄送记录' : '系统执行，不适用人工计票'}</Typography.Text>}
              {activation.kind === 'approval' && activation.baseTotal > 0 && activation.baseSatisfied && <Tag color="green">基础条件已满足</Tag>}
            </Space>
            <ActivationBaseSlots slots={activation.slots} slotTime={slotTime} />
            {activation.approveMethod === null && (
              <ActivationAutoTasks nodeKey={activation.nodeKey} tasks={tasks} slotTaskIds={slotTaskIds} />
            )}
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
                  <Space wrap>{item.slots.map((slot) => (
                    <span key={slot.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Tag>
                        {slot.assigneeName ?? `用户#${slot.currentAssigneeId ?? ''}`} · {WORKFLOW_APPROVAL_SLOT_STATUS_LABELS[slot.status]}
                      </Tag>
                      <SlotTime value={slotTime(slot)} />
                    </span>
                  ))}</Space>
                </div>
              </div>
            ))}
            {(consultsByNodeKey.get(activation.nodeKey) ?? []).map((c) => (
              <div key={c.id} style={{ marginTop: 8, fontSize: 12 }}>
                <Space wrap spacing={6}>
                  <Tag size="small" color="purple">协办</Tag>
                  <Typography.Text>
                    {c.inviterName ?? `用户#${c.inviterId}`} 邀请 {c.consulteeName ?? `用户#${c.consulteeId}`}
                  </Typography.Text>
                  {c.status === 'pending'
                    ? <Tag size="small" color="amber">待回复</Tag>
                    : <Tag size="small" color="green">已回复</Tag>}
                  <SlotTime value={c.repliedAt ?? c.createdAt} />
                </Space>
                {c.question && <div style={{ marginTop: 2, color: 'var(--semi-color-text-2)' }}>问题：{c.question}</div>}
                {c.opinion && <div style={{ marginTop: 2 }}>意见：{c.opinion}</div>}
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
