import { useRef } from 'react';
import { Button, Table, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Upload } from 'lucide-react';
import { formatBytes } from '@zenith/shared/core';
import { DRIVE_SIMPLE_UPLOAD_MAX_BYTES, type DriveFileVersion, type DriveNode } from '@zenith/shared/drive';
import { useDeleteDriveNodeVersion, useDriveNodeVersions, useRestoreDriveNodeVersion, useUploadDriveNodeVersion } from '@/hooks/queries/drive';
import { usePermission } from '@/hooks/usePermission';
import { createOperationColumn, type ResponsiveTableAction } from '@/components/ResponsiveTableActions';
import { confirmDanger, confirmDelete } from '@/utils/confirm';
import { formatDateTime } from '@/utils/date';
import { fetchProtectedFile } from '@/utils/file-utils';
import { downloadBlob } from '@/utils/download';
import { roleAtLeast } from '../drive-utils';

interface DriveVersionsPanelProps {
  readonly node: DriveNode;
}

export function DriveVersionsPanel({ node }: DriveVersionsPanelProps) {
  const { hasPermission } = usePermission();
  const query = useDriveNodeVersions(node.id);
  const upload = useUploadDriveNodeVersion();
  const restore = useRestoreDriveNodeVersion();
  const remove = useDeleteDriveNodeVersion();
  const inputRef = useRef<HTMLInputElement>(null);
  const canEdit = hasPermission('drive:node:upload') && roleAtLeast(node.myRole, 'editor');
  const canDownload = hasPermission('drive:node:download') && roleAtLeast(node.myRole, 'downloader');
  const canDeleteVersion = hasPermission('drive:node:delete') && roleAtLeast(node.myRole, 'manager');

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > DRIVE_SIMPLE_UPLOAD_MAX_BYTES) {
      Toast.warning('新版本单请求上限 5MB，更大的文件请在目录中上传同名文件并选择「覆盖为新版本」');
      return;
    }
    await upload.mutateAsync({ id: node.id, file });
    Toast.success('已上传新版本');
  };

  const download = async (v: DriveFileVersion) => {
    const blob = await fetchProtectedFile(v.url);
    downloadBlob(blob, `v${v.version}-${node.name}`);
  };

  const columns: ColumnProps<DriveFileVersion>[] = [
    {
      title: '版本', dataIndex: 'version', minWidth: 120,
      render: (v: number, r: DriveFileVersion) => (
        <div>
          <span>v{v} {r.isCurrent && <Tag color="green" size="small">当前</Tag>}</span>
          {r.comment && <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ display: 'block' }}>{r.comment}</Typography.Text>}
        </div>
      ),
    },
    { title: '大小', dataIndex: 'size', width: 90, render: (v: number) => formatBytes(v) },
    { title: '上传人', dataIndex: 'authorName', width: 90, render: (v: string | null) => v ?? '—' },
    { title: '时间', dataIndex: 'createdAt', width: 150, render: (v: string) => formatDateTime(v) },
    createOperationColumn<DriveFileVersion>({
      width: 140,
      desktopInlineKeys: ['download', 'restore'],
      actions: (r): ResponsiveTableAction[] => [
        { key: 'download', label: '下载', hidden: !canDownload, onClick: () => download(r) },
        {
          key: 'restore', label: '回滚', hidden: !canEdit || r.isCurrent,
          onClick: () => {
            confirmDanger({
              title: `回滚到版本 v${r.version}？`,
              content: '将以该版本内容生成一个新版本，当前版本保留在历史中。',
              onOk: () => restore.mutateAsync({ params: { id: node.id, version: r.version } }).then(() => Toast.success('已回滚')),
            });
          },
        },
        {
          key: 'delete', label: '删除', danger: true, hidden: !canDeleteVersion || r.isCurrent,
          onClick: () => {
            confirmDelete({
              title: `删除历史版本 v${r.version}？`,
              content: '删除后该版本内容不可恢复，并释放对应容量。',
              onOk: () => remove.mutateAsync({ node, version: r.version }).then(() => Toast.success('已删除')),
            });
          },
        },
      ],
    }),
  ];

  return (
    <div className="drive-panel">
      <div className="drive-panel__section-head">
        <Typography.Text type="tertiary" size="small">共 {query.data?.length ?? 0} 个版本；覆盖上传同名文件或此处上传都会生成新版本。</Typography.Text>
        {canEdit && (
          <>
            <input ref={inputRef} type="file" hidden onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ''; }} />
            <Button size="small" icon={<Upload size={14} />} loading={upload.isPending} onClick={() => inputRef.current?.click()}>上传新版本</Button>
          </>
        )}
      </div>
      <Table<DriveFileVersion> size="small" columns={columns} dataSource={query.data ?? []} loading={query.isFetching} pagination={false} rowKey="id" empty="暂无版本" />
    </div>
  );
}
