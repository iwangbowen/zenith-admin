import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { parseCmsLink } from '@zenith/shared/cms';
import type { CmsChannelDetailPathRule, CmsLinkEntityType, CmsLinkRef, CmsLinkTarget } from '@zenith/shared/cms';
import { db } from '../../db';
import { cmsChannels, cmsContents } from '../../db/schema';
import { channelUrl, contentUrl } from './cms-urls';
import { getEffectivelyEnabledCmsChannelIds } from './cms-channel-visibility.service';

/**
 * 链接解析 —— 把 `entity:content/123` / `entity:channel/45` / `internal:/x` 解析成真实 URL。
 *
 * 协议定义见 `packages/shared/src/cms-link.ts`。解析发生在渲染层而非写入层，
 * 这样目标内容改 slug / 换栏目后，指向它的链接会自动跟随，不会变成死链。
 */

export type CmsLinkResolution = {
  /** 可直接输出到 href 的最终地址 */
  url: string;
  /** 仅 http(s) 等站外地址为 true；站内链接不应 target=_blank */
  isExternal: boolean;
};

/** 批量解析器：对预先声明过的链接值做 O(1) 查表，未声明的值按需退化为同步可解析部分 */
export type CmsLinkResolver = (raw: string | null | undefined) => CmsLinkResolution | null;

/** 实体链接最多跟随的跳数（A→B→C），超出视为环，判定为死链 */
const MAX_HOPS = 3;

type ContentTarget = {
  id: number; slug: string | null; staticPath: string | null;
  publishedAt: Date | null; createdAt: Date; channelId: number; externalLink: string | null;
};
type ChannelTarget = {
  id: number; code: string; path: string;
  detailPathRule: CmsChannelDetailPathRule; type: string; linkUrl: string | null;
};

function collectRefs(rawLinks: Iterable<string | null | undefined>): Map<string, CmsLinkRef> {
  const refs = new Map<string, CmsLinkRef>();
  for (const raw of rawLinks) {
    const value = raw?.trim();
    if (!value || refs.has(value)) continue;
    const ref = parseCmsLink(value);
    if (ref) refs.set(value, ref);
  }
  return refs;
}

function entityIdsOf(refs: Iterable<CmsLinkRef>, entityType: CmsLinkEntityType): Set<number> {
  const ids = new Set<number>();
  for (const ref of refs) {
    if (ref.kind === 'entity' && ref.entityType === entityType && ref.id !== null) ids.add(ref.id);
  }
  return ids;
}

/** 是否存在按栏目标识引用的链接（决定要不要把栏目表整表取回来建 code 索引） */
function hasChannelCodeRef(refs: Iterable<CmsLinkRef>): boolean {
  for (const ref of refs) {
    if (ref.kind === 'entity' && ref.code !== null) return true;
  }
  return false;
}

/** 逐跳加载被引用的内容（目标自身也可能是链接型内容，需继续跟随） */
async function loadContentTargets(siteId: number, seedIds: Set<number>): Promise<Map<number, ContentTarget>> {
  const loaded = new Map<number, ContentTarget>();
  let pending = seedIds;
  for (let hop = 0; hop < MAX_HOPS && pending.size > 0; hop++) {
    const rows = await db.select({
      id: cmsContents.id,
      slug: cmsContents.slug,
      staticPath: cmsContents.staticPath,
      publishedAt: cmsContents.publishedAt,
      createdAt: cmsContents.createdAt,
      channelId: cmsContents.channelId,
      externalLink: cmsContents.externalLink,
    })
      .from(cmsContents)
      .where(and(
        eq(cmsContents.siteId, siteId),
        inArray(cmsContents.id, [...pending]),
        eq(cmsContents.status, 'published'),
        isNull(cmsContents.deletedAt),
        isNull(cmsContents.archivedAt),
        or(isNull(cmsContents.expireAt), gt(cmsContents.expireAt, new Date())),
      ));
    const next = new Set<number>();
    for (const row of rows) {
      loaded.set(row.id, row);
      const ref = parseCmsLink(row.externalLink);
      if (ref?.kind === 'entity' && ref.entityType === 'content' && ref.id !== null && !loaded.has(ref.id)) next.add(ref.id);
    }
    pending = next;
  }
  return loaded;
}

/**
 * 构建批量链接解析器。
 *
 * 传入的 `rawLinks` 里没有实体链接时**不产生任何查询**（绝大多数页面的情况）；
 * 有实体链接时最多 1 次栏目查询 + 若干跳内容查询，与列表条数无关，不会 N+1。
 */
