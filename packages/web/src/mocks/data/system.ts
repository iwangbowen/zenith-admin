import type { SystemConfig, CronJob, FileStorageConfig, OnlineUser } from '@zenith/shared';
import { SEED_SYSTEM_CONFIGS, SEED_CRON_JOBS } from '@zenith/shared';
import { mockDateTimeOffset } from '@/mocks/utils/date';

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
    status: 'enabled',
    isDefault: true,
    basePath: 'uploads',
    localRootPath: 'storage/local',
    remark: '系统默认本地文件服务',
    createdAt: '2024-01-01 00:00:00',
    updatedAt: '2024-01-01 00:00:00',
  },
  {
    id: 2,
    name: '阿里云 OSS',
    provider: 'oss',
    status: 'disabled',
    isDefault: false,
    basePath: 'uploads',
    objectAcl: 'default',
    ossRegion: 'oss-cn-hangzhou',
    ossEndpoint: 'oss-cn-hangzhou.aliyuncs.com',
    ossBucket: 'my-bucket',
    ossAccessKeyId: 'LTAI********************',
    ossAccessKeySecret: '****************************',
    remark: '阿里云对象存储',
    createdAt: '2024-03-01 00:00:00',
    updatedAt: '2024-03-01 00:00:00',
  },
  {
    id: 3,
    name: 'Amazon S3',
    provider: 's3',
    status: 'disabled',
    isDefault: false,
    basePath: 'uploads',
    objectAcl: 'default',
    s3Region: 'us-east-1',
    s3Bucket: 'my-s3-bucket',
    s3AccessKeyId: 'AKIA********************',
    s3SecretAccessKey: '****************************',
    remark: 'AWS S3 存储',
    createdAt: '2024-03-01 00:00:00',
    updatedAt: '2024-03-01 00:00:00',
  },
  {
    id: 4,
    name: '腾讯云 COS',
    provider: 'cos',
    status: 'disabled',
    isDefault: false,
    basePath: 'uploads',
    objectAcl: 'default',
    cosRegion: 'ap-guangzhou',
    cosBucket: 'my-bucket-1250000000',
    cosSecretId: 'AKID********************',
    cosSecretKey: '****************************',
    remark: '腾讯云对象存储',
    createdAt: '2024-03-01 00:00:00',
    updatedAt: '2024-03-01 00:00:00',
  },
];

export const mockOnlineSessions: OnlineUser[] = [
  {
    tokenId: 'mock-token-id-001',
    userId: 1,
    username: 'admin',
    nickname: '管理员',
    ip: '127.0.0.1',
    location: '本地网络',
    browser: 'Chrome 120',
    os: 'Windows 11',
    loginAt: mockDateTimeOffset(-3600 * 1000),
  },
  {
    tokenId: 'mock-token-id-002',
    userId: 2,
    username: 'editor',
    nickname: '编辑员',
    ip: '119.29.xx.xx',
    location: '广东省 深圳市 电信',
    browser: 'Safari 17',
    os: 'macOS Sonoma',
    loginAt: mockDateTimeOffset(-1800 * 1000),
  },
];
