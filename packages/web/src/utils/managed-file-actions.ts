import { Modal } from '@douyinfe/semi-ui';
import type { ManagedFile } from '@zenith/shared';
import type { ResponsiveTableAction } from '@/components/ResponsiveTableActions';
import type { FilePreviewController } from '@/hooks/useFilePreview';
import { canPreviewFile } from '@/utils/file-utils';

interface ManagedFileActionsOptions {
  preview: FilePreviewController;
  onDetail: (record: ManagedFile) => void;
  onCopyUrl: (record: ManagedFile) => void;
  onDelete: (record: ManagedFile) => void | Promise<unknown>;
  canDelete: boolean;
}

/** 文件表格操作列公共动作：预览 / 下载 / 详情 / 复制链接 / 删除 */
export function buildManagedFileActions(
  record: ManagedFile,
  { preview, onDetail, onCopyUrl, onDelete, canDelete }: ManagedFileActionsOptions,
): ResponsiveTableAction[] {
  const isPreviewable = canPreviewFile(record.mimeType);
  return [
    {
      key: 'preview',
      label: '预览',
      disabled: !isPreviewable,
      loading: preview.previewLoadingId === record.id,
      onClick: () => preview.handlePreview(record),
    },
    {
      key: 'download',
      label: '下载',
      loading: preview.downloadLoadingId === record.id,
      onClick: () => preview.handleDownload(record),
    },
    {
      key: 'detail',
      label: '详情',
      onClick: () => onDetail(record),
    },
    {
      key: 'copy-url',
      label: '复制链接',
      onClick: () => onCopyUrl(record),
    },
    {
      key: 'delete',
      label: '删除',
      danger: true,
      dividerBefore: true,
      hidden: !canDelete,
      onClick: () => {
        Modal.confirm({
          title: '确认删除此文件？',
          content: '删除文件记录后，将同步尝试删除实际存储对象。',
          okButtonProps: { type: 'danger', theme: 'solid' },
          onOk: () => onDelete(record),
        });
      },
    },
  ];
}
