/**
 * App 推送 Mock 数据（Demo 模式）。
 * 配置/记录/设备均为演示数据;设备与「应用版本」域的 SEED_CLIENT_APPS 关联。
 */
import type { PushConfig, PushSendLog } from '@zenith/shared/messaging';
import type { ClientDevice } from '@zenith/shared/ops';
import { mockDateTime } from '@/mocks/utils/date';
import { nextIdFrom } from '@/mocks/utils/handlers';

const now = mockDateTime();

export const mockPushConfigs: PushConfig[] = [
  {
    id: 1, appId: 2, appName: 'Zenith 移动端', name: '极光-生产', provider: 'jpush', appKey: 'a1b2******c3d4',
    apnsProduction: true, status: 'enabled', remark: '生产环境聚合推送',
    createdAt: now, updatedAt: now,
  },
];

export const mockPushSendLogs: PushSendLog[] = [
  {
    id: 1, configId: 1, appId: 2, appName: 'Zenith 移动端', provider: 'jpush', subjectType: 'user', subjectId: 1, subjectName: '管理员',
    deviceCount: 2, title: '待办审批提醒', content: '你有一条新的待办：流程「请假申请」（节点：部门审批），请及时处理',
    link: '/approval/tasks/1', eventKey: 'workflow.task.created', status: 'success',
    providerMsgId: '18101216-1a2b3c', deliveryStatus: 'clicked', deliveredAt: now, clickedAt: now,
    errorMsg: null, source: 'system', tenantId: null, sentAt: now, createdAt: now,
  },
  {
    id: 2, configId: 1, appId: 2, appName: 'Zenith 移动端', provider: 'jpush', subjectType: null, subjectId: null, subjectName: null,
    deviceCount: 1, title: 'Zenith 推送测试', content: '这是一条测试推送,收到说明通道配置正确',
    link: null, eventKey: null, status: 'failed',
    providerMsgId: null, deliveryStatus: null, deliveredAt: null, clickedAt: null,
    errorMsg: '极光推送失败: [1011] 目标设备不存在', source: 'test', tenantId: null, sentAt: now, createdAt: now,
  },
];

export const mockClientDevices: ClientDevice[] = [
  {
    id: 1, deviceId: 'demo-desktop-001', appId: 1, appName: 'Zenith 桌面端',
    platform: 'windows', arch: 'x64', deviceModel: null, osVersion: 'Windows 11',
    appVersion: '1.85.0', subjectType: null, subjectId: null, subjectName: null,
    pushProvider: null, pushRegistrationId: null, pushEnabled: true,
    createdAt: now, lastActiveAt: now,
  },
  {
    id: 2, deviceId: 'demo-phone-001', appId: 2, appName: 'Zenith 移动端',
    platform: 'android', arch: 'arm64', deviceModel: 'Xiaomi 15', osVersion: 'Android 15',
    appVersion: '1.10.0', subjectType: 'user', subjectId: 1, subjectName: '管理员',
    pushProvider: 'jpush', pushRegistrationId: '181abc001', pushEnabled: true,
    createdAt: now, lastActiveAt: now,
  },
  {
    id: 3, deviceId: 'demo-phone-002', appId: 2, appName: 'Zenith 移动端',
    platform: 'ios', arch: 'arm64', deviceModel: 'iPhone 17', osVersion: 'iOS 19',
    appVersion: '1.10.0', subjectType: 'member', subjectId: 1, subjectName: '演示会员',
    pushProvider: 'jpush', pushRegistrationId: '181abc002', pushEnabled: false,
    createdAt: now, lastActiveAt: now,
  },
];

let nextPushConfigId = nextIdFrom(mockPushConfigs);
export function getNextPushConfigId(): number {
  return nextPushConfigId++;
}

let nextPushSendLogId = nextIdFrom(mockPushSendLogs);
export function getNextPushSendLogId(): number {
  return nextPushSendLogId++;
}
