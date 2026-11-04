import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignatureInput, SignatureSnapshot } from '@zenith/shared/core';
import type { WorkflowFormField, WorkflowInstanceFormSnapshot, WorkflowNodeConfig } from '@zenith/shared/workflow';
import { approveWorkflowTaskSchema, batchApproveWorkflowTaskSchema, workflowNodeConfigSchema } from '@zenith/shared/workflow';

const { resolveSignature } = vi.hoisted(() => ({ resolveSignature: vi.fn() }));
vi.mock('../../../lib/workflow-identity', () => ({ workflowIdentity: () => ({ resolveSignature }) }));
import { clearWorkflowFormSignatures, resolveWorkflowFormSignatures, resolveWorkflowTaskSignature, signatureTaskValues } from './signatures';

const dataUrl = 'data:image/png;base64,AAAA';
const signed: SignatureSnapshot = { dataUrl, source: 'saved', signerId: 7, signerName: '签署人', signedAt: '2026-09-15 10:00:00', signatureId: 3, signatureVersion: 2 };
const input: SignatureInput = { source: 'saved', signatureId: 3, version: 2 };
const snapshot = (fields: WorkflowFormField[]): WorkflowInstanceFormSnapshot => ({ formType: 'designer', formId: 1, formName: '签署测试', fields, settings: null, customForm: null });
const field: WorkflowFormField = { key: 'sign', label: '本人签名', type: 'signature', signaturePolicy: 'reusable' };
const node = (signaturePolicy: WorkflowNodeConfig['signaturePolicy']): WorkflowNodeConfig => ({ key: 'approve', type: 'approve', label: '审核', signaturePolicy });

beforeEach(() => { resolveSignature.mockReset(); resolveSignature.mockResolvedValue(signed); });

describe('workflow signature evidence', () => {
  it('accepts only current signature inputs and rejects handwritten batch signatures', () => {
    expect(approveWorkflowTaskSchema.safeParse({ signature: input }).success).toBe(true);
    expect(approveWorkflowTaskSchema.safeParse({ signature: dataUrl }).success).toBe(false);
    expect(approveWorkflowTaskSchema.safeParse({ signature: signed }).success).toBe(false);
    expect(batchApproveWorkflowTaskSchema.safeParse({ taskIds: [1], signature: input }).success).toBe(true);
    expect(batchApproveWorkflowTaskSchema.safeParse({ taskIds: [1], signature: { source: 'drawn', dataUrl } }).success).toBe(false);
    expect(workflowNodeConfigSchema.safeParse({ ...node('none'), operations: ['signature'] }).success).toBe(false);
  });
  it('resolves signatures recursively in layout containers and nested detail rows', async () => {
    const form = snapshot([{ key: 'group', label: '分组', type: 'group', children: [
      { key: 'row', label: '分栏', type: 'row', columns: [{ span: 24, fields: [field] }] },
      { key: 'tabs', label: '标签', type: 'tabs', panes: [{ title: '明细', fields: [
        { key: 'items', label: '明细', type: 'detail', children: [field] },
      ] }] },
    ] }]);
    const result = await resolveWorkflowFormSignatures(form, { sign: input, items: [{ sign: input }], name: '资料' }, {}, { userId: 7, tenantId: 1 });
    expect(result).toEqual({ sign: signed, items: [{ sign: signed }], name: '资料' });
    expect(resolveSignature).toHaveBeenCalledTimes(2);
    expect(resolveSignature).toHaveBeenCalledWith(input, 'reusable', { userId: 7, tenantId: 1 });
  });

  it('preserves only the exact stored signature at the same field path', async () => {
    const form = snapshot([field]);
    const previous = { sign: signed };
    expect(await resolveWorkflowFormSignatures(form, structuredClone(previous), previous)).toEqual(previous);
    expect(resolveSignature).not.toHaveBeenCalled();
    await expect(resolveWorkflowFormSignatures(snapshot([{ ...field, signaturePolicy: 'handwritten' }]), previous, previous)).rejects.toMatchObject({ status: 400 });
    await expect(resolveWorkflowFormSignatures(form, { sign: signed })).rejects.toMatchObject({ status: 400 });
    await expect(resolveWorkflowFormSignatures(form, { sign: { ...signed, signerName: '伪造身份' } }, previous)).rejects.toMatchObject({ status: 400 });
    await expect(resolveWorkflowFormSignatures(form, { sign: { source: 'drawn', dataUrl, signerId: 999 } })).rejects.toMatchObject({ status: 400 });
  });

  it('revalidates replaced signatures and removes evidence when cloning to a new application', async () => {
    const form = snapshot([{ key: 'items', label: '明细', type: 'detail', children: [field] }]);
    const previous = { items: [{ sign: signed, count: 2 }] };
    await resolveWorkflowFormSignatures(form, { items: [{ sign: input, count: 2 }] }, previous);
    expect(resolveSignature).toHaveBeenCalledWith(input, 'reusable', undefined);
    expect(clearWorkflowFormSignatures(form, previous)).toEqual({ items: [{ count: 2 }] });
    expect(previous.items[0].sign).toEqual(signed);
  });

  it('enforces per-node batch policy and resolves each reusable task independently', async () => {
    await expect(resolveWorkflowTaskSignature(node('handwritten'), input, true)).rejects.toMatchObject({ status: 400 });
    await expect(resolveWorkflowTaskSignature(node('reusable'), undefined, true)).rejects.toMatchObject({ status: 400 });
    await expect(resolveWorkflowTaskSignature(node('reusable'), { source: 'drawn', dataUrl }, true)).rejects.toMatchObject({ status: 400 });
    expect(await resolveWorkflowTaskSignature(node('none'), input, true)).toBeUndefined();
    expect(resolveSignature).not.toHaveBeenCalled();
    await resolveWorkflowTaskSignature(node('reusable'), input, true);
    await resolveWorkflowTaskSignature(node('reusable'), input, true);
    expect(resolveSignature).toHaveBeenCalledTimes(2);
    await resolveWorkflowTaskSignature(node('handwritten'), { source: 'drawn', dataUrl }, false);
    expect(resolveSignature).toHaveBeenLastCalledWith({ source: 'drawn', dataUrl }, 'handwritten');
  });

  it('keeps the image and evidence in distinct task columns', () => {
    const value = signatureTaskValues(signed);
    expect(value.signature).toBe(dataUrl);
    expect(value.signatureEvidence).toEqual({ source: 'saved', signerId: 7, signerName: '签署人', signedAt: signed.signedAt, signatureId: 3, signatureVersion: 2 });
    expect(signatureTaskValues(undefined)).toEqual({ signature: null, signatureEvidence: null });
  });
});
