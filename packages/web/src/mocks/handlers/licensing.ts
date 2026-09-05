import { LICENSE_FEATURES, licensingContract, type LicenseEventItem, type LicensingStatus } from '@zenith/shared/licensing';
import { mock } from '@/mocks/utils/contract';
import { badRequest } from '@/mocks/utils/handlers';
import { mockDateTime } from '@/mocks/utils/date';

/** Demo 模式固定为 off 模式未激活状态：展示页面结构即可，激活动作给出友好提示 */
const mockStatus: LicensingStatus = {
  installation: {
    installationId: 'demo-0000-0000-0000-000000000000',
    licenseEpoch: 0,
    createdAt: '2025-01-01 00:00:00',
    mode: 'off',
    activeNodes: 1,
  },
  license: null,
  effective: {
    mode: 'off',
    status: 'unlicensed',
    features: [...LICENSE_FEATURES],
    limits: null,
    expiresAt: null,
    graceUntil: null,
    restricted: false,
  },
  usingTestKey: true,
};

const mockEvents: LicenseEventItem[] = [
  { id: 1, licenseId: null, type: 'verified', typeLabel: '校验通过', detail: 'Demo 演示事件', createdAt: mockDateTime() },
];

export const licensingHandlers = [
  mock(licensingContract.status, ({ ok }) => ok(mockStatus)),
  mock(licensingContract.events, ({ ok, paginate }) => ok(paginate(mockEvents))),
  mock(licensingContract.activate, () => badRequest('Demo 模式不支持激活 License')),
  mock(licensingContract.deactivate, () => badRequest('Demo 模式不支持停用 License')),
];