export async function buildCmsLinkResolver(
  siteId: number,
  baseUrl: string,
  rawLinks: Iterable<string | null | undefined>,
): Promise<CmsLinkResolver> {
  const refs = collectRefs(rawLinks);
  const seedContentIds = entityIdsOf(refs.values(), 'content');
  const seedChannelIds = entityIdsOf(refs.values(), 'channel');
  const needChannelCodes = hasChannelCodeRef(refs.values());

  let contentMap = new Map<number, ContentTarget>();
  let channelMap = new Map<number, ChannelTarget>();
  let channelByCode = new Map<string, ChannelTarget>();

  if (seedContentIds.size > 0 || seedChannelIds.size > 0 || needChannelCodes) {
    contentMap = await loadContentTargets(siteId, seedContentIds);
    const effectiveChannelIds = await getEffectivelyEnabledCmsChannelIds(siteId);
    // 内容目标还需其所属栏目的 path；站点栏目量级小，一次全量取回比按需二次查询更省
    const channelRows = await db.select({
      id: cmsChannels.id,
      code: cmsChannels.code,
      path: cmsChannels.path,
      detailPathRule: cmsChannels.detailPathRule,
      type: cmsChannels.type,
      linkUrl: cmsChannels.linkUrl,
      status: cmsChannels.status,
    })
      .from(cmsChannels)
      .where(and(
        eq(cmsChannels.siteId, siteId),
        eq(cmsChannels.status, 'enabled'),
        effectiveChannelIds.size > 0 ? inArray(cmsChannels.id, [...effectiveChannelIds]) : sql`false`,
      ));
    channelMap = new Map(channelRows.map((row) => [row.id, row]));
    channelByCode = new Map(channelRows.map((row) => [row.code, row]));
  }

  const resolveRef = (ref: CmsLinkRef, seen: Set<string>): CmsLinkResolution | null => {
    if (ref.kind === 'external') return { url: ref.url, isExternal: true };
    if (ref.kind === 'internal') return { url: `${baseUrl}${ref.path}`, isExternal: false };
    // 按 code 引用先换算成 id，之后与 id 引用走同一套跟随逻辑
    if (ref.code !== null) {
      const target = channelByCode.get(ref.code);
      return target ? resolveEntity('channel', target.id, seen) : null;
    }
    return resolveEntity(ref.entityType, ref.id, seen);
  };

  const follow = (raw: string | null | undefined, seen: Set<string>): CmsLinkResolution | null => {
    const next = parseCmsLink(raw);
    return next ? resolveRef(next, seen) : null;
  };

  function resolveEntity(entityType: CmsLinkEntityType, id: number, seen: Set<string>): CmsLinkResolution | null {
    const key = `${entityType}/${id}`;
    if (seen.has(key) || seen.size >= MAX_HOPS) return null;
    seen.add(key);

    if (entityType === 'content') {
      const target = contentMap.get(id);
      if (!target) return null;
      // 目标自身也是链接型内容：继续跟随，静态化场景下没有 302 可依赖
      if (target.externalLink?.trim()) return follow(target.externalLink, seen);
      const channel = channelMap.get(target.channelId);
      return channel ? { url: contentUrl(baseUrl, channel, target), isExternal: false } : null;
    }

    const channel = channelMap.get(id);
    if (!channel) return null;
    if (channel.type === 'link') return follow(channel.linkUrl, seen);
    return { url: channelUrl(baseUrl, channel.path), isExternal: false };
  }

  return (raw) => {
    const value = raw?.trim();
    if (!value) return null;
    const ref = refs.get(value) ?? parseCmsLink(value);
    // 未预声明的实体链接无法在同步回调里补查，按死链处理（调用方应把值一起传入 rawLinks）
    return ref ? resolveRef(ref, new Set()) : null;
  };
}

/** 单条解析（详情页 / 栏目页 302 等场景） */
export async function resolveCmsLink(
  siteId: number,
  baseUrl: string,
  raw: string | null | undefined,
): Promise<CmsLinkResolution | null> {
  const resolver = await buildCmsLinkResolver(siteId, baseUrl, [raw]);
  return resolver(raw);
}

/** 站点内「公开可见」内容：已发布、未删除、未归档且未过期（实体链接只允许指向这类内容） */
function publiclyVisibleContentWhere(siteId: number, contentId: number) {
  return and(
    eq(cmsContents.id, contentId),
    eq(cmsContents.siteId, siteId),
    eq(cmsContents.status, 'published'),
    isNull(cmsContents.deletedAt),
    isNull(cmsContents.archivedAt),
    or(isNull(cmsContents.expireAt), gt(cmsContents.expireAt, new Date())),
  );
}

