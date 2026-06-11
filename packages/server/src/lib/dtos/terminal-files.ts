import { z } from '@hono/zod-openapi';

/** 终端文件浏览器：单个目录项 */
export const TerminalFileEntryDTO = z
  .object({
    name: z.string(),
    path: z.string(),
    type: z.enum(['dir', 'file']),
    size: z.number(),
    mtime: z.string(),
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
