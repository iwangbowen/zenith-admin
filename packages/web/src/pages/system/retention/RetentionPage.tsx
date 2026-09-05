import { useMemo, useState } from 'react';
import {
  Button,
  Form,
  InputNumber,
  Switch,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import { Archive, RotateCcw } from 'lucide-react';
import type { RetentionPolicy } from '@zenith/shared/ops';
import { usePermission } from '@/hooks/usePermission';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { confirmDanger } from '@/utils/confirm';
import {
  useRetentionPolicies,
  useRetentionPreview,
  useRunRetentionPolicy,
  useUpdateRetentionPolicy,
} from '@/hooks/queries/retention';
import { EMPTY_PLACEHOLDER, dateTimeColumn } from '@/utils/table-columns';

const { Title, Text } = Typography;

interface EditForm {
  enabled: boolean;
  retentionDays: number;
  batchSize: number;
}

export default function RetentionPage() {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('system:retention:edit');
  const canRun = hasPermission('system:retention:run');

  const { data: policies = [], isLoading, isFetching, refetch } = useRetentionPolicies();
  const updateMutation = useUpdateRetentionPolicy();
  const previewMutation = useRetentionPreview();
  const runMutation = useRunRetentionPolicy();

  const [editing, setEditing] = useState<RetentionPolicy | null>(null);
  const [form, setForm] = useState<EditForm>({ enabled: true, retentionDays: 180, batchSize: 5000 });

  const disabledCount = useMemo(
    () => policies.filter((item) => !item.enabled || item.retentionDays === 0).length,
    [policies],
  );

  const openEdit = (policy: RetentionPolicy) => {
    setEditing(policy);
    setForm({
      enabled: policy.enabled,
      retentionDays: policy.retentionDays,
      batchSize: policy.batchSize,
    });
  };

  const handleSave = async () => {
    if (!editing) return;
    await updateMutation.mutateAsync({ params: { key: editing.key }, body: form });
    Toast.success('保留策略已更新');
    setEditing(null);
  };

  /**
   * 清理是不可逆的批量删除，先试算再确认：
   * 待清理量是随时间变化的瞬时值，只在这一刻有意义，因此不入表格列。
   */
  const handleRun = async (policy: RetentionPolicy) => {
    const preview = await previewMutation.mutateAsync(policy.key);
    if (preview.pending === 0) {
      Toast.info(`「${policy.title}」当前没有超期数据`);
      return;
    }
    confirmDanger({
      title: `清理「${policy.title}」`,
      content: `将删除 ${preview.pending} 行早于 ${preview.cutoff} 的数据（保留 ${policy.retentionDays} 天），此操作不可恢复。`,
      okText: '确认清理',
      cancelText: '取消',
      onOk: async () => {
        const result = await runMutation.mutateAsync({ params: { key: policy.key } });
        Toast.success(`「${policy.title}」已清理 ${result.deleted} 行`);
      },
    });
  };

  return (
    <div className="page-container">
      <div>
        <Title heading={5} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Archive size={18} />
          数据保留策略
        </Title>
        <Text type="tertiary" style={{ display: 'block', marginTop: 8 }}>
          全库日志与流水表的保留口径集中在此配置，由「系统调度」中的
          <Text strong> 数据保留清理（data-retention）</Text> 任务每天 03:00 统一执行。
          保留天数设为 0 表示永久保留，该策略会被跳过。
          共 {policies.length} 条策略，其中 {disabledCount} 条不参与清理。
        </Text>
      </div>

      <ConfigurableTable<RetentionPolicy & { _rowId: string }>
        rowKey="key"
        loading={isLoading}
        onRefresh={() => void refetch()}
        refreshLoading={isFetching}
        dataSource={policies.map((item) => ({ ...item, _rowId: item.key }))}
        pagination={false}
        columns={[
          { key: 'module', title: '模块', dataIndex: 'module', width: 110 },
          {
            key: 'title',
            title: '名称',
            dataIndex: 'title',
            width: 150,
          },
          {
            key: 'tableName',
            title: '数据表',
            dataIndex: 'tableName',
            width: 240,
            render: (tableName: string) => (
              <Text type="tertiary" size="small" code ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{tableName}</Text>
            ),
          },
          {
            key: 'retentionDays',
            title: '保留天数',
            align: 'right',
            dataIndex: 'retentionDays',
            width: 100,
            render: (days: number) => (days > 0
              ? <Tag color="blue">{days} 天</Tag>
              : <Tag color="grey">永久保留</Tag>),
          },
          {
            key: 'enabled',
            title: '状态',
            dataIndex: 'enabled',
            width: 100,
            render: (enabled: boolean) => (enabled
              ? <Tag color="green">启用</Tag>
              : <Tag color="grey">停用</Tag>),
          },
          {
            key: 'scope',
            title: '清理方式',
            width: 150,
            render: (_: unknown, row: RetentionPolicy) => (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {row.perTenant && <Tag size="small" color="violet">按租户</Tag>}
                {row.mode === 'ageAndCap' && (
                  <Tag size="small" color="orange">另限 {row.capLimit} 条/组</Tag>
                )}
                {row.mode === 'expiresAt' && (
                  <Tag size="small" color="cyan">按到期时间</Tag>
                )}
                {row.mode === 'custom' && (
                  <Tag size="small" color="indigo">域内清理</Tag>
                )}
                {row.mode === 'age' && !row.perTenant && (
                  <Tag size="small" color="white">按时间</Tag>
                )}
              </div>
            ),
          },
          dateTimeColumn<RetentionPolicy & { _rowId: string }>('上次执行', 'lastRunAt', {
            key: 'lastRunAt',
            empty: '从未执行',
          }),
          {
            key: 'lastDeleted',
            title: '上次清理',
            dataIndex: 'lastDeleted',
            width: 100,
            render: (deleted: number | null, row: RetentionPolicy) => (row.lastRunAt
              ? `${deleted ?? 0} 行`
              : <Text type="tertiary">{EMPTY_PLACEHOLDER}</Text>),
          },
          {
            key: 'description',
            title: '说明',
            dataIndex: 'description',
            ellipsis: true,
          },
          createOperationColumn<RetentionPolicy & { _rowId: string }>({
            width: 150,
            desktopInlineKeys: ['edit'],
            actions: (row) => [
              { key: 'edit', label: '编辑策略', hidden: !canEdit, onClick: () => openEdit(row) },
              {
                key: 'run',
                label: '立即清理',
                danger: true,
                loading: previewMutation.isPending || runMutation.isPending,
                hidden: !canRun || row.retentionDays === 0,
                onClick: () => void handleRun(row),
              },
            ],
          }),
        ]}
      />

      <AppModal
        visible={editing !== null}
        title={editing ? `编辑「${editing.title}」保留策略` : ''}
        okText="保存"
        cancelText="取消"
        confirmLoading={updateMutation.isPending}
        onOk={handleSave}
        onCancel={() => setEditing(null)}
        width={480}
      >
        {editing && (
          <Form labelPosition="left" labelWidth={110}>
            <Form.Slot label="启用">
              <Switch
                checked={form.enabled}
                onChange={(v) => setForm((prev) => ({ ...prev, enabled: v }))}
              />
            </Form.Slot>
            <Form.Slot label="保留天数">
              <InputNumber
                min={0}
                max={3650}
                value={form.retentionDays}
                onChange={(v) => setForm((prev) => ({ ...prev, retentionDays: Number(v) || 0 }))}
                style={{ width: '100%' }}
                suffix="天"
              />
              <Text type="tertiary" size="small">
                0 表示永久保留；默认 {editing.defaultRetentionDays} 天
              </Text>
            </Form.Slot>
            <Form.Slot label="单批行数">
              <InputNumber
                min={100}
                max={50_000}
                step={1000}
                value={form.batchSize}
                onChange={(v) => setForm((prev) => ({ ...prev, batchSize: Number(v) || 5000 }))}
                style={{ width: '100%' }}
              />
              <Text type="tertiary" size="small">分批删除的单批上限，避免长事务锁表</Text>
            </Form.Slot>
            <Form.Slot label="">
              <Button
                icon={<RotateCcw size={14} />}
                onClick={() => setForm((prev) => ({ ...prev, retentionDays: editing.defaultRetentionDays }))}
              >
                恢复默认天数
              </Button>
            </Form.Slot>
          </Form>
        )}
      </AppModal>
    </div>
  );
}
