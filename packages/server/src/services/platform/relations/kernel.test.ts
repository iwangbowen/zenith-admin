import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { HTTPException } from 'hono/http-exception';
import type { SQL } from 'drizzle-orm';
import type { EntityRef } from '@zenith/shared/core';
import type { CanonicalEntityRef } from '@zenith/shared/platform';
import type { JwtPayload } from '../../../middleware/auth';
import type { EntityAnchorResolver, RelationAccessContext, RelationProvider, VisibleEntityAnchor } from './types';

const state = vi.hoisted(() => ({
  user: { userId: 9, username: 'reviewer', roles: ['reviewer'], tenantId: 7 } as JwtPayload,
  permissions: new Set<string>(),
  disabledFeatures: new Set<string>(),
  anchors: new Map<string, VisibleEntityAnchor>(),
  resolve: vi.fn(), list: vi.fn(), transaction: vi.fn(), metrics: vi.fn(), summaryMetrics: vi.fn(), summaryTiming: vi.fn(), errorLog: vi.fn(), audit: vi.fn(),
}));
vi.mock('../../../config', () => ({ config: { multiTenantMode: true, jwtSecret: 'unit-test-relation-signing-secret' } }));
vi.mock('../../../db', () => ({ db: { transaction: state.transaction } }));
vi.mock('../../../lib/context', () => ({
  currentUser: () => state.user,
  hasPermission: async (...permissions: string[]) => permissions.some((permission) => state.permissions.has(permission)),
  runWithCurrentUser: async (user: JwtPayload, fn: () => unknown) => {
    const previous = state.user;
    state.user = user;
    try { return await fn(); } finally { state.user = previous; }
  },
  setAuditSubjects: state.audit,
}));
vi.mock('../../../lib/licensing', () => ({ isFeatureEnabled: async (key: string) => !state.disabledFeatures.has(key) }));
vi.mock('../../../lib/logger', () => ({ default: { error: state.errorLog } }));
vi.mock('./metrics', () => ({ recordRelationMetric: state.metrics, recordRelationSummaryState: state.summaryMetrics, recordRelationSummaryMetric: state.summaryTiming }));
vi.mock('./providers/payment-order.provider', () => {
  const descriptor = (key: string) => ({ key, labelKey: `relation.${key}`, targetTypes: ['payment.refund'], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true } });
  return {
    paymentAnchorResolvers: ['payment.order', 'payment.refund'].map((type) => ({ type, resolve: (...args: unknown[]) => state.resolve(...args) })),
    paymentRelationProviders: ['payment.order.refunds', 'payment.order.more-refunds'].map((key) => ({
      sourceType: 'payment.order', key, permissions: ['payment:refund:list'], descriptor: descriptor(key), list: (...args: unknown[]) => state.list(...args),
    })),
  };
});
vi.mock('./providers/identity.provider', () => ({
  identityAnchorResolvers: [{ type: 'identity.user', resolve: (...args: unknown[]) => state.resolve(...args) }],
  identityRelationProviders: [],
}));
vi.mock('./providers/member-fulfillment.provider', () => ({ memberFulfillmentAnchors: [], memberFulfillmentProviders: [] }));
vi.mock('./providers/iot-ota.provider', () => ({ iotOtaAnchors: [], iotOtaProviders: [] }));
vi.mock('./providers/business-file.provider', () => ({ businessFileAnchors: [], businessFileProviders: [] }));
vi.mock('./providers/iot-content.provider', () => ({ iotContentAnchorResolvers: [], iotContentRelationProviders: [] }));
vi.mock('./providers/workflow-file.provider', () => ({ workflowFileAnchorResolvers: [], workflowFileRelationProviders: [] }));
vi.mock('./providers/subjects.provider', () => ({ subjectAnchorResolvers: [], subjectProviders: () => [] }));
vi.mock('../../payment/payment-financial-relations.service', () => ({ paymentFinancialAnchorResolvers: [], paymentFinancialRelationProviders: [] }));
vi.mock('./providers/reverse-subjects.provider', () => ({ reverseSubjectProviders: () => [] }));
vi.mock('../../workflow/workflow-business-relations.service', () => ({ workflowBusinessAnchorResolvers: [], createWorkflowBusinessRelationProviders: () => [] }));
vi.mock('../../workflow/workflow-archive-relations.service', () => ({ workflowArchiveAnchorResolvers: [], workflowArchiveRelationProviders: [] }));
vi.mock('../../workflow/workflow-attachment-relations.service', () => ({ workflowAttachmentAnchorResolvers: [], workflowAttachmentRelationProviders: [] }));

