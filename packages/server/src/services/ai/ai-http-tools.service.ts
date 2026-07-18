import { eq, desc } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { aiHttpTools } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import type { AiHttpToolRow } from '../../db/schema';
import type { CreateAiHttpToolInput, UpdateAiHttpToolInput } from '@zenith/shared';

/** 与内置工具冲突的保留名 */
const RESERVED_TOOL_NAMES = new Set(['get_current_time', 'get_my_ai_usage', 'get_system_overview', 'generate_image']);

function mapTool(row: AiHttpToolRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    method: row.method,
    urlTemplate: row.urlTemplate,
    headers: row.headers,
    params: row.params ?? [],
    isEnabled: row.isEnabled,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function ensureNameAllowed(name: string) {
  if (RESERVED_TOOL_NAMES.has(name)) {
    throw new HTTPException(400, { message: `工具名 ${name} 与内置工具冲突` });
  }
}

export async function listHttpTools() {
  const rows = await db.select().from(aiHttpTools).orderBy(desc(aiHttpTools.updatedAt));
  return rows.map(mapTool);
}

export async function createHttpTool(input: CreateAiHttpToolInput) {
  const user = currentUser();
  ensureNameAllowed(input.name);
  try {
    const [row] = await db
      .insert(aiHttpTools)
      .values({
        name: input.name,
        description: input.description,
        method: input.method,
        urlTemplate: input.urlTemplate,
        headers: input.headers ?? null,
        params: input.params ?? [],
        isEnabled: input.isEnabled ?? true,
        createdBy: user.userId,
        updatedBy: user.userId,
      })
      .returning();
    return mapTool(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '工具名已存在');
    throw err;
  }
}

export async function updateHttpTool(id: number, input: UpdateAiHttpToolInput) {
  const user = currentUser();
  const [existing] = await db.select().from(aiHttpTools).where(eq(aiHttpTools.id, id));
  if (!existing) throw new HTTPException(404, { message: '工具不存在' });
  if (input.name !== undefined) ensureNameAllowed(input.name);
  try {
    const [row] = await db
      .update(aiHttpTools)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.method !== undefined && { method: input.method }),
        ...(input.urlTemplate !== undefined && { urlTemplate: input.urlTemplate }),
        ...(input.headers !== undefined && { headers: input.headers }),
        ...(input.params !== undefined && { params: input.params }),
        ...(input.isEnabled !== undefined && { isEnabled: input.isEnabled }),
        updatedBy: user.userId,
      })
      .where(eq(aiHttpTools.id, id))
      .returning();
    return mapTool(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '工具名已存在');
    throw err;
  }
}

export async function deleteHttpTool(id: number) {
  const result = await db.delete(aiHttpTools).where(eq(aiHttpTools.id, id)).returning();
  if (result.length === 0) throw new HTTPException(404, { message: '工具不存在' });
}
