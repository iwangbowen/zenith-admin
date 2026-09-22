import type { CanonicalEntityRef, CanonicalEntityType, EntityRelationItem, EntityRelationSection } from '@zenith/shared/platform';
import { WALLET_TX_TYPES, WALLET_TX_TYPE_LABELS } from '@zenith/shared/member';
import { IOT_OTA_DEVICE_STATUS_OPTIONS, IOT_OTA_TASK_STATUS_OPTIONS } from '@zenith/shared/iot';
import { mockMemberWalletTxs } from '@/mocks/data/members';
import { mockVipRenewals } from '@/mocks/data/payment-contracts';
import { mockPaymentOrders } from '@/mocks/data/payment';
import { mockIotDevices, mockIotFirmwares, mockIotOtaTaskDevices, mockIotOtaTasks } from '@/mocks/data/iot';
import { mockWikiDocs } from '@/mocks/data/wiki';
import { mockAnnouncements } from '@/mocks/data/announcements';
import { isMockPlatformAdmin, type MockSession } from '@/mocks/utils/auth';

/** Fixtures are platform-owned, so tenant viewing must never reuse them. */
export function canReadBusinessChainFixtures(session: MockSession) { return session.viewingTenantId == null && isMockPlatformAdmin(session.user); }

export function mockBusinessAttachments() {
  return [
    ...mockWikiDocs.filter((doc) => !doc.deletedAt).flatMap((doc) => (doc.attachments ?? []).map((attachment) => ({ owner: { type: 'wiki.document' as const, key: String(doc.id) }, attachment }))),
    ...mockAnnouncements.flatMap((doc) => doc.attachments.map((attachment) => ({ owner: { type: 'messaging.announcement' as const, key: String(doc.id) }, attachment }))),
  ];
}

export function mockBusinessChainItem(ref: CanonicalEntityRef, relationKey = 'common.record'): EntityRelationItem | undefined {
  const id = Number(ref.key);
  const base = { ref, relationKey, capabilities: { view: true, open: true } };
  if (ref.type === 'member.wallet-transaction') {
    const row = mockMemberWalletTxs.find((item) => item.id === id);
    return row ? { ...base, title: row.paymentIntentNo || `钱包流水 #${id}`, subtitle: `¥${(row.amount / 100).toFixed(2)}`,
      description: row.remark ?? undefined, status: row.type, occurredAt: row.createdAt } : undefined;
  }
  if (ref.type === 'member.vip-renewal') {
    const row = mockVipRenewals.find((item) => item.id === id);
    return row ? { ...base, title: row.orderNo, subtitle: `¥${(row.amount / 100).toFixed(2)}`, status: 'completed', occurredAt: row.createdAt } : undefined;
  }
  if (ref.type === 'iot.ota-task') {
    const row = mockIotOtaTasks.find((item) => item.id === id);
    return row ? { ...base, title: row.title, subtitle: row.firmwareVersion, status: row.status, attention: row.status === 'paused', occurredAt: row.createdAt } : undefined;
  }
  if (ref.type === 'iot.ota-device') {
    const row = mockIotOtaTaskDevices.find((item) => item.id === id);
    const task = row && mockIotOtaTasks.find((item) => item.id === row.taskId);
    const device = row && mockIotDevices.find((item) => item.id === row.deviceId);
    return row && task && device ? { ...base, title: `${device.name} · ${task.title}`.slice(0, 160), subtitle: task.firmwareVersion,
      status: row.status, attention: row.status === 'failed', description: row.errorMsg ?? undefined, occurredAt: row.notifiedAt ?? task.createdAt } : undefined;
  }
  if (ref.type === 'iot.firmware') {
    const row = mockIotFirmwares.find((item) => item.id === id);
    return row ? { ...base, title: row.version, subtitle: row.fileName, status: row.status, occurredAt: row.createdAt } : undefined;
  }
  if (ref.type === 'messaging.announcement') {
    const row = mockAnnouncements.find((item) => item.id === id);
    return row ? { ...base, title: row.title, status: row.publishStatus, occurredAt: row.createdAt } : undefined;
  }
  if (ref.type === 'platform.managed-file') {
    const row = mockBusinessAttachments().find((item) => item.attachment.fileId === ref.key)?.attachment;
    return row ? { ...base, title: row.file.originalName, subtitle: row.file.mimeType, occurredAt: row.createdAt } : undefined;
  }
}

type Definition = readonly [suffix: string, target: CanonicalEntityType, one?: boolean];
const definitions: Partial<Record<CanonicalEntityType, readonly Definition[]>> = {
  'member.member': [['wallet-transactions', 'member.wallet-transaction'], ['vip-renewals', 'member.vip-renewal']],
  'member.wallet-transaction': [['member', 'member.member', true], ['order', 'payment.order', true]],
  'member.vip-renewal': [['member', 'member.member', true], ['order', 'payment.order', true]],
  'iot.device': [['ota-tasks', 'iot.ota-task'], ['ota-devices', 'iot.ota-device']],
  'iot.ota-task': [['ota-devices', 'iot.ota-device'], ['firmware', 'iot.firmware', true]],
  'iot.ota-device': [['ota-tasks', 'iot.ota-task', true], ['firmware', 'iot.firmware', true], ['device', 'iot.device', true]],
  'iot.firmware': [['ota-tasks', 'iot.ota-task']],
  'wiki.document': [['business-attachments', 'platform.managed-file']],
  'messaging.announcement': [['business-attachments', 'platform.managed-file']],
  'platform.managed-file': [['wiki-usages', 'wiki.document'], ['announcement-usages', 'messaging.announcement']],
};