// Import edges first: its registry import and the registry's manual-provider
// import must assemble through the real circular module graph.
import { changeEntityLink, manualLinksProvider } from './edges.service';
import { addRelationActions } from './actions';
import { createEntityRelationRegistry, describeEntityRelations, entityRelationRegistry, listEntityRelation } from './registry';
import { decodeRelationCursor, encodeRelationCursor, readRelationCursor, signRelationCursor } from './cursor';
import { assertRelationBudget, isStatementTimeout, withRelationRead } from './runtime';

type Statement = { sql: string; params: unknown[] };
type ExecutableQuery = { execute: () => Promise<unknown[]>; toSQL: () => Statement };
let statements: Statement[];
let setupStatements: Statement[];
let readResults: unknown[][];
let tx: RelationAccessContext['db'];

function makeTransaction() {
  const database = drizzle.mock({ casing: 'snake_case' });
  vi.spyOn(database, 'transaction').mockImplementation(async (run) => run(database as unknown as Parameters<typeof run>[0]));
  const instrument = (query: ExecutableQuery, isRead: boolean) => {
    query.execute = async () => {
      statements.push(query.toSQL());
      return isRead ? readResults.shift() ?? [] : [];
    };
    return query;
  };
  const select = database.select.bind(database);
  vi.spyOn(database, 'select').mockImplementation((...args: unknown[]) => {
    const builder = Reflect.apply(select, database, args);
    const from = builder.from;
    builder.from = (...fromArgs: unknown[]) => instrument(Reflect.apply(from, builder, fromArgs), true);
    return builder;
  });
  const insert = database.insert.bind(database);
  vi.spyOn(database, 'insert').mockImplementation((...args: unknown[]) => {
    const builder = Reflect.apply(insert, database, args);
    const values = builder.values;
    builder.values = (...valueArgs: unknown[]) => instrument(Reflect.apply(values, builder, valueArgs), false);
    return builder;
  });
  const remove = database.delete.bind(database);
  vi.spyOn(database, 'delete').mockImplementation((...args: unknown[]) => instrument(Reflect.apply(remove, database, args), false) as never);
  const dialect = new PgDialect({ casing: 'snake_case' });
  vi.spyOn(database, 'execute').mockImplementation(async (query) => {
    setupStatements.push(dialect.sqlToQuery(query as SQL));
    return [] as never;
  });
  return database as unknown as RelationAccessContext['db'];
}

const source = { type: 'payment.order', key: '21' } as const;
const target = { type: 'payment.refund', key: '31' } as const;
const query = { ...source, sectionKey: 'payment.order.refunds', limit: 2 };
const caller = () => ({ user: state.user });
const refKey = (ref: EntityRef) => `${ref.type}:${ref.key}`;

