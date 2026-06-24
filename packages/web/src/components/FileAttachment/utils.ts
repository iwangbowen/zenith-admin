import type { AttachmentItem } from './index';
import { guessMimeTypeFromName } from '@/utils/file-utils';

/**
 * 将 {name,url,size} 形式的已上传文件转为 AttachmentItem，
 * 便于用 FileAttachment 以 view/edit 模式展示（带 MIME 猜测以支持预览）。
 */
export function uploadedFileToAttachment(f: { name: string; url: string; size?: number }, i = 0): AttachmentItem {
  const dot = f.name?.lastIndexOf('.') ?? -1;
  return {
    id: i + 1,
    fileId: f.url,
    file: {
      id: f.url,
      originalName: f.name,
      size: Number(f.size ?? 0),
      mimeType: guessMimeTypeFromName(f.name),
      extension: dot >= 0 ? f.name.slice(dot + 1) : null,
      url: f.url,
    },
    sortOrder: i,
    createdAt: '',
  };
}
