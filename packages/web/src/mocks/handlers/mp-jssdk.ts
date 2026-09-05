import { mpJsSdkContract } from '@zenith/shared/mp';
import { mock } from '@/mocks/utils/contract';

export const mpJsSdkHandlers = [
  mock(mpJsSdkContract.config, ({ body, ok }) =>
    ok({
      appId: `wxmockapp${body.accountId}`,
      timestamp: Math.floor(Date.now() / 1000),
      nonceStr: Math.random().toString(36).slice(2, 12),
      signature: Math.random().toString(16).slice(2).padEnd(40, '0').slice(0, 40),
    })),
];