function addAnchor(ref: CanonicalEntityRef, tenantId: number | null = 7) {
  state.anchors.set(refKey(ref), { ref, title: `${ref.type} ${ref.key}`, tenantId });
}
function assertBinding(statement: Statement, column: string, value: unknown) {
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped} = \\$(\\d+)`).exec(statement.sql);
  expect(match, `${column} must be filtered`).not.toBeNull();
  expect(statement.params[Number(match![1]) - 1]).toEqual(value);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { userId: 9, username: 'reviewer', roles: ['reviewer'], tenantId: 7 };
  state.permissions = new Set(['payment:refund:list']);
  state.disabledFeatures = new Set();
  state.anchors = new Map();
  addAnchor(source); addAnchor(target); addAnchor({ type: 'identity.user', key: '41' });
  statements = [];
  setupStatements = [];
  readResults = [];
  tx = makeTransaction();
  state.resolve.mockImplementation(async (ref: EntityRef) => state.anchors.get(refKey(ref)) ?? null);
  state.list.mockResolvedValue({ items: [{ ref: target, relationKey: query.sectionKey, title: 'Refund', capabilities: { view: true, open: true } }], nextCursor: '8', hasMore: true });
  state.transaction.mockImplementation(async (run: (transaction: RelationAccessContext['db']) => Promise<unknown>) => run(tx));
});

describe('real registry assembly and authorization control flow', () => {
  it('omits inapplicable groups and denies direct access before executing a provider', async () => {
    const provider = entityRelationRegistry.relations.get(query.sectionKey)!;
      Object.defineProperty(provider, 'appliesTo', { value: () => false, configurable: true });
      try {
        expect((await describeEntityRelations(source, caller())).sections.some((section) => section.key === query.sectionKey)).toBe(false);
        // Describe now performs bounded qualitative summaries for other
        // discoverable groups; isolate the direct-access assertion below.
        state.list.mockClear();
        await expect(listEntityRelation(query, caller())).rejects.toMatchObject({ status: 404 });
        expect(state.list).not.toHaveBeenCalled();
      } finally { Reflect.deleteProperty(provider, 'appliesTo'); }
  });
  it('assembles manual-link providers through the registry/edges circular import', () => {
    expect(entityRelationRegistry.anchors.has('payment.order')).toBe(true);
    expect(entityRelationRegistry.relations.get('payment.order.links')?.descriptor.targetTypes).toEqual(['payment.order', 'payment.refund', 'identity.user']);
  });

  it('returns 404 for invisible and unsupported anchors before a section can be queried', async () => {
    state.anchors.delete(refKey(source));
    await expect(describeEntityRelations(source, caller())).rejects.toMatchObject({ status: 404 });
    await expect(listEntityRelation(query, caller())).rejects.toMatchObject({ status: 404 });
    await expect(describeEntityRelations({ type: 'cms.content', key: '21' }, caller())).rejects.toMatchObject({ status: 404 });
    expect(state.list).not.toHaveBeenCalled();
  });

  it('omits undiscoverable groups and never invokes their list function', async () => {
    state.permissions.clear();
    const described = await describeEntityRelations(source, caller());
    expect(described.sections.map((section) => section.key)).toEqual(['payment.order.links']);
    expect(described.canManageLinks).toBe(false);
    await expect(listEntityRelation(query, caller())).rejects.toMatchObject({ status: 404 });
    expect(state.list).not.toHaveBeenCalled();
    expect(described).not.toHaveProperty('total');
  });

  it('returns qualitative section states without exposing counts', async () => {
    state.list.mockResolvedValueOnce({ items: [], nextCursor: null, hasMore: false })
      .mockResolvedValueOnce({ items: [{ ref: target, relationKey: query.sectionKey, title: 'Refund', capabilities: { view: true, open: true } }], nextCursor: null, hasMore: false });
    const sections = (await describeEntityRelations(source, caller())).sections;
    expect(sections.find((section) => section.key === 'payment.order.refunds')?.summaryState).toBe('empty');
    expect(sections.find((section) => section.key === 'payment.order.more-refunds')?.summaryState).toBe('has-data');
    expect(sections).not.toEqual(expect.arrayContaining([expect.objectContaining({ total: expect.anything() })]));
  });

  it('marks a failed provider summary unavailable instead of claiming empty', async () => {
    state.list.mockRejectedValue(new Error('summary unavailable'));
    const sections = (await describeEntityRelations(source, caller())).sections;
    expect(sections.filter((section) => ['payment.order.refunds', 'payment.order.more-refunds'].includes(section.key)).map((section) => section.summaryState)).toEqual(['unavailable', 'unavailable']);
  });

  it('does not let an arbitrary section key cross source types', async () => {
    await expect(listEntityRelation({ ...query, type: 'identity.user', key: '41' }, caller())).rejects.toMatchObject({ status: 404 });
    await expect(listEntityRelation({ ...query, sectionKey: 'payment.order.unknown' }, caller())).rejects.toMatchObject({ status: 404 });
    expect(state.list).not.toHaveBeenCalled();
  });

  it('enforces entity licensing before resolving the anchor', async () => {
    state.disabledFeatures.add('payment');
    await expect(describeEntityRelations(source, caller())).rejects.toMatchObject({ status: 404 });
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it('rejects duplicate resolver, duplicate relation and missing source/target registrations', () => {
    const resolver = entityRelationRegistry.anchors.get('payment.order')!;
    const refundResolver = entityRelationRegistry.anchors.get('payment.refund')!;
    const provider = entityRelationRegistry.relations.get(query.sectionKey)!;
    expect(() => createEntityRelationRegistry([{ anchors: [resolver, resolver], relations: [] }])).toThrow('Duplicate entity resolver');
    expect(() => createEntityRelationRegistry([{ anchors: [resolver, refundResolver], relations: [provider, provider] }])).toThrow('Duplicate relation');
    expect(() => createEntityRelationRegistry([{ anchors: [resolver], relations: [provider] }])).toThrow('Missing target resolver');
    expect(() => createEntityRelationRegistry([{ anchors: [refundResolver], relations: [provider] }])).toThrow('Missing anchor resolver');
    expect(() => createEntityRelationRegistry([{ anchors: [resolver, refundResolver], relations: [{ ...provider, key: 'mismatch' }] }])).toThrow('Mismatched relation descriptor');
  });

  it('allows an anchor with no domain relationship providers', () => {
    const resolver: EntityAnchorResolver = { type: 'identity.user', resolve: async () => null };
    const registry = createEntityRelationRegistry([{ anchors: [resolver], relations: [] }]);
    expect(registry.anchors.get('identity.user')).toBe(resolver);
    expect(registry.relations.size).toBe(0);
  });
});

describe('signed keyset cursor boundaries', () => {
  it('signs returned cursors and verifies them before passing the internal ID to a provider', async () => {
    const first = await listEntityRelation(query, caller());
    expect(first.nextCursor).not.toBe('8');
    await listEntityRelation({ ...query, cursor: first.nextCursor! }, caller());
    expect(state.list.mock.calls[1][1]).toMatchObject({ cursor: '8', limit: 2, access: { user: state.user, db: tx } });
  });

  it('rejects tampering without calling a provider', async () => {
    const first = await listEntityRelation(query, caller());
    const [data, signature] = first.nextCursor!.split('.');
    const changed = `${data}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
    state.list.mockClear();
    await expect(listEntityRelation({ ...query, cursor: changed }, caller())).rejects.toMatchObject({ status: 400 });
    expect(state.list).not.toHaveBeenCalled();
  });

  it.each(['user', 'tenant', 'tenant-view', 'anchor', 'section', 'anchor-tenant', 'impersonation'] as const)('rejects replay after %s changes', async (change) => {
    const first = await listEntityRelation(query, caller());
    const replay = { ...query, key: String(query.key), sectionKey: String(query.sectionKey), cursor: first.nextCursor! };
    if (change === 'user') state.user = { ...state.user, userId: 10 };
    if (change === 'tenant') state.user = { ...state.user, tenantId: 8 };
    if (change === 'tenant-view') state.user = { ...state.user, viewingTenantId: 8 };
    if (change === 'anchor') { addAnchor({ ...source, key: '22' }); replay.key = '22'; }
    if (change === 'section') replay.sectionKey = 'payment.order.more-refunds';
    if (change === 'anchor-tenant') addAnchor(source, 8);
    if (change === 'impersonation') state.user = { ...state.user, impersonation: { byUserId: 3, byUsername: 'admin' } } as JwtPayload;
    state.list.mockClear();
    await expect(listEntityRelation(replay, caller())).rejects.toMatchObject({ status: 400 });
    expect(state.list).not.toHaveBeenCalled();
  });

  it('validates internal IDs and rejects unsupported signed payloads', () => {
    expect(encodeRelationCursor(20)).toBe('20');
    expect(decodeRelationCursor('20')).toBe(20);
    expect(decodeRelationCursor()).toBeUndefined();
    for (const value of ['0', '-1', '1e2', '01', '3.2', '9007199254740992']) expect(() => decodeRelationCursor(value)).toThrow();
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => encodeRelationCursor(value)).toThrow();
    expect(readRelationCursor(signRelationCursor('20', 'scope'), 'scope')).toBe('20');
    expect(() => readRelationCursor(signRelationCursor('20', 'scope'), 'other')).toThrow();
    expect(() => readRelationCursor('invalid', 'scope')).toThrow();
  });
});