export function mockBusinessChainSections(ref: CanonicalEntityRef): EntityRelationSection[] {
  let declared = definitions[ref.type] ?? [];
  if (ref.type === 'payment.order') {
    const order = mockPaymentOrders.find((row) => row.id === Number(ref.key));
    declared = order?.bizType === 'member_recharge' ? [['wallet-transactions', 'member.wallet-transaction']]
      : order?.bizType === 'member_renewal' ? [['vip-renewals', 'member.vip-renewal']] : [];
  }
  return declared.map(([suffix, target, one]) => {
    const key = `${ref.type}.${suffix}`;
    const task = target === 'iot.ota-task', result = target === 'iot.ota-device';
    return { key, labelKey: `relation.${key}`, targetTypes: [target], kind: ref.type.startsWith('member.') || target.startsWith('member.') ? 'causal' : 'direct',
      cardinality: one ? 'one' : 'many', capabilities: { view: true, open: true }, summaryState: 'unavailable',
      filters: one && !task ? {} : { keyword: true, dateRange: true,
        ...(task || result ? { attentionOnly: true, statusOptions: [...(task ? IOT_OTA_TASK_STATUS_OPTIONS : IOT_OTA_DEVICE_STATUS_OPTIONS)] } : {}),
        ...(target === 'member.wallet-transaction' ? { statusOptions: WALLET_TX_TYPES.map((value) => ({ value, label: WALLET_TX_TYPE_LABELS[value] })) } : {}),
      } };
  });
}

export function mockBusinessChainRefs(ref: CanonicalEntityRef, section: string): CanonicalEntityRef[] | undefined {
  if (!mockBusinessChainSections(ref).some((row) => row.key === section)) return undefined;
  const suffix = section.slice(ref.type.length + 1), id = Number(ref.key);
  const refs = (type: CanonicalEntityType, rows: readonly { id: number }[]) => rows.toSorted((a, b) => b.id - a.id).map((row) => ({ type, key: String(row.id) }));
  const wallet = mockMemberWalletTxs.find((row) => row.id === id);
  const renewal = mockVipRenewals.find((row) => row.id === id);
  if (suffix === 'wallet-transactions') {
    const order = mockPaymentOrders.find((row) => row.id === id);
    return refs('member.wallet-transaction', mockMemberWalletTxs.filter((row) => ref.type === 'member.member' ? row.memberId === id
      : row.type === 'recharge' && row.bizType === 'member_recharge' && row.paymentIntentNo === order?.orderNo));
  }
  if (suffix === 'vip-renewals') {
    const order = mockPaymentOrders.find((row) => row.id === id);
    return refs('member.vip-renewal', mockVipRenewals.filter((row) => ref.type === 'member.member' ? row.memberId === id : row.orderNo === order?.orderNo));
  }
  if (suffix === 'member') { const record = ref.type === 'member.wallet-transaction' ? wallet : renewal; return record ? [{ type: 'member.member', key: String(record.memberId) }] : []; }
  if (suffix === 'order') {
    const number = ref.type === 'member.wallet-transaction' ? wallet?.paymentIntentNo : renewal?.orderNo;
    return refs('payment.order', mockPaymentOrders.filter((row) => row.orderNo === number
      && row.bizType === (ref.type === 'member.wallet-transaction' ? 'member_recharge' : 'member_renewal')));
  }
  const result = mockIotOtaTaskDevices.find((row) => row.id === id);
  if (suffix === 'ota-tasks') return refs('iot.ota-task', mockIotOtaTasks.filter((row) => ref.type === 'iot.firmware' ? row.firmwareId === id
    : ref.type === 'iot.ota-device' ? row.id === result?.taskId : mockIotOtaTaskDevices.some((r) => r.taskId === row.id && r.deviceId === id)));
  if (suffix === 'ota-devices') return refs('iot.ota-device', mockIotOtaTaskDevices.filter((row) => ref.type === 'iot.device' ? row.deviceId === id : row.taskId === id));
  if (suffix === 'firmware') {
    const task = mockIotOtaTasks.find((row) => row.id === (ref.type === 'iot.ota-device' ? result?.taskId : id));
    return task ? [{ type: 'iot.firmware', key: String(task.firmwareId) }] : [];
  }
  if (suffix === 'device') return result ? [{ type: 'iot.device', key: String(result.deviceId) }] : [];
  if (suffix === 'business-attachments') return mockBusinessAttachments().filter((row) => row.owner.type === ref.type && row.owner.key === ref.key)
    .map((row) => ({ type: 'platform.managed-file', key: row.attachment.fileId }));
  return mockBusinessAttachments().filter((row) => row.attachment.fileId === ref.key && row.owner.type === (suffix === 'wiki-usages' ? 'wiki.document' : 'messaging.announcement')).map((row) => row.owner);
}
