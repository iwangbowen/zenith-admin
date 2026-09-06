import { HTTPException } from 'hono/http-exception';
import { describe, expect, it, vi } from 'vitest';
import type { PaymentOrderRow } from '../../db/schema';
import type { AdapterContext, ProfitShareReverseInput } from './types';
import { requireSandboxOperation, sandboxProfitShareReverse } from './adapter-sandbox';

function ctx(sandbox: boolean, channel = 'wechat'): AdapterContext {
  return {
    config: { id: 9, sandbox, channel },
    secrets: { sandboxNotifySecret: 'sandbox-secret' },
    notifyUrl: 'https://pay.example.test/notify',
  } as AdapterContext;
}

const order = { orderNo: 'PAY202609060001' } as PaymentOrderRow;

const reverseInput: ProfitShareReverseInput = {
  outSharingNo: 'SHR202609060001',
  channelSharingNo: 'WXSHARE001',
  outReversalNo: 'RSV202609060001',
  amount: 123,
  reason: '分账冲正',
};

describe('payment adapter sandbox helpers', () => {
  it('requireSandboxOperation 保留 provider-specific live 拒绝文案', () => {
    expect(() => requireSandboxOperation(ctx(false, 'alipay'), 'profit-sharing.reverse', 'alipay')).toThrowError(HTTPException);
    try {
      requireSandboxOperation(ctx(false, 'alipay'), 'profit-sharing.reverse', 'alipay');
    } catch (err) {
      expect(err).toBeInstanceOf(HTTPException);
      expect((err as HTTPException).status).toBe(400);
      expect((err as HTTPException).message).toBe('CAPABILITY_UNSUPPORTED: alipay/profit-sharing.reverse/live');
    }
  });

  it('sandboxProfitShareReverse 返回冲正结果，查询结果附带完成时间', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'));
    try {
      const created = await sandboxProfitShareReverse(ctx(true), order, reverseInput, { prefix: 'ALIPSR', label: 'alipay' });
      expect(created).toMatchObject({ status: 'success' });
      expect(created.channelReversalNo).toMatch(/^ALIPSR[A-F0-9]{28}$/);

      const queried = await sandboxProfitShareReverse(ctx(true), order, reverseInput, { prefix: 'ALIPSR', label: 'alipay', query: true });
      expect(queried).toMatchObject({ status: 'success', channelReversalNo: created.channelReversalNo, raw: created.raw });
      expect(queried.finishedAt).toEqual(new Date('2026-09-06T12:00:00Z'));
    } finally {
      vi.useRealTimers();
    }
  });
});
