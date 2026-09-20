import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { mapWorkflowFormAttachments, workflowTaskAttachmentsSchema, type WorkflowFormField } from '@zenith/shared/workflow';
import type { DbExecutor } from '../../db/types';

const state = vi.hoisted(() => ({ retain: vi.fn(), release: vi.fn(), monitor: false, userId: 7,
  restricted: vi.fn(), upload: vi.fn(), db: {} as unknown }));
vi.mock('../../db', () => ({ get db() { return state.db; } }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: state.userId, tenantId: 1, username: 'test', roles: [] }), hasPermission: async () => state.monitor }));
vi.mock('../../lib/tenant', () => ({ tenantCondition: () => undefined, exactTenantCondition: () => undefined, getCreateTenantId: () => 1 }));
vi.mock('../files/file-gc.service', () => ({ retainManagedFiles: state.retain, releaseManagedFiles: state.release }));
vi.mock('../files/files.service', () => ({ getRestrictedFileForRead: state.restricted, uploadManagedFileFromBody: state.upload }));
vi.mock('../platform/relations/providers/workflow-file.provider', () => ({ workflowVisibility: async () => undefined }));

import { bindWorkflowAttachments, bindWorkflowFormAttachments, getWorkflowAttachmentSummary, listWorkflowAttachmentSummaries, uploadWorkflowAttachment } from './workflow-attachments.service';

const fileId = '018f6f8a-0900-7000-8000-000000000001';
const metadata = { id: fileId, name: 'server.pdf', size: 42, mimeType: 'application/pdf', uploaderId: 7 };
const inst = { id: 10, tenantId: 1, formSnapshot: null };
function executor(results: unknown[][]) {
  const wheres: SQL[] = [];
  const limits: number[] = [];
  const values: unknown[] = [];
  const chain: Record<string, unknown> = {};
  for (const key of ['from', 'innerJoin', 'orderBy', 'for', 'onConflictDoNothing', 'returning']) chain[key] = () => chain;
  chain.where = (where: SQL) => { wheres.push(where); return chain; };
  chain.limit = (limit: number) => { limits.push(limit); return chain; };
  chain.values = (value: unknown) => { values.push(value); return chain; };
  chain.then = (resolve: (value: unknown) => void) => resolve(results.shift() ?? []);
  return { db: { select: () => chain, insert: () => chain, delete: () => chain } as unknown as DbExecutor, wheres, limits, values, results };
}
const queryOf = (where: SQL) => new PgDialect({ casing: 'snake_case' }).sqlToQuery(where);
beforeEach(() => { vi.clearAllMocks(); state.monitor = false; state.userId = 7; });

