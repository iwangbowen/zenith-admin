import { useEffect, useState } from 'react';
import { Select, Input, InputNumber, Toast, Typography, Space } from '@douyinfe/semi-ui';
import type { WorkflowDefinition, WorkflowFlowData, WorkflowRecoveryBatchResult } from '@zenith/shared';
import { request } from '@/utils/request';
import AppModal from '@/components/AppModal';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * 批量推进卡死实例：选流程定义 + 卡死节点（+ 卡死时长下限），逐个跳过该节点的活动 Token 并推进。
 * 自包含：自行加载已发布流程与所选流程的节点列表，无需父组件透传。
 */
export default function WorkflowBatchRecoveryModal({ visible, onClose }: Readonly<Props>) {
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [definitionId, setDefinitionId] = useState<number | undefined>();
  const [nodeOptions, setNodeOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [nodeKey, setNodeKey] = useState<string | undefined>();
  const [olderThanMinutes, setOlderThanMinutes] = useState<number | undefined>();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDefinitionId(undefined);
    setNodeKey(undefined);
    setNodeOptions([]);
    setOlderThanMinutes(undefined);
    setReason('');
    void request.get<WorkflowDefinition[]>('/api/workflows/definitions/published').then((res) => {
      if (res.code === 0) setDefinitions(res.data ?? []);
    });
  }, [visible]);

  const onPickDefinition = async (id: number) => {
    setDefinitionId(id);
    setNodeKey(undefined);
    setNodeOptions([]);
    const res = await request.get<WorkflowDefinition>(`/api/workflows/definitions/${id}`);
    if (res.code === 0) {
      const flow = (res.data.flowData ?? null) as WorkflowFlowData | null;
      const opts = (flow?.nodes ?? [])
        .filter((n) => n.data.type !== 'start' && n.data.type !== 'end')
        .map((n) => ({ label: `${n.data.label || n.data.key}（${n.data.key}）`, value: n.data.key }));
      setNodeOptions(opts);
    }
  };

  const submit = async () => {
    if (!definitionId || !nodeKey) {
      Toast.warning('请选择流程定义与卡死节点');
      return;
    }
    setSubmitting(true);
    try {
      const res = await request.post<WorkflowRecoveryBatchResult>('/api/workflows/instances/batch-skip-stuck', {
        definitionId,
        nodeKey,
        ...(olderThanMinutes ? { olderThanMinutes } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      if (res.code === 0) {
        Toast.success(res.message || `已推进 ${res.data.success}/${res.data.total} 个实例`);
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppModal
      title="批量推进卡死实例"
      visible={visible}
      onCancel={onClose}
      onOk={() => void submit()}
      okText="确认推进"
      okButtonProps={{ loading: submitting }}
      width={520}
    >
      <Space vertical align="start" style={{ width: '100%' }} spacing={12}>
        <Typography.Text type="tertiary" size="small">
          找出所选流程下停在指定节点的全部运行中实例，逐个跳过该节点并推进流程。用于节点配置错误 / 外部派发失败导致的集体卡死恢复，单个失败不影响其它。
        </Typography.Text>
        <div style={{ width: '100%' }}>
          <Typography.Text strong>流程定义</Typography.Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            placeholder="选择流程定义"
            value={definitionId}
            filter
            optionList={definitions.map((d) => ({ label: d.name, value: d.id }))}
            onChange={(v) => void onPickDefinition(Number(v))}
          />
        </div>
        <div style={{ width: '100%' }}>
          <Typography.Text strong>卡死节点</Typography.Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            placeholder={definitionId ? '选择卡死节点' : '请先选择流程'}
            value={nodeKey}
            filter
            disabled={!definitionId}
            optionList={nodeOptions}
            onChange={(v) => setNodeKey(String(v))}
          />
        </div>
        <div style={{ width: '100%' }}>
          <Typography.Text strong>卡死时长下限（分钟，可选）</Typography.Text>
          <InputNumber
            style={{ width: '100%', marginTop: 4 }}
            min={0}
            placeholder="仅推进卡死超过该时长的实例；留空则不限"
            value={olderThanMinutes}
            onChange={(v) => setOlderThanMinutes(typeof v === 'number' ? v : undefined)}
          />
        </div>
        <div style={{ width: '100%' }}>
          <Typography.Text strong>原因（可选）</Typography.Text>
          <Input
            style={{ marginTop: 4 }}
            value={reason}
            onChange={setReason}
            maxLength={256}
            showClear
            placeholder="记录到审计与任务备注"
          />
        </div>
      </Space>
    </AppModal>
  );
}
