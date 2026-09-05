/**
 * App 推送 Mock（Demo 模式）：配置 CRUD / 测试发送 / 发送记录 / 设备中心。
 */
import { http } from 'msw';
import { pushConfigContract, pushSendLogContract } from '@zenith/shared/messaging';
import type { PushConfig } from '@zenith/shared/messaging';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound, ok, paginate } from '@/mocks/utils/handlers';
import { mockDateTime } from '@/mocks/utils/date';
import {
  getNextPushConfigId,
  getNextPushSendLogId,
  mockClientDevices,
  mockPushConfigs,
  mockPushSendLogs,
} from '../data/push';

export const pushHandlers = [
  // ─── 推送配置 ───────────────────────────────────────────────────────────────
  mock(pushConfigContract.list, ({ query, ok, paginate }) => {
    let list = [...mockPushConfigs];
    if (query.keyword) list = list.filter((c) => c.name.includes(query.keyword!) || (c.remark ?? '').includes(query.keyword!));
    if (query.provider) list = list.filter((c) => c.provider === query.provider);
    if (query.status) list = list.filter((c) => c.status === query.status);
    return ok(paginate(list));
  }),

  mock(pushConfigContract.detail, ({ params, ok }) => {
    const config = mockPushConfigs.find((c) => c.id === params.id);
    if (!config) return notFound('推送配置不存在', { status: 404 });
    return ok({ ...config, masterSecret: '' });
  }),

  mock(pushConfigContract.create, ({ body, ok }) => {
    if (mockPushConfigs.some((c) => c.appId === body.appId)) {
      return badRequest('该应用已存在推送配置(一个应用只允许一套凭证)', { status: 400 });
    }
    const now = mockDateTime();
    const appNames: Record<number, string> = { 1: 'Zenith 桌面端', 2: 'Zenith 移动端' };
    const config: PushConfig = {
      id: getNextPushConfigId(),
      appId: body.appId,
      appName: appNames[body.appId] ?? `应用#${body.appId}`,
      name: body.name,
      provider: body.provider,
      appKey: body.appKey,
      apnsProduction: body.apnsProduction,
      status: body.status,
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockPushConfigs.push(config);
    return ok(config, '创建成功');
  }),

  mock(pushConfigContract.testSend, ({ params, body, ok }) => {
    const config = mockPushConfigs.find((c) => c.id === params.id);
    if (!config) return notFound('推送配置不存在', { status: 404 });
    const now = mockDateTime();
    const msgId = `demo-${Date.now()}`;
    mockPushSendLogs.unshift({
      id: getNextPushSendLogId(),
      configId: config.id,
      appId: config.appId,
      appName: config.appName ?? null,
      provider: config.provider,
      subjectType: null, subjectId: null, subjectName: null,
      deviceCount: 1,
      title: body.title,
      content: body.content,
      link: null, eventKey: null,
      status: 'success', providerMsgId: msgId,
      deliveryStatus: 'delivered', deliveredAt: now, clickedAt: null, errorMsg: null,
      source: 'test', tenantId: null, sentAt: now, createdAt: now,
    });
    return ok({ msgId }, '发送成功');
  }),

  mock(pushConfigContract.update, ({ params, body, ok }) => {
    const config = mockPushConfigs.find((c) => c.id === params.id);
    if (!config) return notFound('推送配置不存在', { status: 404 });
    // masterSecret 留空表示不更新；脱敏字段不覆盖；所属应用创建后不可改
    const { masterSecret: _secret, appId: _appId, ...patch } = body;
    Object.assign(config, { ...patch, updatedAt: mockDateTime() });
    return ok(config, '更新成功');
  }),

  mock(pushConfigContract.remove, ({ params, ok }) => {
    const idx = mockPushConfigs.findIndex((c) => c.id === params.id);
    if (idx === -1) return notFound('推送配置不存在', { status: 404 });
    mockPushConfigs.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ─── 发送记录 ───────────────────────────────────────────────────────────────
  mock(pushSendLogContract.stats, ({ query, ok }) => {
    const days = query.days ?? 14;
    const totals = {
      total: mockPushSendLogs.length,
      success: mockPushSendLogs.filter((l) => l.status === 'success').length,
      failed: mockPushSendLogs.filter((l) => l.status === 'failed').length,
      delivered: mockPushSendLogs.filter((l) => l.deliveredAt).length,
      clicked: mockPushSendLogs.filter((l) => l.clickedAt).length,
    };
    const trend = Array.from({ length: days }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (days - 1 - i));
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      // 演示数据：最后一天放真实计数，其余为 0
      const isLast = i === days - 1;
      return {
        date,
        total: isLast ? totals.total : 0,
        success: isLast ? totals.success : 0,
        failed: isLast ? totals.failed : 0,
        delivered: isLast ? totals.delivered : 0,
        clicked: isLast ? totals.clicked : 0,
      };
    });
    return ok({ totals, trend });
  }),

  mock(pushSendLogContract.list, ({ query, ok, paginate }) => {
    let list = [...mockPushSendLogs];
    if (query.keyword) {
      list = list.filter((l) => l.title.includes(query.keyword!) || l.content.includes(query.keyword!) || (l.eventKey ?? '').includes(query.keyword!));
    }
    if (query.provider) list = list.filter((l) => l.provider === query.provider);
    if (query.status) list = list.filter((l) => l.status === query.status);
    return ok(paginate(list));
  }),

  // ─── 设备中心（挂在应用版本域路径下）───────────────────────────────────────
  http.get('/api/app-releases/devices', ({ request }) => {
    const url = new URL(request.url);
    const appId = url.searchParams.get('appId');
    const platform = url.searchParams.get('platform') || '';
    const subjectType = url.searchParams.get('subjectType') || '';
    const pushBound = url.searchParams.get('pushBound') || '';
    const keyword = url.searchParams.get('keyword') || '';
    let list = [...mockClientDevices];
    if (appId) list = list.filter((d) => d.appId === Number(appId));
    if (platform) list = list.filter((d) => d.platform === platform);
    if (subjectType) list = list.filter((d) => d.subjectType === subjectType);
    if (pushBound === 'true') list = list.filter((d) => d.pushRegistrationId);
    if (keyword) {
      list = list.filter((d) => d.deviceId.includes(keyword) || (d.deviceModel ?? '').includes(keyword) || (d.appVersion ?? '').includes(keyword));
    }
    return ok(paginate(list, url));
  }),

  http.put('/api/app-releases/devices/:id/unbind', ({ params }) => {
    const device = mockClientDevices.find((d) => d.id === Number(params.id));
    if (!device) return notFound('设备不存在', { status: 404 });
    Object.assign(device, { subjectType: null, subjectId: null, subjectName: null, pushProvider: null, pushRegistrationId: null });
    return ok(null, '解绑成功');
  }),

  http.delete('/api/app-releases/devices/:id', ({ params }) => {
    const idx = mockClientDevices.findIndex((d) => d.id === Number(params.id));
    if (idx === -1) return notFound('设备不存在', { status: 404 });
    mockClientDevices.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];