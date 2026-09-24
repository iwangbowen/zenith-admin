import { canTransitionCmsFeedback, CMS_ATTRIBUTION_EVENTS, CMS_WORKSPACE_QUEUES, cmsFeedbackSchema, cmsOperationsContract, type CmsEditorialTask, type CmsWorkspaceItem } from '@zenith/shared/cms';
import { WORKFLOW_ACTIVE_INSTANCE_STATUSES } from '@zenith/shared/workflow';
import { mock, MockHttpError } from '../utils/contract';
import { requireItem } from '../utils/crud';
import { badRequest, conflict, nextIdFrom } from '../utils/handlers';
import { mockDateTime } from '../utils/date';
import { matchesFilter } from '../utils/filter';
import { mockCmsContents, mockCmsForms, mockCmsSites } from '../data/cms';
import { mockUsers } from '../data/users';
import { mockWorkflowDefinitions } from '../data/workflow';
import { appendMockCmsFeedbackHistory, mockCmsAttributionReads, mockCmsEditorialTasks, mockCmsFeedback, mockCmsHandlingPolicies, mockCmsNoResultKeywords, syncMockCmsFeedbackSubmissions } from '../data/cms-operations';
import { getMockBusinessContext, previewMockBusinessWorkflow, requireMockBusinessInstance, startMockBusinessWorkflow } from '../utils/workflow-business';
import { getMockCmsWorkingContent } from '../utils/cms-revisions';
import { getMockCmsUnresolvedNoteContentIds } from './cms-editorial';

const active = (status?: string | null) => WORKFLOW_ACTIVE_INSTANCE_STATUSES.some((value) => value === status);
const person = (id?: number | null) => {
  const user = id ? requireItem(mockUsers, id, '负责人不存在', { status: 400 }) : null;
  if (user && (user.status !== 'enabled' || user.tenantId != null)) throw new MockHttpError(badRequest('负责人不存在或已停用', { status: 400 }));
  return user;
};
const ownerName = (id?: number | null) => person(id)?.nickname ?? null;
function feedback(id: number) { syncMockCmsFeedbackSubmissions(); const row = requireItem(mockCmsFeedback, id, '来信不存在', { status: 404 }); row.ownerName = ownerName(row.ownerId); return row; }
function definition(id: number) {
  const row = requireItem(mockWorkflowDefinitions, id, '流程不存在', { status: 400 });
  if (row.status !== 'published' || row.formType !== 'external' || row.customForm?.viewComponent !== 'cms/feedback/CmsFeedbackApprovalView') throw new MockHttpError(badRequest('请选择已发布的 CMS 来信办理流程', { status: 400 }));
  return row;
}
function assertVersion(current: number, expected: number) { if (current !== expected) throw new MockHttpError(conflict('记录已被更新，请刷新后重试；本次输入未保存', { status: 409 })); }
function taskContent(siteId: number, contentId?: number | null) {
  if (!contentId) return null;
  const content = getMockCmsWorkingContent(contentId);
  if (content.siteId !== siteId) throw new MockHttpError(badRequest('关联稿件必须属于本站', { status: 400 }));
  return content;
}
function task(row: CmsEditorialTask): CmsEditorialTask {
  const content = taskContent(row.siteId, row.contentId);
  return { ...row, ownerName: ownerName(row.ownerId), contentTitle: content?.title ?? null, contentStatus: content?.status ?? null,
    editorialStatus: content?.editorialStatus ?? null, publishedRevisionId: content?.publishedRevisionId ?? null, hasUnpublishedChanges: content?.hasUnpublishedChanges ?? false };
}
const policy = (formId: number) => { requireItem(mockCmsForms, formId, '表单不存在', { status: 404 }); return mockCmsHandlingPolicies.find((row) => row.formId === formId) ?? { formId, version: 0, defaultOwnerId: null, workflowDefinitionId: null, workflowName: null }; };

