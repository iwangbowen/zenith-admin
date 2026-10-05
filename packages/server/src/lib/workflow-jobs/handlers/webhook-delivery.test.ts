import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowJobContext, WorkflowJobHandler } from '../types';

const mocks = vi.hoisted(() => ({
  handler: undefined as WorkflowJobHandler | undefined,
  subscription: {} as Record<string, unknown>, post: vi.fn(), invoke: vi.fn(), getConnector: vi.fn(), secret: vi.fn(),
}));
vi.mock('../../../db', () => ({ db: { select: () => ({ from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: async () => [mocks.subscription] }) } }));
vi.mock('../registry', () => ({ registerJobHandler: (_type: string, handler: WorkflowJobHandler) => { mocks.handler = handler; } }));
vi.mock('../../../services/workflow/workflow-connectors.service', () => ({ invokeConnector: mocks.invoke, getConnectorRowById: mocks.getConnector }));
vi.mock('../../../services/workflow/workflow-event-subscriptions.service', () => ({ requireSubscriptionSigningSecret: mocks.secret }));
vi.mock('../../workflow-outbound', () => ({ workflowHttpPost: mocks.post }));
import './webhook-delivery';
import { WorkflowJobPermanentError } from '../errors';

const event = { eventId: 'contract-approved', type: 'instance.approved', instanceId: 46, note: '合同批准' };
const context = { payload: { subscriptionId: 1, event }, attempt: 1, job: { id: 9 } } as unknown as WorkflowJobContext;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.subscription = { id: 1, enabled: true, signMode: 'hmacSha256', secretEncrypted: 'encrypted-key', url: '/contracts', connectorId: 7, headers: null };
  mocks.secret.mockReturnValue('signing-key');
  mocks.getConnector.mockResolvedValue({ id: 7, type: 'http', code: 'erp' });
  mocks.invoke.mockResolvedValue({ ok: true, status: 200, responseSnippet: '{"ok":true}' });
});

describe('webhook subscription signing', () => {
  it('signs the exact raw JSON body which the connector receives', async () => {
    await mocks.handler!(context);
    const request = mocks.invoke.mock.calls[0][1];
    expect(request.body).toBe(JSON.stringify(event));
    expect(request.path).toBe('/contracts');
    const signature = request.headers['X-Zenith-Signature'] as string;
    const timestamp = signature.match(/^t=(\d+),v1=/)![1];
    expect(signature).toBe(`t=${timestamp},v1=${createHmac('sha256', 'signing-key').update(`${timestamp}.${request.body}`).digest('hex')}`);
  });

  it('dead-letters an unusable HMAC configuration without sending unsigned data', async () => {
    mocks.secret.mockImplementation(() => { throw new Error('HMAC 签名密钥缺失或无法解密，已拒绝发送'); });
    await expect(mocks.handler!(context)).rejects.toBeInstanceOf(WorkflowJobPermanentError);
    expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('does not route an event through an IM or notification adapter', async () => {
    mocks.getConnector.mockResolvedValue({ id: 7, type: 'dingtalk', code: 'robot' });
    await expect(mocks.handler!(context)).rejects.toMatchObject({ permanent: true });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
