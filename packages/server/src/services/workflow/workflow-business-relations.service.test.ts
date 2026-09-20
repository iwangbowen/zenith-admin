import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { HTTPException } from 'hono/http-exception';
import { WORKFLOW_BUSINESS_ENTITY_TYPES } from '@zenith/shared/platform';
import { PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE } from '@zenith/shared/payment';
import type { JwtPayload } from '../../middleware/auth';
import type { RelationAccessContext, VisibleEntityAnchor } from '../platform/relations/types';

const state = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('../../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config')>();
  return { ...actual, config: { ...actual.config, multiTenantMode: true } };
});
vi.mock('../../lib/context', () => ({
  hasPermission: async (...codes: string[]) => codes.some((code) => state.permissions.has(code)),
  runWithCurrentUser: (_user: JwtPayload, run: () => unknown) => run(),
}));
// The participant predicate has its own integration/SQL tests. Keep this suite focused on applying it to both sides.
vi.mock('../platform/relations/providers/workflow-file.provider', async () => {
  const { workflowInstances } = await import('../../db/schema');
  return { workflowVisibility: vi.fn(async (access: RelationAccessContext) => state.permissions.has('workflow:instance:monitor')
    ? undefined : eq(workflowInstances.initiatorId, access.user.userId)) };
});

import { createWorkflowBusinessRelationProviders, workflowBusinessAnchorResolvers, workflowBusinessHistoryProvider } from './workflow-business-relations.service';

type Statement = { sql: string; params: unknown[] };
type ExecutableQuery = { execute: () => Promise<unknown[]>; toSQL: () => Statement };
const user: JwtPayload = { userId: 9, username: 'owner', roles: ['member'], tenantId: 7 };

function captureAccess(results: unknown[][] = [], principal = user) {
  const tx = drizzle.mock({ casing: 'snake_case' });
  const statements: Statement[] = [];
  const select = tx.select.bind(tx);
  vi.spyOn(tx, 'select').mockImplementation((...args: unknown[]) => {
    const builder = Reflect.apply(select, tx, args);
    const from = builder.from;
    builder.from = (...fromArgs: unknown[]) => {
      const query = Reflect.apply(from, builder, fromArgs) as ExecutableQuery;
      query.execute = async () => { statements.push(query.toSQL()); return results.shift() ?? []; };
      return query;
    };
    return builder;
  });
  return { access: { user: principal, db: tx as unknown as RelationAccessContext['db'] }, statements, tx };
}

