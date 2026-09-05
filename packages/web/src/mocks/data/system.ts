import type { CronJob, FileStorageConfig } from '@zenith/shared/platform';
import type { OnlineSession } from '@zenith/shared/identity';
import { SEED_CRON_JOBS } from '@zenith/shared/seed';
import { mockDateTimeOffset } from '@/mocks/utils/date';

export const mockCronJobs: CronJob[] = SEED_CRON_JOBS.map((c) => ({ ...c }));

let nextCronJobId = Math.max(...SEED_CRON_JOBS.map((c) => c.id)) + 1;
export function getNextCronJobId() {
  return nextCronJobId++;
}

/** 各 provider 的 write-only 密钥字段：接口不返回，mock 数据里保存以模拟「留空即沿用原值」 */
export const STORAGE_SECRET_FIELDS = [
  'ossAccessKeySecret', 's3SecretAccessKey', 'cosSecretKey',
  'obsSecretAccessKey', 'kodoSecretKey', 'bosSecretAccessKey',
  'azureAccountKey', 'sftpPassword', 'sftpPrivateKey',
] as const;

export type MockFileStorageConfig = FileStorageConfig & Partial<Record<(typeof STORAGE_SECRET_FIELDS)[number], string>>;

export const mockFileStorageConfigs: MockFileStorageConfig[] = [
  {
    id: 1,
    name: '本地磁盘',
    provider: 'local',
    status: 'enabled',
    isDefault: true,
    basePath: 'uploads',
    objectAcl: 'default',
    urlStrategy: 'proxy',
    presignedExpirySeconds: 1800,
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
    urlStrategy: 'proxy',
    presignedExpirySeconds: 1800,
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
    urlStrategy: 'proxy',
    presignedExpirySeconds: 1800,
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
    urlStrategy: 'proxy',
    presignedExpirySeconds: 1800,
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

export const mockOnlineSessions: OnlineSession[] = [
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
