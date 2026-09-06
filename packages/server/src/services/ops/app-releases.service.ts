/**
 * 应用版本管理（在线升级）。
 *
 * 管理侧：应用 / 版本 / 制品 CRUD、发布状态机（draft → published → revoked）、灰度调整、看板统计。
 * 公开侧：check 检查更新（灰度按 deviceId 哈希命中）、按文件名解析制品（兼容 electron-updater
 * generic provider 的 latest.yml 布局）、latest 查询与安装回执。
 *
 * 公开读取一律限定 status = published；草稿与已撤回版本对公开 API 不存在。
 */
import { createHash } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type {
  AppArch,
  AppArtifactKind,
  AppPlatform,
  AppPublicReleaseInfo,
  AppReleaseChannel,
  AppReleaseStats,
  AppReleaseStatus,
  AppUpdateCheckResult,
  CheckAppUpdateQuery,
  CreateAppReleaseInput,
  CreateClientAppInput,
  CreateExternalArtifactInput,
  ReportAppReleaseEventInput,
  UpdateAppReleaseInput,
  UpdateClientAppInput,
} from '@zenith/shared/ops';
import { db } from '../../db';
import {
  appArtifacts,
  appReleaseEvents,
  appReleases,
  clientApps,
  type AppArtifactRow,
  type AppReleaseRow,
  type ClientAppRow,
  type NewAppReleaseEvent,
} from '../../db/schema';
import logger from '../../lib/logger';
import { currentUser } from '../../lib/context';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { deleteManagedFile, saveGeneratedManagedFile } from '../files/files.service';
import { countActiveDevices, getDeviceVersionDistribution, upsertDeviceHeartbeat } from './client-devices.service';

// ─── semver 比较（无依赖实现；仅服务本模块的版本新旧判断）────────────────────

function parseSemver(v: string) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?/.exec(v);
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
}

/** a>b 返回正数，a<b 返回负数，相等返回 0；非法输入退化为字符串比较 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return a.localeCompare(b);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1; // 正式版 > 预发布版
  if (pb.pre === null) return -1;
  return pa.pre.localeCompare(pb.pre);
}

/** 灰度命中：同一设备对同一版本的结论恒定（sha256(releaseId:deviceId) 落桶） */
export function rolloutHit(deviceId: string, releaseId: number, percent: number): boolean {
  if (percent >= 100) return true;
  if (percent <= 0) return false;
  const digest = createHash('sha256').update(`${releaseId}:${deviceId}`).digest();
  return digest.readUInt32BE(0) % 100 < percent;
}

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

