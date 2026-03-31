import type { SystemConfig, CronJob, FileStorageConfig, OnlineUser } from '@zenith/shared';
import { SEED_SYSTEM_CONFIGS, SEED_CRON_JOBS } from '@zenith/shared';

export const mockSystemConfigs: SystemConfig[] = SEED_SYSTEM_CONFIGS.map((s) => ({ ...s }));

export const mockCronJobs: CronJob[] = SEED_CRON_JOBS.map((c) => ({ ...c }));

let nextCronJobId = Math.max(...SEED_CRON_JOBS.map((c) => c.id)) + 1;
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
  {
    id: 2,
    name: '阿里云 OSS',
    provider: 'oss',
    status: 'disabled',
    isDefault: false,
    basePath: 'uploads',
    ossRegion: 'oss-cn-hangzhou',
    ossEndpoint: 'oss-cn-hangzhou.aliyuncs.com',
    ossBucket: 'my-bucket',
    ossAccessKeyId: 'LTAI********************',
    ossAccessKeySecret: '****************************',
    remark: '阿里云对象存储',
    createdAt: '2024-03-01T00:00:00.000Z',
    updatedAt: '2024-03-01T00:00:00.000Z',
  },
  {
    id: 3,
    name: 'Amazon S3',
    provider: 's3',
    status: 'disabled',
    isDefault: false,
    basePath: 'uploads',
    s3Region: 'us-east-1',
    s3Bucket: 'my-s3-bucket',
    s3AccessKeyId: 'AKIA********************',
    s3AccessKeySecret: '****************************',
    remark: 'AWS S3 存储',
    createdAt: '2024-03-01T00:00:00.000Z',
    updatedAt: '2024-03-01T00:00:00.000Z',
  },
  {
    id: 4,
    name: '腾讯云 COS',
    provider: 'cos',
    status: 'disabled',
    isDefault: false,
    basePath: 'uploads',
    cosRegion: 'ap-guangzhou',
    cosBucket: 'my-bucket-1250000000',
    cosAppId: '1250000000',
    cosSecretId: 'AKID********************',
    cosSecretKey: '****************************',
    remark: '腾讯云对象存储',
    createdAt: '2024-03-01T00:00:00.000Z',
    updatedAt: '2024-03-01T00:00:00.000Z',
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