function anchor(type: VisibleEntityAnchor['ref']['type'], tenantId: number | null = 7): VisibleEntityAnchor {
  return { ref: { type, key: '21' }, title: '业务单据', tenantId };
}
function instance(id: number) {
  return { id, title: `审批 #${id}`, serialNo: `WF-${id}`, status: 'approved', createdAt: new Date('2026-09-20T00:00:00Z') };
}
function source(bizType = 'biz_leave', bizId: string | null = '21', tenantId: number | null = 7) {
  return { id: 50, bizType, bizId, tenantId };
}
function expectBinding(statement: Statement, column: string, value: unknown, operator = '=') {
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped} ${operator} \\$(\\d+)`).exec(statement.sql);
  expect(match, `${column} ${operator} parameter missing`).not.toBeNull();
  expect(statement.params[Number(match![1]) - 1]).toEqual(value);
}
function getProvider(key: string, resolve = vi.fn(async (type: VisibleEntityAnchor['ref']['type'], key: string) => ({ ...anchor(type), ref: { type, key } }))) {
  const provider = createWorkflowBusinessRelationProviders(resolve).find((item) => item.key === key);
  if (!provider) throw new Error(`Missing provider: ${key}`);
  return { provider, resolve };
}

beforeEach(() => { state.permissions.clear(); vi.clearAllMocks(); });

describe('workflow business relation identities and scopes', () => {
  it('shares payment business identity and declares one target type per relation', () => {
    expect(WORKFLOW_BUSINESS_ENTITY_TYPES.find((item) => item.entityType === 'payment.recon-adjustment')?.bizType).toBe(PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE);
    const providers = createWorkflowBusinessRelationProviders(vi.fn());
    expect(providers).toHaveLength(7);
    expect(new Set(providers.map((item) => item.key)).size).toBe(7);
    for (const provider of providers) expect(provider.descriptor.targetTypes).toHaveLength(1);
  });

  it.each([user, { ...user, roles: ['super_admin'], tenantId: null }])('keeps leave anchors owner-only for $roles', async (principal) => {
    const { access, statements } = captureAccess([[{ id: 21, tenantId: principal.tenantId }]], principal);
    const result = await workflowBusinessAnchorResolvers[0].resolve({ type: 'biz.leave', key: '21' }, access);
    expect(result).toEqual({ ref: { type: 'biz.leave', key: '21' }, title: '请假申请 #21', tenantId: principal.tenantId });
    expectBinding(statements[0], '"biz_leaves"."id"', 21);
    expectBinding(statements[0], '"biz_leaves"."created_by"', 9);
    if (principal.tenantId !== null) expectBinding(statements[0], '"biz_leaves"."tenant_id"', 7);
    expect(statements[0].sql).not.toContain('"reason"');
  });

  it.each(['0', '-1', '01', '2147483648', '1.5', 'abc'])('rejects invalid leave key %s before reads', async (key) => {
    const { access, tx } = captureAccess();
    expect(await workflowBusinessAnchorResolvers[0].resolve({ type: 'biz.leave', key }, access)).toBeNull();
    expect(tx.select).not.toHaveBeenCalled();
  });

  it('returns no anchor for another owner or a missing leave', async () => {
    const { access } = captureAccess();
    expect(await workflowBusinessAnchorResolvers[0].resolve({ type: 'biz.leave', key: '21' }, access)).toBeNull();
  });

  it.each(WORKFLOW_BUSINESS_ENTITY_TYPES)('lists every $entityType round by exact business and tenant identity', async (business) => {
    state.permissions.add('workflow:instance:list');
    const { provider, resolve } = getProvider(`${business.entityType}.workflow-instances`);
    const { access, statements } = captureAccess([[instance(100), instance(80), instance(40)], [instance(40)]]);
    const first = await provider.list(anchor(business.entityType), { limit: 2, access });
    expect(resolve).toHaveBeenCalledWith(business.entityType, '21', access);
    expect(first.items.map((item) => item.ref.key)).toEqual(['100', '80']);
    expect(first).toMatchObject({ nextCursor: '80', hasMore: true });
    expect(first).not.toHaveProperty('total');
    expectBinding(statements[0], '"workflow_instances"."biz_type"', business.bizType);
    expectBinding(statements[0], '"workflow_instances"."biz_id"', '21');
    expectBinding(statements[0], '"workflow_instances"."tenant_id"', 7);
    expectBinding(statements[0], '"workflow_instances"."initiator_id"', 9);
    expect(statements[0].sql).toMatch(/order by "workflow_instances"\."id" desc limit \$\d+$/);
    expect(statements[0].params.at(-1)).toBe(3);
    expect(statements[0].sql).not.toMatch(/workflow_instance_id|form_data|definition_snapshot|offset/);
    const second = await provider.list(anchor(business.entityType), { limit: 2, access, cursor: first.nextCursor! });
    expectBinding(statements[1], '"workflow_instances"."id"', 80, '<');
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('does not query rounds when workflow access is absent', async () => {
    const { provider, resolve } = getProvider('biz.leave.workflow-instances');
    const { access, tx } = captureAccess();
    expect(await provider.list(anchor('biz.leave'), { limit: 2, access })).toEqual({ items: [], hasMore: false, nextCursor: null });
    expect(resolve).not.toHaveBeenCalled();
    expect(tx.select).not.toHaveBeenCalled();
  });

  it('rejects stale or mismatched business source anchors', async () => {
    state.permissions.add('workflow:instance:list');
    const resolve = vi.fn(async () => anchor('biz.leave', 8));
    const { provider } = getProvider('biz.leave.workflow-instances', resolve);
    const { access, tx } = captureAccess();
    await expect(provider.list(anchor('biz.leave'), { limit: 2, access })).rejects.toMatchObject({ status: 404 });
    expect(tx.select).not.toHaveBeenCalled();
  });

  it('keeps platform business histories bound to null tenant under all-tenant monitoring', async () => {
    state.permissions.add('workflow:instance:monitor');
    const { provider } = getProvider('cms.content.workflow-instances', vi.fn(async () => anchor('cms.content', null)));
    const { access, statements } = captureAccess([], { ...user, roles: ['super_admin'], tenantId: null });
    await provider.list(anchor('cms.content', null), { limit: 2, access });
    expect(statements[0].sql).toContain('"workflow_instances"."tenant_id" is null');
    expect(statements[0].sql).not.toContain('"initiator_id"');
  });

  it.each(WORKFLOW_BUSINESS_ENTITY_TYPES)('returns from $bizType only through the business target resolver', async (business) => {
    state.permissions.add('workflow:task:handle');
    const { provider, resolve } = getProvider(`workflow.instance.${business.reverseRelation}`);
    const { access, statements } = captureAccess([[source(business.bizType)]]);
    const result = await provider.list(anchor('workflow.instance'), { limit: 2, access });
    expect(resolve).toHaveBeenCalledWith(business.entityType, '21', access);
    expect(result.items).toMatchObject([{ ref: { type: business.entityType, key: '21' }, title: '业务单据' }]);
    expectBinding(statements[0], '"workflow_instances"."tenant_id"', 7);
    expectBinding(statements[0], '"workflow_instances"."initiator_id"', 9);
    expect(statements[0].sql).not.toMatch(/form_data|definition_snapshot/);
  });

  it.each([source('unregistered'), source('biz_leave', null), source('biz_leave', '01')])('ignores absent, unknown or malformed business identity', async (row) => {
    state.permissions.add('workflow:instance:list');
    const { provider, resolve } = getProvider('workflow.instance.business-leave');
    const { access } = captureAccess([[row]]);
    expect((await provider.list(anchor('workflow.instance'), { limit: 2, access })).items).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('does not disclose a cross-tenant business even for a workflow monitor', async () => {
    state.permissions.add('workflow:instance:monitor');
    const { provider } = getProvider('workflow.instance.business-leave', vi.fn(async () => anchor('biz.leave', 8)));
    const { access } = captureAccess([[source()]], { ...user, roles: ['super_admin'], tenantId: null });
    expect((await provider.list(anchor('workflow.instance'), { limit: 2, access })).items).toEqual([]);
  });

  it('hides a forbidden business target and propagates infrastructure errors', async () => {
    state.permissions.add('workflow:instance:list');
    const resolve = vi.fn().mockRejectedValueOnce(new HTTPException(404)).mockRejectedValueOnce(new Error('Database unavailable'));
    const { provider } = getProvider('workflow.instance.business-leave', resolve);
    const { access } = captureAccess([[source()], [source()]]);
    expect((await provider.list(anchor('workflow.instance'), { limit: 2, access })).items).toEqual([]);
    await expect(provider.list(anchor('workflow.instance'), { limit: 2, access })).rejects.toThrow('Database unavailable');
  });

  it('lists other rounds with the source business identity, excludes the source and reapplies participant visibility', async () => {
    state.permissions.add('workflow:instance:list');
    const { access, statements } = captureAccess([[source()], [instance(80), instance(40), instance(30)]]);
    const result = await workflowBusinessHistoryProvider.list(anchor('workflow.instance'), { limit: 2, cursor: '90', access });
    expect(result.items.map((item) => item.ref.key)).toEqual(['80', '40']);
    expect(result).toMatchObject({ nextCursor: '40', hasMore: true });
    expectBinding(statements[0], '"workflow_instances"."initiator_id"', 9);
    expectBinding(statements[1], '"workflow_instances"."biz_type"', 'biz_leave');
    expectBinding(statements[1], '"workflow_instances"."biz_id"', '21');
    expectBinding(statements[1], '"workflow_instances"."id"', 50, '<>');
    expectBinding(statements[1], '"workflow_instances"."id"', 90, '<');
    expectBinding(statements[1], '"workflow_instances"."tenant_id"', 7);
    expectBinding(statements[1], '"workflow_instances"."initiator_id"', 9);
    expect(statements[1].sql).not.toMatch(/workflow_instance_id|form_data|definition_snapshot/);
  });

  it('does not list history after source visibility is revoked', async () => {
    state.permissions.add('workflow:instance:list');
    const { access, statements } = captureAccess([[]]);
    expect((await workflowBusinessHistoryProvider.list(anchor('workflow.instance'), { limit: 2, access })).items).toEqual([]);
    expect(statements).toHaveLength(1);
  });

  it('rejects invalid history cursors before target reads', async () => {
    state.permissions.add('workflow:instance:list');
    const { access, statements } = captureAccess([[source()]]);
    await expect(workflowBusinessHistoryProvider.list(anchor('workflow.instance'), { limit: 2, cursor: '-1', access })).rejects.toMatchObject({ status: 400 });
    expect(statements).toHaveLength(1);
  });
});
