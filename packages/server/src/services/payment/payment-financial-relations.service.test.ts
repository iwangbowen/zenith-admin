import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { JwtPayload } from '../../middleware/auth';
import type { RelationAccessContext, VisibleEntityAnchor } from '../platform/relations/types';

const state = vi.hoisted(() => ({ permissions: new Set<string>(), orderWhere: vi.fn(),
  user: { userId: 9, username: 'reviewer', roles: ['super_admin'], tenantId: null } as JwtPayload }));
vi.mock('../../config', () => ({ config: { multiTenantMode: true, jwtSecret: 'financial-relation-unit-secret' } }));
vi.mock('../../lib/context', () => ({ currentUser: () => state.user,
  hasPermission: async (...permissions: string[]) => permissions.some((permission) => state.permissions.has(permission)),
  runWithCurrentUser: async (_user: JwtPayload, fn: () => unknown) => fn(),
}));
vi.mock('./payment.service', () => ({ buildOrdersWhere: (...args: unknown[]) => state.orderWhere(...args) }));

import { paymentOrders } from '../../db/schema';
import { paymentFinancialAnchorResolvers, paymentFinancialRelationProviders } from './payment-financial-relations.service';

type Statement = { sql: string; params: unknown[] };
type Query = { execute: () => Promise<unknown[]>; toSQL: () => Statement };
function capture(results: unknown[][] = []) {
  const tx = drizzle.mock({ casing: 'snake_case' });
  const statements: Statement[] = [];
  const select = tx.select.bind(tx);
  vi.spyOn(tx, 'select').mockImplementation((...args: unknown[]) => {
    const builder = Reflect.apply(select, tx, args);
    const from = builder.from;
    builder.from = (...fromArgs: unknown[]) => {
      const query = Reflect.apply(from, builder, fromArgs) as Query;
      query.execute = async () => { statements.push(query.toSQL()); return results.shift() ?? []; };
      return query;
    };
    return builder;
  });
  return { access: { user: state.user, db: tx as unknown as RelationAccessContext['db'] }, statements, tx };
}
const scope = { tenantId: 7, appId: 17, channelAccountId: 27, currency: 'CNY', orderId: 11, orderNo: 'PO-11', channelConfigId: 37 };
function anchor(type: VisibleEntityAnchor['ref']['type'], metadata: VisibleEntityAnchor['metadata'] = {}): VisibleEntityAnchor {
  return { ref: { type, key: '11' }, title: 'Anchor', tenantId: 7, metadata: { ...scope, ...metadata } };
}
function provider(key: string) {
  const result = paymentFinancialRelationProviders.find((entry) => entry.key === key);
  if (!result) throw new Error(`Missing provider ${key}`);
  return result;
}
function binding(statement: Statement, column: string, value: unknown, operator = '=') {
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped} ${operator} \\$(\\d+)`).exec(statement.sql);
  expect(match, `Missing ${column} ${operator}`).not.toBeNull();
  expect(statement.params[Number(match![1]) - 1]).toEqual(value);
}
function expectMoneyScope(statement: Statement, table: string) {
  binding(statement, `"${table}"."tenant_id"`, 7);
  binding(statement, `"${table}"."app_id"`, 17);
  binding(statement, `"${table}"."channel_account_id"`, 27);
  binding(statement, `"${table}"."currency"`, 'CNY');
}
beforeEach(() => {
  state.permissions.clear();
  state.orderWhere.mockReset().mockImplementation(async () => eq(paymentOrders.createdBy, 9));
});

describe('payment financial relation boundaries', () => {
  it.each(paymentFinancialRelationProviders.map((entry) => [entry.key, entry] as const))('%s does not query without target permission', async (_key, entry) => {
    const { access, tx } = capture();
    expect(await entry.list(anchor(entry.sourceType), { limit: 2, access })).toEqual({ items: [], nextCursor: null, hasMore: false });
    expect(tx.select).not.toHaveBeenCalled();
  });

  it.each(paymentFinancialAnchorResolvers)('$type anchors deny missing financial permission before querying', async (resolver) => {
    const { access, tx } = capture();
    expect(await resolver.resolve({ type: resolver.type, key: '11' }, access)).toBeNull();
    expect(tx.select).not.toHaveBeenCalled();
  });

  it('has unique namespaced keys without colliding with generic relation groups', () => {
    expect(new Set(paymentFinancialRelationProviders.map((entry) => entry.key)).size).toBe(paymentFinancialRelationProviders.length);
    for (const entry of paymentFinancialRelationProviders) {
      expect(entry.key).toBe(entry.descriptor.key);
      expect(entry.key).toMatch(new RegExp(`^${entry.sourceType.replaceAll('.', '\\.')}\\.`));
      expect(['audit', 'notifications', 'tasks', 'links'].map((key) => `${entry.sourceType}.${key}`)).not.toContain(entry.key);
    }
  });

  it('requires complete money scope and known producer semantics for an order journal', async () => {
    state.permissions.add('payment:ledger:list');
    const { access, statements } = capture([[scope], []]);
    await provider('payment.order.journals').list(anchor('payment.order'), { limit: 2, cursor: '50', access });
    expect(state.orderWhere).toHaveBeenCalledWith({}, access.db);
    const query = statements[1];
    expectMoneyScope(query, 'payment_journals');
    expect(query.params).toEqual(expect.arrayContaining(['payment.capture', 'payment.preauth.capture', 'payment.fee', 'payment.refund', 'payment.fee_refund', 'payment.sharing', 'payment.sharing_reversal', 'recon.adjust', 'recon.adjust.reversal', 'journal.reversal']));
    expect(query.sql).toContain('"payment_journals"."source_id" = "payment_orders"."order_no"');
    expect(query.sql).toContain('"payment_refunds"."order_id" = "payment_orders"."id"');
    expect(query.sql).toContain('"payment_refunds"."channel_account_id" = "payment_orders"."channel_account_id"');
    expect(query.sql).toContain('"relation_original_journal"."id" = "payment_journals"."reversal_of_journal_id"');
    binding(query, '"payment_journals"."id"', 50, '<');
    expect(query.sql).toMatch(/order by "payment_journals"\."id" desc limit \$\d+$/);
    expect(query.params.at(-1)).toBe(3);
  });

  it('refund journals bind the refund ID to its own order and never infer a sharing relationship', async () => {
    state.permissions.add('payment:ledger:list');
    const { access, statements } = capture([[{ ...scope, refundId: 12, refundNo: 'RF-12' }], []]);
    await provider('payment.refund.journals').list(anchor('payment.refund'), { limit: 5, access });
    expect(statements[0].sql).toContain('"payment_refunds"."order_no" = "payment_orders"."order_no"');
    expect(statements[0].sql).toContain('"payment_refunds"."tenant_id" is not distinct from "payment_orders"."tenant_id"');
    const query = statements[1];
    binding(query, '"payment_refunds"."id"', 12);
    expect(query.sql).toContain('"payment_journals"."source_id" = "payment_refunds"."refund_no"');
    expect(query.params).not.toContain('payment.capture');
    expect(query.params).not.toContain('payment.sharing');
    expect(query.sql).toContain('"payment_recon_cases"."refund_id" = "payment_refunds"."id"');
  });

  it('refund reconciliation records require both refund ID and original order ID', async () => {
    state.permissions.add('payment:recon:list');
    const { access, statements } = capture([[{ ...scope, refundId: 12, refundNo: 'RF-12' }], []]);
    await provider('payment.refund.recon-cases').list(anchor('payment.refund'), { limit: 2, access });
    binding(statements[1], '"payment_recon_cases"."order_id"', 11);
    binding(statements[1], '"payment_recon_cases"."refund_id"', 12);
    binding(statements[1], '"payment_recon_cases"."application_id"', 17);
    binding(statements[1], '"payment_recon_cases"."account_id"', 27);
    binding(statements[1], '"payment_recon_cases"."currency"', 'CNY');
  });

  it('settlements follow claimed journal lines rather than date/amount guesses', async () => {
    state.permissions.add('payment:settlement:list');
    const { access, statements } = capture([[scope], []]);
    await provider('payment.order.settlement-batches').list(anchor('payment.order'), { limit: 2, access });
    const query = statements[1];
    expectMoneyScope(query, 'payment_settlement_batches');
    expect(query.sql).toContain('"payment_journal_lines"."id" = "payment_settlement_items"."journal_line_id"');
    expect(query.sql).toContain('"payment_journals"."id" = "payment_journal_lines"."journal_id"');
    expect(query.sql).toContain('"payment_settlement_items"."batch_id" = "payment_settlement_batches"."id"');
    for (const column of ['app_id', 'channel_account_id', 'currency']) expect(query.sql).toContain(`"payment_settlement_items"."${column}" = "payment_settlement_batches"."${column}"`);
    expect(query.sql).not.toContain('period_start');
    expect(query.sql).not.toContain('gross_amount');
  });

  it('settlement batch journals include its own posting lifecycle within the full money scope', async () => {
    state.permissions.add('payment:ledger:list');
    const { access, statements } = capture();
    await provider('payment.settlement-batch.journals').list(anchor('payment.settlement-batch', { title: 'SETTLE-11' }), { limit: 2, cursor: '50', access });
    const query = statements[0];
    expectMoneyScope(query, 'payment_journals');
    expect(query.params).toEqual(expect.arrayContaining(['settlement.initiated', 'settlement.paid', 'settlement.failed']));
    binding(query, '"payment_journals"."source_id"', 'SETTLE-11');
    binding(query, '"payment_settlement_items"."batch_id"', 11);
    binding(query, '"payment_journals"."id"', 50, '<');
    expect(query.sql).toContain('"payment_journal_lines"."id" = "payment_settlement_items"."journal_line_id"');
    expect(query.sql).not.toContain('period_start');
    expect(query.params.at(-1)).toBe(3);
  });

  it('a settlement posting resolves its batch by authoritative number and money scope without requiring claimed lines', async () => {
    state.permissions.add('payment:settlement:list');
    const { access, statements } = capture();
    await provider('payment.journal.settlement-batches').list(anchor('payment.journal'), { limit: 2, access });
    const query = statements[0];
    expectMoneyScope(query, 'payment_settlement_batches');
    binding(query, '"payment_journals"."id"', 11);
    expect(query.params).toEqual(expect.arrayContaining(['settlement.initiated', 'settlement.paid', 'settlement.failed']));
    expect(query.sql).toContain('"payment_journals"."source_id" = "payment_settlement_batches"."batch_no"');
    expect(query.sql).toMatch(/exists \(select .*from "payment_journals" where .*\) or exists \(select .*from "payment_settlement_items"/);
    expect(query.sql).toContain('"payment_journals"."tenant_id" is not distinct from "payment_settlement_batches"."tenant_id"');
    for (const column of ['app_id', 'channel_account_id', 'currency']) expect(query.sql).toContain(`"payment_journals"."${column}" = "payment_settlement_batches"."${column}"`);
  });

  it('reverse journal orders retain domain data scope on the same transaction', async () => {
    state.permissions.add('payment:order:list');
    const { access, statements } = capture();
    await provider('payment.journal.orders').list(anchor('payment.journal'), { limit: 2, access });
    expect(state.orderWhere).toHaveBeenCalledWith({}, access.db);
    expectMoneyScope(statements[0], 'payment_orders');
    binding(statements[0], '"payment_orders"."created_by"', 9);
    binding(statements[0], '"payment_journals"."id"', 11);
  });

  it('reverse reconciliation refunds cannot attach a refund from another order in the same app', async () => {
    state.permissions.add('payment:refund:list');
    const { access, statements } = capture();
    await provider('payment.recon-case.refunds').list(anchor('payment.recon-case', { refundId: 12, orderId: 22 }), { limit: 2, access });
    binding(statements[0], '"payment_refunds"."id"', 12);
    binding(statements[0], '"payment_orders"."id"', 22);
    expectMoneyScope(statements[0], 'payment_orders');
  });

  it('only successfully processed, verified callbacks with authoritative app/order/config are linked', async () => {
    state.permissions.add('payment:log:list');
    const { access, statements } = capture([[scope], []]);
    await provider('payment.order.notify-logs').list(anchor('payment.order'), { limit: 2, access });
    const query = statements[1];
    binding(query, '"payment_notify_logs"."order_no"', 'PO-11');
    binding(query, '"payment_notify_logs"."app_id"', 17);
    binding(query, '"payment_notify_logs"."channel_config_id"', 37);
    binding(query, '"payment_notify_logs"."signature_valid"', true);
    binding(query, '"payment_channel_configs"."channel_account_id"', 27);
    expect(query.sql).toContain("like 'processed:%'");
    expect(query.sql).toContain('"payment_notify_logs"."currency" is null');
    expect(query.sql).not.toContain('raw_body');
    expect(query.sql).not.toContain('headers');
    expect(paymentFinancialRelationProviders.some((entry) => entry.key === 'payment.refund.notify-logs')).toBe(false);
  });

  it('callback anchors derive currency from the validated order when the provider omitted it', async () => {
    state.permissions.add('payment:log:list');
    const { access, statements } = capture();
    await paymentFinancialAnchorResolvers.find((entry) => entry.type === 'payment.notify-log')!.resolve({ type: 'payment.notify-log', key: '11' }, access);
    expect(statements[0].sql).toContain('"payment_orders"."currency"');
    expect(statements[0].sql).toContain('"payment_notify_logs"."app_id" = "payment_orders"."app_id"');
    expect(statements[0].sql).toContain("like 'processed:%'");
  });

  it('sharing receiver summaries exclude account details and enforce exact ownership', async () => {
    state.permissions.add('payment:sharing:list');
    const { access, statements } = capture();
    await provider('payment.sharing-order.receiver').list(anchor('payment.sharing-order', { receiverId: 41 }), { limit: 2, access });
    binding(statements[0], '"payment_sharing_receivers"."tenant_id"', 7);
    binding(statements[0], '"payment_sharing_receivers"."id"', 41);
    expect(statements[0].sql).not.toContain('"account"');
  });

  it('sharing reversals require the matching journal source type and identifier', async () => {
    state.permissions.add('payment:sharing:list');
    const { access, statements, tx } = capture([[{ id: 8, title: 'REV-1', status: 'success', at: new Date() }]]);
    const entry = provider('payment.journal.sharing-reversals');
    expect(await entry.list(anchor('payment.journal', { sourceType: 'payment.capture', sourceId: 'REV-1' }), { limit: 2, access })).toEqual({ items: [], nextCursor: null, hasMore: false });
    expect(tx.select).not.toHaveBeenCalled();
    const result = await entry.list(anchor('payment.journal', { sourceType: 'payment.sharing_reversal', sourceId: 'REV-1' }), { limit: 2, access });
    expect(result.items[0].relationKey).toBe(entry.key);
    binding(statements[0], '"payment_sharing_reversals"."reversal_no"', 'REV-1');
    expectMoneyScope(statements[0], 'payment_orders');
  });

  it('returns a stable last-shown keyset without counts or lookahead rows', async () => {
    state.permissions.add('payment:ledger:list');
    const row = (id: number) => ({ id, title: `J-${id}`, subtitle: 'payment.capture', at: new Date('2026-09-20T00:00:00Z') });
    const { access, statements } = capture([[scope], [row(50), row(40), row(30)], [scope], [row(30)]]);
    const entry = provider('payment.order.journals');
    const first = await entry.list(anchor('payment.order'), { limit: 2, access });
    expect(first.items.map((item) => item.ref.key)).toEqual(['50', '40']);
    expect(first).toMatchObject({ hasMore: true, nextCursor: '40' });
    expect(first).not.toHaveProperty('total');
    const second = await entry.list(anchor('payment.order'), { limit: 2, cursor: first.nextCursor!, access });
    expect(second.items.map((item) => item.ref.key)).toEqual(['30']);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
    binding(statements[3], '"payment_journals"."id"', 40, '<');
  });
});
