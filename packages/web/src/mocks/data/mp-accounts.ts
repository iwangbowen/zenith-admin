import type { MpAccount } from '@zenith/shared';
import { SEED_MP_ACCOUNTS } from '@zenith/shared';

export const mockMpAccounts: MpAccount[] = [
  ...SEED_MP_ACCOUNTS.map((a) => ({ ...a })),
  {
    id: 3,
    name: '已认证服务号',
    account: 'gh_zenith_demo',
    appId: 'wxenableddemo0003',
    appSecret: 'EnabledDemoSecret',
    token: 'enableddemotoken',
    encodingAesKey: null,
    encryptMode: 'plaintext',
    type: 'service',
    qrCodeUrl: null,
    isDefault: false,
    autoCreateMember: false,
    status: 'enabled',
    remark: '演示用已启用服务号',
    createdAt: '2025-03-01 09:00:00',
    updatedAt: '2025-03-01 09:00:00',
  },
];

let nextId = Math.max(...mockMpAccounts.map((a) => a.id)) + 1;
export function getNextMpAccountId() {
  return nextId++;
}
