import { useCallback, useState } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import type { ChatMessage } from '@zenith/shared/chat';
import { canPreviewFile, fetchManagedFileBlob, isSpreadsheetFile, resolveFileMimeType } from '@/utils/file-utils';

export interface FilePreviewTarget {
  fileId?: string;
  url: string;
  name: string;
  mimeType: string;
}

/**
 * 文件消息预览：可预览类型打开 FilePreviewModal；xlsx 历史消息无 fileId 时退化为下载避免报错。
 * 消息气泡与媒体库面板共用同一入口（原 ChatPage 中两段相同逻辑合一）。
 */
export function useFilePreview() {
  const [filePreview, setFilePreview] = useState<FilePreviewTarget | null>(null);

  const openFilePreview = useCallback((msg: ChatMessage) => {
    const asset = msg.extra?.asset;
    if (!asset || !canPreviewFile(asset.mimeType, asset.name)) return;
    // xlsx 历史消息无 fileId，退化为下载避免报错
    if (isSpreadsheetFile(resolveFileMimeType(asset.mimeType, asset.name)) && !asset.fileId) {
      void fetchManagedFileBlob(msg.content).then((blob) => {
        const objectUrl = globalThis.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = asset.name ?? '文件.xlsx';
        link.click();
        globalThis.setTimeout(() => globalThis.URL.revokeObjectURL(objectUrl), 60_000);
      }).catch(() => Toast.error('文件下载失败'));
      return;
    }
    setFilePreview({
      url: msg.content,
      name: asset.name ?? '文件',
      mimeType: asset.mimeType ?? 'application/octet-stream',
      fileId: asset.fileId ?? undefined,
    });
  }, []);

  const closeFilePreview = useCallback(() => setFilePreview(null), []);

  return { filePreview, openFilePreview, closeFilePreview };
}
