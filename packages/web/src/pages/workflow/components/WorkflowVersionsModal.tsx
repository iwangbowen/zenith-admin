import { useEffect, useState } from 'react';
import { Button, Modal, Table, Tag, Toast } from '@douyinfe/semi-ui';
import AppModal from '@/components/AppModal';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { WorkflowDefinition, WorkflowDefinitionVersion } from '@zenith/shared';
import { request } from '@/utils/request';

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
  const [versions, setVersions] = useState<WorkflowDefinitionVersion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    request
      .get<WorkflowDefinitionVersion[]>(`/api/workflows/definitions/${definitionId}/versions`)
      .then(res => {
        if (res.code === 0) setVersions(res.data ?? []);
      })
      .finally(() => setLoading(false));
  }, [visible, definitionId]);

  const handleRestore = (ver: WorkflowDefinitionVersion) => {
    Modal.confirm({
      title: `确认恢复到 v${ver.version}？`,
      content: '当前未保存的修改将被覆盖，流程将转为草稿状态，需要重新发布。',
      onOk: async () => {
        const res = await request.post<WorkflowDefinition>(
          `/api/workflows/definitions/${definitionId}/versions/${ver.id}/restore`,
          {},
        );
        if (res.code === 0) {
          Toast.success('已恢复为草稿');
          onCancel();
          onRestored?.(res.data);
        }
      },
    });
  };

  const columns: ColumnProps<WorkflowDefinitionVersion>[] = [
    { title: '版本号', dataIndex: 'version', width: 90, render: (v: number) => <Tag color="blue">v{v}</Tag> },
    { title: '名称', dataIndex: 'name' },
    { title: '发布人', dataIndex: 'publishedByName', width: 120, render: (v?: string) => v ?? '-' },
    { title: '发布时间', dataIndex: 'publishedAt', width: 170 },
    {
      title: '操作',
      width: 100,
      fixed: 'right',
      render: (_: unknown, record: WorkflowDefinitionVersion) => (
        <Button
          theme="borderless"
          size="small"
          onClick={() => handleRestore(record)}
          disabled={record.version === currentVersion && currentStatus === 'published'}
        >
          恢复
        </Button>
      ),
    },
  ];

  return (
    <AppModal title="历史版本" visible={visible} onCancel={onCancel} footer={null} width={720}>
      <Table
        dataSource={versions}
        loading={loading}
        rowKey="id"
        pagination={false}
        columns={columns}
      />
    </AppModal>
  );
}
