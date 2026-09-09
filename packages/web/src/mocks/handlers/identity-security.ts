import { identitySecurityContract, type LoginRiskEvent } from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { mockDateTime } from '@/mocks/utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';
import { currentMockSession, isMockPlatformAdmin, mockUserPermissions } from '@/mocks/utils/auth';
import { forbidden, unauthorized } from '@/mocks/utils/handlers';
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
for (const tenantId of [1, 2]) {
  riskEvents.push({ ...riskEvents[0], id: tenantId + 1, userId: tenantId + 1, tenantId, username: `tenant-${tenantId}-admin` });
}

export const identitySecurityHandlers = [
  mock(identitySecurityContract.riskEvents, ({ request, query, ok, paginate }) => {
    const session = currentMockSession(request);
    if (!session) return unauthorized('未登录', { status: 401 });
    const permissions = mockUserPermissions(session.user);
    if (!permissions.includes('*') && !permissions.includes('system:login-risk:list')) return forbidden('权限不足', { status: 403 });
    const tenantId = isMockPlatformAdmin(session.user) ? session.viewingTenantId ?? undefined : session.user.tenantId ?? null;
    const visible = riskEvents.filter((event) => tenantId === undefined || event.tenantId === tenantId);
    const keyword = query.keyword?.trim() ?? '';
    const list = keyword
      ? filterByKeyword(visible, keyword, [(item) => item.username, (item) => item.reason, (item) => item.ip])
      : visible;
    return ok(paginate([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)));
  }),
];
