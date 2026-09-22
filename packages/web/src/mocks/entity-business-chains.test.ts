import { describe, expect, it } from 'vitest';
import type { HttpHandler } from 'msw';
import { businessFileContract, entityRelationsContract, entityRelationPageSchema, type CanonicalEntityType } from '@zenith/shared/platform';
import { memberFulfillmentContract } from '@zenith/shared/member';
import { iotFirmwareContract, iotOtaTaskContract } from '@zenith/shared/iot';
import { urlOf } from '@/lib/contract-query';
import { entityDetailRoute } from '@/utils/entity-relations';
import { entityRelationsHandlers } from './handlers/entity-relations';
import { businessFileDetailHandlers } from './handlers/business-file-details';
import { memberAdminHandlers } from './handlers/member-admin';
import { iotHandlers } from './handlers/iot';
import { mockMemberWalletTxs } from './data/members';
import { mockVipRenewals } from './data/payment-contracts';
import { mockPaymentOrders } from './data/payment';
import { mockIotFirmwares, mockIotOtaTaskDevices } from './data/iot';
import { mockAnnouncements } from './data/announcements';
import { mockAccessToken } from './utils/auth';

async function call(path: string, token = mockAccessToken('admin')) {
  const request = new Request(`${window.location.origin}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  for (const handler of [...entityRelationsHandlers, ...businessFileDetailHandlers, ...memberAdminHandlers, ...iotHandlers]) {
    const result = await (handler as HttpHandler).run({ request, requestId: 'business-chain-test' });
    if (result?.response) return result.response;
  }
  throw new Error('No handler matched');
}
async function section(type: CanonicalEntityType, key: string, suffix: string) {
  const response = await call(urlOf(entityRelationsContract.section, { params: { type, key, sectionKey: `${type}.${suffix}` }, query: { limit: 50 } }));
  return entityRelationPageSchema.parse((await response.json()).data);
}

describe('business chain details and relation identities', () => {
  it('follows explicit wallet payment-intention references in both directions without matching the free-form business key', async () => {
    const order = mockPaymentOrders[0], wallet = mockMemberWalletTxs[0];
    const beforeOrder = { ...order }, beforeWallet = { ...wallet };
    try {
      order.bizType = 'member_recharge';
      wallet.paymentIntentNo = order.orderNo;
      wallet.bizId = 'unrelated-display-reference';
      expect((await section('payment.order', String(order.id), 'wallet-transactions')).items.map((row) => row.ref.key)).toContain(String(wallet.id));
      expect((await section('member.wallet-transaction', String(wallet.id), 'order')).items.map((row) => row.ref.key)).toEqual([String(order.id)]);
      wallet.paymentIntentNo = null;
      wallet.bizId = order.orderNo;
      expect((await section('member.wallet-transaction', String(wallet.id), 'order')).items).toEqual([]);
    } finally { Object.assign(order, beforeOrder); Object.assign(wallet, beforeWallet); wallet.paymentIntentNo = beforeWallet.paymentIntentNo; }
  });

  it('serves exact wallet and renewal details independently of list pagination', async () => {
    const wallet = await call(urlOf(memberFulfillmentContract.walletTransaction, { params: { id: mockMemberWalletTxs[0].id } }));
    expect((await wallet.json()).data.balanceAfter).toBe(mockMemberWalletTxs[0].balanceAfter);
    const renewal = await call(urlOf(memberFulfillmentContract.vipRenewal, { params: { id: mockVipRenewals[0].id } }));
    expect((await renewal.json()).data.vipExpireAfter).toBe(mockVipRenewals[0].vipExpireAfter);
  });

  it('resolves device execution, parent task and firmware by their own IDs', async () => {
    const result = mockIotOtaTaskDevices[0];
    expect((await section('iot.ota-device', String(result.id), 'ota-tasks')).items.map((row) => row.ref.key)).toEqual([String(result.taskId)]);
    expect((await section('iot.ota-device', String(result.id), 'device')).items.map((row) => row.ref.key)).toEqual([String(result.deviceId)]);
    const response = await call(urlOf(iotOtaTaskContract.deviceDetail, { params: { id: result.id } }));
    expect((await response.json()).data.id).toBe(result.id);
    const firmware = await call(urlOf(iotFirmwareContract.detail, { params: { id: mockIotFirmwares[0].id } }));
    expect((await firmware.json()).data.sha256).toBe(mockIotFirmwares[0].sha256);
  });

  it('preserves managed UUID identity and revokes access when its last visible business reference disappears', async () => {
    const notice = mockAnnouncements[0];
    const fileId = '0197aabb-1111-7000-8000-000000000001';
    const attachment = { id: 90901, fileId, sortOrder: 0, createdAt: notice.createdAt,
      file: { id: fileId, originalName: 'business-note.txt', size: 4, mimeType: 'text/plain', extension: 'txt', url: 'data:text/plain,test' } };
    notice.attachments.push(attachment);
    const detailUrl = urlOf(businessFileContract.managedDetail, { params: { fileId } });
    try {
      expect((await section('messaging.announcement', String(notice.id), 'business-attachments')).items[0].ref).toEqual({ type: 'platform.managed-file', key: fileId });
      expect((await section('platform.managed-file', fileId, 'announcement-usages')).items.map((row) => row.ref.key)).toContain(String(notice.id));
      expect((await call(detailUrl)).status).toBe(200);
      expect((await call(detailUrl, mockAccessToken('admin', 7))).status).toBe(404);
      expect(entityDetailRoute({ type: 'platform.managed-file', key: fileId })).toBeUndefined();
    } finally { notice.attachments.splice(notice.attachments.indexOf(attachment), 1); }
    expect((await call(detailUrl)).status).toBe(404);
  });
});
