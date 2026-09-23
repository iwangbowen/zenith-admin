import { resetMockCmsRevisions } from './utils/cms-revisions';
import { resetMockCmsReleases } from './handlers/cms-releases';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnyOperation } from '@zenith/shared/core';
import { bizLeaveContract } from '@zenith/shared/biz';
import { cmsContentContract } from '@zenith/shared/cms';
import { SEED_WORKFLOW_DEFINITIONS } from '@zenith/shared/seed';
import { workflowBusinessContextSchema, workflowBusinessPreviewSchema, workflowDefinitionContract, workflowDefinitionOptionSchema, workflowInstanceContract, workflowTaskContract } from '@zenith/shared/workflow';
import { mockBizLeaves } from './data/biz-leave';
import { mockCmsContents, mockCmsSites } from './data/cms';
import { mockWorkflowDefinitions, mockWorkflowInstances, mockWorkflowTasks } from './data/workflow';
import { bizLeaveHandlers } from './handlers/biz-leave';
import { cmsHandlers, cmsP3Handlers, cmsP6Handlers } from './handlers/cms';
import { cmsStage4Handlers } from './handlers/cms-stage4';
import { workflowHandlers } from './handlers/workflow';
import { mockAccessToken } from './utils/auth';

const handlers = [...bizLeaveHandlers, ...cmsHandlers, ...cmsP3Handlers, ...cmsP6Handlers, ...cmsStage4Handlers, ...workflowHandlers];
const stores = [mockBizLeaves, mockCmsContents, mockCmsSites, mockWorkflowDefinitions, mockWorkflowInstances, mockWorkflowTasks];
const snapshots = stores.map((store) => structuredClone(store));
afterEach(() => {
  resetMockCmsRevisions(); resetMockCmsReleases();
  stores.forEach((store, index) => { (store as unknown[]).splice(0, store.length, ...structuredClone(snapshots[index])); });
});