export const cmsOperationsHandlers = [
  mock(cmsOperationsContract.assignees, ({ ok }) => ok(mockUsers.filter((user) => user.status === 'enabled').map((user) => ({ id: user.id, name: user.nickname || user.username })))),
  mock(cmsOperationsContract.handlingWorkflows, ({ ok }) => ok(mockWorkflowDefinitions.filter((row) => row.status === 'published' && row.formType === 'external' && row.customForm?.viewComponent === 'cms/feedback/CmsFeedbackApprovalView').map(({ id, name }) => ({ id, name })))),
  mock(cmsOperationsContract.feedback, ({ query, ok, paginate }) => {
    syncMockCmsFeedbackSubmissions();
    return ok(paginate(mockCmsFeedback.filter((row) => row.siteId === query.siteId && matchesFilter(row.formId, query.formId) && matchesFilter(row.status, query.status) && matchesFilter(row.ownerId, query.ownerId) && (!query.keyword || row.title.includes(query.keyword))).sort((a, b) => b.id - a.id).map((row) => cmsFeedbackSchema.parse(feedback(row.id)))));
  }),
  mock(cmsOperationsContract.feedbackDetail, ({ params, ok }) => ok(feedback(params.id))),
  mock(cmsOperationsContract.approvalDetail, ({ params, query, ok }) => { requireMockBusinessInstance('cms_feedback', params.id, query.instanceId); return ok(feedback(params.id)); }),
  mock(cmsOperationsContract.handleFeedback, ({ params, body, ok }) => {
    const row = feedback(params.id); assertVersion(row.version, body.expectedVersion);
    if (active(row.workflowStatus)) return conflict('办理结果正在审批，请先完成或撤回审批', { status: 409 });
    const status = body.status ?? row.status;
    if (!canTransitionCmsFeedback(row.status, status)) return badRequest('不支持此办理状态转换，请先转为处理中', { status: 400 });
    if (status !== row.status && !body.note?.trim()) return badRequest('状态变化必须填写办理意见', { status: 400 });
    if (status === 'resolved' && row.workflowDefinitionId) return conflict('请提交办理审批，通过后完成办理', { status: 409 });
    if (body.ownerId) person(body.ownerId);
    const action = status !== row.status ? `status:${status}` : body.ownerId !== undefined && body.ownerId !== row.ownerId ? 'assigned' : body.dueAt !== undefined && body.dueAt !== row.dueAt ? 'deadline' : 'note';
    Object.assign(row, { status, version: row.version + 1, ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}), ...(body.dueAt !== undefined ? { dueAt: body.dueAt } : {}), ...(status === 'resolved' || status === 'closed' ? { resolution: body.note ?? row.resolution } : {}) });
    appendMockCmsFeedbackHistory(row, action, body.note ?? null);
    return ok(feedback(row.id));
  }),
  mock(cmsOperationsContract.handlingPolicy, ({ params, ok }) => ok(policy(params.id))),
  mock(cmsOperationsContract.saveHandlingPolicy, ({ params, body, ok }) => {
    syncMockCmsFeedbackSubmissions();
    const current = policy(params.id); assertVersion(current.version, body.expectedVersion); person(body.defaultOwnerId);
    const flow = body.workflowDefinitionId ? definition(body.workflowDefinitionId) : null;
    const saved = { formId: params.id, version: current.version + 1, defaultOwnerId: body.defaultOwnerId, workflowDefinitionId: body.workflowDefinitionId, workflowName: flow?.name ?? null };
    const index = mockCmsHandlingPolicies.findIndex((row) => row.formId === params.id); if (index >= 0) mockCmsHandlingPolicies[index] = saved; else mockCmsHandlingPolicies.push(saved);
    return ok(saved);
  }),
  mock(cmsOperationsContract.workflowPreview, ({ params, ok }) => { const row = feedback(params.id); return ok(previewMockBusinessWorkflow(row.workflowDefinitionId ? definition(row.workflowDefinitionId) : null)); }),
  mock(cmsOperationsContract.workflowContext, ({ params, query, ok }) => { const row = feedback(params.id); return ok(getMockBusinessContext('cms_feedback', row.id, row.status === 'resolved' || active(row.workflowStatus) ? row.workflowInstanceId : null, query.instanceId ?? undefined)); }),
  mock(cmsOperationsContract.submitWorkflow, ({ params, body, ok }) => {
    const row = feedback(params.id); assertVersion(row.version, body.expectedVersion);
    if (!row.workflowDefinitionId || row.status !== 'processing') return badRequest('请先配置办理审批并将来信转为处理中', { status: 400 });
    if (active(row.workflowStatus)) return conflict('办理结果正在审批', { status: 409 });
    row.version += 1; row.resolution = body.note;
    const instance = startMockBusinessWorkflow({ definition: definition(row.workflowDefinitionId), bizType: 'cms_feedback', bizId: row.id, title: `来信办理 - ${row.title}`, tenantId: null,
      variables: { feedbackTitle: row.title, formName: row.formName, feedbackVersion: row.version, ownerId: row.ownerId, resolution: row.resolution, siteName: mockCmsSites.find((site) => site.id === row.siteId)?.name } });
    row.workflowInstanceId = instance.id; row.workflowStatus = instance.status; if (instance.status === 'approved') row.status = 'resolved';
    appendMockCmsFeedbackHistory(row, 'workflow:submitted', body.note); return ok(row);
  }),
  mock(cmsOperationsContract.tasks, ({ query, ok, paginate }) => ok(paginate(mockCmsEditorialTasks.filter((row) => row.siteId === query.siteId && matchesFilter(row.status, query.status) && matchesFilter(row.ownerId, query.ownerId) && (!query.keyword || row.title.includes(query.keyword))).sort((a, b) => b.id - a.id).map(task)))),
  mock(cmsOperationsContract.taskDetail, ({ params, ok }) => ok(task(requireItem(mockCmsEditorialTasks, params.id, '事项不存在', { status: 404 })))),
  mock(cmsOperationsContract.createTask, ({ body, ok }) => {
    requireItem(mockCmsSites, body.siteId, '站点不存在', { status: 404 }); person(body.ownerId); taskContent(body.siteId, body.contentId);
    if (body.source === 'search' && !mockCmsNoResultKeywords.some((row) => row.keyword === body.sourceKeyword)) return badRequest('无结果搜索词不存在', { status: 400 });
    if (body.source === 'submission' && feedback(body.feedbackId!).siteId !== body.siteId) return badRequest('来源来信必须属于本站', { status: 400 });
    const existing = mockCmsEditorialTasks.find((row) => row.siteId === body.siteId && row.source === body.source && (body.source === 'search' ? row.sourceKeyword === body.sourceKeyword : body.source === 'submission' && row.feedbackId === body.feedbackId));
    if (existing) return ok(task(existing));
    const row: CmsEditorialTask = { id: nextIdFrom(mockCmsEditorialTasks), siteId: body.siteId, title: body.title, description: body.description, source: body.source, sourceKeyword: body.sourceKeyword ?? null, feedbackId: body.feedbackId ?? null,
      ownerId: body.ownerId ?? null, ownerName: null, dueAt: body.dueAt ?? null, status: 'open', version: 1, contentId: body.contentId ?? null, contentTitle: null, contentStatus: null, editorialStatus: null, publishedRevisionId: null, hasUnpublishedChanges: false, createdAt: mockDateTime(), updatedAt: mockDateTime() };
    mockCmsEditorialTasks.push(row); return ok(task(row));
  }),
  mock(cmsOperationsContract.updateTask, ({ params, body, ok }) => {
    const row = requireItem(mockCmsEditorialTasks, params.id, '事项不存在', { status: 404 }); assertVersion(row.version, body.expectedVersion); person(body.ownerId); taskContent(row.siteId, body.contentId);
    if ((body.status ?? row.status) === 'done' && row.source !== 'manual' && !(body.contentId === undefined ? row.contentId : body.contentId)) return badRequest('完成事项前请关联稿件', { status: 400 });
    const { expectedVersion: _, ...patch } = body; Object.assign(row, patch, { version: row.version + 1, updatedAt: mockDateTime() }); return ok(task(row));
  }),
  mock(cmsOperationsContract.workspace, ({ query, ok, paginate }) => {
    syncMockCmsFeedbackSubmissions();
    const contents = mockCmsContents.filter((item) => item.siteId === query.siteId).map((item) => getMockCmsWorkingContent(item.id));
    const noteIds = getMockCmsUnresolvedNoteContentIds();
    const items = (queue: typeof CMS_WORKSPACE_QUEUES[number]): CmsWorkspaceItem[] => queue === 'feedback' ? mockCmsFeedback.filter((row) => row.siteId === query.siteId && ['new', 'processing'].includes(row.status) && (!row.ownerId || row.ownerId === 1)).map((row) => ({ id: row.id, title: row.title, status: row.status, dueAt: row.dueAt, kind: 'feedback' as const, ownerName: ownerName(row.ownerId), href: `/cms/forms?site=${row.siteId}&feedback=${row.id}` }))
      : queue === 'tasks' ? mockCmsEditorialTasks.filter((row) => row.siteId === query.siteId && ['open', 'in_progress'].includes(row.status) && (!row.ownerId || row.ownerId === 1)).map((row) => ({ id: row.id, title: row.title, status: row.status, dueAt: row.dueAt, kind: 'task' as const, ownerName: ownerName(row.ownerId), href: `/cms/dashboard?site=${row.siteId}&task=${row.id}` }))
      : contents.filter((row) => queue === 'mine' ? row.ownerId === 1 : queue === 'review' ? row.editorialStatus === 'pending' : queue === 'overdue' ? !!row.dueAt && row.dueAt < mockDateTime() && row.editorialStatus !== 'clean' : queue === 'notes' ? noteIds.has(row.id) : row.editorialStatus !== 'clean').map((row) => ({ id: row.id, title: row.title, kind: 'content' as const, status: row.editorialStatus, ownerName: ownerName(row.ownerId), dueAt: row.dueAt, href: `/cms/contents/edit?id=${row.id}&site=${query.siteId}` }));
    return ok({ ...paginate(items(query.queue ?? 'mine').filter((row) => !query.keyword || row.title.includes(query.keyword))), counters: CMS_WORKSPACE_QUEUES.map((queue) => ({ queue, count: items(queue).length, available: true })) });
  }),
  mock(cmsOperationsContract.attribution, ({ query, ok }) => {
    requireItem(mockCmsSites, query.siteId, '站点不存在', { status: 404 });
    const reads = mockCmsAttributionReads.filter((row) => row.siteId === query.siteId && matchesFilter(row.contentId, query.contentId) && !query.releaseId && !query.deploymentId && (!query.startTime || row.createdAt >= query.startTime) && (!query.endTime || row.createdAt <= query.endTime));
    const count = reads.reduce((total, row) => total + row.count, 0);
    const visitors = reads.reduce((total, row) => total + row.visitors, 0);
    return ok({ totals: CMS_ATTRIBUTION_EVENTS.map((event) => ({ event, count: event === 'cms.read' || event === 'cms.entry' ? count : 0, visitors: event === 'cms.read' || event === 'cms.entry' ? visitors : 0 })),
      journeys: reads.map((row) => ({ contentId: row.contentId, contentTitle: row.contentTitle, releaseId: null, deploymentId: null, entryPath: row.entryPath, source: 'direct', reads: row.count, clicks: 0, downloads: 0, formCompletions: 0, voteCompletions: 0 })) });
  }),
];
