import { and, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { cmsContentContract, cmsOperationsContract, CMS_WORKSPACE_QUEUES, type CmsWorkspaceItem } from '@zenith/shared/cms';
import type { QueryOutputOf } from '@zenith/shared/core';
import { db } from '../../db';
import { cmsContents, cmsContentWorkingCopies, cmsEditorialNotes, cmsEditorialTasks, cmsFeedbackCases, users } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { hasPermission } from '../../lib/context';
import { APP_TIME_ZONE, formatNullableDateTime } from '../../lib/datetime';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { assertSiteAccess } from './cms-sites.service';
import { buildCmsContentListWhere } from './cms-contents-query.service';
import { cmsEditorialTaskVisibility } from './cms-editorial-tasks.service';

type Queue = (typeof CMS_WORKSPACE_QUEUES)[number];
export async function getCmsEditorialWorkspace(q: QueryOutputOf<typeof cmsOperationsContract.workspace>) {
  await assertSiteAccess(q.siteId);
  const actor = currentUser().userId;
  const [contentAllowed, reviewAllowed, feedbackAllowed] = await Promise.all([hasPermission('cms:content:list'), hasPermission('cms:content:audit'), hasPermission('cms:form:list')]);
  const contentScope = contentAllowed ? await buildCmsContentListWhere(cmsContentContract.list.query.parse({ siteId: q.siteId })) : sql`false`;
  const taskScope = await cmsEditorialTaskVisibility(q.siteId);
  const workingOwner = sql<number>`nullif(${cmsContentWorkingCopies.snapshot}->>'ownerId','')::integer`;
  const due = sql<string | null>`${cmsContentWorkingCopies.snapshot}->>'dueAt'`;
  const queueConditions: Record<Queue, SQL | undefined> = {
    mine: or(eq(workingOwner, actor), and(isNull(workingOwner), eq(cmsContents.createdBy, actor))), review: eq(cmsContentWorkingCopies.editorialStatus, 'pending'),
    overdue: and(ne(cmsContentWorkingCopies.editorialStatus, 'clean'), sql`nullif(${due},'')::timestamp < (now() at time zone ${APP_TIME_ZONE})`),
    notes: sql`exists (select 1 from ${cmsEditorialNotes} where ${cmsEditorialNotes.contentId}=${cmsContents.id} and ${cmsEditorialNotes.resolved}=false)`,
    unpublished: ne(cmsContentWorkingCopies.editorialStatus, 'clean'), feedback: undefined, tasks: undefined,
  };
  const allowed = (queue: Queue) => queue === 'feedback' ? feedbackAllowed : queue === 'tasks' ? true : contentAllowed && (queue !== 'review' || reviewAllowed);
  const contentWhere = (queue: Queue, keyword?: string) => buildWhere(contentScope, sql`exists (select 1 from ${cmsContentWorkingCopies} where ${buildWhere(eq(cmsContentWorkingCopies.contentId, cmsContents.id), queueConditions[queue], keywordCondition(keyword, [sql`${cmsContentWorkingCopies.snapshot}->>'title'`]))})`);
  const feedbackWhere = (keyword?: string) => buildWhere(eq(cmsFeedbackCases.siteId, q.siteId), inArray(cmsFeedbackCases.status, ['new', 'processing']), or(isNull(cmsFeedbackCases.ownerId), eq(cmsFeedbackCases.ownerId, actor)), keywordCondition(keyword, [cmsFeedbackCases.title]));
  const tasksWhere = (keyword?: string) => buildWhere(eq(cmsEditorialTasks.siteId, q.siteId), taskScope, inArray(cmsEditorialTasks.status, ['open', 'in_progress']), or(isNull(cmsEditorialTasks.ownerId), eq(cmsEditorialTasks.ownerId, actor)), keywordCondition(keyword, [cmsEditorialTasks.title]));
  const counters = await Promise.all(CMS_WORKSPACE_QUEUES.map(async (queue) => ({ queue, available: allowed(queue), count: !allowed(queue) ? 0 : queue === 'feedback' ? await db.$count(cmsFeedbackCases, feedbackWhere()) : queue === 'tasks' ? await db.$count(cmsEditorialTasks, tasksWhere()) : await db.$count(cmsContents, contentWhere(queue)) })));
  const queue = q.queue ?? counters.find((counter) => counter.available)?.queue ?? 'tasks';
  if (!allowed(queue)) throw new HTTPException(403, { message: '没有查看此工作队列的权限' });
  let result;
  if (queue === 'feedback') {
    const where = feedbackWhere(q.keyword);
    result = await buildListResult({ page: q.page, pageSize: q.pageSize, count: () => db.$count(cmsFeedbackCases, where), rows: () => withPagination(db.select({ id: cmsFeedbackCases.id, title: cmsFeedbackCases.title, status: cmsFeedbackCases.status, ownerName: users.nickname, dueAt: cmsFeedbackCases.dueAt }).from(cmsFeedbackCases).leftJoin(users, eq(users.id, cmsFeedbackCases.ownerId)).where(where).orderBy(desc(cmsFeedbackCases.id)).$dynamic(), q.page, q.pageSize), map: (row): CmsWorkspaceItem => ({ ...row, dueAt: formatNullableDateTime(row.dueAt), kind: 'feedback', href: `/cms/forms?site=${q.siteId}&feedback=${row.id}` }) });
  } else if (queue === 'tasks') {
    const where = tasksWhere(q.keyword);
    result = await buildListResult({ page: q.page, pageSize: q.pageSize, count: () => db.$count(cmsEditorialTasks, where), rows: () => withPagination(db.select({ id: cmsEditorialTasks.id, title: cmsEditorialTasks.title, status: cmsEditorialTasks.status, ownerName: users.nickname, dueAt: cmsEditorialTasks.dueAt }).from(cmsEditorialTasks).leftJoin(users, eq(users.id, cmsEditorialTasks.ownerId)).where(where).orderBy(desc(cmsEditorialTasks.id)).$dynamic(), q.page, q.pageSize), map: (row): CmsWorkspaceItem => ({ ...row, dueAt: formatNullableDateTime(row.dueAt), kind: 'task', href: `/cms/dashboard?site=${q.siteId}&task=${row.id}` }) });
  } else {
    const where = contentWhere(queue, q.keyword);
    result = await buildListResult({ page: q.page, pageSize: q.pageSize, count: () => db.$count(cmsContents, where), rows: () => withPagination(db.select({ id: cmsContents.id, title: sql<string>`${cmsContentWorkingCopies.snapshot}->>'title'`, status: cmsContentWorkingCopies.editorialStatus, ownerName: users.nickname, dueAt: due }).from(cmsContents).innerJoin(cmsContentWorkingCopies, eq(cmsContentWorkingCopies.contentId, cmsContents.id)).leftJoin(users, eq(users.id, workingOwner)).where(where).orderBy(desc(cmsContents.id)).$dynamic(), q.page, q.pageSize), map: (row): CmsWorkspaceItem => ({ ...row, kind: 'content', href: `/cms/contents/edit?id=${row.id}&site=${q.siteId}` }) });
  }
  return { ...result, counters };
}
