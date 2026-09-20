import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, type AnyColumn } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { JwtPayload } from '../../../../middleware/auth';
import type { RelationAccessContext, VisibleEntityAnchor } from '../types';

const state = vi.hoisted(() => ({
  user: { userId: 9, username: 'reviewer', roles: ['reviewer'], tenantId: 7 } as JwtPayload,
  permissions: new Set<string>(),
  allData: false,
  siteIds: [5] as number[] | null,
  channelIds: [12] as number[] | null,
}));

vi.mock('../../../../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../config')>();
  return { ...actual, config: { ...actual.config, multiTenantMode: true } };
});
vi.mock('../../../../db', async () => {
  const { drizzle: makeDb } = await import('drizzle-orm/postgres-js');
  return { db: makeDb.mock({ casing: 'snake_case' }) };
});
vi.mock('../../../../lib/context', () => ({
  hasPermission: async (...codes: string[]) => codes.some((code) => state.permissions.has(code)),
  runWithCurrentUser: async (user: JwtPayload, run: () => unknown) => {
    const previous = state.user;
    state.user = user;
    try { return await run(); } finally { state.user = previous; }
  },
  currentUser: () => state.user,
  currentUserOrNull: () => state.user,
  currentUserId: () => state.user.userId,
  isSuperAdmin: () => state.user.tenantId === null && state.user.roles.includes('super_admin'),
}));
vi.mock('../../../../lib/data-scope', () => ({
  getDataScopeCondition: async ({ ownerColumn, currentUserId }: { ownerColumn: AnyColumn; currentUserId: number }) => state.allData ? undefined : eq(ownerColumn, currentUserId),
}));
vi.mock('../../../payment/payment.service', async () => {
  const { paymentOrders } = await import('../../../../db/schema');
  const { buildWhere } = await import('../../../../lib/where-helpers');
  const { tenantCondition } = await import('../../../../lib/tenant');
  return { buildOrdersWhere: async () => buildWhere(tenantCondition(paymentOrders, state.user), state.allData ? undefined : eq(paymentOrders.createdBy, state.user.userId)) };
});
vi.mock('../../../member/member-wallet.service', () => ({ WALLET_RECHARGE_BIZ_TYPE: 'member_recharge' }));
vi.mock('../../../cms/cms-sites.service', () => ({ getAccessibleSiteIds: async () => state.siteIds }));
vi.mock('../../../cms/cms-channels.service', () => ({ getAccessibleChannelIds: async () => state.channelIds }));
vi.mock('../../../tasks/async-tasks.service', () => ({
  resolveAsyncTaskAccessScope: async () => ({ userId: state.user.userId, global: state.permissions.has('system:async-task:list') }),
}));
// Preserve the production ACL SQL. Only identity expansion is replaced: it
// normally queries role/group membership, which is independent of this suite.
vi.mock('../../../drive/drive-access.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../drive/drive-access.service')>();
  return { ...actual, loadDriveSubjects: async () => ({
    userId: state.user.userId, user: new Set([state.user.userId]), department: new Set([3]),
    role: new Set([4]), user_group: new Set([6]), departmentId: 3, isAdmin: state.permissions.has('drive:admin:space:edit'),
  }) };
});

import { identityAnchorResolvers, identityRelationProviders, identityUserPaymentsProvider, memberPaymentsProvider, identityUserAuditProvider } from './identity.provider';
import { iotContentAnchorResolvers, iotContentRelationProviders, cmsContentRelatedProvider, iotDeviceAlarmsProvider } from './iot-content.provider';
import { workflowFileAnchorResolvers, workflowFileRelationProviders, workflowInstanceChildrenProvider } from './workflow-file.provider';

type Statement = { sql: string; params: unknown[] };
type ExecutableQuery = { execute: () => Promise<unknown[]>; toSQL: () => Statement };

/** Build real Drizzle SQL while replacing only the final database execution. */
function captureAccess(results: unknown[][] = []) {
  const tx = drizzle.mock({ casing: 'snake_case' });
  const statements: Statement[] = [];
  const select = tx.select.bind(tx);
  vi.spyOn(tx, 'select').mockImplementation((...args: unknown[]) => {
    const builder = Reflect.apply(select, tx, args);
    const from = builder.from;
    builder.from = (...fromArgs: unknown[]) => {
      const query = Reflect.apply(from, builder, fromArgs) as ExecutableQuery;
      query.execute = async () => {
        statements.push(query.toSQL());
        return results.shift() ?? [];
      };
      return query;
    };
    return builder;
  });
  return { access: { user: state.user, db: tx as unknown as RelationAccessContext['db'] }, statements, tx };
}

