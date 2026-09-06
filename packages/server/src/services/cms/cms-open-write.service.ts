/**
 * Headless 开放 API 的 CMS 写入服务。
 *
 * 全部复用后台既有的 `createCmsContent` / `updateCmsContent` / `submitCmsContent` 等管线，
 * 因此版本快照、操作日志、发布 outbox、静态产物、敏感词替换、编辑锁校验、素材句柄归一化
 * 与引用索引维护全部自动生效 —— 开放 API 不另起一套写路径。
 *
 * 安全边界（三层，缺一不可）：
 *   1. scope：`cms:write` / `cms:publish`
 *   2. 应用授权：`cms_open_app_grants` 的站点 + 栏目白名单（fail-closed）
 *   3. 站点开关：`openApiPublishEnabled` 决定能否绕过审核直接发布
 */
import { requireRow } from '../../lib/db-assert';
import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsChannels, cmsContents } from '../../db/schema';
import type { CmsSiteRow } from '../../db/schema';
import { runWithCmsOpenApiAccess, runWithCurrentUser } from '../../lib/context';
import {
  createCmsContent, getCmsContent, publishCmsContent, recycleCmsContents,
  submitCmsContent, updateCmsContent,
} from './cms-contents.service';
import {
  assertCmsOpenChannelAllowed, assertCmsOpenPublishAllowed, assertCmsOpenWriteAccess,
  type CmsOpenWriteAccess,
} from './cms-open-grants.service';
import { getEffectivelyEnabledCmsChannelIds } from './cms-channel-visibility.service';

/**
 * 开放 API 写入以系统身份执行。
 *
 * 内容的 `created_by` 会记为系统账号，真实来源通过 `source` 字段标记为「开放应用: {appKey}」，
 * 后台内容列表可据此筛出外部写入的稿件。
 */
const OPEN_API_ACTOR = { userId: 1, username: 'open-api', roles: [] as string[], tenantId: null };

/**
 * 以开放应用 principal 执行后台写入管线。
 *
 * `runWithCurrentUser` 仅用于兼容审计/创建人等需要用户上下文的旧服务；权限和
 * 站点/栏目范围由独立的 `CmsOpenApiAccessContext` 决定，故这里绝不能再携带
 * `super_admin` 角色。
 */
function withOpenApiActor<T>(
  access: CmsOpenWriteAccess,
  permissions: readonly string[],
  fn: () => Promise<T>,
): Promise<T> {
  return runWithCmsOpenApiAccess({
    clientId: access.clientId,
    siteId: access.siteId,
    channelIds: access.channelIds,
    permissions,
  }, () => runWithCurrentUser({
    ...OPEN_API_ACTOR,
    roles: [],
  }, fn));
}

async function resolveWritableChannel(site: CmsSiteRow, access: CmsOpenWriteAccess, channelCode: string) {
  const [channel] = await db.select().from(cmsChannels).where(and(
    eq(cmsChannels.siteId, site.id),
    eq(cmsChannels.code, channelCode),
  )).limit(1);
  requireRow(channel, `栏目标识「${channelCode}」不存在`);
  if (channel.type !== 'list') throw new HTTPException(400, { message: '仅列表型栏目可写入内容' });
  if (channel.status !== 'enabled' || !(await getEffectivelyEnabledCmsChannelIds(site.id)).has(channel.id)) {
    throw new HTTPException(400, { message: '栏目已停用或其父级栏目不可用' });
  }
  assertCmsOpenChannelAllowed(access, channel.id);
  return channel;
}

/** 取应用有权访问的内容行；跨站或越权栏目一律 404，不泄露存在性 */
async function ensureWritableContent(site: CmsSiteRow, access: CmsOpenWriteAccess, id: number) {
  const [row] = await db.select().from(cmsContents).where(and(
    eq(cmsContents.id, id),
    eq(cmsContents.siteId, site.id),
  )).limit(1);
  requireRow(row, '内容不存在');
  assertCmsOpenChannelAllowed(access, row.channelId);
  return row;
}

