import type { SystemConfig, CronJob, FileStorageConfig, OnlineUser } from '@zenith/shared';

export const mockSystemConfigs: SystemConfig[] = [
  { id: 1, configKey: 'captcha_enabled',       configValue: 'false',        configType: 'boolean', description: '是否开启登录验证码', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 2, configKey: 'site_name',             configValue: 'Zenith Admin', configType: 'string',  description: '站点名称，显示在浏览器标签页', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 3, configKey: 'user_default_password', configValue: '123456',       configType: 'string',  description: '新增用户时的默认密码', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
];

export const mockCronJobs: CronJob[] = [
  {
    id: 1,
    name: '清理过期验证码',
    cronExpression: '0 */30 * * * *',
    handler: 'cleanExpiredCaptchas',
    params: null,
    status: 'active',
    description: '每30分钟清理过期的验证码',
    lastRunAt: '2024-01-01T00:30:00.000Z',
    nextRunAt: '2024-01-01T01:00:00.000Z',
    lastRunStatus: 'success',
    lastRunMessage: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 2,
    name: '清理过期会话',
    cronExpression: '0 0 * * * *',
    handler: 'cleanExpiredSessions',
    params: null,
    status: 'active',
    description: '每小时清理超过8小时无活动的会话',
    lastRunAt: '2024-01-01T01:00:00.000Z',
    nextRunAt: '2024-01-01T02:00:00.000Z',
    lastRunStatus: 'success',
    lastRunMessage: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
];

let nextCronJobId = 3;
export function getNextCronJobId() {
  return nextCronJobId++;
}

export const mockFileStorageConfigs: FileStorageConfig[] = [
  {
    id: 1,
    name: '本地磁盘',
    provider: 'local',
    status: 'active',
    isDefault: true,
    basePath: 'uploads',
    localRootPath: 'storage/local',
    remark: '系统默认本地文件服务',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
];

export const mockOnlineSessions: OnlineUser[] = [
  {
    tokenId: 'mock-token-id-001',
    userId: 1,
    username: 'admin',
    nickname: '管理员',
    ip: '127.0.0.1',
    browser: 'Chrome 120',
    os: 'Windows 11',
    loginAt: new Date(Date.now() - 3600 * 1000).toISOString(),
  },
];
