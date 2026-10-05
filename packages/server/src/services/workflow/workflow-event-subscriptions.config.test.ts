import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptSecret } from '../../lib/secret-crypto';

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  writes: [] as Record<string, unknown>[],
  ensureConnector: vi.fn(), safeUrl: vi.fn(), post: vi.fn(), invoke: vi.fn(), getConnector: vi.fn(),
}));
vi.mock('../../config', () => ({ config: { fieldEncryptionKey: 'ab'.repeat(32) } }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 1, roles: ['super_admin'], tenantId: null }) }));
vi.mock('../../lib/http-client', () => ({ httpRequest: vi.fn() }));
vi.mock('../../db', () => ({ db: {
  select: () => ({ from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: async () => state.row ? [state.row] : [] }),
  insert: () => ({ values: (values: Record<string, unknown>) => {
    state.writes.push(values);
    state.row = { id: 1, createdBy: 1, updatedBy: 1, createdAt: new Date(), updatedAt: new Date(), ...values };
    return { returning: async () => [state.row] };
  } }),
  update: () => ({ set: (patch: Record<string, unknown>) => {
    state.writes.push(patch); state.row = { ...state.row, ...patch };
    return { where: () => ({ returning: async () => [state.row] }) };
  } }),
} }));
vi.mock('../../lib/workflow-outbound', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/workflow-outbound')>();
  return { ...actual, assertSafeWorkflowUrl: state.safeUrl, workflowHttpPost: state.post };
});
vi.mock('../../lib/workflow-jobs/engine', () => ({ retryJob: vi.fn(), enqueueJob: vi.fn(), scheduleJobPickup: vi.fn() }));
vi.mock('./workflow-connectors.service', () => ({ ensureConnector: state.ensureConnector, invokeConnector: state.invoke, getConnectorRowById: state.getConnector }));

import { createSubscription, getSubscriptionSecret, updateSubscription, testSubscriptionDelivery, requireSubscriptionSigningSecret } from './workflow-event-subscriptions.service';

const input = { name: '合同归档', events: ['instance.approved' as const], url: 'https://1.1.1.1/events', enabled: false };
const connector = { id: 7, type: 'http', code: 'erp', config: { baseUrl: 'https://1.1.1.1/v1', query: { source: 'workflow' } } };
beforeEach(() => {
  vi.clearAllMocks(); state.row = null; state.writes = [];
  state.ensureConnector.mockResolvedValue(connector);
  state.safeUrl.mockImplementation(async (url: string) => new URL(url));
});

