import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { RelationAccessContext } from '../platform/relations/types';
const state = vi.hoisted(() => ({ allowed: true, redacted: vi.fn() }));
vi.mock('../../lib/context', () => ({ hasPermission: async () => state.allowed, runWithCurrentUser: async (_user: unknown, fn: () => unknown) => fn() }));
vi.mock('../platform/relations/runtime', () => ({ assertRelationBudget: () => undefined }));
vi.mock('../platform/relations/providers/workflow-file.provider', () => ({ workflowVisibility: async () => undefined }));
vi.mock('./workflow-print-access', () => ({ workflowArchiveNeedsRedaction: state.redacted }));
import { workflowArchiveAnchorResolvers, workflowArchiveRelationProviders } from './workflow-archive-relations.service';

// Use real tenant SQL for assertions while keeping the global app/runtime outside this unit.
vi.mock('../../lib/tenant', async (original) => {
  const mod = await original<typeof import('../../lib/tenant')>();
  return { ...mod, tenantCondition: () => undefined };
});
vi.mock('../../config', () => ({ config: { multiTenantMode: true } }));
type Statement = { sql: string; params: unknown[] };
function capture(results: unknown[][] = []) {
  const tx = drizzle.mock({ casing: 'snake_case' }), statements: Statement[] = [];
  const select = tx.select.bind(tx);
  vi.spyOn(tx, 'select').mockImplementation((...args: unknown[]) => {
    const builder = Reflect.apply(select, tx, args), from = builder.from;
    builder.from = (...fromArgs: unknown[]) => {
      const query = Reflect.apply(from, builder, fromArgs);
      query.execute = async () => { statements.push(query.toSQL()); return results.shift() ?? []; };
      return query;
    };
    return builder;
  });
  const access: RelationAccessContext = { user: { userId: 9, username: 'viewer', roles: [], tenantId: 7 }, db: tx as unknown as RelationAccessContext['db'] };
  return { access, statements, tx };
}
const archived = (id: number) => ({ id, title: `Round ${id}`, tenantId: 7, initiatorId: 9, archivedAt: new Date(), definitionSnapshot: null, formSnapshot: null });
beforeEach(() => { state.allowed = true; state.redacted.mockReset().mockResolvedValue(false); });
describe('archive relation boundaries', () => {
  it('does not query without workflow access or with a malformed key', async () => {
    const { access, tx } = capture(); state.allowed = false;
    expect(await workflowArchiveAnchorResolvers[0].resolve({ type: 'workflow.archive', key: '1' }, access)).toBeNull();
    state.allowed = true;
    expect(await workflowArchiveAnchorResolvers[0].resolve({ type: 'workflow.archive', key: '1x' }, access)).toBeNull();
    expect(tx.select).not.toHaveBeenCalled();
  });
  it('hides an archived original when field access requires redaction', async () => {
    const { access } = capture([[archived(1)], []]); state.redacted.mockResolvedValue(true);
    expect(await workflowArchiveAnchorResolvers[0].resolve({ type: 'workflow.archive', key: '1' }, access)).toBeNull();
  });
  it('anchors through the restricted live file FK without disclosing its storage identity', async () => {
    const { access, statements } = capture([[archived(1)], []]);
    const result = await workflowArchiveAnchorResolvers[0].resolve({ type: 'workflow.archive', key: '1' }, access);
    expect(result).toEqual({ ref: { type: 'workflow.archive', key: '1' }, title: 'Round 1 · 审批归档件', tenantId: 7 });
    expect(statements[0].sql).toContain('"workflow_instances"."archive_file_id" = "managed_files"."id"');
    expect(statements[0].sql).toContain('"managed_files"."tenant_id" is not distinct from "workflow_instances"."tenant_id"');
    expect(statements[0].params).toEqual(expect.arrayContaining(['restricted', 'live', 1]));
  });
  it('uses the full business identity and visible-item cursor for earlier archives', async () => {
    const provider = workflowArchiveRelationProviders.find((item) => item.key === 'biz.leave.archives')!;
    const { access, statements } = capture([[archived(9), archived(8), archived(7), archived(6)], [], [], [], []]);
    state.redacted.mockResolvedValueOnce(true).mockResolvedValue(false);
    const result = await provider.list({ ref: { type: 'biz.leave', key: '3' }, title: 'Leave', tenantId: 7 }, { limit: 2, cursor: '10', access });
    expect(result.items.map((item) => item.ref.key)).toEqual(['8', '7']);
    expect(result.nextCursor).toBe('7'); expect(result.hasMore).toBe(true);
    expect(statements[0].params).toEqual(expect.arrayContaining(['biz_leave', '3', 7, 10]));
    expect(statements[0].sql).toContain('"workflow_instances"."id" <');
  });
});
