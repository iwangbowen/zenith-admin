import { z } from '@hono/zod-openapi';

/** 终端文件浏览器：单个目录项 */
export const TerminalFileEntryDTO = z
  .object({
    name: z.string(),
    path: z.string(),
    type: z.enum(['dir', 'file']),
    size: z.number(),
    mtime: z.string(),
    /** Unix 权限字符串，如 rwxr-xr-x（Windows 下为空字符串） */
    permissions: z.string().optional(),
    /** 文件所属用户 ID（Windows 下为 0） */
    uid: z.number().optional(),
    /** 文件所属用户组 ID（Windows 下为 0） */
    gid: z.number().optional(),
  })
  .openapi('TerminalFileEntry');

/** 终端文件浏览器：目录列表结果 */
export const TerminalDirListingDTO = z
  .object({
    path: z.string(),
    parent: z.string().nullable(),
    entries: z.array(TerminalFileEntryDTO),
  })
  .openapi('TerminalDirListing');

/** 终端：单个可用 shell */
export const TerminalShellInfoDTO = z
  .object({
    id: z.string(),
    label: z.string(),
    path: z.string(),
  })
  .openapi('TerminalShellInfo');

/** 终端：当前平台可用 shell 列表 */
export const TerminalShellsDTO = z
  .object({
    platform: z.string(),
    shells: z.array(TerminalShellInfoDTO),
    defaultShell: z.string(),
  })
  .openapi('TerminalShells');

/** 终端：文件系统根信息（用于文件浏览器初始化） */
export const TerminalRootInfoDTO = z
  .object({
    home: z.string().describe('用户主目录'),
    isWindows: z.boolean().describe('是否 Windows 系统'),
    drives: z.array(z.string()).describe('Windows 盘符列表（Unix 下为空数组）'),
  })
  .openapi('TerminalRootInfo');

/** 终端：文本文件内容 */
export const TerminalFileContentDTO = z
  .object({
    path: z.string(),
    content: z.string(),
    size: z.number(),
  })
  .openapi('TerminalFileContent');
