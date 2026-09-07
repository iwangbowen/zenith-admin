import { HTTPException } from 'hono/http-exception';
import { extensionOf } from './drive-common';
import { blockedExtensionSet, getDriveSettings } from './drive-settings.service';

/**
 * 网盘内容策略：扩展名黑名单 + 魔数识别的可执行文件拦截。
 * 取代通用 `file_upload_allowed_types` 白名单（企业网盘需要承载任意办公 / 设计 / 归档格式）。
 * 上传、上传新版本、重命名（改后缀绕过）共用。
 */

/** 伪装扩展名也拦得住：按魔数识别出的可执行 / 动态库类型 */
const EXECUTABLE_MIME_TYPES = new Set([
  'application/x-msdownload', 'application/x-dosexec', 'application/vnd.microsoft.portable-executable',
  'application/x-executable', 'application/x-elf', 'application/x-sharedlib', 'application/x-mach-binary',
  'application/x-ms-shortcut', 'application/x-msi',
]);

export async function assertDriveFileAllowed(fileName: string, head?: Buffer) {
  const settings = await getDriveSettings();
  const ext = extensionOf(fileName);
  if (ext && blockedExtensionSet(settings).has(ext)) {
    throw new HTTPException(400, { message: `不允许上传 .${ext} 类型的文件` });
  }
  if (head && head.length > 0) {
    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(head.subarray(0, 4100));
    if (detected && EXECUTABLE_MIME_TYPES.has(detected.mime)) {
      throw new HTTPException(400, { message: `不允许上传可执行文件（检测到 ${detected.mime}）` });
    }
    if (detected?.ext && blockedExtensionSet(settings).has(detected.ext)) {
      throw new HTTPException(400, { message: `不允许上传 .${detected.ext} 类型的文件（按内容识别）` });
    }
  }
}

/** 重命名文件：新后缀不得落入黑名单（否则可先传 x.txt 再改名 x.exe） */
export async function assertRenameExtensionAllowed(newName: string) {
  const settings = await getDriveSettings();
  const ext = extensionOf(newName);
  if (ext && blockedExtensionSet(settings).has(ext)) {
    throw new HTTPException(400, { message: `不允许使用 .${ext} 作为文件后缀` });
  }
}