/**
 * 后台用：把链接值解析成人类可读的描述（编辑页回显 `entity:content/123` 时用）。
 * 目标失效时返回 `exists: false`，前端据此提示"目标已删除"。
 */
export async function describeCmsLink(siteId: number, raw: string | null | undefined): Promise<CmsLinkTarget> {
  const value = raw?.trim() ?? '';
  const ref = parseCmsLink(value);
  if (!ref) return { kind: 'invalid', label: value, targetId: null, targetCode: null, exists: false };
  if (ref.kind === 'external') return { kind: 'external', label: ref.url, targetId: null, targetCode: null, exists: true };
  if (ref.kind === 'internal') return { kind: 'internal', label: ref.path, targetId: null, targetCode: null, exists: true };

  if (ref.code !== null) {
    const target = await db.query.cmsChannels.findFirst({
      where: and(eq(cmsChannels.code, ref.code), eq(cmsChannels.siteId, siteId)),
      columns: { id: true, name: true },
    });
    const enabled = target ? await getEffectivelyEnabledCmsChannelIds(siteId) : new Set<number>();
    return {
      kind: 'entity-channel',
      label: target?.name ?? `栏目「${ref.code}」（不存在）`,
      targetId: target?.id ?? null,
      targetCode: ref.code,
      exists: !!target && enabled.has(target.id),
    };
  }

  if (ref.entityType === 'content') {
    const target = await db.query.cmsContents.findFirst({
      where: publiclyVisibleContentWhere(siteId, ref.id),
      columns: { id: true, title: true, channelId: true },
    });
    const enabledChannels = target ? await getEffectivelyEnabledCmsChannelIds(siteId) : new Set<number>();
    return {
      kind: 'entity-content',
      label: target?.title ?? `内容 #${ref.id}（不可公开访问）`,
      targetId: ref.id,
      targetCode: null,
      exists: !!target && enabledChannels.has(target.channelId),
    };
  }

  const target = await db.query.cmsChannels.findFirst({
    where: and(eq(cmsChannels.id, ref.id), eq(cmsChannels.siteId, siteId)),
    columns: { id: true, name: true },
  });
  const enabled = target ? await getEffectivelyEnabledCmsChannelIds(siteId) : new Set<number>();
  return {
    kind: 'entity-channel',
    label: target?.name ?? `栏目 #${ref.id}（不可公开访问）`,
    targetId: ref.id,
    targetCode: null,
    exists: !!target && enabled.has(target.id),
  };
}

export async function ensureCmsLinkTargetExists(siteId: number, raw: string | null | undefined): Promise<void> {
  const ref = parseCmsLink(raw);
  if (ref?.kind !== 'entity') return;

  if (ref.code !== null) {
    const target = await db.query.cmsChannels.findFirst({
      where: and(eq(cmsChannels.code, ref.code), eq(cmsChannels.siteId, siteId), eq(cmsChannels.status, 'enabled')),
      columns: { id: true },
    });
    if (!target || !(await getEffectivelyEnabledCmsChannelIds(siteId)).has(target.id)) throw new HTTPException(400, { message: '内部链接指向的栏目不存在或已停用' });
    return;
  }

  if (ref.entityType === 'content') {
    const target = await db.query.cmsContents.findFirst({
      where: publiclyVisibleContentWhere(siteId, ref.id),
      columns: { id: true, channelId: true },
    });
    if (!target || !(await getEffectivelyEnabledCmsChannelIds(siteId)).has(target.channelId)) throw new HTTPException(400, { message: '内部链接只能指向当前站点公开可见的内容' });
    return;
  }

  const target = await db.query.cmsChannels.findFirst({
    where: and(eq(cmsChannels.id, ref.id), eq(cmsChannels.siteId, siteId), eq(cmsChannels.status, 'enabled')),
    columns: { id: true },
  });
  if (!target || !(await getEffectivelyEnabledCmsChannelIds(siteId)).has(target.id)) throw new HTTPException(400, { message: '内部链接指向的栏目不存在或已停用' });
}

/**
 * 链接是否指向指定栏目（用于「不能指向自身」校验）——
 * id 引用与 code 引用两种写法都要认出来。
 */
export function isCmsLinkToChannel(raw: string | null | undefined, channel: { id: number; code: string }): boolean {
  const ref = parseCmsLink(raw);
  if (ref?.kind !== 'entity' || ref.entityType !== 'channel') return false;
  return ref.code !== null ? ref.code === channel.code : ref.id === channel.id;
}