describe('structured workflow attachment boundaries', () => {
  it('uploads into the authorized existing instance tenant, not the platform-wide session tenant', async () => {
    const fake = executor([[{ id: 10, tenantId: 9, initiatorId: 7, title: '申请', definitionSnapshot: null }], [], []]);
    state.db = fake.db;
    state.upload.mockResolvedValue({ id: fileId, directUrl: 'forbidden-public-url' });
    const file = { name: 'proof.pdf' };
    const result = await uploadWorkflowAttachment(file, 10);
    expect(state.upload).toHaveBeenCalledWith(file, { visibility: 'restricted', tenantId: 9 });
    expect(fake.values[0]).toEqual({ fileId, userId: 7, tenantId: 9 });
    expect(result.directUrl).toBeNull();
    expect(result.url).toContain('/uploads/');
  });

  it('rejects URL-only inputs and discards client-supplied metadata', () => {
    expect(workflowTaskAttachmentsSchema.safeParse([{ name: 'forged', url: 'https://example.com/file' }]).success).toBe(false);
    expect(workflowTaskAttachmentsSchema.parse([{ fileId, name: 'forged', url: 'https://example.com/file', size: 999 }])).toEqual([{ fileId }]);
  });

  it('binds only upload provenance and retains the actual inserted link using the action transaction', async () => {
    const fake = executor([[{ id: 20 }], [], [metadata], [{ id: 33, fileId }]]);
    const result = await bindWorkflowAttachments(fake.db, inst, { source: 'task', taskId: 20 }, [{ fileId }], 7);
    expect(result).toEqual([{ id: 33, fileId, name: 'server.pdf', size: 42, mimeType: 'application/pdf', url: '/api/workflows/attachments/33/content' }]);
    expect(state.retain).toHaveBeenCalledWith(fake.db, [fileId]);
    expect(fake.values[0]).toEqual([{ instanceId: 10, tenantId: 1, fileId, source: 'task', sourceKey: '20', taskId: 20, commentId: null, fieldKeys: [] }]);
    expect(queryOf(fake.wheres[2]).sql).toContain('"managed_files"."visibility"');
  });

  it('rejects another uploader, missing/reclaimed files and foreign task sources before retention', async () => {
    await expect(bindWorkflowAttachments(executor([[{ id: 20 }], [], [{ ...metadata, uploaderId: 8 }]]).db, inst,
      { source: 'task', taskId: 20 }, [{ fileId }], 7)).rejects.toMatchObject({ status: 400 });
    await expect(bindWorkflowAttachments(executor([[{ id: 20 }], [], []]).db, inst,
      { source: 'task', taskId: 20 }, [{ fileId }], 7)).rejects.toMatchObject({ status: 400 });
    await expect(bindWorkflowAttachments(executor([[]]).db, inst,
      { source: 'task', taskId: 99 }, [{ fileId }], 7)).rejects.toMatchObject({ status: 404 });
    expect(state.retain).not.toHaveBeenCalled();
  });

  it('keeps a file already bound to the same source without increasing the reference count', async () => {
    const fake = executor([[{ id: 20 }], [{ id: 33, fileId }], [{ ...metadata, uploaderId: 8 }]]);
    expect(await bindWorkflowAttachments(fake.db, inst, { source: 'task', taskId: 20 }, [{ fileId }, { fileId }], 7)).toHaveLength(1);
    expect(state.retain).not.toHaveBeenCalled();
  });

  it('releases removed form files within the same transaction and leaves arbitrary fields untouched', async () => {
    const fake = executor([[{ fileId }]]);
    const snapshot = { formType: 'designer' as const, formId: 1, formName: 'form', fields: [{ key: 'proof', type: 'attachment' as const, label: 'proof' }], settings: null, customForm: null };
    expect(await bindWorkflowFormAttachments(fake.db, inst, snapshot, { proof: [], arbitrary: [{ fileId }] }, 7)).toEqual({ proof: [], arbitrary: [{ fileId }] });
    expect(state.release).toHaveBeenCalledWith(fake.db, [fileId]);
  });

  it('filters hidden form fields in SQL before pagination without reading file contents', async () => {
    const viewer = { id: 10, tenantId: 1, initiatorId: 9, title: '申请', definitionSnapshot: { flowData: { nodes: [
      { data: { key: 'review', type: 'approve', fieldPermissions: { proof: 'hidden' } } },
    ] } } };
    const fake = executor([[viewer], [{ assigneeId: 7, nodeKey: 'review' }], []]);
    await listWorkflowAttachmentSummaries(10, { limit: 6, beforeId: 50 }, fake.db);
    const query = queryOf(fake.wheres[2]);
    expect(query.sql).toContain('not ("workflow_attachment_links"."field_keys" && array[');
    expect(query.params).toContain('proof');
    expect(query.params).toContain(50);
    expect(fake.limits.at(-1)).toBe(6);
    expect(state.restricted).not.toHaveBeenCalled();
  });

  it('does not widen a hidden source merely because its link id is known', async () => {
    const fake = executor([[{ instanceId: 10 }], [{ id: 10, tenantId: 1, initiatorId: 9, title: 'x', definitionSnapshot: null }], [], []]);
    await expect(getWorkflowAttachmentSummary(33, fake.db)).rejects.toMatchObject({ status: 404 });
    expect(state.restricted).not.toHaveBeenCalled();
  });
});

describe('declared attachment traversal', () => {
  it('handles nested layouts/detail rows while preserving field ancestry for authorization', async () => {
    const file: WorkflowFormField = { key: 'proof', type: 'attachment', label: '证明' };
    const fields: WorkflowFormField[] = [{ key: 'group', type: 'group', label: '分组', children: [
      { key: 'items', type: 'detail', label: '明细', children: [file] },
    ] }];
    const resolve = vi.fn(async (_value, _field, path, keys) => ({ path, keys }));
    const arbitrary = { fileId, url: 'https://example.com/private' };
    const result = await mapWorkflowFormAttachments(fields, { items: [{ proof: [{ fileId }] }], text: arbitrary }, resolve);
    expect(result).toEqual({ items: [{ proof: { path: '["items","0","proof"]', keys: ['group', 'items', 'proof'] } }], text: arbitrary });
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
