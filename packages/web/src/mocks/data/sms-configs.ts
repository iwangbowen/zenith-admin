import type { SmsConfig } from '@zenith/shared';

export const mockSmsConfigs: SmsConfig[] = [
  {
    id: 1,
    name: '阿里云默认',
    provider: 'aliyun',
    accessKeyId: 'LTAI5tXXXXXXXXXXXX',
    accessKeySecret: 'aliyun-secret-original',
    region: 'cn-hangzhou',
    signName: 'Zenith',
    isDefault: true,
    status: 'enabled',
    remark: '生产环境主用',
    createdAt: '2025-01-01 00:00:00',
    updatedAt: '2025-01-01 00:00:00',
  },
  {
    id: 2,
    name: '腾讯云备用',
    provider: 'tencent',
    accessKeyId: 'AKIDxxxxxxxxxxxxxxxx',
    accessKeySecret: 'tencent-secret-original',
    region: 'ap-guangzhou',
    signName: 'Zenith',
    isDefault: false,
    status: 'enabled',
    remark: null,
    createdAt: '2025-01-05 09:00:00',
    updatedAt: '2025-01-05 09:00:00',
  },
  {
    id: 3,
    name: '阿里云测试',
    provider: 'aliyun',
    accessKeyId: 'LTAI5tYYYYYYYYYYYY',
    accessKeySecret: 'aliyun-test-secret',
    region: 'cn-shanghai',
    signName: 'ZenithTest',
    isDefault: false,
    status: 'disabled',
    remark: '已停用',
    createdAt: '2025-02-01 11:00:00',
    updatedAt: '2025-02-01 11:00:00',
  },
];

let nextId = Math.max(...mockSmsConfigs.map((c) => c.id)) + 1;
export function getNextSmsConfigId() {
  return nextId++;
}
