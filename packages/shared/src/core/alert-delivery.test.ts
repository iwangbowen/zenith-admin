/**
 * 告警投递校验的两种收件人形态共用渠道公共校验：锁定 issue 的 path / message，
 * 保证前端错误告警规则（recipients）与系统监控告警规则（recipientUserIds / recipientEmails）行为不变。
 */
import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { validateAlertDelivery, validateTypedAlertDelivery } from './validation';

type Issue = { path: PropertyKey[]; message: string };

function collect(run: (ctx: z.RefinementCtx) => void): Issue[] {
  const issues: Issue[] = [];
  const ctx = {
    addIssue: (issue: { path?: PropertyKey[]; message?: string }) => issues.push({ path: issue.path ?? [], message: issue.message ?? '' }),
  } as unknown as z.RefinementCtx;
  run(ctx);
  return issues;
}

describe('validateAlertDelivery（recipients 列表）', () => {
  it('未启用时不校验', () => {
    expect(collect((ctx) => validateAlertDelivery({ enabled: false, channels: [] }, ctx))).toEqual([]);
  });

  it('启用但无渠道 / webhook 缺 URL / 邮件缺收件人', () => {
    expect(collect((ctx) => validateAlertDelivery({ enabled: true, channels: [] }, ctx))).toEqual([
      { path: ['channels'], message: '启用告警时至少选择一个通知渠道' },
    ]);
    expect(collect((ctx) => validateAlertDelivery({ channels: ['webhook'], webhookUrl: null, recipients: [] }, ctx))).toEqual([
      { path: ['webhookUrl'], message: 'Webhook 渠道必须配置有效 URL' },
    ]);
    expect(collect((ctx) => validateAlertDelivery({ channels: ['email'], recipients: [] }, ctx))).toEqual([
      { path: ['recipients'], message: '邮件或站内通知渠道必须配置接收人' },
    ]);
    expect(collect((ctx) => validateAlertDelivery({ channels: ['inapp'], recipients: ['u1'] }, ctx))).toEqual([]);
  });
});

describe('validateTypedAlertDelivery（recipientUserIds / recipientEmails）', () => {
  it('站内信必须有接收用户；邮件可用额外邮箱代替', () => {
    expect(collect((ctx) => validateTypedAlertDelivery({ channels: ['inapp'], recipientUserIds: [], recipientEmails: ['a@b.c'] }, ctx))).toEqual([
      { path: ['recipientUserIds'], message: '站内信渠道必须选择接收用户' },
    ]);
    expect(collect((ctx) => validateTypedAlertDelivery({ channels: ['email'], recipientUserIds: [], recipientEmails: [] }, ctx))).toEqual([
      { path: ['recipientEmails'], message: '邮件渠道必须选择接收用户或填写额外邮箱' },
    ]);
    expect(collect((ctx) => validateTypedAlertDelivery({ channels: ['email'], recipientEmails: ['a@b.c'] }, ctx))).toEqual([]);
    expect(collect((ctx) => validateTypedAlertDelivery({ channels: ['email', 'inapp'], recipientUserIds: [1] }, ctx))).toEqual([]);
  });

  it('部分更新省略收件人字段时仍按类型化收件人校验', () => {
    expect(collect((ctx) => validateTypedAlertDelivery({ enabled: true, channels: ['inapp', 'webhook'] }, ctx))).toEqual([
      { path: ['webhookUrl'], message: 'Webhook 渠道必须配置有效 URL' },
      { path: ['recipientUserIds'], message: '站内信渠道必须选择接收用户' },
    ]);
  });
});
