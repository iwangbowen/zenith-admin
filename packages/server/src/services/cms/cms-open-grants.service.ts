/**
 * 开放应用的 CMS 站点/栏目授权。
 *
 * 安全模型：`cms:write` scope 只说明「这个应用能调写接口」，不代表「能写任意站点」。
 * 与人类侧的 `cms_site_users` / `cms_channel_users` 同构 —— 未显式授权一律拒绝（fail-closed）。
 * 直接发布还要三个条件同时成立：`cms:publish` scope + 授权行 `can_publish` + 站点开关。
 */
import { requireRow } from '../../lib/db-assert';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsChannels, cmsOpenAppGrants, cmsSites, oauth2Clients } from '../../db/schema';
import type { CmsOpenAppGrantRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { resolveCmsSiteOpsSettings } from './cms-site-settings';
import { assertSiteAccess } from './cms-sites.service';

export function mapCmsOpenAppGrant(row: CmsOpenAppGrantRow, extra?: { siteName?: string | null; appName?: string | null }) {
  return {
    id: row.id,
    clientId: row.clientId,
    appName: extra?.appName ?? null,
    siteId: row.siteId,
    siteName: extra?.siteName ?? null,
    channelIds: row.channelIds ?? [],
    canPublish: row.canPublish,
    status: row.status,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function listCmsOpenAppGrants(siteId?: number) {
  const rows = await db.select({
    grant: cmsOpenAppGrants,
    siteName: cmsSites.name,
    appName: oauth2Clients.name,
  }).from(cmsOpenAppGrants)
    .leftJoin(cmsSites, eq(cmsOpenAppGrants.siteId, cmsSites.id))
    .leftJoin(oauth2Clients, eq(cmsOpenAppGrants.clientId, oauth2Clients.clientId))
    .where(siteId ? eq(cmsOpenAppGrants.siteId, siteId) : undefined)
    .orderBy(desc(cmsOpenAppGrants.id));
  return rows.map((row) => mapCmsOpenAppGrant(row.grant, { siteName: row.siteName, appName: row.appName }));
}

export interface SaveCmsOpenAppGrantInput {
  clientId: string;
  siteId: number;
  channelIds?: number[];
  canPublish?: boolean;
  status?: 'enabled' | 'disabled';
  remark?: string | null;
}

export async function saveCmsOpenAppGrant(input: SaveCmsOpenAppGrantInput) {
  const [site] = await db.select({ id: cmsSites.id }).from(cmsSites).where(eq(cmsSites.id, input.siteId)).limit(1);
  requireRow(site, '站点不存在');
  const [app] = await db.select({ clientId: oauth2Clients.clientId }).from(oauth2Clients)
    .where(eq(oauth2Clients.clientId, input.clientId)).limit(1);
  requireRow(app, '开放应用不存在');

  const channelIds = [...new Set(input.channelIds ?? [])].filter((id) => Number.isInteger(id) && id > 0);
  if (channelIds.length > 0) {
    const rows = await db.select({ id: cmsChannels.id }).from(cmsChannels).where(and(
      eq(cmsChannels.siteId, input.siteId),
      inArray(cmsChannels.id, channelIds),
    ));
    if (rows.length !== channelIds.length) {
      throw new HTTPException(400, { message: '存在不属于该站点的栏目' });
    }
  }

  const [row] = await db.insert(cmsOpenAppGrants).values({
    clientId: input.clientId,
    siteId: input.siteId,
    channelIds,
    canPublish: input.canPublish === true,
    status: input.status ?? 'enabled',
    remark: input.remark ?? null,
  }).onConflictDoUpdate({
    target: [cmsOpenAppGrants.clientId, cmsOpenAppGrants.siteId],
    set: {
      channelIds,
      canPublish: input.canPublish === true,
      status: input.status ?? 'enabled',
      remark: input.remark ?? null,
    },
  }).returning();
  return mapCmsOpenAppGrant(row);
}

export async function deleteCmsOpenAppGrant(id: number) {
  const [row] = await db.select().from(cmsOpenAppGrants).where(eq(cmsOpenAppGrants.id, id)).limit(1);
  requireRow(row, '授权不存在');
  // 站点级 ACL：否则持有 cms:site:update 的用户可以枚举 id，撤销别的站点的开放授权
  await assertSiteAccess(row.siteId);
  await db.delete(cmsOpenAppGrants).where(eq(cmsOpenAppGrants.id, id));
}

// ─── 运行时校验（网关写入路径）───────────────────────────────────────────────

export interface CmsOpenWriteAccess {
  clientId: string;
  siteId: number;
  channelIds: number[];
  canPublish: boolean;
}

/** 应用被授权的站点 id（读接口不依赖它 —— 只读走 scope + 已发布过滤即可） */
export async function listCmsOpenGrantedSiteIds(clientId: string): Promise<number[]> {
  const rows = await db.select({ siteId: cmsOpenAppGrants.siteId }).from(cmsOpenAppGrants)
    .where(and(eq(cmsOpenAppGrants.clientId, clientId), eq(cmsOpenAppGrants.status, 'enabled')));
  return rows.map((row) => row.siteId);
}

/** 写入前的 fail-closed 校验：无授权行即拒绝 */
export async function assertCmsOpenWriteAccess(clientId: string, siteId: number): Promise<CmsOpenWriteAccess> {
  const [row] = await db.select().from(cmsOpenAppGrants).where(and(
    eq(cmsOpenAppGrants.clientId, clientId),
    eq(cmsOpenAppGrants.siteId, siteId),
    eq(cmsOpenAppGrants.status, 'enabled'),
  )).limit(1);
  if (!row) {
    throw new HTTPException(403, { message: '应用未被授权写入该站点，请在「站点管理 → 开放授权」中配置' });
  }
  return { clientId, siteId: row.siteId, channelIds: row.channelIds ?? [], canPublish: row.canPublish };
}

/** 栏目白名单校验：授权行 channelIds 为空表示该站点全部栏目 */
export function assertCmsOpenChannelAllowed(access: CmsOpenWriteAccess, channelId: number): void {
  if (access.channelIds.length === 0) return;
  if (!access.channelIds.includes(channelId)) {
    throw new HTTPException(403, { message: `应用未被授权写入栏目 #${channelId}` });
  }
}

/**
 * 直接发布的三重开关：应用授权 `can_publish` + `cms:publish` scope + 站点内容策略。
 *
 * 与「站点导入包一律降级为草稿」同一条约定：外部写入默认不得绕过站点审核管道。
 */
export async function assertCmsOpenPublishAllowed(
  access: CmsOpenWriteAccess,
  hasPublishScope: boolean,
): Promise<void> {
  if (!hasPublishScope) {
    throw new HTTPException(403, { message: '应用未授权 scope：cms:publish' });
  }
  if (!access.canPublish) {
    throw new HTTPException(403, { message: '该站点的开放授权未开启「允许直接发布」' });
  }
  const [site] = await db.select({ settings: cmsSites.settings }).from(cmsSites)
    .where(eq(cmsSites.id, access.siteId)).limit(1);
  if (!resolveCmsSiteOpsSettings(site?.settings).openApiPublishEnabled) {
    throw new HTTPException(403, { message: '站点已关闭「允许开放 API 直接发布」' });
  }
}
