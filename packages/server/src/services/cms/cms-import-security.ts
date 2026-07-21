import { createCmsSiteSchema } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';

export function parseCmsImportSiteCode(value: unknown): string {
  const parsed = createCmsSiteSchema.shape.code.safeParse(value);
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: parsed.error.issues[0]?.message ?? '导入站点 code 格式无效',
    });
  }
  return parsed.data;
}
