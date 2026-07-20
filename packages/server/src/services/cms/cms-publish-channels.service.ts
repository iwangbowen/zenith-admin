import { eq, asc } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsPublishChannels } from '../../db/schema';
import type { CmsPublishChannelRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { CMS_DEFAULT_CHANNEL_CODE } from '@zenith/shared';
import type { CreateCmsPublishChannelInput, UpdateCmsPublishChannelInput } from '@zenith/shared';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';

/** 前台渲染所需的通道信息（虚拟默认通道也用此结构） */
export interface PublishChannelInfo {
  id: number;
  siteId: number;
  name: string;
  code: string;
  domain: string | null;
  uaRegex: string | null;
  isDefault: boolean;
}

// ─── 前台通道缓存（siteId → 启用通道列表；写操作后失效）─────────────────────────
let channelCache: { bySite: Map<number, PublishChannelInfo[]>; byHost: Map<string, PublishChannelInfo>; loadedAt: number } | null = null;
const CHANNEL_CACHE_TTL_MS = 30_000;

export function invalidatePublishChannelCache(): void {
  channelCache = null;
}

async function getChannelCache() {
  if (channelCache && Date.now() - channelCache.loadedAt < CHANNEL_CACHE_TTL_MS) return channelCache;
  const rows = await db.select().from(cmsPublishChannels)
    .where(eq(cmsPublishChannels.status, 'enabled'))
    .orderBy(asc(cmsPublishChannels.sort), asc(cmsPublishChannels.id));
  const bySite = new Map<number, PublishChannelInfo[]>();
  const byHost = new Map<string, PublishChannelInfo>();
  for (const row of rows) {
    const info: PublishChannelInfo = {
      id: row.id, siteId: row.siteId, name: row.name, code: row.code,
      domain: row.domain ?? null, uaRegex: row.uaRegex ?? null, isDefault: row.isDefault,
    };
    const list = bySite.get(row.siteId) ?? [];
    list.push(info);
    bySite.set(row.siteId, list);
    // 仅非默认通道支持独立域名路由（默认通道走站点主域名）
    if (!info.isDefault && info.domain) byHost.set(info.domain.toLowerCase(), info);
  }
  channelCache = { bySite, byHost, loadedAt: Date.now() };
  return channelCache;
}

/** 虚拟默认通道：站点无任何通道记录时兜底（老站点零迁移可用） */
export function virtualDefaultChannel(siteId: number): PublishChannelInfo {
  return { id: 0, siteId, name: 'PC 桌面', code: CMS_DEFAULT_CHANNEL_CODE, domain: null, uaRegex: null, isDefault: true };
}

/** 站点启用的发布通道（前台渲染/静态化用；保证至少含一个默认通道） */
export async function getActivePublishChannels(siteId: number): Promise<PublishChannelInfo[]> {
  const cache = await getChannelCache();
  const list = cache.bySite.get(siteId) ?? [];
  if (!list.some((c) => c.isDefault)) return [virtualDefaultChannel(siteId), ...list];
  return list;
}

/** 站点默认通道 */
export async function getDefaultPublishChannel(siteId: number): Promise<PublishChannelInfo> {
  const list = await getActivePublishChannels(siteId);
  return list.find((c) => c.isDefault) ?? virtualDefaultChannel(siteId);
}

/** 按通道编码取启用通道（预览路径段 __{code} 校验用） */
export async function findActiveChannelByCode(siteId: number, code: string): Promise<PublishChannelInfo | null> {
  const list = await getActivePublishChannels(siteId);
  return list.find((c) => c.code === code) ?? null;
}

/** 按 Host 匹配非默认通道独立域名 */
export async function resolveChannelByHost(host: string | undefined): Promise<PublishChannelInfo | null> {
  if (!host) return null;
  const cache = await getChannelCache();
  return cache.byHost.get(host.split(':')[0].toLowerCase()) ?? null;
}

/**
 * UA 302 互跳目标 host（不含协议/路径；null = 无需跳转）：
 * 默认通道上 UA 命中某通道 uaRegex → 跳该通道域名；
 * 非默认通道上 UA 不再命中本通道 uaRegex → 跳回站点主域名。
 */
export async function resolveChannelUaRedirectHost(
  siteId: number,
  siteDomain: string | null,
  current: PublishChannelInfo,
  ua: string | undefined,
): Promise<string | null> {
  if (!ua) return null;
  const test = (pattern: string): boolean => {
    try {
      return new RegExp(pattern, 'i').test(ua);
    } catch {
      return false; // 用户配置的非法正则直接忽略
    }
  };
  if (current.isDefault) {
    const channels = await getActivePublishChannels(siteId);
    const hit = channels.find((c) => !c.isDefault && c.domain && c.uaRegex && test(c.uaRegex));
    return hit?.domain ?? null;
  }
  if (current.uaRegex && siteDomain && !test(current.uaRegex)) return siteDomain;
  return null;
}

// ─── 后台 CRUD ───────────────────────────────────────────────────────────────
export function mapCmsPublishChannel(row: CmsPublishChannelRow) {
  return {
    id: row.id,
    siteId: row.siteId,
    name: row.name,
    code: row.code,
    domain: row.domain ?? null,
    uaRegex: row.uaRegex ?? null,
    isDefault: row.isDefault,
    status: row.status,
    sort: row.sort,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureCmsPublishChannelExists(id: number): Promise<CmsPublishChannelRow> {
  const [row] = await db.select().from(cmsPublishChannels).where(eq(cmsPublishChannels.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '发布通道不存在' });
  return row;
}

/** 后台完整列表（含停用，按排序） */
export async function listCmsPublishChannels(siteId: number) {
  await assertSiteAccess(siteId);
  const rows = await db.select().from(cmsPublishChannels)
    .where(eq(cmsPublishChannels.siteId, siteId))
    .orderBy(asc(cmsPublishChannels.sort), asc(cmsPublishChannels.id));
  return rows.map(mapCmsPublishChannel);
}

export async function createCmsPublishChannel(data: CreateCmsPublishChannelInput) {
  await ensureCmsSiteExists(data.siteId);
  await assertSiteAccess(data.siteId);
  try {
    const row = await db.transaction(async (tx) => {
      if (data.isDefault) {
        await tx.update(cmsPublishChannels).set({ isDefault: false }).where(eq(cmsPublishChannels.siteId, data.siteId));
      }
      const [created] = await tx.insert(cmsPublishChannels).values({ ...data }).returning();
      return created;
    });
    invalidatePublishChannelCache();
    return mapCmsPublishChannel(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同编码的通道');
  }
}

export async function updateCmsPublishChannel(id: number, data: UpdateCmsPublishChannelInput) {
  const current = await ensureCmsPublishChannelExists(id);
  await assertSiteAccess(current.siteId);
  if (current.isDefault && data.isDefault === false) {
    throw new HTTPException(400, { message: '默认通道不可取消默认，请将其他通道设为默认' });
  }
  if (current.isDefault && data.status === 'disabled') {
    throw new HTTPException(400, { message: '默认通道不可停用' });
  }
  try {
    const row = await db.transaction(async (tx) => {
      if (data.isDefault && !current.isDefault) {
        await tx.update(cmsPublishChannels).set({ isDefault: false }).where(eq(cmsPublishChannels.siteId, current.siteId));
      }
      const [updated] = await tx.update(cmsPublishChannels).set({ ...data }).where(eq(cmsPublishChannels.id, id)).returning();
      return updated;
    });
    invalidatePublishChannelCache();
    return mapCmsPublishChannel(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同编码的通道');
  }
}

export async function deleteCmsPublishChannel(id: number) {
  const current = await ensureCmsPublishChannelExists(id);
  await assertSiteAccess(current.siteId);
  if (current.isDefault) throw new HTTPException(400, { message: '默认通道不可删除' });
  await db.delete(cmsPublishChannels).where(eq(cmsPublishChannels.id, id));
  invalidatePublishChannelCache();
}
