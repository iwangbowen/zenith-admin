import type { AttachmentItem } from './index';
import { extractManagedFileId, guessMimeTypeFromName } from '@/utils/file-utils';

/**
 * 将 {name,url,size} 形式的已上传文件转为 AttachmentItem，
 * 便于用 FileAttachment 以 view/edit 模式展示（带 MIME 猜测以支持预览）。
 *
 * 托管文件内容地址中的 ID 仍需提取为纯文件 ID，供附件删除、排序等操作使用；非托管地址则原样作为 ID。
 */
export function uploadedFileToAttachment(f: { name: string; url: string; size?: number }, i = 0): AttachmentItem {
  const dot = f.name?.lastIndexOf('.') ?? -1;
  const fileId = extractManagedFileId(f.url) ?? f.url;
  return {
    id: i + 1,
    fileId,
    file: {
      id: fileId,
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

/** Workflow identities are explicit; never infer a trusted file identity from a URL. */
export interface WorkflowUploadedFile { fileId: string; name: string; url: string; size?: number; mimeType?: string | null }
export function workflowFileToAttachment(file: WorkflowUploadedFile, index = 0): AttachmentItem {
  const dot = file.name.lastIndexOf('.');
  return { id: index + 1, fileId: file.fileId, sortOrder: index, createdAt: '',
    file: { id: file.fileId, originalName: file.name, size: file.size ?? 0,
      mimeType: file.mimeType ?? guessMimeTypeFromName(file.name), extension: dot >= 0 ? file.name.slice(dot + 1) : null, url: file.url } };
}