export interface OpenCreateContentInput {
  channel: string;
  title: string;
  subTitle?: string | null;
  shortTitle?: string | null;
  slug?: string | null;
  summary?: string | null;
  coverImage?: string | null;
  author?: string | null;
  editor?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  body?: string | null;
  extend?: Record<string, unknown>;
  externalLink?: string | null;
  seoTitle?: string | null;
  seoKeywords?: string | null;
  seoDescription?: string | null;
  /** true 且三重开关全开时直接发布，否则落草稿并提交审核 */
  publish?: boolean;
}

export async function createOpenCmsContent(
  site: CmsSiteRow,
  clientId: string,
  hasPublishScope: boolean,
  input: OpenCreateContentInput,
) {
  const access = await assertCmsOpenWriteAccess(clientId, site.id);
  const channel = await resolveWritableChannel(site, access, input.channel);
  if (input.publish) await assertCmsOpenPublishAllowed(access, hasPublishScope);

  const { channel: _channel, publish, ...rest } = input;
  return withOpenApiActor(access, [
    'cms:content:create', 'cms:content:update', 'cms:content:submit',
    ...(publish ? ['cms:content:publish'] : []),
  ], async () => {
    const created = await createCmsContent({
      ...rest,
      siteId: site.id,
      channelId: channel.id,
      source: rest.source ?? `开放应用: ${clientId}`,
      extend: rest.extend ?? {},
    } as Parameters<typeof createCmsContent>[0]);
    if (!created) throw new HTTPException(500, { message: '内容创建失败' });
    if (publish) {
      await publishCmsContent(created.id, { skipAccessCheck: true });
    } else {
      await submitCmsContent(created.id, { skipAccessCheck: true });
    }
    return getCmsContent(created.id);
  });
}

export interface OpenUpdateContentInput extends Partial<Omit<OpenCreateContentInput, 'channel' | 'publish'>> {
  channel?: string;
  /** 乐观锁：与当前 version 不一致返回 409 */
  expectedVersion?: number;
}

export async function updateOpenCmsContent(
  site: CmsSiteRow,
  clientId: string,
  id: number,
  input: OpenUpdateContentInput,
) {
  const access = await assertCmsOpenWriteAccess(clientId, site.id);
  await ensureWritableContent(site, access, id);
  const { channel: channelCode, ...rest } = input;
  const channel = channelCode ? await resolveWritableChannel(site, access, channelCode) : null;
  return withOpenApiActor(access, ['cms:content:update'], async () => {
    await updateCmsContent(id, {
      ...rest,
      ...(channel ? { channelId: channel.id } : {}),
    } as Parameters<typeof updateCmsContent>[1]);
    return getCmsContent(id);
  });
}

export async function submitOpenCmsContent(site: CmsSiteRow, clientId: string, id: number) {
  const access = await assertCmsOpenWriteAccess(clientId, site.id);
  await ensureWritableContent(site, access, id);
  return withOpenApiActor(access, ['cms:content:submit'], async () => {
    await submitCmsContent(id, { skipAccessCheck: true });
    return getCmsContent(id);
  });
}

export async function publishOpenCmsContent(
  site: CmsSiteRow,
  clientId: string,
  hasPublishScope: boolean,
  id: number,
) {
  const access = await assertCmsOpenWriteAccess(clientId, site.id);
  await assertCmsOpenPublishAllowed(access, hasPublishScope);
  await ensureWritableContent(site, access, id);
  return withOpenApiActor(access, ['cms:content:publish'], async () => {
    await publishCmsContent(id, { skipAccessCheck: true });
    return getCmsContent(id);
  });
}

/** 删除即移入回收站；彻底删除只能由后台执行 */
export async function recycleOpenCmsContent(site: CmsSiteRow, clientId: string, id: number) {
  const access = await assertCmsOpenWriteAccess(clientId, site.id);
  await ensureWritableContent(site, access, id);
  return withOpenApiActor(access, ['cms:content:delete'], async () => {
    await recycleCmsContents([id]);
  });
}
