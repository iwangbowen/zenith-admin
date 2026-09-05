/**
 * 应用版本管理 Mock（Demo 模式）。
 *
 * 覆盖管理侧全部端点：应用 / 版本 / 制品 CRUD、发布状态机、灰度调整与看板统计。
 * 看板统计由确定性伪随机数生成（同一应用同一天数结果恒定），不重复维护静态数组。
 */
import { enumValueOf } from '@zenith/shared/core';
import {
  APP_ARCHES,
  APP_FILE_ARTIFACT_KINDS,
  APP_PLATFORMS,
  appArtifactContract,
  appReleaseContract,
  appReleaseStatsContract,
  clientAppContract,
  type AppArtifact,
  type AppRelease,
  type AppReleaseStats,
  type ClientApp,
} from '@zenith/shared/ops';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { removeWhere } from '@/mocks/utils/array';
import { mockDateTime } from '@/mocks/utils/date';
import {
  getNextAppArtifactId,
  getNextAppReleaseId,
  getNextClientAppId,
  mockAppArtifacts,
  mockAppReleases,
  mockClientApps,
} from '../data/app-releases';

/** 组装列表 / 详情输出：附加应用冗余字段与制品 */
function decorateRelease(release: AppRelease): AppRelease {
  const app = mockClientApps.find((a) => a.id === release.appId);
  const artifacts = mockAppArtifacts.filter((a) => a.releaseId === release.id);
  return {
    ...release,
    appKey: app?.appKey,
    appName: app?.name,
    artifacts,
    artifactCount: artifacts.length,
  };
}

function decorateApp(app: ClientApp): ClientApp {
  const releases = mockAppReleases.filter((r) => r.appId === app.id);
  const published = releases
    .filter((r) => r.status === 'published')
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  return { ...app, releaseCount: releases.length, latestVersion: published[0]?.version ?? null };
}

/** 确定性伪随机：同一 seed 恒定，看板刷新不跳数 */
function seededInt(seed: string, max: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % max;
}

