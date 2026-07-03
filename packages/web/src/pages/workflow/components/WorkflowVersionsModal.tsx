import { useEffect, useState } from 'react';
import { Modal, Table, Tag, Toast, Button, Spin } from '@douyinfe/semi-ui';
import { GitCompare, ArrowLeft } from 'lucide-react';
import AppModal from '@/components/AppModal';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { WorkflowDefinition, WorkflowDefinitionVersion, WorkflowVersionDiff } from '@zenith/shared';
import WorkflowVersionDiffView from './WorkflowVersionDiffView';
import { useRestoreWorkflowDefinitionVersion, useWorkflowDefinitionDiff, useWorkflowDefinitionVersions } from '@/hooks/queries/workflow-definitions';

interface Props {
  visible: boolean;
  definitionId: number;
  currentVersion?: number;
  currentStatus?: string;
  onCancel: () => void;
  onRestored?: (def: WorkflowDefinition) => void;
}

export default function WorkflowVersionsModal({
  visible,
  definitionId,
  currentVersion,
  currentStatus,
  onCancel,
  onRestored,
}: Readonly<Props>) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [diff, setDiff] = useState<WorkflowVersionDiff | null>(null);
  const [diffParams, setDiffParams] = useState<{ left: number; right: number } | null>(null);
  const versionsQuery = useWorkflowDefinitionVersions(definitionId, visible);
  const versions = versionsQuery.data ?? [];
  const diffQuery = useWorkflowDefinitionDiff(
    { definitionId, left: diffParams?.left ?? 0, right: diffParams?.right ?? 0 },
    visible && !!diffParams,
  );
  const restoreMutation = useRestoreWorkflowDefinitionVersion();
  const diffLoading = diffQuery.isFetching;

  useEffect(() => {
    if (!visible) return;
    setDiff(null);
    setDiffParams(null);
    setSelectedIds([]);
  }, [visible, definitionId]);

  useEffect(() => {
    if (diffQuery.data) setDiff(diffQuery.data);
  }, [diffQuery.data]);

  const loadDiff = (left: number, right: number) => setDiffParams({ left, right });

  const handleRestore = (ver: WorkflowDefinitionVersion) => {
    Modal.confirm({
      title: `确认恢复到 v${ver.version}？`,
      content: '当前未保存的修改将被覆盖，流程将转为草稿状态，需要重新发布。',
      onOk: async () => {
        const res = await restoreMutation.mutateAsync({ definitionId, versionId: ver.id });
        Toast.success('已恢复为草稿');
        onCancel();
        onRestored?.(res);
      },
    });
  };

  const compareSelected = () => {
    if (selectedIds.length !== 2) {
      Toast.warning('请选择两个版本进行对比');
      return;
    }
    // 旧版本在左、新版本在右（版本行 id 越大越新）
    const [a, b] = selectedIds;
    void loadDiff(Math.min(a, b), Math.max(a, b));
  };

  const columns: ColumnProps<WorkflowDefinitionVersion>[] = [
    { title: '版本号', dataIndex: 'version', width: 90, render: (v: number) => <Tag color="blue">v{v}</Tag> },
    { title: '名称', dataIndex: 'name' },
    { title: '发布人', dataIndex: 'publishedByName', width: 120, render: (v?: string) => v ?? '-' },
    { title: '发布时间', dataIndex: 'publishedAt', width: 170 },
    createOperationColumn<WorkflowDefinitionVersion>({
      width: 140,
      desktopInlineKeys: ['diff', 'restore'],
      actions: (record) => [
        {
          key: 'diff',
          label: '对比草稿',
          onClick: () => void loadDiff(record.id, 0),
        },
        {
          key: 'restore',
          label: '恢复',
          disabled: record.version === currentVersion && currentStatus === 'published',
          disabledReason: '当前已发布版本无需恢复',
          onClick: () => handleRestore(record),
        },
      ],
    }),
  ];

  return (
    <AppModal title="历史版本" visible={visible} onCancel={onCancel} footer={null} width={diff ? 860 : 760}>
      {diff ? (
        <div>
          <Button size="small" theme="borderless" icon={<ArrowLeft size={14} />} onClick={() => setDiff(null)} style={{ marginBottom: 8 }}>返回版本列表</Button>
          <WorkflowVersionDiffView diff={diff} />
        </div>
      ) : (
        <Spin spinning={diffLoading}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <Button
              size="small"
              icon={<GitCompare size={14} />}
              disabled={selectedIds.length !== 2}
              onClick={compareSelected}
            >对比所选两个版本</Button>
          </div>
          <Table
            dataSource={versions}
            loading={versionsQuery.isFetching}
            rowKey="id"
            pagination={false}
            columns={columns}
            rowSelection={{
              selectedRowKeys: selectedIds,
              onChange: (keys) => {
                const ids = (keys ?? []).map(Number);
                if (ids.length > 2) {
                  Toast.warning('最多选择两个版本对比');
                  setSelectedIds(ids.slice(-2));
                } else {
                  setSelectedIds(ids);
                }
              },
            }}
          />
        </Spin>
      )}
    </AppModal>
  );
}
