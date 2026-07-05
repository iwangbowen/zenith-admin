/**
 * 离职交接向导 Modal（流程监控工具栏入口）
 *
 * 选择交接人后自动预览影响范围（待办/审批代理/写死审批人的定义清单），
 * 选择接手人执行批量移交；逐条改派互不阻断，结束后展示成功/失败明细。
 */
import { useRef, useState } from 'react';
import { Banner, Checkbox, Form, Select, Table, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { WorkflowHandoverPreview, WorkflowHandoverResult } from '@zenith/shared';
import AppModal from '@/components/AppModal';
import { useUserOptions } from '@/hooks/useUserOptions';
import { useWorkflowHandover, useWorkflowHandoverPreview } from '@/hooks/queries/workflow-monitor';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function WorkflowHandoverModal({ visible, onClose }: Readonly<Props>) {
  const formApi = useRef<FormApi | null>(null);
  const { userOptions } = useUserOptions({ immediate: true });
  const previewMutation = useWorkflowHandoverPreview();
  const handoverMutation = useWorkflowHandover();
  const [fromUserId, setFromUserId] = useState<number | null>(null);
  const [preview, setPreview] = useState<WorkflowHandoverPreview | null>(null);
  const [disableDelegations, setDisableDelegations] = useState(true);
  const [result, setResult] = useState<WorkflowHandoverResult | null>(null);

  const reset = () => {
    setFromUserId(null);
    setPreview(null);
    setResult(null);
    setDisableDelegations(true);
  };

  const handleFromChange = async (v: number) => {
    setFromUserId(v);
    setPreview(null);
    setResult(null);
    if (!v) return;
    try {
      setPreview(await previewMutation.mutateAsync(v));
    } catch { /* request 层已提示 */ }
  };

  const submit = async () => {
    try {
      const values = await formApi.current?.validate() as { toUserId: number; comment?: string };
      if (!fromUserId) { Toast.warning('请选择交接人'); return; }
      if (values.toUserId === fromUserId) { Toast.error('接手人不能与交接人相同'); return; }
      const res = await handoverMutation.mutateAsync({
        fromUserId,
        toUserId: values.toUserId,
        disableDelegations,
        comment: values.comment,
      });
      setResult(res);
      if (res.failed === 0) Toast.success(`已交接 ${res.succeeded}/${res.taskTotal} 条待办`);
      else Toast.warning(`交接完成：成功 ${res.succeeded} 条，失败 ${res.failed} 条，请查看明细`);
    } catch { /* validation or request */ }
  };

  const totalTasks = (preview?.pendingTaskCount ?? 0) + (preview?.waitingTaskCount ?? 0);

  return (
    <AppModal
      title="离职交接"
      visible={visible}
      onCancel={() => { reset(); onClose(); }}
      onOk={result ? () => { reset(); onClose(); } : () => void submit()}
      okText={result ? '完成' : '执行交接'}
      okButtonProps={{ loading: handoverMutation.isPending, type: 'primary', disabled: !result && (!preview || totalTasks + (preview?.delegationCount ?? 0) === 0) }}
      style={{ width: 560 }}
    >
      <Form getFormApi={(api) => { formApi.current = api; }} labelPosition="left" labelWidth={90} disabled={!!result}>
        <Form.Slot label="交接人">
          <Select
            filter
            placeholder="选择离职/转岗人员"
            optionList={userOptions}
            value={fromUserId ?? undefined}
            onChange={(v) => void handleFromChange(v as number)}
            style={{ width: '100%' }}
            disabled={!!result}
            loading={previewMutation.isPending}
          />
        </Form.Slot>
        {preview && (
          <Form.Slot label="影响范围">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Tag color="blue">待办 {preview.pendingTaskCount} 条</Tag>
                <Tag color="cyan">等待中 {preview.waitingTaskCount} 条</Tag>
                <Tag color="violet">启用代理 {preview.delegationCount} 条</Tag>
              </div>
              {preview.affectedDefinitions.length > 0 && (
                <Banner
                  fullMode={false}
                  closeIcon={null}
                  type="warning"
                  description={(
                    <span>
                      {preview.affectedDefinitions.length} 个已发布流程将其写死为指定审批人（
                      {preview.affectedDefinitions.map((d) => `${d.name}：${d.nodeNames.join('、')}`).join('；')}
                      ），请在流程设计器中另行调整。
                    </span>
                  )}
                />
              )}
              {totalTasks + preview.delegationCount === 0 && (
                <Typography.Text type="tertiary">该用户名下无未处理待办与启用代理，无需交接。</Typography.Text>
              )}
            </div>
          </Form.Slot>
        )}
        <Form.Select
          field="toUserId"
          label="接手人"
          placeholder="选择接手人"
          filter
          optionList={userOptions.filter((u) => u.value !== fromUserId)}
          rules={[{ required: true, message: '请选择接手人' }]}
          style={{ width: '100%' }}
        />
        <Form.Slot label="代理规则">
          <Checkbox checked={disableDelegations} onChange={(e) => setDisableDelegations(!!e.target.checked)} disabled={!!result}>
            同时停用其名下启用中的审批代理规则
          </Checkbox>
        </Form.Slot>
        <Form.TextArea field="comment" label="交接说明" rows={2} maxLength={255} placeholder="选填，随转办记录留痕" />
      </Form>
      {result && (
        <div style={{ marginTop: 12 }}>
          <Typography.Text strong>
            交接结果：成功 {result.succeeded} / {result.taskTotal} 条{result.delegationsDisabled > 0 ? `，已停用代理 ${result.delegationsDisabled} 条` : ''}
          </Typography.Text>
          {result.results.length > 0 && (
            <Table
              size="small"
              style={{ marginTop: 8 }}
              pagination={false}
              scroll={{ y: 200 }}
              dataSource={result.results}
              rowKey="taskId"
              columns={[
                { title: '申请标题', dataIndex: 'title', ellipsis: true },
                { title: '节点', dataIndex: 'nodeName', width: 120 },
                {
                  title: '结果', dataIndex: 'success', width: 140,
                  render: (ok: boolean, r) => (ok ? <Tag color="green">已移交</Tag> : <Tag color="red">{r.message ?? '失败'}</Tag>),
                },
              ]}
            />
          )}
        </div>
      )}
    </AppModal>
  );
}