export const appReleasesHandlers = [
  // ─── 应用 ──────────────────────────────────────────────────────────────────
  mock(clientAppContract.all, ({ ok }) =>
    ok(mockClientApps.filter((a) => a.status === 'enabled').map(decorateApp))),

  mock(clientAppContract.list, ({ query, ok, paginate }) => {
    let list = mockClientApps.map(decorateApp);
    if (query.keyword) list = list.filter((a) => a.name.includes(query.keyword!) || a.appKey.includes(query.keyword!));
    if (query.status) list = list.filter((a) => a.status === query.status);
    return ok(paginate(list));
  }),

  mock(clientAppContract.create, ({ body, ok }) => {
    if (mockClientApps.some((a) => a.appKey === body.appKey)) {
      return badRequest('应用标识（appKey）已存在', { status: 400 });
    }
    const now = mockDateTime();
    const app: ClientApp = {
      id: getNextClientAppId(),
      appKey: body.appKey,
      name: body.name,
      description: body.description ?? '',
      status: body.status,
      createdAt: now,
      updatedAt: now,
    };
    mockClientApps.push(app);
    return ok(decorateApp(app), '创建成功');
  }),

  mock(clientAppContract.update, ({ params, body, ok }) => {
    const app = mockClientApps.find((a) => a.id === params.id);
    if (!app) return notFound('应用不存在', { status: 404 });
    if (body.name !== undefined) app.name = body.name;
    if (body.description !== undefined) app.description = body.description;
    if (body.status !== undefined) app.status = body.status;
    app.updatedAt = mockDateTime();
    return ok(decorateApp(app), '更新成功');
  }),

  mock(clientAppContract.remove, ({ params, ok }) => {
    const idx = mockClientApps.findIndex((a) => a.id === params.id);
    if (idx === -1) return notFound('应用不存在', { status: 404 });
    if (mockAppReleases.some((r) => r.appId === params.id)) {
      return badRequest('该应用下仍有版本记录，请先删除全部版本', { status: 400 });
    }
    mockClientApps.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ─── 看板统计 ───────────────────────────────────────────────────────────────
  mock(appReleaseStatsContract.stats, ({ query, ok }) => {
    const appId = query.appId;
    const days = query.days ?? 30;
    if (!mockClientApps.some((a) => a.id === appId)) return notFound('应用不存在', { status: 404 });

    const trend: AppReleaseStats['trend'] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const checks = 40 + seededInt(`${appId}:${date}:c`, 160);
      const downloads = Math.floor(checks * 0.18) + seededInt(`${appId}:${date}:d`, 8);
      const installSuccess = Math.max(0, downloads - seededInt(`${appId}:${date}:s`, 4));
      const installFail = seededInt(`${appId}:${date}:f`, 3);
      trend.push({ date, checks, downloads, installSuccess, installFail });
    }
    const totals = trend.reduce(
      (acc, t) => ({
        checks: acc.checks + t.checks,
        downloads: acc.downloads + t.downloads,
        devices: acc.devices,
        installSuccess: acc.installSuccess + t.installSuccess,
        installFail: acc.installFail + t.installFail,
      }),
      { checks: 0, downloads: 0, devices: 120 + seededInt(`${appId}:devices:${days}`, 300), installSuccess: 0, installFail: 0 },
    );

    const platformSet = new Set(
      mockAppArtifacts
        .filter((a) => mockAppReleases.some((r) => r.id === a.releaseId && r.appId === appId))
        .map((a) => a.platform),
    );
    const platforms: AppReleaseStats['platforms'] = [...platformSet].map((platform) => ({
      platform,
      count: 100 + seededInt(`${appId}:${platform}:${days}`, 900),
    }));

    const versions: AppReleaseStats['versions'] = mockAppReleases
      .filter((r) => r.appId === appId && r.status === 'published')
      .map((r) => ({ version: r.version, devices: 30 + seededInt(`${appId}:${r.version}:${days}`, 260) }))
      .sort((a, b) => b.devices - a.devices);

    return ok({ totals, trend, platforms, versions });
  }),

  // ─── 版本 ──────────────────────────────────────────────────────────────────
  mock(appReleaseContract.list, ({ query, ok, paginate }) => {
    let list = mockAppReleases.map(decorateRelease);
    if (query.appId) list = list.filter((r) => r.appId === query.appId);
    if (query.channel) list = list.filter((r) => r.channel === query.channel);
    if (query.status) list = list.filter((r) => r.status === query.status);
    if (query.keyword) list = list.filter((r) => r.version.includes(query.keyword!) || (r.notes ?? '').includes(query.keyword!));
    list = list.sort((a, b) => b.id - a.id);
    return ok(paginate(list));
  }),

  mock(appReleaseContract.detail, ({ params, ok }) => {
    const release = mockAppReleases.find((r) => r.id === params.id);
    if (!release) return notFound('版本不存在', { status: 404 });
    return ok(decorateRelease(release));
  }),

  mock(appReleaseContract.create, ({ body, ok }) => {
    if (!mockClientApps.some((a) => a.id === body.appId)) return badRequest('指定的应用不存在', { status: 400 });
    if (mockAppReleases.some((r) => r.appId === body.appId && r.channel === body.channel && r.version === body.version)) {
      return badRequest('该应用在此渠道下已存在相同版本号', { status: 400 });
    }
    const now = mockDateTime();
    const release: AppRelease = {
      id: getNextAppReleaseId(),
      appId: body.appId,
      channel: body.channel,
      version: body.version,
      notes: body.notes ?? '',
      status: 'draft',
      mandatory: body.mandatory,
      minVersion: body.minVersion ?? null,
      rolloutPercent: body.rolloutPercent,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    mockAppReleases.push(release);
    return ok(decorateRelease(release), '创建成功');
  }),

  mock(appReleaseContract.update, ({ params, body, ok }) => {
    const release = mockAppReleases.find((r) => r.id === params.id);
    if (!release) return notFound('版本不存在', { status: 404 });
    if (release.status !== 'draft') {
      if (body.version !== undefined && body.version !== release.version) {
        return badRequest('仅草稿状态可修改版本号', { status: 400 });
      }
      if (body.channel !== undefined && body.channel !== release.channel) {
        return badRequest('仅草稿状态可修改发布渠道', { status: 400 });
      }
    }
    if (body.channel !== undefined) release.channel = body.channel;
    if (body.version !== undefined) release.version = body.version;
    if (body.notes !== undefined) release.notes = body.notes;
    if (body.mandatory !== undefined) release.mandatory = body.mandatory;
    if (body.minVersion !== undefined) release.minVersion = body.minVersion;
    if (body.rolloutPercent !== undefined) release.rolloutPercent = body.rolloutPercent;
    release.updatedAt = mockDateTime();
    return ok(decorateRelease(release), '更新成功');
  }),

  mock(appReleaseContract.publish, ({ params, ok }) => {
    const release = mockAppReleases.find((r) => r.id === params.id);
    if (!release) return notFound('版本不存在', { status: 404 });
    if (release.status === 'published') return badRequest('该版本已是发布状态', { status: 400 });
    if (!mockAppArtifacts.some((a) => a.releaseId === release.id)) {
      return badRequest('该版本还没有任何制品，无法发布', { status: 400 });
    }
    Object.assign(release, { status: 'published', publishedAt: mockDateTime(), updatedAt: mockDateTime() });
    return ok(decorateRelease(release), '发布成功');
  }),

  mock(appReleaseContract.revoke, ({ params, ok }) => {
    const release = mockAppReleases.find((r) => r.id === params.id);
    if (!release) return notFound('版本不存在', { status: 404 });
    if (release.status !== 'published') return badRequest('仅已发布版本可以撤回', { status: 400 });
    Object.assign(release, { status: 'revoked', updatedAt: mockDateTime() });
    return ok(decorateRelease(release), '撤回成功');
  }),

  mock(appReleaseContract.rollout, ({ params, body, ok }) => {
    const release = mockAppReleases.find((r) => r.id === params.id);
    if (!release) return notFound('版本不存在', { status: 404 });
    Object.assign(release, { rolloutPercent: body.rolloutPercent, updatedAt: mockDateTime() });
    return ok(decorateRelease(release), '调整成功');
  }),

  mock(appReleaseContract.remove, ({ params, ok }) => {
    const idx = mockAppReleases.findIndex((r) => r.id === params.id);
    if (idx === -1) return notFound('版本不存在', { status: 404 });
    if (mockAppReleases[idx].status === 'published') {
      return badRequest('已发布版本不可删除，请先撤回', { status: 400 });
    }
    mockAppReleases.splice(idx, 1);
    removeWhere(mockAppArtifacts, (a) => a.releaseId === params.id);
    return ok(null, '删除成功');
  }),

  // ─── 制品 ──────────────────────────────────────────────────────────────────
  mock(appReleaseContract.uploadArtifact, ({ params, body, ok }) => {
    const releaseId = params.id;
    if (!mockAppReleases.some((r) => r.id === releaseId)) return notFound('版本不存在', { status: 404 });
    const file = body.get('file');
    if (!(file instanceof File)) return badRequest('请选择要上传的制品文件', { status: 400 });
    if (mockAppArtifacts.some((a) => a.releaseId === releaseId && a.fileName === file.name)) {
      return badRequest('该版本下已存在同名制品文件', { status: 400 });
    }
    const platform = enumValueOf(APP_PLATFORMS, body.get('platform'));
    if (!platform) return badRequest('platform 不合法', { status: 400 });
    const now = mockDateTime();
    const artifact: AppArtifact = {
      id: getNextAppArtifactId(),
      releaseId,
      platform,
      arch: enumValueOf(APP_ARCHES, body.get('arch')) ?? 'x64',
      kind: enumValueOf(APP_FILE_ARTIFACT_KINDS, body.get('kind')) ?? 'installer',
      fileId: null,
      externalUrl: null,
      fileName: file.name,
      size: file.size,
      sha256: null,
      downloadCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockAppArtifacts.push(artifact);
    return ok(artifact, '上传成功');
  }),

  mock(appReleaseContract.addExternalArtifact, ({ params, body, ok }) => {
    const releaseId = params.id;
    if (!mockAppReleases.some((r) => r.id === releaseId)) return notFound('版本不存在', { status: 404 });
    if (mockAppArtifacts.some((a) => a.releaseId === releaseId && a.fileName === body.fileName)) {
      return badRequest('该版本下已存在同名制品文件', { status: 400 });
    }
    const now = mockDateTime();
    const artifact: AppArtifact = {
      id: getNextAppArtifactId(),
      releaseId,
      platform: body.platform,
      arch: body.arch,
      kind: 'external',
      fileId: null,
      externalUrl: body.externalUrl,
      fileName: body.fileName,
      size: 0,
      sha256: null,
      downloadCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockAppArtifacts.push(artifact);
    return ok(artifact, '添加成功');
  }),

  mock(appArtifactContract.remove, ({ params, ok }) => {
    const idx = mockAppArtifacts.findIndex((a) => a.id === params.id);
    if (idx === -1) return notFound('制品不存在', { status: 404 });
    mockAppArtifacts.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
