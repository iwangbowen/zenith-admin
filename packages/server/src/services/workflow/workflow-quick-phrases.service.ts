import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';
import { db } from '../../db';
import { workflowQuickPhrases } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { formatDateTime } from '../../lib/datetime';
import type { WorkflowQuickPhrase, CreateWorkflowQuickPhraseInput, UpdateWorkflowQuickPhraseInput } from '@zenith/shared/workflow';
import { requireRow } from '../../lib/db-assert';

type PhraseRow = typeof workflowQuickPhrases.$inferSelect;

export function mapQuickPhrase(row: PhraseRow): WorkflowQuickPhrase {
  return {
    id: row.id,
    userId: row.userId ?? null,
    content: row.content,
    sort: row.sort,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 列出当前用户可用的常用语：系统预置（userId=null）+ 个人 */
export async function listMyQuickPhrases(): Promise<WorkflowQuickPhrase[]> {
  const user = currentUser();
  const tc = tenantCondition(workflowQuickPhrases, user);
  const scope = or(isNull(workflowQuickPhrases.userId), eq(workflowQuickPhrases.userId, user.userId));
  const where = tc ? and(scope, tc) : scope;
  const rows = await db.select().from(workflowQuickPhrases).where(where)
    .orderBy(asc(workflowQuickPhrases.sort), desc(workflowQuickPhrases.id));
  return rows.map(mapQuickPhrase);
}

export async function createMyQuickPhrase(input: CreateWorkflowQuickPhraseInput): Promise<WorkflowQuickPhrase> {
  const user = currentUser();
  const [row] = await db.insert(workflowQuickPhrases).values({
    userId: user.userId,
    content: input.content,
    sort: input.sort ?? 0,
    tenantId: getCreateTenantId(user),
  }).returning();
  return mapQuickPhrase(row);
}

async function ensureOwnPhrase(id: number): Promise<PhraseRow> {
  const user = currentUser();
  const [row] = await db.select().from(workflowQuickPhrases).where(eq(workflowQuickPhrases.id, id)).limit(1);
  requireRow(row, '常用语不存在');
  if (row.userId !== user.userId) throw new HTTPException(403, { message: '无权操作该常用语' });
  return row;
}

export async function getQuickPhraseBeforeAudit(id: number): Promise<WorkflowQuickPhrase | null> {
  const row = await ensureOwnPhrase(id).catch((err) => {
    if (err instanceof HTTPException && err.status === 404) return null;
    throw err;
  });
  return row ? mapQuickPhrase(row) : null;
}

export async function updateMyQuickPhrase(id: number, input: UpdateWorkflowQuickPhraseInput): Promise<WorkflowQuickPhrase> {
  await ensureOwnPhrase(id);
  const patch: Partial<typeof workflowQuickPhrases.$inferInsert> = {};
  if (input.content !== undefined) patch.content = input.content;
  if (input.sort !== undefined) patch.sort = input.sort;
  const [row] = await db.update(workflowQuickPhrases).set(patch).where(eq(workflowQuickPhrases.id, id)).returning();
  return mapQuickPhrase(row);
}

export async function deleteMyQuickPhrase(id: number): Promise<void> {
  await ensureOwnPhrase(id);
  await db.delete(workflowQuickPhrases).where(eq(workflowQuickPhrases.id, id));
}
