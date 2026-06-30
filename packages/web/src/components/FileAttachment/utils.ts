import type { AttachmentItem } from './index';
import { guessMimeTypeFromName } from '@/utils/file-utils';

/** 从受保护文件下载地址 `/api/files/{id}/content` 中解析出文件 ID；非该形态则原样返回。 */
function extractFileId(url: string): string {
  const matched = /\/api\/files\/([^/]+)\/content/.exec(url);
  return matched?.[1] ?? url;
}

/**
 * 将 {name,url,size} 形式的已上传文件转为 AttachmentItem，
 * 便于用 FileAttachment 以 view/edit 模式展示（带 MIME 猜测以支持预览）。
 *
 * 注意：表格预览走 `/api/files/{id}/sheet-preview`，因此 file.id 必须是**纯文件 ID**，
 * 不能用整段下载 URL，否则会拼出 `/api/files//api/files/{id}/content/sheet-preview` 的重复路径。
 */
export function uploadedFileToAttachment(f: { name: string; url: string; size?: number }, i = 0): AttachmentItem {
  const dot = f.name?.lastIndexOf('.') ?? -1;
  const fileId = extractFileId(f.url);
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
