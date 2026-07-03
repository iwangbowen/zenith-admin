import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select, Input, InputNumber, Toast, Typography, Space } from '@douyinfe/semi-ui';
import type { WorkflowDefinition, WorkflowFlowData } from '@zenith/shared';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';
import AppModal from '@/components/AppModal';
import { useWorkflowBatchRecovery, useWorkflowDefinitionDetail } from '@/hooks/queries/workflow-monitor';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * 批量推进卡死实例：选流程定义 + 卡死节点（+ 卡死时长下限），逐个跳过该节点的活动 Token 并推进。
 * 自包含：自行加载已发布流程与所选流程的节点列表，无需父组件透传。
 */
export default function WorkflowBatchRecoveryModal({ visible, onClose }: Readonly<Props>) {
  const [definitionId, setDefinitionId] = useState<number | undefined>();
  const [nodeKey, setNodeKey] = useState<string | undefined>();
  const [olderThanMinutes, setOlderThanMinutes] = useState<number | undefined>();
  const [reason, setReason] = useState('');
  const recoveryMutation = useWorkflowBatchRecovery();
  const definitionsQuery = useQuery({
    queryKey: ['workflow', 'definitions', 'options'] as const,
    queryFn: () => request.get<WorkflowDefinition[]>('/api/workflows/definitions/published').then(unwrap),
    enabled: visible,
  });
  const definitionQuery = useWorkflowDefinitionDetail(definitionId, visible && definitionId !== undefined);
  const definitions = definitionsQuery.data ?? [];
  const flow = (definitionQuery.data?.flowData ?? null) as WorkflowFlowData | null;
  const nodeOptions = (flow?.nodes ?? [])
    .filter((n) => n.data.type !== 'start' && n.data.type !== 'end')
    .map((n) => ({ label: `${n.data.label || n.data.key}（${n.data.key}）`, value: n.data.key }));

  useEffect(() => {
    if (!visible) return;
    setDefinitionId(undefined);
    setNodeKey(undefined);
    setOlderThanMinutes(undefined);
    setReason('');
  }, [visible]);

  const onPickDefinition = (id: number) => {
    setDefinitionId(id);
    setNodeKey(undefined);
  };

  const submit = async () => {
    if (!definitionId || !nodeKey) {
      Toast.warning('请选择流程定义与卡死节点');
      return;
    }
    const result = await recoveryMutation.mutateAsync({
      definitionId,
      nodeKey,
      ...(olderThanMinutes ? { olderThanMinutes } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
    Toast.success(`已推进 ${result.success}/${result.total} 个实例`);
    onClose();
  };

  return (
    <AppModal
      title="批量推进卡死实例"
      visible={visible}
      onCancel={onClose}
      onOk={() => void submit()}
      okText="确认推进"
      okButtonProps={{ loading: recoveryMutation.isPending }}
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
            onChange={(v) => onPickDefinition(Number(v))}
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
