/**
 * 日志文件 DTO（运维日志文件浏览）
 */
import { z } from '@hono/zod-openapi';

export const LogFileDTO = z
  .object({
    name: z.string(),
    size: z.number(),
    modifiedAt: z.string(),
    isGzip: z.boolean(),
  })
  .openapi('LogFile');

export const LogFileContentDTO = z
  .object({
    lines: z.array(z.string()),
  })
  .openapi('LogFileContent');
