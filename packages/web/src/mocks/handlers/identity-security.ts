import { identitySecurityContract, type LoginRiskEvent } from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { mockDateTime } from '@/mocks/utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';

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
      ? filterByKeyword(riskEvents, keyword, [(item) => item.username, (item) => item.reason, (item) => item.ip])
      : riskEvents;
    return ok(paginate(list));
  }),
];
