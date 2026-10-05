import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { workflowAutomationContract, workflowAutomationRunSchema, type WorkflowAutomationRun } from '@zenith/shared/workflow';
import { workflowAutomationsHandlers, mockWorkflowAutomationRuns } from './workflow-automations';

const server = setupServer(...workflowAutomationsHandlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => { mockWorkflowAutomationRuns.length = 0; });
const createUrl = new URL(workflowAutomationContract.create.fullPath, window.location.origin).href;
const create = (actions: unknown[]) => fetch(createUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ definitionId: 1, name: 'Demo 自动化模板校验', trigger: 'approved', actions }) });

describe('Demo automation contract', () => {
  it('accepts the canonical formData and system references using the Shared syntax boundary', async () => {
    const response = await create([{ type: 'startWorkflow', definitionId: 2, titleTemplate: '{{system.title}}验收',
      formMapping: { amount: '{{formData.amount}}', reviewers: '{{formData.reviewers}}' } }]);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.actions[0].formMapping.reviewers).toBe('{{formData.reviewers}}');
  });
  it('rejects flat business references and dynamic HTTP authorities with actionable errors', async () => {
    const flat = await create([{ type: 'updateField', fields: { amount: '{{amount}}' } }]);
    expect(flat.status).toBe(400);
    expect((await flat.json()).message).toContain('表单字段请使用 formData.字段');
    const authority = await create([{ type: 'webhook', url: 'https://{{formData.host}}/erp' }]);
    expect(authority.status).toBe(400);
    expect((await authority.json()).message).toContain('主机必须固定');
  });
  it('returns the created target fields without offering retries for a successful creation', async () => {
    const row: WorkflowAutomationRun = { id: 81, ruleId: 7, ruleName: '验收派生', instanceId: 10, instanceTitle: '采购源单',
      targetInstanceId: 30, targetTitle: '设备验收', trigger: 'approved', actionIndex: 0, actionType: 'startWorkflow',
      status: 'succeeded', eventId: 'event-demo', attempts: 1, maxAttempts: 5, nextRetryAt: null, canRetry: false,
      externalOutcomeUncertain: false, error: null, durationMs: 10, tenantId: 1, createdAt: '2026-10-06 04:00:00' };
    mockWorkflowAutomationRuns.push(row);
    const recordsUrl = new URL(workflowAutomationContract.runs.fullPath, window.location.origin);
    recordsUrl.searchParams.set('ruleId', '7');
    const response = await fetch(recordsUrl);
    const returned = (await response.json()).data.list[0];
    expect(workflowAutomationRunSchema.safeParse(returned).success).toBe(true);
    expect(returned).toMatchObject({ targetInstanceId: 30, targetTitle: '设备验收', status: 'succeeded' });
    const retryUrl = new URL(workflowAutomationContract.retryRun.fullPath.replace('{id}', '81'), window.location.origin);
    expect((await fetch(retryUrl, { method: 'POST' })).status).toBe(409);
    expect(row.status).toBe('succeeded');
  });
});
