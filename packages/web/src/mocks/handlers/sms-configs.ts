import { smsConfigContract } from '@zenith/shared/messaging';
import type { SmsConfig } from '@zenith/shared/messaging';
import { maskSecret, SECRET_PLACEHOLDER } from '@zenith/shared/core';
import { mock } from '@/mocks/utils/contract';
import { requireItem, removeByIds } from '@/mocks/utils/crud';
import { badRequest } from '@/mocks/utils/handlers';
import { mockSmsConfigs, getNextSmsConfigId } from '@/mocks/data/sms-configs';
import { mockDateTime } from '@/mocks/utils/date';
import { includesKeyword } from '@/mocks/utils/filter';

/** 列表 / 写操作响应：脱敏 accessKeyId 且不含 accessKeySecret */
function toSafe(c: SmsConfig): SmsConfig {
  const { accessKeySecret: _secret, ...safe } = c;
  return {
    ...safe,
    accessKeyId: c.accessKeyId ? maskSecret(c.accessKeyId, { filler: SECRET_PLACEHOLDER }) : '',
  };
}

/** 编辑详情：accessKeyId 原文 + 空 accessKeySecret（留空即不更新） */
function toEditable(c: SmsConfig): SmsConfig {
  return { ...c, accessKeySecret: '' };
}

export const smsConfigsHandlers = [
  mock(smsConfigContract.list, ({ query, ok, paginate }) => {
    const filtered = mockSmsConfigs.filter((c) => {
      if (query.keyword && !includesKeyword(query.keyword, c.name, c.signName)) return false;
      if (query.provider && c.provider !== query.provider) return false;
      if (query.status && c.status !== query.status) return false;
      return true;
    });
    const page = paginate(filtered);
    return ok({ ...page, list: page.list.map(toSafe) });
  }),

  mock(smsConfigContract.detail, ({ params, ok }) => {
    const c = requireItem(mockSmsConfigs, params.id, '短信配置不存在', { status: 404 });
    return ok(toEditable(c));
  }),

  mock(smsConfigContract.create, ({ body, ok }) => {
    if (mockSmsConfigs.some((c) => c.name === body.name)) {
      return badRequest('配置名称已存在', { status: 400 });
    }
    const now = mockDateTime();
    const item: SmsConfig = {
      id: getNextSmsConfigId(),
      name: body.name,
      provider: body.provider,
      accessKeyId: body.accessKeyId,
      accessKeySecret: body.accessKeySecret,
      region: body.region ?? null,
      signName: body.signName,
      isDefault: body.isDefault,
      status: body.status,
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    if (item.isDefault) mockSmsConfigs.forEach((c) => { c.isDefault = false; });
    mockSmsConfigs.push(item);
    return ok(toSafe(item), '创建成功');
  }),

  mock(smsConfigContract.update, ({ params, body, ok }) => {
    const c = requireItem(mockSmsConfigs, params.id, '短信配置不存在', { status: 404 });
    if (body.name && body.name !== c.name && mockSmsConfigs.some((x) => x.name === body.name)) {
      return badRequest('配置名称已存在', { status: 400 });
    }
    // 留空 secret 表示不修改
    const next = { ...body };
    if (!next.accessKeySecret) delete next.accessKeySecret;
    if (next.isDefault) mockSmsConfigs.forEach((x) => { if (x.id !== c.id) x.isDefault = false; });
    Object.assign(c, next, { updatedAt: mockDateTime() });
    return ok(toSafe(c), '更新成功');
  }),

  mock(smsConfigContract.setDefault, ({ params, ok }) => {
    const c = requireItem(mockSmsConfigs, params.id, '短信配置不存在', { status: 404 });
    mockSmsConfigs.forEach((x) => { x.isDefault = x.id === c.id; });
    c.updatedAt = mockDateTime();
    return ok(toSafe(c), '设置默认成功');
  }),

  mock(smsConfigContract.remove, ({ params, ok }) => {
    requireItem(mockSmsConfigs, params.id, '短信配置不存在', { status: 404 });
    removeByIds(mockSmsConfigs, [params.id]);
    return ok(null, '删除成功');
  }),
];