describe('relation transaction budget and failure semantics', () => {
  it('uses a read-only transaction and PostgreSQL statement/lock timeouts', async () => {
    await describeEntityRelations(source, caller());
    expect(state.transaction).toHaveBeenCalledWith(expect.any(Function), { accessMode: 'read only' });
    expect(setupStatements[0].sql).toContain("set_config('statement_timeout', '1500', true)");
    expect(setupStatements[0].sql).toContain("set_config('lock_timeout', '750', true)");
    expect(state.metrics).toHaveBeenCalledWith('describe', 'success', expect.any(Number));
  });

  it('degrades only a timed-out authorized group and records timeout metrics', async () => {
    state.list.mockRejectedValue({ cause: { code: '57014' } });
    expect(await listEntityRelation(query, caller())).toEqual({ items: [], nextCursor: null, hasMore: false, degraded: 'timeout' });
    expect(state.metrics).toHaveBeenCalledWith('section', 'timeout', expect.any(Number));
    expect(state.errorLog).not.toHaveBeenCalled();
  });

  it('never treats a failed anchor check as an authorized degraded group', async () => {
    state.resolve.mockRejectedValue({ code: '57014' });
    await expect(listEntityRelation(query, caller())).rejects.toMatchObject({ status: 503 });
    expect(state.list).not.toHaveBeenCalled();
  });

  it.each(['ECONNRESET', '57P01', '55P03'])('returns 503 for %s rather than an empty/degraded page', async (code) => {
    state.list.mockRejectedValue(Object.assign(new Error('database unavailable'), { code }));
    await expect(listEntityRelation(query, caller())).rejects.toMatchObject({ status: 503 });
    expect(state.errorLog).toHaveBeenCalledOnce();
    expect(state.metrics).toHaveBeenCalledWith('section', 'error', expect.any(Number));
  });

  it('preserves deliberate HTTP errors', async () => {
    state.list.mockRejectedValue(new HTTPException(403, { message: 'revoked' }));
    await expect(listEntityRelation(query, caller())).rejects.toMatchObject({ status: 403 });
    expect(state.metrics).toHaveBeenCalledWith('section', 'denied', expect.any(Number));
  });

  it('records exhausted request budgets separately from SQL failures', async () => {
    await expect(withRelationRead('expired', caller(), async (access) => {
      assertRelationBudget({ ...access, deadlineAt: performance.now() - 1 });
    })).rejects.toMatchObject({ status: 503 });
    expect(state.metrics).toHaveBeenCalledWith('expired', 'budget', expect.any(Number));
  });

  it('caps active reads without queueing and releases slots after completion', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const running = Array.from({ length: 8 }, () => withRelationRead('busy', caller(), async () => pending));
    await expect(withRelationRead('overflow', caller(), async () => 'unexpected')).rejects.toMatchObject({ status: 503 });
    expect(state.metrics).toHaveBeenCalledWith('overflow', 'busy', expect.any(Number));
    release();
    await Promise.all(running);
    expect(await withRelationRead('after', caller(), async () => 'ok')).toBe('ok');
  });

  it('releases a slot on transaction connection failure and recognizes wrapped cancellation only', async () => {
    state.transaction.mockRejectedValueOnce(new Error('connection failed'));
    await expect(withRelationRead('failed', caller(), async () => undefined)).rejects.toMatchObject({ status: 503 });
    expect(await withRelationRead('retry', caller(), async () => 'ok')).toBe('ok');
    expect(isStatementTimeout({ cause: { cause: { code: '57014' } } })).toBe(true);
    expect(isStatementTimeout({ code: 'ECONNRESET' })).toBe(false);
    expect(isStatementTimeout(null)).toBe(false);
  });
});

