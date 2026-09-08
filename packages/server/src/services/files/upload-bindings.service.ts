/**
 * 分片上传会话的通用归属绑定：归属模块在 init 时记录业务上下文，complete 时取回落地。
 * 绑定跟随 upload_sessions 级联删除；网盘因需级联到空间 / 节点仍用自己的 drive_upload_bindings。
 */
import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { ZodType } from 'zod';
import { db } from '../../db';
import { uploadSessionBindings } from '../../db/schema';
import { currentUser, currentUserId } from '../../lib/context';
import { requireRow } from '../../lib/db-assert';
import { getCreateTenantId } from '../../lib/tenant';

export async function bindUploadSession(uploadId: string, module: string, payload: Record<string, unknown>) {
  await db.insert(uploadSessionBindings).values({ uploadId, module, payload, tenantId: getCreateTenantId(currentUser()) });
}

/**
 * 读取并校验绑定：必须是当前用户在同一模块下发起的会话；payload 按模块 schema 解析，
 * schema 演进后旧会话解析失败视为上下文失效，让客户端重新上传而不是带着旧上下文落地。
 */
export async function requireUploadBinding<T>(uploadId: string, module: string, schema: ZodType<T>): Promise<T> {
  const [row] = await db
    .select({ payload: uploadSessionBindings.payload })
    .from(uploadSessionBindings)
    .where(and(
      eq(uploadSessionBindings.uploadId, uploadId),
      eq(uploadSessionBindings.module, module),
      eq(uploadSessionBindings.createdBy, currentUserId()),
    ))
    .limit(1);
  const binding = requireRow(row, '上传会话不存在');
  const parsed = schema.safeParse(binding.payload);
  if (!parsed.success) throw new HTTPException(400, { message: '上传会话上下文已失效，请重新上传' });
  return parsed.data;
}