describe('subscription HMAC configuration', () => {
  it('generates a 32-byte random key, encrypts it and only returns a mask publicly', async () => {
    const first = await createSubscription({ ...input, secret: '' });
    const firstSecret = (await getSubscriptionSecret(first.id)).secret!;
    expect(Buffer.from(firstSecret, 'base64url')).toHaveLength(32);
    expect(firstSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.secretMasked).toBe(`${firstSecret.slice(0, 4)}****${firstSecret.slice(-4)}`);
    expect(JSON.stringify(first)).not.toContain(firstSecret);
    expect(state.row?.secretEncrypted).not.toBe(firstSecret);
    expect(decryptSecret(state.row?.secretEncrypted as string)).toBe(firstSecret);
    await createSubscription(input);
    expect((await getSubscriptionSecret(1)).secret).not.toBe(firstSecret);
  });

  it('preserves the encrypted key on an empty edit and generates when none changes to HMAC', async () => {
    await createSubscription({ ...input, secret: 'operator-supplied-key' });
    const encrypted = state.row?.secretEncrypted;
    await updateSubscription(1, { description: '归档地址不变', secret: '' });
    expect(state.row?.secretEncrypted).toBe(encrypted);
    await createSubscription({ ...input, signMode: 'none', secret: null });
    expect(state.row?.secretEncrypted).toBeNull();
    await updateSubscription(1, { signMode: 'hmacSha256', secret: '' });
    expect(Buffer.from((await getSubscriptionSecret(1)).secret!, 'base64url')).toHaveLength(32);
  });

  it('repairs an unusable saved HMAC key when the subscription is edited', async () => {
    await createSubscription(input); state.row!.secretEncrypted = 'corrupt-ciphertext';
    expect(() => requireSubscriptionSigningSecret('corrupt-ciphertext')).toThrow('已拒绝发送');
    await updateSubscription(1, { description: '重新配置' });
    expect((await getSubscriptionSecret(1)).secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('refuses test delivery with an absent or unreadable HMAC key before any external call', async () => {
    await createSubscription(input); state.row!.secretEncrypted = null;
    expect(await testSubscriptionDelivery(1)).toMatchObject({ ok: false, httpStatus: null, error: expect.stringContaining('已拒绝发送') });
    expect(state.post).not.toHaveBeenCalled(); expect(state.invoke).not.toHaveBeenCalled();
  });
});

describe('subscription connector target validation', () => {
  it.each(['http', 'webhook'])('resolves a %s connector-relative callback then checks its final URL', async (type) => {
    state.ensureConnector.mockResolvedValue({ ...connector, type });
    const result = await createSubscription({ ...input, url: '/contracts', connectorId: 7 });
    expect(result.url).toBe('/contracts');
    expect(state.ensureConnector).toHaveBeenCalledWith(7);
    expect(state.safeUrl).toHaveBeenCalledWith('https://1.1.1.1/v1/contracts?source=workflow');
  });

  it('permits a same-origin absolute callback and refuses a different origin', async () => {
    await createSubscription({ ...input, url: 'https://1.1.1.1/hooks/contracts', connectorId: 7 });
    expect(state.safeUrl).toHaveBeenCalledWith('https://1.1.1.1/hooks/contracts?source=workflow');
    const writes = state.writes.length;
    await expect(createSubscription({ ...input, url: 'https://8.8.8.8/hooks/contracts', connectorId: 7 })).rejects.toMatchObject({ status: 400 });
    expect(state.writes).toHaveLength(writes);
  });

  it('checks connector visibility before persisting a reference', async () => {
    state.ensureConnector.mockRejectedValue(Object.assign(new Error('连接器不存在'), { status: 404 }));
    await expect(createSubscription({ ...input, url: '/contracts', connectorId: 777 })).rejects.toMatchObject({ status: 404 });
    expect(state.writes).toHaveLength(0); expect(state.safeUrl).not.toHaveBeenCalled();
  });

  it('retains outbound protection for connector targets and rejects channel adapters', async () => {
    state.ensureConnector.mockResolvedValue({ ...connector, config: { baseUrl: 'http://localhost:5399' } });
    state.safeUrl.mockRejectedValue(Object.assign(new Error('出站地址不允许访问本机或内网主机'), { status: 400 }));
    await expect(createSubscription({ ...input, url: '/contracts', connectorId: 7 })).rejects.toMatchObject({ status: 400 });
    expect(state.safeUrl).toHaveBeenCalledWith('http://localhost:5399/contracts');
    expect(state.writes).toHaveLength(0);
    state.ensureConnector.mockResolvedValue({ ...connector, type: 'feishu' });
    await expect(createSubscription({ ...input, url: '/contracts', connectorId: 7 })).rejects.toMatchObject({ status: 400 });
  });

  it('validates the merged update and refuses clearing the connector while retaining a relative URL', async () => {
    await createSubscription({ ...input, url: '/contracts', connectorId: 7 });
    const writes = state.writes.length;
    await expect(updateSubscription(1, { connectorId: null })).rejects.toMatchObject({ status: 400 });
    expect(state.writes).toHaveLength(writes);
    await updateSubscription(1, { url: 'https://1.1.1.1/contracts', connectorId: null });
    expect(state.row).toMatchObject({ url: 'https://1.1.1.1/contracts', connectorId: null });
  });
});