describe('manual relation mutation and target authorization', () => {
  it('adds refund handling only for authorized pending approvals and exposes no mutation command', async () => {
    const item = { ref: target, relationKey: query.sectionKey, title: 'Refund', capabilities: { view: true, open: true } };
    const anchor = state.anchors.get(refKey(source))!;
    const access = { user: state.user, db: tx };
    expect((await addRelationActions([item], anchor, access))[0].action).toBeUndefined();
    expect(statements).toHaveLength(0);
    state.permissions.add('payment:refund:approve');
    readResults.push([{ id: 31 }]);
    const result = await addRelationActions([item], anchor, access);
    expect(result[0].action).toEqual({ label: '审核退款', target });
    assertBinding(statements[0], '"payment_refunds"."tenant_id"', 7);
    assertBinding(statements[0], '"payment_refunds"."approval_status"', 'pending');
  });
  it('rejects missing manage permission before starting a transaction', async () => {
    await expect(changeEntityLink(source, target, false)).rejects.toMatchObject({ status: 403 });
    expect(state.transaction).not.toHaveBeenCalled();
    expect(statements).toHaveLength(0);
  });

  it.each([false, true])('rejects cross-tenant links for remove=%s without writing', async (remove) => {
    state.permissions.add('system:relation:manage');
    addAnchor(target, 8);
    await expect(changeEntityLink(source, target, remove)).rejects.toMatchObject({ status: 400 });
    expect(statements).toHaveLength(0);
    expect(state.audit).not.toHaveBeenCalled();
  });

  it('rejects self links after canonical resolution', async () => {
    state.permissions.add('system:relation:manage');
    await expect(changeEntityLink(source, source, false)).rejects.toMatchObject({ status: 400 });
    expect(statements).toHaveLength(0);
  });

  it('rejects missing/inaccessible target creation', async () => {
    state.permissions.add('system:relation:manage');
    state.anchors.delete(refKey(target));
    await expect(changeEntityLink(source, target, false)).rejects.toMatchObject({ status: 404 });
    expect(statements).toHaveLength(0);
  });

  it('normalizes symmetric insertions to one conflict-safe edge and records both subjects', async () => {
    state.permissions.add('system:relation:manage');
    await changeEntityLink(source, target, false);
    await changeEntityLink(target, source, false);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toEqual(statements[1]);
    expect(statements[0].sql).toContain('on conflict do nothing');
    expect(statements[0].params).toEqual(expect.arrayContaining([7, 'payment.order', '21', 'payment.refund', '31', 'platform.related', 9]));
    expect(state.audit.mock.calls[0]).toEqual([[{ ...source, role: 'primary' }, { ...target, role: 'related' }], 7]);
  });

  it('deletes the same canonical edge from either direction with its tenant and relation key', async () => {
    state.permissions.add('system:relation:manage');
    await changeEntityLink(source, target, true);
    await changeEntityLink(target, source, true);
    expect(statements[0]).toEqual(statements[1]);
    expect(statements[0].sql).toMatch(/^delete from "entity_relation_edges"/);
    assertBinding(statements[0], '"entity_relation_edges"."tenant_id"', 7);
    assertBinding(statements[0], '"entity_relation_edges"."relation_key"', 'platform.related');
  });

  it('preserves directional semantics and removes exactly that type from the reverse endpoint', async () => {
    state.permissions.add('system:relation:manage');
    await changeEntityLink(source, target, false, { relationType: 'reference', note: '退款说明依据' });
    expect(statements[0].params).toContain('platform.manual.reference');
    expect(statements[0].params).toContain(JSON.stringify({ note: '退款说明依据' }));
    await changeEntityLink(target, source, true, { relationType: 'reference', direction: 'incoming' });
    assertBinding(statements[1], '"entity_relation_edges"."source_key"', source.key);
    assertBinding(statements[1], '"entity_relation_edges"."target_key"', target.key);
    assertBinding(statements[1], '"entity_relation_edges"."relation_key"', 'platform.manual.reference');
  });

  it('allows removal of a deleted target while retaining the authorized source tenant', async () => {
    state.permissions.add('system:relation:manage');
    state.anchors.delete(refKey(target));
    await changeEntityLink(source, target, true);
    assertBinding(statements[0], '"entity_relation_edges"."tenant_id"', 7);
    expect(state.audit.mock.calls[0]).toEqual([[{ ...source, role: 'primary' }], 7]);
  });

  it('filters inaccessible and cross-tenant manual targets without exposing counts', async () => {
    addAnchor({ type: 'payment.refund', key: '33' }, 8);
    readResults.push([
      { id: 90, sourceType: source.type, sourceKey: source.key, targetType: target.type, targetKey: '32', relationKey: 'platform.related' },
      { id: 80, sourceType: source.type, sourceKey: source.key, targetType: target.type, targetKey: '33', relationKey: 'platform.related' },
      { id: 70, sourceType: source.type, sourceKey: source.key, targetType: target.type, targetKey: target.key, relationKey: 'platform.related', createdByName: null },
    ], []);
    const provider = manualLinksProvider('payment.order', ['payment.refund']);
    const result = await provider.list(state.anchors.get(refKey(source))!, { limit: 2, access: { user: state.user, db: tx } });
    expect(result.items.map((item) => item.ref)).toEqual([target]);
    expect(result).toMatchObject({ hasMore: false, nextCursor: null });
    expect(result).not.toHaveProperty('total');
    assertBinding(statements[0], '"entity_relation_edges"."tenant_id"', 7);
    expect(statements[0].params.at(-1)).toBe(32);
  });

  it('manual links use edge IDs and the last visible item for continuation', async () => {
    addAnchor({ type: 'payment.refund', key: '34' });
    addAnchor({ type: 'payment.refund', key: '35' });
    const edge = (id: number, key: string) => ({ id, sourceType: source.type, sourceKey: source.key, targetType: target.type, targetKey: key, relationKey: 'platform.related', createdByName: null });
    readResults.push(Array.from({ length: 32 }, (_, index) => edge(100 - index, index === 0 ? '31' : index === 31 ? '34' : '999')), [edge(68, '35')]);
    const provider: RelationProvider = manualLinksProvider('payment.order', ['payment.refund']);
    const result = await provider.list(state.anchors.get(refKey(source))!, { limit: 2, access: { user: state.user, db: tx, deadlineAt: performance.now() + 2500 } });
    expect(result.items.map((item) => item.ref.key)).toEqual(['31', '34']);
    expect(result).toMatchObject({ hasMore: true, nextCursor: '69' });
    expect(statements[1].sql).toContain('"entity_relation_edges"."id" <');
    expect(statements[1].params).toContain(69);
  });
});
