import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type * as z from 'zod';
import type { QueryOutputOf } from '@zenith/shared/core';
import { cmsContentContract, cmsEditorialTaskSchema, cmsOperationsContract, createCmsEditorialTaskSchema, updateCmsEditorialTaskSchema } from '@zenith/shared/cms';
import { db } from '../../db';
import { cmsContents, cmsContentWorkingCopies, cmsEditorialTasks, cmsSearchLogs, users } from '../../db/schema';
import { pickEntity } from '../../lib/entity-map';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { parseDateTimeInput } from '../../lib/datetime';
import { requireTenantUser } from '../../lib/user-nicknames';
import { hasPermission } from '../../lib/context';
import { assertSiteAccess } from './cms-sites.service';
import { assertAllCmsSiteChannelsAccess } from './cms-channels.service';
import { buildCmsContentListWhere, getCmsContent } from './cms-contents-query.service';
import { getCmsFeedbackDetail } from './cms-feedback.service';

export async function cmsEditorialTaskVisibility(siteId: number) {
  if (!await hasPermission('cms:content:list')) return isNull(cmsEditorialTasks.contentId);
  const scope = await buildCmsContentListWhere(cmsContentContract.list.query.parse({ siteId }));
  return or(isNull(cmsEditorialTasks.contentId), sql`exists (select 1 from ${cmsContents} where ${cmsContents.id} = ${cmsEditorialTasks.contentId} and ${scope})`);
}
const selection = { item: cmsEditorialTasks, ownerName: users.nickname, contentTitle: sql<string | null>`${cmsContentWorkingCopies.snapshot}->>'title'`, contentStatus: cmsContents.status,
  editorialStatus: cmsContentWorkingCopies.editorialStatus, publishedRevisionId: cmsContentWorkingCopies.publishedRevisionId };
