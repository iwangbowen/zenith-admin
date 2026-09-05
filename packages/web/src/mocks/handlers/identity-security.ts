import { identitySecurityContract, type LoginRiskEvent } from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { mockDateTime } from '@/mocks/utils/date';

const riskEvents: LoginRiskEvent[] = [
  {
    id: 1,
    userId: 1,
    username: 'admin',
    tenantId: null,
    riskLevel: 'medium',
    reason: '新设备登录',
    action: 'challenge',
    ip: '127.0.0.1',
    location: '本地网络',
    userAgent: 'Mozilla/5.0 Chrome/124',
    createdAt: mockDateTime(),
  },
];

export const identitySecurityHandlers = [
  mock(identitySecurityContract.riskEvents, ({ query, ok, paginate }) => {
    const keyword = query.keyword ?? '';
    const list = keyword
      ? riskEvents.filter((item) => item.username.includes(keyword) || item.reason.includes(keyword) || (item.ip ?? '').includes(keyword))
      : riskEvents;
    return ok(paginate(list));
  }),
];