function anchor(type: VisibleEntityAnchor['ref']['type'], metadata: VisibleEntityAnchor['metadata'] = {}): VisibleEntityAnchor {
  return { ref: { type, key: '21' }, title: 'source', tenantId: type === 'cms.content' ? null : 7, metadata };
}

function expectBinding(statement: Statement, column: string, value: unknown, operator = '=') {
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped} ${operator} \\$(\\d+)`).exec(statement.sql);
  expect(match, `${column} ${operator} parameter missing from SQL`).not.toBeNull();
  expect(statement.params[Number(match![1]) - 1]).toEqual(value);
}

function findProvider(key: string) {
  const provider = workflowFileRelationProviders.find((item) => item.key === key);
  if (!provider) throw new Error(`Provider missing: ${key}`);
  return provider;
}

beforeEach(() => {
  state.user = { userId: 9, username: 'reviewer', roles: ['reviewer'], tenantId: 7 };
  state.permissions = new Set();
  state.allData = false;
  state.siteIds = [5];
  state.channelIds = [12];
});

describe('domain relation permission and pagination boundaries', () => {
  const providers = [...identityRelationProviders, ...iotContentRelationProviders, ...workflowFileRelationProviders];
  it('keeps domain relation keys distinct from generic audit, notification and async-task groups', () => {
    const specialized = providers.filter((provider) => !provider.key.endsWith('.audit'));
    expect(new Set(specialized.map((provider) => provider.key)).size).toBe(specialized.length);
    for (const provider of specialized) {
      expect(provider.descriptor.key).toBe(provider.key);
      expect(['audit', 'notifications', 'tasks'].map((suffix) => `${provider.sourceType}.${suffix}`)).not.toContain(provider.key);
    }
  });

  it.each(providers.map((provider) => [provider.key, provider] as const))('%s never queries or exposes totals without target permission', async (_key, provider) => {
    const { access, statements, tx } = captureAccess();
    const result = await provider.list(anchor(provider.sourceType, { parentId: 20, spaceId: 2, instanceId: 3, siteId: 5, deviceId: 4 }), { limit: 2, access });
    expect(result).toEqual({ items: [], nextCursor: null, hasMore: false });
    expect(statements).toHaveLength(0);
    expect(tx.select).not.toHaveBeenCalled();
  });

  it.each([...identityAnchorResolvers, ...iotContentAnchorResolvers, ...workflowFileAnchorResolvers].filter((resolver) => resolver.type !== 'tasks.async'))('%s anchors deny missing domain permission before querying', async (resolver) => {
    const { access, tx } = captureAccess();
    expect(await resolver.resolve({ type: resolver.type, key: '21' }, access)).toBeNull();
    expect(tx.select).not.toHaveBeenCalled();
  });

  it('binds a platform-wide user payment query to the anchor tenant and uses the last shown ID cursor', async () => {
    state.user = { ...state.user, roles: ['super_admin'], tenantId: null };
    state.allData = true;
    state.permissions.add('payment:order:list');
    const order = (id: number) => ({ id, orderNo: `PO-${id}`, subject: 'Order', status: 'success', createdAt: new Date('2026-09-20T00:00:00Z') });
    const { access, statements } = captureAccess([[order(100), order(80), order(20)], [order(20)]]);
    const first = await identityUserPaymentsProvider.list(anchor('identity.user'), { limit: 2, access });
    expect(first.items.map((item) => item.ref.key)).toEqual(['100', '80']);
    expect(first).toMatchObject({ nextCursor: '80', hasMore: true });
    expect(first).not.toHaveProperty('total');
    expectBinding(statements[0], '"payment_orders"."tenant_id"', 7);
    expectBinding(statements[0], '"payment_orders"."user_id"', 21);
    expect(statements[0].sql).toContain('"payment_orders"."biz_type" not in');
    expect(statements[0].sql).toMatch(/order by "payment_orders"\."id" desc limit \$\d+$/);
    expect(statements[0].params.at(-1)).toBe(3);
    expect(statements[0].sql).not.toContain('offset');
    const second = await identityUserPaymentsProvider.list(anchor('identity.user'), { limit: 2, cursor: first.nextCursor!, access });
    expectBinding(statements[1], '"payment_orders"."id"', 80, '<');
    expect(second).toMatchObject({ nextCursor: null, hasMore: false });
  });

  it('member payments require concrete wallet or renewal records and preserve the payment data scope', async () => {
    state.permissions.add('payment:order:list');
    const { access, statements } = captureAccess();
    await memberPaymentsProvider.list(anchor('member.member'), { limit: 5, access });
    const query = statements[0];
    expect(query.sql).toContain('"member_wallet_transactions"."payment_intent_no" = "payment_orders"."order_no"');
    expect(query.sql).toContain('"member_vip_renewals"."order_no" = "payment_orders"."order_no"');
    expectBinding(query, '"member_wallet_transactions"."member_id"', 21);
    expectBinding(query, '"member_vip_renewals"."member_id"', 21);
    expectBinding(query, '"payment_orders"."created_by"', 9);
    expectBinding(query, '"payment_orders"."tenant_id"', 7);
    expect(query.sql).not.toContain('"payment_orders"."biz_id"');
    expect(query.params.at(-1)).toBe(6);
  });

  it('audits use tenant-bound EXISTS so multiple subject roles cannot duplicate a page', async () => {
    state.permissions.add('system:log:operation');
    const { access, statements } = captureAccess();
    await identityUserAuditProvider.list(anchor('identity.user'), { limit: 5, cursor: '40', access });
    const query = statements[0];
    expect(query.sql).toContain('exists (select');
    expect(query.sql).not.toContain(' join ');
    expectBinding(query, '"operation_logs"."tenant_id"', 7);
    expectBinding(query, '"operation_log_subjects"."tenant_id"', 7);
    expectBinding(query, '"operation_log_subjects"."entity_type"', 'identity.user');
    expectBinding(query, '"operation_logs"."id"', 40, '<');
  });

  it('CMS anchors and relations enforce global site/channel grants and never project body', async () => {
    state.permissions.add('cms:content:list');
    const { access, statements } = captureAccess();
    const resolver = iotContentAnchorResolvers.find((entry) => entry.type === 'cms.content')!;
    await resolver.resolve({ type: 'cms.content', key: '21' }, access);
    await cmsContentRelatedProvider.list(anchor('cms.content', { siteId: 5 }), { limit: 2, cursor: '80', access });
    for (const query of statements) {
      expect(query.sql).toContain('"cms_contents"."site_id" in');
      expect(query.sql).toContain('"cms_contents"."channel_id" in');
      expect(query.sql).toContain('"cms_contents"."deleted_at" is null');
      expectBinding(query, '"cms_contents"."created_by"', 9);
      expect(query.sql).not.toContain('"body"');
    }
    expectBinding(statements[1], '"cms_contents"."site_id"', 5);
    expectBinding(statements[1], '"cms_content_relations"."content_id"', 21);
    expectBinding(statements[1], '"cms_contents"."id"', 80, '<');
    expect(statements[1].params.at(-1)).toBe(3);
  });

  it('CMS missing grants produce a false SQL predicate instead of an unfiltered query', async () => {
    state.permissions.add('cms:content:list');
    state.siteIds = [];
    state.channelIds = [];
    const { access, statements } = captureAccess();
    await cmsContentRelatedProvider.list(anchor('cms.content', { siteId: 5 }), { limit: 2, access });
    expect(statements[0].sql).toContain('false');
  });

  it('IoT alarms inherit tenant isolation from their device even in platform-wide view', async () => {
    state.user = { ...state.user, roles: ['super_admin'], tenantId: null };
    state.permissions.add('iot:alarm:list');
    const { access, statements } = captureAccess();
    await iotDeviceAlarmsProvider.list(anchor('iot.device'), { limit: 2, access });
    expectBinding(statements[0], '"iot_devices"."tenant_id"', 7);
    expectBinding(statements[0], '"iot_alarms"."device_id"', 21);
  });

  it('drive anchors and children preserve real per-node ACLs including broken inheritance', async () => {
    state.permissions.add('drive:node:list');
    const { access, statements } = captureAccess();
    await workflowFileAnchorResolvers.find((entry) => entry.type === 'drive.file')!.resolve({ type: 'drive.file', key: '21' }, access);
    await findProvider('drive.file.children').list(anchor('drive.file', { spaceId: 4 }), { limit: 2, cursor: '80', access });
    for (const query of statements) {
      expect(query.sql).toContain('"drive_nodes"."acl_open"');
      expect(query.sql).toContain('"drive_nodes"."acl_chain_ids" && ARRAY(');
      expect(query.sql).toContain('"drive_node_permissions"."expire_at"');
      expect(query.sql).toContain('"drive_nodes"."deleted_at" is null');
    }
    expectBinding(statements[1], '"drive_nodes"."tenant_id"', 7);
    expectBinding(statements[1], '"drive_spaces"."tenant_id"', 7);
    expectBinding(statements[1], '"drive_nodes"."space_id"', 4);
    expectBinding(statements[1], '"drive_nodes"."parent_id"', 21);
  });

  it('Wiki relation SQL hides private spaces and drafts from nonmembers and noneditors', async () => {
    state.permissions.add('wiki:doc:list');
    const { access, statements } = captureAccess();
    await workflowFileAnchorResolvers.find((entry) => entry.type === 'wiki.document')!.resolve({ type: 'wiki.document', key: '21' }, access);
    await findProvider('wiki.document.children').list(anchor('wiki.document', { spaceId: 4 }), { limit: 2, access });
    for (const query of statements) {
      expect(query.sql).toContain('"wiki_space_members"."user_id"');
      expect(query.sql).toContain('"wiki_space_members"."role" in');
      expect(query.params).toEqual(expect.arrayContaining(['published', 'owner', 'admin', 'editor', 'public', 'enabled', 9]));
      expect(query.sql).not.toContain('"content"');
    }
    expectBinding(statements[1], '"wiki_docs"."is_archived"', false);
    expectBinding(statements[1], '"wiki_docs"."tenant_id"', 7);
    expectBinding(statements[1], '"wiki_spaces"."tenant_id"', 7);
  });

  it('workflow children require their own participant or ancestor permission with exact tenant binding', async () => {
    state.permissions.add('workflow:instance:list');
    const { access, statements } = captureAccess();
    await workflowInstanceChildrenProvider.list(anchor('workflow.instance'), { limit: 2, access });
    const query = statements[0];
    expectBinding(query, '"workflow_instances"."parent_instance_id"', 21);
    expectBinding(query, '"workflow_instances"."tenant_id"', 7);
    expectBinding(query, '"workflow_tasks"."assignee_id"', 9);
    expect(query.sql).toContain('with recursive ancestors');
    expect(query.sql).toContain('ancestors.depth < 10');
    expect(query.sql.match(/parent\.tenant_id is not distinct from "workflow_instances"\."tenant_id"/g)).toHaveLength(2);
  });

  it('async task anchors allow owners but never drop tenant isolation for task admins', async () => {
    const resolver = workflowFileAnchorResolvers.find((entry) => entry.type === 'tasks.async')!;
    const { access, statements } = captureAccess();
    await resolver.resolve({ type: 'tasks.async', key: '21' }, access);
    expectBinding(statements[0], '"async_tasks"."created_by"', 9);
    expectBinding(statements[0], '"async_tasks"."tenant_id"', 7);
    state.permissions.add('system:async-task:list');
    await resolver.resolve({ type: 'tasks.async', key: '21' }, access);
    expectBinding(statements[1], '"async_tasks"."tenant_id"', 7);
    expect(statements[1].sql).not.toContain('"async_tasks"."created_by"');
  });

  it.each(['0', '-1', '21x', '1.2', '001', '2147483648'])('rejects noncanonical integer identity %s without queries', async (key) => {
    state.permissions.add('system:user:list');
    const { access, tx } = captureAccess();
    expect(await identityAnchorResolvers[0].resolve({ type: 'identity.user', key }, access)).toBeNull();
    expect(tx.select).not.toHaveBeenCalled();
  });
});
