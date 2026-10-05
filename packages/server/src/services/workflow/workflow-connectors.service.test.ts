import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';

const mocks = vi.hoisted(() => ({
  results: [] as unknown[][],
  where: vi.fn(), insertValues: vi.fn(), http: vi.fn(), mail: vi.fn(), sms: vi.fn(),
  breakerFailure: vi.fn(), breakerSuccess: vi.fn(),
}));

vi.mock('../../db', () => ({
  db: {
    select: () => {
      const chain = {
        from: () => chain,
        where: (condition: unknown) => { mocks.where(condition); return chain; },
        orderBy: () => chain,
        limit: async () => mocks.results.shift() ?? [],
      };
      return chain;
    },
    insert: () => ({ values: mocks.insertValues }),
  },
}));
vi.mock('../../lib/workflow-outbound', () => ({
  workflowHttp: mocks.http, assertSafeWorkflowUrl: vi.fn(),
  buildConnectorUrl: (base: string, path?: string) => path ? `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}` : base,
}));
vi.mock('../../lib/email', () => ({ sendMail: mocks.mail }));
vi.mock('../../lib/sms-sender', () => ({ sendSmsByProvider: mocks.sms, renderTemplate: () => '采购已批准' }));
vi.mock('../../lib/workflow-connector-breaker', () => ({
  breakerAllow: async () => ({ allowed: true }), breakerSuccess: mocks.breakerSuccess,
  breakerFailure: mocks.breakerFailure, breakerState: async () => 'closed', breakerReset: vi.fn(),
}));
vi.mock('../../lib/workflow-connector-rate-limit', () => ({ rateLimitAcquire: async () => ({ allowed: true }), rateLimitReset: vi.fn() }));
vi.mock('../../lib/workflow-jobs/external-effects', () => ({ markWorkflowExternalEffect: vi.fn() }));
vi.mock('../../lib/workflow-jobs/execution-context', () => ({ currentWorkflowJobContext: () => undefined }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 1, tenantId: 7 }) }));
vi.mock('../../lib/tenant', () => ({
  tenantCondition: () => undefined,
  currentCreateTenantId: () => 7,
  inheritedTenantCondition: (column: unknown, tenantId: number | null) => sql`${column} = ${tenantId} or ${column} is null`,
}));
vi.mock('../../lib/encryption', () => ({ encryptField: (x: string) => x, decryptField: (x: string) => x }));

import { invokeConnector } from './workflow-connectors.service';
import type { WorkflowConnectorRow } from '../../db/schema';

function connector(type: WorkflowConnectorRow['type'], config: Record<string, unknown>): WorkflowConnectorRow {
  return {
    id: 42, name: '测试连接器', code: 'test-connector', type, config, description: null,
    credentialsEncrypted: null, timeoutMs: 10000, retryMax: 0, circuitBreakerEnabled: true,
    failureThreshold: 5, cooldownSec: 60, rateLimitEnabled: false, rateLimitWindowSec: 60,
    rateLimitMax: 0, status: 'enabled', tenantId: 7, createdBy: 1, updatedBy: 1,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.results.length = 0;
  mocks.insertValues.mockResolvedValue(undefined);
  mocks.mail.mockResolvedValue(undefined);
  mocks.sms.mockResolvedValue({ success: true });
  mocks.http.mockResolvedValue({ ok: true, status: 200, text: async () => '{"ok":true}' });
});

describe('connector channel adapters', () => {
  it('uses email channel settings and caller message without an HTTP request', async () => {
    const result = await invokeConnector(connector('email', { to: 'finance@example.com', subject: '付款审批通过' }), { body: '报销单已批准', source: 'test' });
    expect(result.ok).toBe(true);
    expect(mocks.mail).toHaveBeenCalledWith('finance@example.com', '付款审批通过', '报销单已批准');
    expect(mocks.http).not.toHaveBeenCalled();
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({ connectorId: 42, source: 'test', ok: true }));
  });

  it('uses the selected SMS template and a matching provider within the connector tenant', async () => {
    const template = { id: 5, code: 'purchase-approved', provider: 'aliyun', content: '采购已批准', tenantId: 7 };
    const config = { id: 9, provider: 'aliyun', tenantId: 7 };
    mocks.results.push([template], [config]);
    const result = await invokeConnector(connector('sms', { phone: '13800000000', templateCode: 'purchase-approved' }), { body: { orderNo: 'PO-202610' } });
    expect(result.ok).toBe(true);
    expect(mocks.sms).toHaveBeenCalledWith(expect.objectContaining({ template, config, phone: '13800000000', variables: { orderNo: 'PO-202610' } }));
    const params = mocks.where.mock.calls.map(([condition]) => new PgDialect().sqlToQuery(condition as SQL).params);
    expect(params[0]).toContain(7);
    expect(params[1]).toContain(7);
    expect(params[1]).toContain('aliyun');
  });

  it('does not send SMS when the selected template is unavailable', async () => {
    mocks.results.push([]);
    const result = await invokeConnector(connector('sms', { phone: '13800000000', templateCode: 'missing-template' }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('短信模板不存在');
    expect(mocks.sms).not.toHaveBeenCalled();
  });

  it('encodes HTTP form data according to the saved request format', async () => {
    const result = await invokeConnector(connector('http', { baseUrl: 'https://erp.example.com', method: 'POST', contentType: 'form' }), {
      path: '/purchase', body: { amount: 1680, approved: false, items: [{ name: '办公电脑', count: 4 }] },
    });
    expect(result.ok).toBe(true);
    const [, options] = mocks.http.mock.calls[0];
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const fields = new URLSearchParams(options.body);
    expect(fields.get('amount')).toBe('1680');
    expect(fields.get('approved')).toBe('false');
    expect(JSON.parse(fields.get('items')!)).toEqual([{ name: '办公电脑', count: 4 }]);
  });

  it('applies saved authentication to IM webhook requests', async () => {
    const c = connector('wecom', { baseUrl: 'https://wecom.example.com/bot', authType: 'bearer' });
    c.credentialsEncrypted = JSON.stringify({ token: 'synthetic-test-token' });
    await invokeConnector(c, { body: '采购通过' });
    expect(mocks.http).toHaveBeenCalledWith('https://wecom.example.com/bot', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer synthetic-test-token' }),
      body: { msgtype: 'markdown', markdown: { content: '采购通过' } },
    }));
  });

  it('blocks a disabled connector and records the failure without sending', async () => {
    const c = connector('email', { to: 'finance@example.com', subject: '审批通过' });
    c.status = 'disabled';
    expect((await invokeConnector(c, { body: '不应发送' })).error).toBe('连接器已禁用');
    expect(mocks.mail).not.toHaveBeenCalled();
    expect(mocks.http).not.toHaveBeenCalled();
  });
});