async function call(operation: AnyOperation, options: { params?: Record<string, number>; query?: Record<string, number>; body?: unknown } = {}) {
  let path = operation.fullPath;
  for (const [key, value] of Object.entries(options.params ?? {})) path = path.replace(`{${key}}`, String(value));
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, String(value));
  for (const handler of handlers) {
    const request = new Request(url, {
      method: operation.method.toUpperCase(), headers: { 'content-type': 'application/json', authorization: `Bearer ${mockAccessToken('admin')}` },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const result = await (handler as unknown as { run(args: unknown): Promise<{ response?: Response } | null> }).run({ request, requestId: `business-flow-${Math.random()}` });
    if (result?.response) return { status: result.response.status, body: await result.response.json() };
  }
  throw new Error(`No handler matched ${operation.method} ${path}`);
}

describe('business workflow integration in Demo', () => {
  it('includes external and disabled definitions in lookup without exposing full designs or enabling direct launch', async () => {
    const external = mockWorkflowDefinitions.find((definition) => definition.formType === 'external')!;
    external.status = 'disabled';
    const options = await call(workflowDefinitionContract.all);
    expect(options.status).toBe(200);
    expect(options.body.data).toContainEqual({ id: external.id, name: external.name, status: 'disabled', formType: 'external' });
    for (const option of options.body.data) {
      expect(workflowDefinitionOptionSchema.parse(option)).toEqual(option);
      expect(Object.keys(option).sort()).toEqual(['formType', 'id', 'name', 'status']);
    }
    external.status = 'published';
    const published = await call(workflowDefinitionContract.published);
    expect(published.body.data.some((definition: { id: number }) => definition.id === external.id)).toBe(false);
    const refreshed = await call(workflowDefinitionContract.all);
    expect(refreshed.body.data.filter((definition: { status: string; formType: string }) => definition.status === 'published' && definition.formType === 'external'))
      .toContainEqual({ id: external.id, name: external.name, status: 'published', formType: 'external' });
  });

  it('derives pending definition options from my running tasks, including disabled external definitions and deduplicating tasks', async () => {
    const definition = mockWorkflowDefinitions.find((item) => item.formType === 'external')!;
    definition.status = 'disabled';
    const instance = mockWorkflowInstances[0];
    instance.status = 'running';
    instance.definitionId = definition.id;
    const task = { ...mockWorkflowTasks[0], instanceId: instance.id, assigneeId: 1, status: 'pending' as const };
    mockWorkflowTasks.splice(0, mockWorkflowTasks.length, task, { ...task, id: task.id + 10000 });
    const options = await call(workflowInstanceContract.pendingDefinitionOptions);
    expect(options.body.data).toEqual([{ id: definition.id, name: definition.name, status: 'disabled', formType: 'external' }]);
    mockWorkflowTasks.forEach((item) => { item.assigneeId = 2; });
    expect((await call(workflowInstanceContract.pendingDefinitionOptions)).body.data).toEqual([]);
    mockWorkflowTasks.forEach((item) => { item.assigneeId = 1; });
    instance.status = 'approved';
    expect((await call(workflowInstanceContract.pendingDefinitionOptions)).body.data).toEqual([]);
    instance.status = 'running';
    mockWorkflowTasks.forEach((item) => { item.status = 'approved'; });
    expect((await call(workflowInstanceContract.pendingDefinitionOptions)).body.data).toEqual([]);
  });

  it('derives both external definitions from shared seed and previews without saving', async () => {
    for (const seed of SEED_WORKFLOW_DEFINITIONS) {
      const definition = mockWorkflowDefinitions.find((item) => item.name === seed.name && item.formType === 'external');
      expect(definition?.flowData).toEqual(seed.flowData);
      expect(definition?.customForm).toEqual(seed.customForm);
    }
    const counts = [mockBizLeaves.length, mockWorkflowInstances.length, mockWorkflowTasks.length];
    const result = await call(bizLeaveContract.workflowPreview, { body: { days: 2, leaveType: 'annual' } });
    expect(result.status).toBe(200);
    const preview = workflowBusinessPreviewSchema.parse(result.body.data);
    expect(preview.definition?.name).toBe('请假审批');
    expect(preview.nodes[0]).toMatchObject({ nodeKey: 'approve_admin', approvers: [{ id: 1 }] });
    expect([mockBizLeaves.length, mockWorkflowInstances.length, mockWorkflowTasks.length]).toEqual(counts);
  });

  it('preserves earlier approval rounds after reopen and rejects unrelated business keys', async () => {
    const leave = mockBizLeaves.find((item) => item.status === 'draft')!;
    await call(bizLeaveContract.submit, { params: { id: leave.id } });
    const previousId = leave.workflowInstanceId!;
    const task = mockWorkflowTasks.find((item) => item.instanceId === previousId)!;
    expect(task.assigneeId).toBe(1);
    await call(workflowTaskContract.reject, { params: { taskId: task.id }, body: { comment: '请补充事由' } });
    expect(leave.status).toBe('rejected');
    await call(bizLeaveContract.reopen, { params: { id: leave.id } });
    const reopened = workflowBusinessContextSchema.parse((await call(bizLeaveContract.workflowContext, { params: { id: leave.id } })).body.data);
    expect(reopened.instance).toBeNull();
    expect(reopened.previousInstances[0].id).toBe(previousId);
    await call(bizLeaveContract.submit, { params: { id: leave.id } });
    expect(leave.workflowInstanceId).not.toBe(previousId);
    const context = workflowBusinessContextSchema.parse((await call(bizLeaveContract.workflowContext, { params: { id: leave.id } })).body.data);
    expect(context.instance?.id).toBe(leave.workflowInstanceId);
    expect(context.previousInstances.map((instance) => instance.id)).toEqual([leave.workflowInstanceId, previousId]);
    expect((await call(bizLeaveContract.approvalDetail, { params: { id: leave.id }, query: { instanceId: previousId } })).status).toBe(200);
    expect((await call(bizLeaveContract.approvalDetail, { params: { id: 1 }, query: { instanceId: previousId } })).status).toBe(404);
    expect((await call(bizLeaveContract.approvalDetail, { params: { id: leave.id } })).status).toBe(400);
  });

  it('keeps simple CMS review independent and creates an instance for workflow review', async () => {
    const content = mockCmsContents[0];
    const site = mockCmsSites.find((item) => item.id === content.siteId)!;
    content.status = 'draft'; content.editorialStatus = 'draft';
    site.settings.auditMode = 'simple';
    const previewBody = { siteId: content.siteId, channelId: content.channelId, title: content.title };
    expect((await call(cmsContentContract.workflowPreview, { body: previewBody })).body.data).toEqual({ definition: null, nodes: [] });
    const before = mockWorkflowInstances.length;
    await call(cmsContentContract.submit, { params: { id: content.id }, body: { expectedVersion: content.version } });
    expect(mockWorkflowInstances).toHaveLength(before);
    content.status = 'draft'; content.editorialStatus = 'draft';
    site.settings.auditMode = 'workflow';
    const preview = workflowBusinessPreviewSchema.parse((await call(cmsContentContract.workflowPreview, { body: previewBody })).body.data);
    expect(preview.definition?.name).toBe('CMS 内容审核');
    expect(preview.nodes[0].nodeKey).toBe('approve_editor');
    expect((await call(cmsContentContract.submit, { params: { id: content.id }, body: { expectedVersion: content.version } })).status).toBe(200);
    const context = workflowBusinessContextSchema.parse((await call(cmsContentContract.workflowContext, { params: { id: content.id } })).body.data);
    expect(context.instance?.bizType).toBe('cms_content');
    expect(context.instance?.tasks?.[0].assigneeId).toBe(1);
    expect((await call(cmsContentContract.publish, { params: { id: content.id }, body: { expectedVersion: content.version } })).status).toBe(400);
    expect((await call(cmsContentContract.reject, { params: { id: content.id }, body: { reason: '不能绕过流程', expectedVersion: content.version } })).status).toBe(400);
    expect((await call(workflowTaskContract.approve, { params: { taskId: context.instance!.tasks![0].id }, body: { signature: { source: 'drawn', dataUrl: 'data:image/png;base64,c2lnbmF0dXJl' } } })).status).toBe(200);
    expect(content.status).toBe('draft');
    expect(content.editorialStatus).toBe('approved');
    await vi.waitFor(() => expect(content.status).toBe('published'));
    expect((await call(cmsContentContract.approvalDetail, { params: { id: content.id }, query: { instanceId: context.instance!.id } })).status).toBe(200);
  });

  it('reports unusable CMS workflow configuration without submitting content', async () => {
    const content = mockCmsContents[0];
    const site = mockCmsSites.find((item) => item.id === content.siteId)!;
    content.status = 'draft'; content.editorialStatus = 'draft';
    site.settings.auditMode = 'workflow';
    site.settings.auditWorkflowDefinitionId = 1; // A designer form cannot accept a business submission.
    const before = mockWorkflowInstances.length;
    expect((await call(cmsContentContract.workflowPreview, { body: { siteId: content.siteId, channelId: content.channelId } })).status).toBe(400);
    expect((await call(cmsContentContract.submit, { params: { id: content.id }, body: { expectedVersion: content.version } })).status).toBe(400);
    const batch = await call(cmsContentContract.batchStatus, { body: { ids: [content.id], expectedVersions: { [String(content.id)]: content.version }, action: 'submit' } });
    expect(batch.body.data.failed[0].reason).toContain('未找到已发布');
    expect(content.status).toBe('draft');
    expect(mockWorkflowInstances).toHaveLength(before);
  });

  it('creates CMS workflows for batch submission and restores preview after withdrawal', async () => {
    const contents = mockCmsContents.slice(0, 2);
    for (const content of contents) {
      content.status = 'draft'; content.editorialStatus = 'draft';
      mockCmsSites.find((site) => site.id === content.siteId)!.settings.auditMode = 'workflow';
    }
    const result = await call(cmsContentContract.batchStatus, { body: { ids: contents.map((content) => content.id), expectedVersions: Object.fromEntries(contents.map((content) => [String(content.id), content.version])), action: 'submit' } });
    expect(result.body.data.okIds).toHaveLength(2);
    for (const content of contents) {
      const context = workflowBusinessContextSchema.parse((await call(cmsContentContract.workflowContext, { params: { id: content.id } })).body.data);
      expect(context.instance?.tasks).toHaveLength(1);
      await call(workflowInstanceContract.withdraw, { params: { id: context.instance!.id } });
      expect(content.status).toBe('draft');
      const reopened = workflowBusinessContextSchema.parse((await call(cmsContentContract.workflowContext, { params: { id: content.id } })).body.data);
      expect(reopened.instance).toBeNull();
      expect(reopened.previousInstances[0].status).toBe('withdrawn');
    }
  });
});
