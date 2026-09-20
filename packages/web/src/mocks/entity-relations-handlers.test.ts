import { describe, expect, it } from 'vitest';
import type { HttpHandler } from 'msw';
import { entityRelationsContract, entityRelationsResponseSchema, entityRelationPageSchema, entityTimelineContract, entityTimelineResponseSchema, type CanonicalEntityType } from '@zenith/shared/platform';
import { paymentReconContract } from '@zenith/shared/payment';
import { notificationPolicyContract } from '@zenith/shared/messaging';
import { urlOf } from '@/lib/contract-query';
import { entityRelationsHandlers, entityTimelineHandlers } from './handlers/entity-relations';
import { mockPaymentRefunds } from './data/payment';
import { mockAccessToken } from './utils/auth';
import { mockPaymentJournals } from './handlers/payment-journals';
import { mockPaymentSettlements } from './handlers/payment-bext';
import { paymentExtHandlers } from './handlers/payment-ext';
import { notificationPoliciesHandlers } from './handlers/notification-policies';
import { mockOperationLogs } from './data/logs';
import { mockAsyncTasks } from './handlers/async-tasks';
import { mockEntitySubjects } from './data/entity-subjects';

async function call(path: string, { method = 'GET', body, token = mockAccessToken('admin') }: { method?: string; body?: unknown; token?: string | null } = {}) {
  const request = new Request(`${window.location.origin}${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const handler of [...entityRelationsHandlers, ...entityTimelineHandlers, ...paymentExtHandlers, ...notificationPoliciesHandlers]) {
    const result = await (handler as HttpHandler).run({ request, requestId: 'entity-relations-test' });
    if (result?.response) return result.response;
  }
  throw new Error('No handler matched');
}

describe('Demo entity relations follow the real domain data', () => {
  const params = { type: 'payment.order' as const, key: '1' };
  const section = async (type: CanonicalEntityType, key: string, suffix: string) => entityRelationPageSchema.parse((await (await call(urlOf(entityRelationsContract.section, {
    params: { type, key, sectionKey: `${type}.${suffix}` }, query: { limit: 50 },
  }))).json()).data);

  it('resolves real ledger identities in both directions and excludes a different money scope', async () => {
    const journal = mockPaymentJournals.find((row) => row.sourceType === 'payment.capture' && row.sourceId === 'PAY1700000000001')!;
    const unrelated = { ...journal, id: 99999, appId: 99999 };
    mockPaymentJournals.push(unrelated);
    try {
      expect((await section('payment.order', '1', 'journals')).items.map((row) => row.ref.key)).toContain(String(journal.id));
      expect((await section('payment.order', '1', 'journals')).items.some((row) => row.ref.key === String(unrelated.id))).toBe(false);
      expect((await section('payment.journal', String(journal.id), 'orders')).items.map((row) => row.ref.key)).toEqual(['1']);
    } finally { mockPaymentJournals.splice(mockPaymentJournals.indexOf(unrelated), 1); }
  });

  it('follows sharing receiver and reversal FKs without guessing a settlement by amount or date', async () => {
    expect((await section('payment.sharing-order', '1', 'receiver')).items[0].ref).toEqual({ type: 'payment.sharing-receiver', key: '1' });
    expect((await section('payment.sharing-reversal', '1', 'sharing-orders')).items[0].ref).toEqual({ type: 'payment.sharing-order', key: '1' });
    expect((await section('payment.settlement-batch', '1', 'orders')).items).toEqual([]);
    expect((await section('payment.notify-log', '1', 'orders')).items[0].ref).toEqual({ type: 'payment.order', key: '1' });
  });

  it.each(['settlement.initiated', 'settlement.paid', 'settlement.failed'])('links %s postings to their own settlement batch in both directions', async (sourceType) => {
    const batch = mockPaymentSettlements.find((row) => row.id === 1)!;
    const template = mockPaymentJournals.find((row) => row.appId === batch.appId && row.channelConfigId === batch.channelConfigId && row.currency === batch.currency)!;
    const journal = { ...template, id: 99998, sourceType, sourceId: batch.batchNo, lines: [] };
    const wrongScope = { ...journal, id: 99997, appId: 99999 };
    const wrongProducer = { ...journal, id: 99996, sourceType: 'payment.capture' };
    mockPaymentJournals.push(journal, wrongScope, wrongProducer);
    try {
      const related = (await section('payment.settlement-batch', '1', 'journals')).items.map((item) => item.ref.key);
      expect(related).toContain(String(journal.id));
      expect(related).not.toContain(String(wrongScope.id));
      expect(related).not.toContain(String(wrongProducer.id));
      expect((await section('payment.journal', String(journal.id), 'settlement-batches')).items.map((item) => item.ref.key)).toEqual(['1']);
    } finally { for (const item of [journal, wrongScope, wrongProducer]) mockPaymentJournals.splice(mockPaymentJournals.indexOf(item), 1); }
  });

  it('uses the real notification outbox ID and the explicitly recorded case subject', async () => {
    const response = await (await call(urlOf(notificationPolicyContract.dispatches, { query: { page: 1, pageSize: 20 } }))).json();
    const dispatch = response.data.list[0];
    expect(dispatch.id).not.toBe(dispatch.outboxId);
    expect((await section('notification.outbox', String(dispatch.outboxId), 'subjects')).items.map((row) => row.ref)).toEqual([{ type: 'payment.recon-case', key: '1' }]);
    expect((await call(urlOf(entityRelationsContract.describe, { params: { type: 'notification.outbox', key: String(dispatch.id) } }))).status).toBe(404);
  });

  it('records task and audit subjects when the existing compensation action creates them', async () => {
    const oldTaskIds = new Set(mockAsyncTasks.map((task) => task.id));
    const oldLogIds = new Set(mockOperationLogs.map((log) => log.id));
    try {
      const task = (await (await call(urlOf(paymentReconContract.compensate, { params: { id: 1 } }), { method: 'POST' })).json()).data;
      expect((await section('tasks.async', String(task.id), 'subjects')).items.map((row) => row.ref)).toEqual([{ type: 'payment.recon-case', key: '1' }]);
      const audit = mockOperationLogs.find((log) => !oldLogIds.has(log.id))!;
      expect((await section('platform.operation-log', String(audit.id), 'subjects')).items.map((row) => row.ref)).toContainEqual({ type: 'payment.recon-case', key: '1' });
      expect((await section('payment.recon-case', '1', 'tasks')).items.map((row) => row.ref.key)).toContain(String(task.id));
    } finally {
      for (let i = mockAsyncTasks.length - 1; i >= 0; i--) if (!oldTaskIds.has(mockAsyncTasks[i].id)) { mockEntitySubjects.delete(`tasks.async:${mockAsyncTasks[i].id}`); mockAsyncTasks.splice(i, 1); }
      for (let i = mockOperationLogs.length - 1; i >= 0; i--) if (!oldLogIds.has(mockOperationLogs[i].id)) { mockEntitySubjects.delete(`platform.operation-log:${mockOperationLogs[i].id}`); mockOperationLogs.splice(i, 1); }
    }
  });
  it('resolves an actual anchor and returns only refunds whose orderId matches', async () => {
    const description = await (await call(urlOf(entityRelationsContract.describe, { params }))).json();
    expect(entityRelationsResponseSchema.parse(description.data).anchor.title).toBe('PAY1700000000001');
    const response = await (await call(urlOf(entityRelationsContract.section, { params: { ...params, sectionKey: 'payment.order.refunds' }, query: { limit: 50 } }))).json();
    const data = entityRelationPageSchema.parse(response.data);
    expect(data.items.map((row) => row.ref.key)).toEqual(mockPaymentRefunds.filter((row) => row.orderId === 1).map((row) => String(row.id)));
  });

  it('rejects unauthenticated, missing anchors and unrelated groups', async () => {
    expect((await call(urlOf(entityRelationsContract.describe, { params }), { token: null })).status).toBe(401);
    expect((await call(urlOf(entityRelationsContract.describe, { params: { ...params, key: '999999' } }))).status).toBe(404);
    expect((await call(urlOf(entityRelationsContract.section, { params: { ...params, sectionKey: 'iot.device.alarms' }, query: { limit: 5 } }))).status).toBe(404);
    expect((await call(urlOf(entityRelationsContract.describe, { params }), { token: mockAccessToken('admin', 2) })).status).toBe(404);
  });

  it('creates, deduplicates and removes a manual link in both directions', async () => {
    const target = { type: 'wiki.document' as const, key: '1' };
    const linkUrl = urlOf(entityRelationsContract.link, { params });
    const targetPageUrl = urlOf(entityRelationsContract.section, { params: { ...target, sectionKey: 'wiki.document.links' }, query: { limit: 5 } });
    for (let i = 0; i < 2; i++) expect((await call(linkUrl, { method: 'POST', body: { target } })).status).toBe(200);
    const data = entityRelationPageSchema.parse((await (await call(targetPageUrl)).json()).data);
    expect(data.items.filter((row) => row.ref.type === params.type && row.ref.key === params.key)).toHaveLength(1);
    expect((await call(urlOf(entityRelationsContract.unlink, { params: target }), { method: 'DELETE', body: { target: params } })).status).toBe(200);
    expect((await (await call(targetPageUrl)).json()).data.items).toEqual([]);
  });

  it('uses real order timestamps for typed events and cursor pagination', async () => {
    const refundedOrder = { ...params, key: '3' };
    const first = entityTimelineResponseSchema.parse((await (await call(urlOf(entityTimelineContract.timeline, { params: refundedOrder, query: { limit: 1 } }))).json()).data);
    expect(first.items).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    const second = entityTimelineResponseSchema.parse((await (await call(urlOf(entityTimelineContract.timeline, { params: refundedOrder, query: { limit: 1, cursor: first.nextCursor! } }))).json()).data);
    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect(second.hasMore).toBe(false);
  });
});
