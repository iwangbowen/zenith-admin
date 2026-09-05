/**
 * 应用版本管理种子数据。
 *
 * SEED_CLIENT_APPS 进 DB seed：桌面端 / 移动端是产品自带的客户端形态，预置应用记录，
 * 用户也可在「应用管理」中自由增删；版本与制品由管理员真实发布产生。
 * SEED_APP_RELEASES / SEED_APP_ARTIFACTS 仅供 Demo 模式（MSW mock）派生使用。
 */
import type { AppRelease, AppArtifact, ClientApp } from '../ops/contracts';
import { SEED_DATE } from './_base';

export const SEED_CLIENT_APPS: ClientApp[] = [
  {
    id: 1, appKey: 'zenith-desktop', name: 'Zenith 桌面端',
    description: 'Electron 桌面客户端（Windows / macOS / Linux）', status: 'enabled',
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 2, appKey: 'zenith-mobile', name: 'Zenith 移动端',
    description: '移动客户端（Android / iOS）', status: 'enabled',
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

/** Demo 数据：仅 MSW mock 派生，不进 DB seed */
export const SEED_APP_RELEASES: AppRelease[] = [
  {
    id: 1, appId: 1, appKey: 'zenith-desktop', appName: 'Zenith 桌面端',
    channel: 'stable', version: '1.84.0', notes: '## 1.84.0\n\n- 修复若干问题\n- 性能优化',
    status: 'published', mandatory: false, minVersion: null, rolloutPercent: 100,
    publishedAt: '2025-06-01 10:00:00', artifactCount: 2,
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 2, appId: 1, appKey: 'zenith-desktop', appName: 'Zenith 桌面端',
    channel: 'stable', version: '1.85.0', notes: '## 1.85.0\n\n- 新增应用版本管理\n- 支持在线升级',
    status: 'published', mandatory: false, minVersion: '1.80.0', rolloutPercent: 30,
    publishedAt: '2025-06-15 10:00:00', artifactCount: 3,
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 3, appId: 1, appKey: 'zenith-desktop', appName: 'Zenith 桌面端',
    channel: 'beta', version: '1.86.0-beta.1', notes: '## 1.86.0-beta.1\n\n- 体验新特性',
    status: 'draft', mandatory: false, minVersion: null, rolloutPercent: 100,
    publishedAt: null, artifactCount: 1,
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 4, appId: 2, appKey: 'zenith-mobile', appName: 'Zenith 移动端',
    channel: 'stable', version: '1.10.0', notes: '## 1.10.0\n\n- 移动审批体验优化',
    status: 'published', mandatory: false, minVersion: null, rolloutPercent: 100,
    publishedAt: '2025-06-10 09:00:00', artifactCount: 2,
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_APP_ARTIFACTS: AppArtifact[] = [
  { id: 1, releaseId: 1, platform: 'windows', arch: 'x64', kind: 'installer', fileId: null, externalUrl: null, fileName: 'Zenith-Admin-Setup-1.84.0.exe', size: 98_566_144, sha256: 'a'.repeat(64), downloadCount: 1286, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, releaseId: 1, platform: 'windows', arch: 'x64', kind: 'metadata', fileId: null, externalUrl: null, fileName: 'latest.yml', size: 512, sha256: null, downloadCount: 0, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, releaseId: 2, platform: 'windows', arch: 'x64', kind: 'installer', fileId: null, externalUrl: null, fileName: 'Zenith-Admin-Setup-1.85.0.exe', size: 99_614_720, sha256: 'b'.repeat(64), downloadCount: 342, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, releaseId: 2, platform: 'windows', arch: 'x64', kind: 'hotupdate', fileId: null, externalUrl: null, fileName: 'web-1.85.0.zip', size: 18_874_368, sha256: 'c'.repeat(64), downloadCount: 923, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5, releaseId: 2, platform: 'macos', arch: 'arm64', kind: 'installer', fileId: null, externalUrl: null, fileName: 'Zenith-Admin-1.85.0-arm64.dmg', size: 104_857_600, sha256: 'd'.repeat(64), downloadCount: 87, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 6, releaseId: 3, platform: 'windows', arch: 'x64', kind: 'installer', fileId: null, externalUrl: null, fileName: 'Zenith-Admin-Setup-1.86.0-beta.1.exe', size: 99_614_720, sha256: 'e'.repeat(64), downloadCount: 0, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 7, releaseId: 4, platform: 'android', arch: 'universal', kind: 'installer', fileId: null, externalUrl: null, fileName: 'zenith-mobile-1.10.0.apk', size: 45_088_768, sha256: 'f'.repeat(64), downloadCount: 466, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 8, releaseId: 4, platform: 'ios', arch: 'universal', kind: 'external', fileId: null, externalUrl: 'https://apps.apple.com/app/id0000000000', fileName: 'App Store', size: 0, sha256: null, downloadCount: 208, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];
