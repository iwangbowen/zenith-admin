import { afterEach, describe, expect, it } from 'vitest';
import type { CmsEditorialTask, CmsFeedbackDetail } from '@zenith/shared/cms';
import { mockCmsContents, mockCmsFormSubmissions } from './data/cms';
import { mockCmsFeedback, mockCmsEditorialTasks, mockCmsHandlingPolicies, syncMockCmsFeedbackSubmissions } from './data/cms-operations';
import { mockWorkflowDefinitions, mockWorkflowInstances, mockWorkflowTasks } from './data/workflow';
import { cmsOperationsHandlers } from './handlers/cms-operations';
import { syncMockWorkflowBusinessResult } from './utils/workflow-business';
import { resetMockCmsRevisions } from './utils/cms-revisions';

const snapshots = { contents: structuredClone(mockCmsContents), submissions: structuredClone(mockCmsFormSubmissions), instances: structuredClone(mockWorkflowInstances), tasks: structuredClone(mockWorkflowTasks) };
afterEach(() => {
  resetMockCmsRevisions();
  mockCmsContents.splice(0, mockCmsContents.length, ...structuredClone(snapshots.contents));
  mockCmsFeedback.length = 0; mockCmsEditorialTasks.length = 0; mockCmsHandlingPolicies.length = 0;
  mockCmsFormSubmissions.splice(0, mockCmsFormSubmissions.length, ...structuredClone(snapshots.submissions));
  mockWorkflowInstances.splice(0, mockWorkflowInstances.length, ...structuredClone(snapshots.instances));
  mockWorkflowTasks.splice(0, mockWorkflowTasks.length, ...structuredClone(snapshots.tasks));
});
async function call<T>(method: string, path: string, body?: unknown) {
  for (const handler of cmsOperationsHandlers) {
    const request = new Request(`${window.location.origin}/api/cms/operations${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await (handler as unknown as { run(args: unknown): Promise<{ response?: Response } | null> }).run({ request, requestId: `cms-operations-${Math.random()}` });
    if (result?.response) return { status: result.response.status, body: await result.response.json() as { code: number; message: string; data: T } };
  }
  throw new Error(`No handler matched ${method} ${path}`);
}

describe('CMS feedback and editorial operations', () => {
  it('retains original submission and history, rejects stale edits and invalid transitions', async () => {
    syncMockCmsFeedbackSubmissions(); const initial = structuredClone(mockCmsFeedback[0]);
    const invalid = await call('POST', `/feedback/${initial.id}/handle`, { expectedVersion: initial.version, status: 'resolved', note: '完成' });
    expect(invalid.status).toBe(400);
    const saved = await call<CmsFeedbackDetail>('POST', `/feedback/${initial.id}/handle`, { expectedVersion: initial.version, status: 'processing', note: '已受理' });
    expect(saved.body.data.status).toBe('processing');
    const stale = await call('POST', `/feedback/${initial.id}/handle`, { expectedVersion: initial.version, ownerId: 1 });
    expect(stale.status).toBe(409);
    const detail = await call<CmsFeedbackDetail>('GET', `/feedback/${initial.id}`);
    expect(detail.body.data.data).toEqual(initial.data);
    expect(detail.body.data.history.at(-1)).toEqual(initial.history[0]);
    expect(detail.body.data.history[0].previousHash).toBe(initial.history[0].hash);
  });
  it('deduplicates source conversion and requires same-site content to complete source tasks', async () => {
    syncMockCmsFeedbackSubmissions(); const feedback = mockCmsFeedback[0];
    const body = { siteId: feedback.siteId, title: '读者问题内容补全', source: 'submission', feedbackId: feedback.id };
    const created = await call<CmsEditorialTask>('POST', '/tasks', body);
    const repeated = await call<CmsEditorialTask>('POST', '/tasks', body);
    expect(repeated.body.data.id).toBe(created.body.data.id);
    expect((await call('PUT', `/tasks/${created.body.data.id}`, { expectedVersion: 1, status: 'done' })).status).toBe(400);
    const foreign = mockCmsContents.find((content) => content.siteId !== feedback.siteId)!;
    expect((await call('PUT', `/tasks/${created.body.data.id}`, { expectedVersion: 1, contentId: foreign.id })).status).toBe(400);
    const own = mockCmsContents.find((content) => content.siteId === feedback.siteId)!;
    const done = await call<CmsEditorialTask>('PUT', `/tasks/${created.body.data.id}`, { expectedVersion: 1, status: 'done', contentId: own.id });
    expect(done.status).toBe(200);
    expect((await call('PUT', `/tasks/${created.body.data.id}`, { expectedVersion: done.body.data.version, contentId: null })).status).toBe(400);
    expect((await call('PUT', `/tasks/${created.body.data.id}`, { expectedVersion: 1, title: '陈旧保存' })).status).toBe(409);
  });
  it('applies policy only to new submissions, blocks edits in approval, and permits a new round after rejection', async () => {
    syncMockCmsFeedbackSubmissions(); const old = mockCmsFeedback[0];
    const workflow = mockWorkflowDefinitions.find((item) => item.customForm?.viewComponent === 'cms/feedback/CmsFeedbackApprovalView')!;
    expect((await call('POST', `/forms/${old.formId}/handling`, { expectedVersion: 0, defaultOwnerId: 1, workflowDefinitionId: workflow.id })).status).toBe(200);
    expect(old.workflowDefinitionId).toBeNull();
    mockCmsFormSubmissions.push({ ...snapshots.submissions[0], id: 99001, data: { message: '需要复核的办理结果' } });
    syncMockCmsFeedbackSubmissions(); const current = mockCmsFeedback.find((row) => row.submissionId === 99001)!;
    expect(current.workflowDefinitionId).toBe(workflow.id);
    await call('POST', `/feedback/${current.id}/handle`, { expectedVersion: current.version, status: 'processing', note: '受理' });
    await call('POST', `/feedback/${current.id}/submit`, { expectedVersion: current.version, note: '第一次结果' });
    expect((await call('POST', `/feedback/${current.id}/handle`, { expectedVersion: current.version, note: '审批中修改' })).status).toBe(409);
    const first = mockWorkflowInstances.find((row) => row.id === current.workflowInstanceId)!;
    first.status = 'rejected'; syncMockWorkflowBusinessResult(first);
    expect(current.status).toBe('processing');
    await call('POST', `/feedback/${current.id}/submit`, { expectedVersion: current.version, note: '修订后的结果' });
    expect(current.workflowInstanceId).not.toBe(first.id);
    first.status = 'approved'; syncMockWorkflowBusinessResult(first);
    expect(current.status).toBe('processing');
    const latest = mockWorkflowInstances.find((row) => row.id === current.workflowInstanceId)!;
    latest.status = 'approved'; syncMockWorkflowBusinessResult(latest);
    expect(current.status).toBe('resolved');
    const context = await call<{ previousInstances: unknown[] }>('GET', `/feedback/${current.id}/workflow`);
    expect(context.body.data.previousInstances).toHaveLength(2);
    const unrelated = await call('GET', `/feedback/${old.id}/approval-detail?instanceId=${latest.id}`);
    expect(unrelated.status).toBe(404);
  });
});