function mapTask(row: { item: typeof cmsEditorialTasks.$inferSelect; ownerName: string | null; contentTitle: string | null; contentStatus: string | null; editorialStatus: string | null; publishedRevisionId: number | null }) {
  return pickEntity(cmsEditorialTaskSchema, row.item, { ownerName: row.ownerName, contentTitle: row.contentTitle, contentStatus: row.contentStatus, editorialStatus: row.editorialStatus,
    publishedRevisionId: row.publishedRevisionId, hasUnpublishedChanges: row.item.contentId !== null && row.editorialStatus !== 'clean' });
}
export async function listCmsEditorialTasks(q: QueryOutputOf<typeof cmsOperationsContract.tasks>) {
  await assertSiteAccess(q.siteId);
  const where = buildWhere(eq(cmsEditorialTasks.siteId, q.siteId), await cmsEditorialTaskVisibility(q.siteId), q.status ? eq(cmsEditorialTasks.status, q.status) : undefined,
    q.ownerId ? eq(cmsEditorialTasks.ownerId, q.ownerId) : undefined, keywordCondition(q.keyword, [cmsEditorialTasks.title]));
  return buildListResult({ page: q.page, pageSize: q.pageSize, count: () => db.$count(cmsEditorialTasks, where),
    rows: () => withPagination(db.select(selection).from(cmsEditorialTasks).leftJoin(users, eq(users.id, cmsEditorialTasks.ownerId)).leftJoin(cmsContents, eq(cmsContents.id, cmsEditorialTasks.contentId)).leftJoin(cmsContentWorkingCopies, eq(cmsContentWorkingCopies.contentId, cmsEditorialTasks.contentId)).where(where).orderBy(desc(cmsEditorialTasks.id)).$dynamic(), q.page, q.pageSize), map: mapTask,
  });
}
export async function getCmsEditorialTask(id: number) {
  const [task] = await db.select().from(cmsEditorialTasks).where(eq(cmsEditorialTasks.id, id)).limit(1);
  const row = requireRow(task, '编辑事项不存在'); await assertSiteAccess(row.siteId);
  const [result] = await db.select(selection).from(cmsEditorialTasks).leftJoin(users, eq(users.id, cmsEditorialTasks.ownerId)).leftJoin(cmsContents, eq(cmsContents.id, cmsEditorialTasks.contentId)).leftJoin(cmsContentWorkingCopies, eq(cmsContentWorkingCopies.contentId, cmsEditorialTasks.contentId)).where(buildWhere(eq(cmsEditorialTasks.id, id), await cmsEditorialTaskVisibility(row.siteId))).limit(1);
  return mapTask(requireRow(result, '编辑事项不存在或关联稿件不可访问'));
}
async function validateTaskContent(siteId: number, contentId?: number | null) {
  if (!contentId) return;
  if (!await hasPermission('cms:content:list')) throw new HTTPException(403, { message: '没有查看关联稿件的权限' });
  const content = await getCmsContent(contentId);
  if (content.siteId !== siteId) throw new HTTPException(400, { message: '关联稿件必须属于本站' });
}
export async function createCmsEditorialTask(input: z.output<typeof createCmsEditorialTaskSchema>) {
  await assertSiteAccess(input.siteId); await validateTaskContent(input.siteId, input.contentId);
  if (input.ownerId) await requireTenantUser(input.ownerId, '事项负责人不存在或已停用', { enabledOnly: true });
  let sourceKey: string | null = null;
  if (input.source === 'search') {
    if (!await hasPermission('cms:stat:view')) throw new HTTPException(403, { message: '没有查看搜索反馈的权限' });
    await assertAllCmsSiteChannelsAccess(input.siteId);
    const [search] = await db.select({ id: cmsSearchLogs.id }).from(cmsSearchLogs).where(and(eq(cmsSearchLogs.siteId, input.siteId), eq(cmsSearchLogs.keyword, input.sourceKeyword!), eq(cmsSearchLogs.resultCount, 0))).limit(1);
    requireRow(search, '该搜索词不存在于本站无结果搜索记录'); sourceKey = input.sourceKeyword!;
  }
  if (input.source === 'submission') {
    if (!await hasPermission('cms:form:list')) throw new HTTPException(403, { message: '没有查看来信的权限' });
    const feedback = await getCmsFeedbackDetail(input.feedbackId!);
    if (feedback.siteId !== input.siteId) throw new HTTPException(400, { message: '来源来信必须属于本站' });
    sourceKey = String(feedback.id);
  }
  const [created] = await db.insert(cmsEditorialTasks).values({ ...input, sourceKey, dueAt: input.dueAt ? parseDateTimeInput(input.dueAt) : null }).onConflictDoNothing({ target: [cmsEditorialTasks.siteId, cmsEditorialTasks.source, cmsEditorialTasks.sourceKey] }).returning();
  if (created) return getCmsEditorialTask(created.id);
  const [existing] = await db.select({ id: cmsEditorialTasks.id }).from(cmsEditorialTasks).where(and(eq(cmsEditorialTasks.siteId, input.siteId), eq(cmsEditorialTasks.source, input.source), eq(cmsEditorialTasks.sourceKey, sourceKey!))).limit(1);
  return getCmsEditorialTask(requireRow(existing, '事项创建冲突，请重试', 409).id);
}
export async function updateCmsEditorialTask(id: number, input: z.output<typeof updateCmsEditorialTaskSchema>) {
  const current = await getCmsEditorialTask(id);
  await validateTaskContent(current.siteId, input.contentId);
  if (input.ownerId) await requireTenantUser(input.ownerId, '事项负责人不存在或已停用', { enabledOnly: true });
  if (input.status === 'done' && current.source !== 'manual' && !(input.contentId === undefined ? current.contentId : input.contentId)) throw new HTTPException(400, { message: '请先关联处理该反馈的稿件，再完成编辑事项' });
  const { expectedVersion, dueAt, ...patch } = input;
  const [row] = await db.update(cmsEditorialTasks).set({ ...patch, ...(dueAt !== undefined ? { dueAt: dueAt ? parseDateTimeInput(dueAt) : null } : {}), version: sql`${cmsEditorialTasks.version} + 1` }).where(and(eq(cmsEditorialTasks.id, id), eq(cmsEditorialTasks.version, expectedVersion))).returning({ id: cmsEditorialTasks.id });
  if (!row) throw new HTTPException(409, { message: '编辑事项已被更新，请刷新后重试' });
  return getCmsEditorialTask(id);
}
