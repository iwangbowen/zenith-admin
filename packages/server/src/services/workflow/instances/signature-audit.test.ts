import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import type { JwtPayload } from '../../../middleware/auth';

const { insertLog } = vi.hoisted(() => ({ insertLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../config', () => ({ config: { multiTenantMode: false, redis: { keyPrefix: 'test:' }, log: { level: 'silent', dir: 'logs', maxFiles: '30d' } } }));
vi.mock('../../../db', () => ({ db: { insert: () => ({ values: insertLog }) } }));
vi.mock('../../../lib/permissions', () => ({ isSuperAdmin: vi.fn(), getUserPermissions: vi.fn() }));
vi.mock('../../../lib/licensing', () => ({ assertFeatureEnabled: vi.fn() }));
vi.mock('../../../lib/ip-location', () => ({ lookupIpLocation: () => '内网' }));
vi.mock('../../../lib/request-helpers', () => ({ getClientIp: () => '127.0.0.1', getPlatformVersion: () => null, parseUserAgent: () => ({ browser: 'test', os: 'test' }) }));
import { workflowInstanceContract, workflowInstanceOpsContract, workflowTaskContract } from '@zenith/shared/workflow';
import { guard, setAuditAfterData } from '../../../middleware/guard';
import { redactWorkflowSignatureImages } from './signature-audit';

describe('workflow signature audit', () => {
  it('redacts nested form and task image bytes while preserving signature evidence', () => {
    const value = { formData: { rows: [{ sign: { dataUrl: 'data:image/png;base64,AAAA', source: 'saved', signerId: 4, signatureVersion: 2 } }] }, tasks: [{ signature: 'data:image/png;base64,BBBB', signatureEvidence: { signerName: '用户', signedAt: '2026-09-15 10:00:00' } }] };
    const audit = redactWorkflowSignatureImages(value);
    expect(JSON.stringify(audit)).not.toContain('base64');
    expect(audit.formData.rows[0].sign).toMatchObject({ source: 'saved', signerId: 4, signatureVersion: 2 });
    expect(audit.tasks[0].signatureEvidence).toEqual(value.tasks[0].signatureEvidence);
    expect(value.tasks[0].signature).toContain('base64');
  });

  it('never records request/response bodies from signature writes', () => {
    for (const operation of [workflowInstanceContract.create, workflowInstanceContract.updateDraft, workflowInstanceContract.submitDraft, workflowTaskContract.approve, workflowTaskContract.batchApprove]) {
      expect(operation.audit).toMatchObject({ recordBody: false, recordResponseBody: false });
    }
    for (const operation of [workflowInstanceContract.withdraw, workflowInstanceContract.cancel, workflowTaskContract.reject, workflowInstanceOpsContract.suspend, workflowInstanceOpsContract.resume]) {
      expect(operation.audit).toMatchObject({ recordResponseBody: false });
    }
  });

  it('keeps PNG out of automatic afterData fallback while returning it to the caller', async () => {
    insertLog.mockClear();
    const image = 'data:image/png;base64,AAAA';
    const responseData = { signature: image, signatureEvidence: { signerId: 4, signatureVersion: 2 } };
    const app = new Hono<{ Variables: { user: JwtPayload } }>();
    app.use('*', contextStorage());
    app.use('*', async (c, next) => { c.set('user', { userId: 4, username: 'signer', roles: ['user'], tenantId: null }); await next(); });
    app.post('/signed', guard({ audit: { description: '审批通过', recordBody: false, recordResponseBody: false } }), (c) => {
      setAuditAfterData(c, redactWorkflowSignatureImages(responseData));
      return c.json({ code: 0, data: responseData, message: 'ok' });
    });
    const response = await app.request('/signed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signature: { source: 'drawn', dataUrl: image } }) });
    expect((await response.json()).data.signature).toBe(image);
    await vi.waitFor(() => expect(insertLog).toHaveBeenCalled());
    const logged = insertLog.mock.calls[0][0];
    expect(logged.requestBody).toBeNull();
    expect(logged.responseBody).toBeNull();
    expect(logged.afterData).not.toContain('base64');
    expect(JSON.parse(logged.afterData).signatureEvidence).toEqual(responseData.signatureEvidence);
  });
});