export function mapClientApp(row: ClientAppRow) {
  return {
    id: row.id,
    appKey: row.appKey,
    name: row.name,
    description: row.description ?? null,
    status: row.status,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapAppArtifact(row: AppArtifactRow) {
  return {
    id: row.id,
    releaseId: row.releaseId,
    platform: row.platform,
    arch: row.arch,
    kind: row.kind,
    fileId: row.fileId ?? null,
    externalUrl: row.externalUrl ?? null,
    fileName: row.fileName,
    size: row.size,
    sha256: row.sha256 ?? null,
    downloadCount: row.downloadCount,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapAppRelease(
  row: AppReleaseRow & { app?: { appKey: string; name: string } | null; artifacts?: AppArtifactRow[] },
) {
  return {
    id: row.id,
    appId: row.appId,
    appKey: row.app?.appKey,
    appName: row.app?.name,
    channel: row.channel,
    version: row.version,
    notes: row.notes ?? null,
    status: row.status,
    mandatory: row.mandatory,
    minVersion: row.minVersion ?? null,
    rolloutPercent: row.rolloutPercent,
    publishedAt: formatNullableDateTime(row.publishedAt),
    artifactCount: row.artifacts?.length,
    artifacts: row.artifacts?.map(mapAppArtifact),
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 应用 CRUD ────────────────────────────────────────────────────────────────

export interface ListClientAppsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'enabled' | 'disabled';
}

function buildClientAppWhere(q: ListClientAppsQuery & { id?: number }) {
  return buildWhere(
    q.id !== undefined ? eq(clientApps.id, q.id) : undefined,
    keywordCondition(q.keyword, [clientApps.appKey, clientApps.name, clientApps.description]),
    q.status ? eq(clientApps.status, q.status) : undefined,
  );
}

export async function listClientApps(q: ListClientAppsQuery) {
  const { page = 1, pageSize = 10 } = q;
  const where = buildClientAppWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(clientApps, where),
    rows: async () => {
      const rows = await withPagination(db.select().from(clientApps).where(where).orderBy(asc(clientApps.id)).$dynamic(), page, pageSize);

      // 列表冗余：版本总数 + 最新已发布版本号
      const ids = rows.map((r) => r.id);
      const [countRows, publishedRows] = ids.length
        ? await Promise.all([
          db
            .select({ appId: appReleases.appId, cnt: sql<number>`count(*)::int` })
            .from(appReleases)
            .where(inArray(appReleases.appId, ids))
            .groupBy(appReleases.appId),
          db
            .select({ appId: appReleases.appId, version: appReleases.version, publishedAt: appReleases.publishedAt })
            .from(appReleases)
            .where(and(inArray(appReleases.appId, ids), eq(appReleases.status, 'published')))
            .orderBy(desc(appReleases.publishedAt)),
        ])
        : [[], []];
      const countMap = new Map(countRows.map((r) => [r.appId, r.cnt]));
      const latestMap = new Map<number, string>();
      for (const r of publishedRows) {
        if (!latestMap.has(r.appId)) latestMap.set(r.appId, r.version);
      }

      return rows.map((row) => ({
        ...mapClientApp(row),
        releaseCount: countMap.get(row.id) ?? 0,
        latestVersion: latestMap.get(row.id) ?? null,
      }));
    },
  });
}

/** 全部启用应用（页面应用切换器） */
export async function listAllClientApps() {
  const rows = await db
    .select()
    .from(clientApps)
    .where(buildClientAppWhere({ status: 'enabled' }))
    .orderBy(asc(clientApps.id));
  return rows.map(mapClientApp);
}

export async function ensureClientAppExists(id: number): Promise<ClientAppRow> {
  return requireFirstRow(
    db.select().from(clientApps).where(eq(clientApps.id, id)).limit(1),
    '应用不存在',
  );
}

export async function getClientAppBeforeAudit(id: number) {
  return mapClientApp(await ensureClientAppExists(id));
}

export async function createClientApp(input: CreateClientAppInput) {
  try {
    const [row] = await db.insert(clientApps).values(input).returning();
    return mapClientApp(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '应用标识（appKey）已存在');
    throw err;
  }
}

export async function updateClientApp(id: number, input: UpdateClientAppInput) {
  await ensureClientAppExists(id);
  const [row] = await db.update(clientApps).set(input).where(eq(clientApps.id, id)).returning();
  return mapClientApp(row);
}

export async function deleteClientApp(id: number) {
  await ensureClientAppExists(id);
  const releaseCount = await db.$count(appReleases, eq(appReleases.appId, id));
  if (releaseCount > 0) throw new HTTPException(400, { message: '该应用下仍有版本记录，请先删除全部版本' });
  await db.delete(clientApps).where(eq(clientApps.id, id));
}

// ─── 版本 CRUD 与状态机 ───────────────────────────────────────────────────────

export interface ListAppReleasesQuery {
  page?: number;
  pageSize?: number;
  appId?: number;
  channel?: AppReleaseChannel;
  status?: AppReleaseStatus;
  keyword?: string;
}

function buildAppReleaseWhere(q: ListAppReleasesQuery & { id?: number }) {
  return buildWhere(
    q.id !== undefined ? eq(appReleases.id, q.id) : undefined,
    q.appId !== undefined ? eq(appReleases.appId, q.appId) : undefined,
    q.channel ? eq(appReleases.channel, q.channel) : undefined,
    q.status ? eq(appReleases.status, q.status) : undefined,
    keywordCondition(q.keyword, [appReleases.version, appReleases.notes]),
  );
}

export async function listAppReleases(q: ListAppReleasesQuery) {
  const { page = 1, pageSize = 10 } = q;
  const where = buildAppReleaseWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(appReleases, where),
    rows: () => db.query.appReleases.findMany({
      where,
      with: {
        app: { columns: { appKey: true, name: true } },
        artifacts: true,
      },
      orderBy: [desc(appReleases.createdAt), desc(appReleases.id)],
      limit: pageSize,
      offset: (Math.max(page, 1) - 1) * pageSize,
    }),
    map: mapAppRelease,
  });
}

export async function ensureAppReleaseExists(id: number): Promise<AppReleaseRow> {
  return requireFirstRow(
    db.select().from(appReleases).where(eq(appReleases.id, id)).limit(1),
    '版本不存在',
  );
}

export async function getAppRelease(id: number) {
  const row = requireRow(await db.query.appReleases.findFirst({
    where: eq(appReleases.id, id),
    with: {
      app: { columns: { appKey: true, name: true } },
      artifacts: true,
    },
  }), '版本不存在');
  return mapAppRelease(row);
}

export async function getAppReleaseBeforeAudit(id: number) {
  return mapAppRelease(await ensureAppReleaseExists(id));
}

export async function createAppRelease(input: CreateAppReleaseInput) {
  await ensureClientAppExists(input.appId);
  try {
    const [row] = await db.insert(appReleases).values(input).returning();
    return getAppRelease(row.id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该应用在此渠道下已存在相同版本号');
    throw err;
  }
}

export async function updateAppRelease(id: number, input: UpdateAppReleaseInput) {
  const before = await ensureAppReleaseExists(id);
  // 版本号与渠道是发布事实的一部分，仅草稿可改；发布后只允许调整说明与升级策略
  if (before.status !== 'draft') {
    if (input.version !== undefined && input.version !== before.version) {
      throw new HTTPException(400, { message: '仅草稿状态可修改版本号' });
    }
    if (input.channel !== undefined && input.channel !== before.channel) {
      throw new HTTPException(400, { message: '仅草稿状态可修改发布渠道' });
    }
  }
  try {
    await db.update(appReleases).set(input).where(eq(appReleases.id, id));
  } catch (err) {
    rethrowPgUniqueViolation(err, '该应用在此渠道下已存在相同版本号');
    throw err;
  }
  return getAppRelease(id);
}

export async function publishAppRelease(id: number) {
  const before = await ensureAppReleaseExists(id);
  if (before.status === 'published') throw new HTTPException(400, { message: '该版本已是发布状态' });
  const artifactCount = await db.$count(appArtifacts, eq(appArtifacts.releaseId, id));
  if (artifactCount === 0) throw new HTTPException(400, { message: '该版本还没有任何制品，无法发布' });
  // 重新发布也刷新 publishedAt：公开侧始终以最新发布时间决定「最新版本」
  await db.update(appReleases).set({ status: 'published', publishedAt: new Date() }).where(eq(appReleases.id, id));
  return getAppRelease(id);
}

export async function revokeAppRelease(id: number) {
  const before = await ensureAppReleaseExists(id);
  if (before.status !== 'published') throw new HTTPException(400, { message: '仅已发布版本可以撤回' });
  await db.update(appReleases).set({ status: 'revoked' }).where(eq(appReleases.id, id));
  return getAppRelease(id);
}

export async function setAppReleaseRollout(id: number, rolloutPercent: number) {
  await ensureAppReleaseExists(id);
  await db.update(appReleases).set({ rolloutPercent }).where(eq(appReleases.id, id));
  return getAppRelease(id);
}

export async function deleteAppRelease(id: number) {
  const before = await ensureAppReleaseExists(id);
  if (before.status === 'published') throw new HTTPException(400, { message: '已发布版本不可删除，请先撤回' });
  const artifacts = await db.select().from(appArtifacts).where(eq(appArtifacts.releaseId, id));
  await db.delete(appReleases).where(eq(appReleases.id, id)); // 制品行随外键级联删除
  // 存储清理是尽力而为的副作用，不放入事务：失败只影响存储空间，不影响发布数据一致性
  for (const artifact of artifacts) {
    if (!artifact.fileId) continue;
    try {
      await deleteManagedFile(artifact.fileId);
    } catch (err) {
      logger.warn(`[app-releases] 删除制品文件失败 fileId=${artifact.fileId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ─── 制品 ─────────────────────────────────────────────────────────────────────

export interface AddFileArtifactMeta {
  platform: AppPlatform;
  arch: AppArch;
  kind: Exclude<AppArtifactKind, 'external'>;
}

export async function addFileArtifact(releaseId: number, meta: AddFileArtifactMeta, file: File) {
  await ensureAppReleaseExists(releaseId);
  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  // 制品是任意二进制（exe / dmg / apk / yml / blockmap），不适用通用上传的
  // MIME 白名单（uploadManagedFile 会拒绝 application/octet-stream），
  // 走生成文件通道；接口本身已由 system:app-release:create 权限门控
  const uploaded = await saveGeneratedManagedFile({
    buffer,
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    tenantId: null,
    createdBy: currentUser().userId,
  });
  try {
    const [row] = await db
      .insert(appArtifacts)
      .values({
        releaseId,
        platform: meta.platform,
        arch: meta.arch,
        kind: meta.kind,
        fileId: uploaded.id,
        fileName: file.name,
        size: file.size,
        sha256,
      })
      .returning();
    return mapAppArtifact(row);
  } catch (err) {
    // 制品行写入失败时回收刚上传的文件，避免存储残留
    try {
      await deleteManagedFile(uploaded.id);
    } catch {
      logger.warn(`[app-releases] 回收上传文件失败 fileId=${uploaded.id}`);
    }
    rethrowPgUniqueViolation(err, '该版本下已存在同名制品文件');
    throw err;
  }
}

export async function addExternalArtifact(releaseId: number, input: CreateExternalArtifactInput) {
  await ensureAppReleaseExists(releaseId);
  try {
    const [row] = await db
      .insert(appArtifacts)
      .values({
        releaseId,
        platform: input.platform,
        arch: input.arch,
        kind: 'external',
        externalUrl: input.externalUrl,
        fileName: input.fileName,
        size: 0,
      })
      .returning();
    return mapAppArtifact(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该版本下已存在同名制品文件');
    throw err;
  }
}

export async function ensureAppArtifactExists(id: number): Promise<AppArtifactRow> {
  return requireFirstRow(
    db.select().from(appArtifacts).where(eq(appArtifacts.id, id)).limit(1),
    '制品不存在',
  );
}

export async function getAppArtifactBeforeAudit(id: number) {
  return mapAppArtifact(await ensureAppArtifactExists(id));
}

export async function deleteAppArtifact(id: number) {
  const artifact = await ensureAppArtifactExists(id);
  await db.delete(appArtifacts).where(eq(appArtifacts.id, id));
  if (artifact.fileId) {
    try {
      await deleteManagedFile(artifact.fileId);
    } catch (err) {
      logger.warn(`[app-releases] 删除制品文件失败 fileId=${artifact.fileId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ─── 公开侧：检查更新 / 制品分发 / 回执 ──────────────────────────────────────

async function findEnabledAppByKey(appKey: string): Promise<ClientAppRow> {
  return requireFirstRow(
    db
      .select()
      .from(clientApps)
      .where(and(eq(clientApps.appKey, appKey), eq(clientApps.status, 'enabled')))
      .limit(1),
    '应用不存在',
  );
}

/** 事件写入失败不影响主流程（统计缺一条 ≪ 客户端升级被 500 打断） */
async function safeInsertEvent(values: NewAppReleaseEvent) {
  try {
    await db.insert(appReleaseEvents).values(values);
  } catch (err) {
    logger.warn(`[app-releases] 升级事件写入失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function buildPublicDownloadUrl(appKey: string, channel: AppReleaseChannel, platform: AppPlatform, fileName: string) {
  return `/api/public/app-releases/${appKey}/${channel}/${platform}/${encodeURIComponent(fileName)}`;
}

/** check 响应选择制品：热更包优先于安装包，精确架构优先于 universal，metadata 不参与 */
function pickCheckArtifact(artifacts: AppArtifactRow[], platform: AppPlatform, arch?: AppArch) {
  const KIND_ORDER: Record<string, number> = { hotupdate: 0, installer: 1, external: 2 };
  return artifacts
    .filter((a) => a.platform === platform && a.kind !== 'metadata')
    .filter((a) => !arch || a.arch === arch || a.arch === 'universal')
    .sort((a, b) => {
      const kindDiff = (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9);
      if (kindDiff !== 0) return kindDiff;
      if (arch) return (a.arch === arch ? 0 : 1) - (b.arch === arch ? 0 : 1);
      return 0;
    })[0];
}

export async function checkAppUpdate(q: CheckAppUpdateQuery): Promise<AppUpdateCheckResult> {
  const app = await findEnabledAppByKey(q.app);
  const rows = await db.query.appReleases.findMany({
    where: and(
      eq(appReleases.appId, app.id),
      eq(appReleases.channel, q.channel),
      eq(appReleases.status, 'published'),
    ),
    with: { artifacts: true },
    orderBy: [desc(appReleases.publishedAt), desc(appReleases.id)],
    limit: 50,
  });

  let matched: { release: (typeof rows)[number]; artifact: AppArtifactRow } | null = null;
  for (const release of rows) {
    if (compareSemver(release.version, q.version) <= 0) continue;
    const artifact = pickCheckArtifact(release.artifacts, q.platform, q.arch);
    if (!artifact) continue;
    if (release.rolloutPercent < 100 && (!q.deviceId || !rolloutHit(q.deviceId, release.id, release.rolloutPercent))) {
      continue;
    }
    matched = { release, artifact };
    break;
  }

  await safeInsertEvent({
    appId: app.id,
    releaseId: matched?.release.id ?? null,
    eventType: 'check',
    channel: q.channel,
    platform: q.platform,
    arch: q.arch ?? null,
    version: q.version,
    deviceId: q.deviceId ?? null,
  });

  // 检查即心跳:携带 deviceId 的请求顺手养活统一设备中心（失败不影响主流程）
  if (q.deviceId) {
    await upsertDeviceHeartbeat({
      deviceId: q.deviceId,
      appId: app.id,
      platform: q.platform,
      arch: q.arch,
      appVersion: q.version,
    });
  }

  if (!matched) return { hasUpdate: false };

  const { release, artifact } = matched;
  const mandatory = release.mandatory || (release.minVersion ? compareSemver(q.version, release.minVersion) < 0 : false);
  return {
    hasUpdate: true,
    mandatory,
    version: release.version,
    notes: release.notes ?? null,
    publishedAt: formatNullableDateTime(release.publishedAt),
    artifact: {
      kind: artifact.kind,
      fileName: artifact.fileName,
      size: artifact.size,
      sha256: artifact.sha256 ?? null,
      downloadUrl: artifact.kind === 'external' && artifact.externalUrl
        ? artifact.externalUrl
        : buildPublicDownloadUrl(app.appKey, q.channel, q.platform, artifact.fileName),
    },
  };
}

export interface ResolvedPublicArtifact {
  app: ClientAppRow;
  release: AppReleaseRow;
  artifact: AppArtifactRow;
}

/**
 * 按文件名解析公开制品（electron-updater generic provider 的请求形态）。
 *
 * latest.yml 等 metadata 指向「最新发布版本」，同名文件在多个版本存在时取发布时间最新
 * 且通过灰度命中的一个；无 deviceId 时灰度中的版本对其不可见（fail-closed）。
 * 版本化的二进制文件名全局唯一，不做灰度门控（其可见性已由 check / latest.yml 决定）。
 */
export async function resolvePublicArtifact(params: {
  appKey: string;
  channel: AppReleaseChannel;
  platform: AppPlatform;
  fileName: string;
  deviceId?: string;
}): Promise<ResolvedPublicArtifact> {
  const app = await findEnabledAppByKey(params.appKey);
  const rows = await db
    .select({ artifact: appArtifacts, release: appReleases })
    .from(appArtifacts)
    .innerJoin(appReleases, eq(appArtifacts.releaseId, appReleases.id))
    .where(
      and(
        eq(appReleases.appId, app.id),
        eq(appReleases.channel, params.channel),
        eq(appReleases.status, 'published'),
        eq(appArtifacts.platform, params.platform),
        eq(appArtifacts.fileName, params.fileName),
      ),
    )
    .orderBy(desc(appReleases.publishedAt), desc(appReleases.id))
    .limit(20);

  for (const { artifact, release } of rows) {
    const gated = artifact.kind === 'metadata' && release.rolloutPercent < 100;
    if (gated && (!params.deviceId || !rolloutHit(params.deviceId, release.id, release.rolloutPercent))) continue;
    return { app, release, artifact };
  }
  throw new HTTPException(404, { message: '文件不存在' });
}

/** 下载计数 + 事件留痕（metadata 不计；Range 续传只在首个分片计一次，由路由决定是否调用） */
export async function registerArtifactDownload(resolved: ResolvedPublicArtifact, deviceId?: string) {
  if (resolved.artifact.kind === 'metadata') return;
  await db
    .update(appArtifacts)
    .set({ downloadCount: sql`${appArtifacts.downloadCount} + 1` })
    .where(eq(appArtifacts.id, resolved.artifact.id));
  await safeInsertEvent({
    appId: resolved.app.id,
    releaseId: resolved.release.id,
    artifactId: resolved.artifact.id,
    eventType: 'download',
    channel: resolved.release.channel,
    platform: resolved.artifact.platform,
    arch: resolved.artifact.arch,
    version: resolved.release.version,
    deviceId: deviceId ?? null,
  });
}

/** 官网下载页：最新已发布版本及其全部（非 metadata）制品 */
export async function getLatestPublicRelease(
  appKey: string,
  channel: AppReleaseChannel,
  platform?: AppPlatform,
): Promise<AppPublicReleaseInfo> {
  const app = await findEnabledAppByKey(appKey);
  const rows = await db.query.appReleases.findMany({
    where: and(eq(appReleases.appId, app.id), eq(appReleases.channel, channel), eq(appReleases.status, 'published')),
    with: { artifacts: true },
    orderBy: [desc(appReleases.publishedAt), desc(appReleases.id)],
    limit: 20,
  });
  const maybeRelease = rows.find((r) =>
    r.artifacts.some((a) => a.kind !== 'metadata' && (!platform || a.platform === platform)),
  );
  const release = requireRow(maybeRelease, '暂无已发布版本');
  return {
    version: release.version,
    notes: release.notes ?? null,
    publishedAt: formatNullableDateTime(release.publishedAt),
    artifacts: release.artifacts
      .filter((a) => a.kind !== 'metadata' && (!platform || a.platform === platform))
      .map((a) => ({
        platform: a.platform,
        arch: a.arch,
        kind: a.kind,
        fileName: a.fileName,
        size: a.size,
        sha256: a.sha256 ?? null,
        downloadUrl: a.kind === 'external' && a.externalUrl
          ? a.externalUrl
          : buildPublicDownloadUrl(app.appKey, channel, a.platform, a.fileName),
      })),
  };
}

/** 客户端安装回执（install_success / install_fail） */
export async function reportAppReleaseEvent(input: ReportAppReleaseEventInput) {
  const app = await findEnabledAppByKey(input.app);
  const [release] = await db
    .select({ id: appReleases.id })
    .from(appReleases)
    .where(
      and(
        eq(appReleases.appId, app.id),
        eq(appReleases.channel, input.channel),
        eq(appReleases.version, input.version),
      ),
    )
    .limit(1);
  await safeInsertEvent({
    appId: app.id,
    releaseId: release?.id ?? null,
    eventType: input.eventType,
    channel: input.channel,
    platform: input.platform,
    arch: input.arch ?? null,
    version: input.version,
    deviceId: input.deviceId ?? null,
  });
}

// ─── 看板统计 ─────────────────────────────────────────────────────────────────

export async function getAppReleaseStats(appId: number, days: number): Promise<AppReleaseStats> {
  await ensureClientAppExists(appId);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const baseWhere = and(eq(appReleaseEvents.appId, appId), gte(appReleaseEvents.createdAt, since));
  const dateExpr = sql<string>`to_char(${appReleaseEvents.createdAt}, 'YYYY-MM-DD')`;

  const [typeTotals, activeDevices, trendRows, platformRows, versionRows] = await Promise.all([
    db
      .select({ eventType: appReleaseEvents.eventType, cnt: sql<number>`count(*)::int` })
      .from(appReleaseEvents)
      .where(baseWhere)
      .groupBy(appReleaseEvents.eventType),
    // 在网设备与版本分布直查统一设备中心（比事件去重更准:一台设备只算一次）
    countActiveDevices(appId, since),
    db
      .select({ date: dateExpr, eventType: appReleaseEvents.eventType, cnt: sql<number>`count(*)::int` })
      .from(appReleaseEvents)
      .where(baseWhere)
      .groupBy(dateExpr, appReleaseEvents.eventType),
    db
      .select({ platform: appReleaseEvents.platform, cnt: sql<number>`count(*)::int` })
      .from(appReleaseEvents)
      .where(and(baseWhere, eq(appReleaseEvents.eventType, 'check'), sql`${appReleaseEvents.platform} is not null`))
      .groupBy(appReleaseEvents.platform),
    getDeviceVersionDistribution(appId, since),
  ]);

  const totalsMap = new Map(typeTotals.map((r) => [r.eventType, r.cnt]));

  // 趋势补零：图表需要连续日期轴
  const trendMap = new Map<string, { checks: number; downloads: number; installSuccess: number; installFail: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    trendMap.set(key, { checks: 0, downloads: 0, installSuccess: 0, installFail: 0 });
  }
  for (const row of trendRows) {
    const bucket = trendMap.get(row.date);
    if (!bucket) continue;
    if (row.eventType === 'check') bucket.checks = row.cnt;
    else if (row.eventType === 'download') bucket.downloads = row.cnt;
    else if (row.eventType === 'install_success') bucket.installSuccess = row.cnt;
    else if (row.eventType === 'install_fail') bucket.installFail = row.cnt;
  }

  return {
    totals: {
      checks: totalsMap.get('check') ?? 0,
      downloads: totalsMap.get('download') ?? 0,
      devices: activeDevices,
      installSuccess: totalsMap.get('install_success') ?? 0,
      installFail: totalsMap.get('install_fail') ?? 0,
    },
    trend: [...trendMap.entries()].map(([date, counts]) => ({ date, ...counts })),
    platforms: platformRows.map((r) => ({ platform: r.platform as AppPlatform, count: r.cnt })),
    versions: versionRows.map((r) => ({ version: r.version as string, devices: r.devices })),
  };
}
