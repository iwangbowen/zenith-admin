/**
 * SSH 远程文件（SFTP）DTO
 */
import { z } from '@hono/zod-openapi';

/** SFTP：单个目录项 */
export const SftpFileEntryDTO = z
  .object({
    name: z.string(),
    path: z.string(),
    type: z.enum(['dir', 'file']),
    size: z.number(),
    mtime: z.string(),
    /** Unix 权限字符串，如 rwxr-xr-x */
    permissions: z.string().optional(),
  })
  .openapi('SftpFileEntry');

/** SFTP：目录列表结果 */
export const SftpDirListingDTO = z
  .object({
    path: z.string(),
    parent: z.string().nullable(),
    entries: z.array(SftpFileEntryDTO),
  })
  .openapi('SftpDirListing');

/** SFTP：文本文件内容 */
export const SftpFileContentDTO = z
  .object({
    path: z.string(),
    content: z.string(),
    size: z.number(),
  })
  .openapi('SftpFileContent');

/** SFTP：远程 home 目录信息 */
export const SftpHomeDTO = z
  .object({
    home: z.string().describe('远程用户主目录'),
  })
  .openapi('SftpHome');
