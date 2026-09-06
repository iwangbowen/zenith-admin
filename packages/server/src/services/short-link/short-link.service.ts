/**
 * 短链服务 —— 管理 CRUD 与跨域复用入口。
 *
 * 对其他业务域暴露 ensureShortLink()（同 bizType+bizRef 幂等复用），
 * 跨域同步协作直接调用本服务函数，不走内部 HTTP。
 */
import { randomBytes } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  SHORT_LINK_CODE_ALPHABET,
  SHORT_LINK_CODE_LENGTH,
  SHORT_LINK_RESERVED_CODES,
  type ShortLinkBizType,
} from '@zenith/shared/short-link';
import type { CreateShortLinkInput, UpdateShortLinkInput } from '@zenith/shared/short-link';
import { db } from '../../db';
import { shortLinks, type ShortLinkRow } from '../../db/schema';
import { config } from '../../config';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';
import { isPgUniqueViolation, rethrowPgUniqueViolation } from '../../lib/db-errors';
import { currentUser, currentUserOrNull } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { invalidateShortLinkCache } from './short-link-redirect.service';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function buildShortUrl(code: string): string {
  return `${config.publicBaseUrl}/s/${code}`;
}

export function mapShortLink(row: ShortLinkRow) {
  const expiresAt = row.expiresAt ?? null;
  return {
    id: row.id,
    code: row.code,
    shortUrl: buildShortUrl(row.code),
    targetUrl: row.targetUrl,
    title: row.title ?? null,
    redirectType: row.redirectType,
    status: row.status,
    expiresAt: formatNullableDateTime(expiresAt),
    expired: expiresAt !== null && expiresAt.getTime() <= Date.now(),
    maxVisits: row.maxVisits ?? null,
    password: row.password ?? null,
    utmSource: row.utmSource ?? null,
    utmMedium: row.utmMedium ?? null,
    utmCampaign: row.utmCampaign ?? null,
    utmTerm: row.utmTerm ?? null,
    utmContent: row.utmContent ?? null,
    bizType: row.bizType as ShortLinkBizType,
    bizRef: row.bizRef ?? null,
    remark: row.remark ?? null,
    totalPv: row.totalPv,
    lastVisitAt: formatNullableDateTime(row.lastVisitAt),
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 目标 URL 安全校验 ────────────────────────────────────────────────────────
const PRIVATE_HOST_PATTERN = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[::1\]|::1$)/i;

/** 协议白名单 + 拦截内网/回环地址与凭据注入，防止开放跳转被滥用为内网探测入口 */
export function ensureSafeTargetUrl(targetUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new HTTPException(400, { message: '目标地址必须是合法 URL' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HTTPException(400, { message: '目标地址仅支持 http/https 协议' });
  }
  if (parsed.username || parsed.password) {
    throw new HTTPException(400, { message: '目标地址不允许携带认证信息' });
  }
  const host = parsed.hostname;
  if (PRIVATE_HOST_PATTERN.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw new HTTPException(400, { message: '目标地址不允许指向内网或本机' });
  }
  // 禁止指向自身短链路径，避免跳转环
  if (targetUrl.startsWith(`${config.publicBaseUrl}/s/`)) {
    throw new HTTPException(400, { message: '目标地址不能是本系统短链' });
  }
}

// ─── 短码生成 ─────────────────────────────────────────────────────────────────
const RESERVED_CODES = new Set<string>(SHORT_LINK_RESERVED_CODES.map((c) => c.toLowerCase()));

export function generateShortCode(length = SHORT_LINK_CODE_LENGTH): string {
  const alphabet = SHORT_LINK_CODE_ALPHABET;
  const bytes = randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

function ensureCodeNotReserved(code: string): void {
  if (RESERVED_CODES.has(code.toLowerCase())) {
    throw new HTTPException(400, { message: `短码 "${code}" 为系统保留字，请更换` });
  }
}

// ─── 查询 ─────────────────────────────────────────────────────────────────────
export interface ListShortLinksQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'enabled' | 'disabled';
  bizType?: ShortLinkBizType;
  startTime?: string;
  endTime?: string;
}

interface ShortLinkWhereInput extends ListShortLinksQuery {
  id?: number;
}

function buildShortLinkWhere(q: ShortLinkWhereInput) {
  return buildWhere(
    q.id !== undefined ? eq(shortLinks.id, q.id) : undefined,
    keywordCondition(q.keyword, [shortLinks.code, shortLinks.title, shortLinks.targetUrl]),
    q.status ? eq(shortLinks.status, q.status) : undefined,
    q.bizType ? eq(shortLinks.bizType, q.bizType) : undefined,
    ...dateRangeConditions(shortLinks.createdAt, q.startTime, q.endTime),
    tenantCondition(shortLinks, currentUser()),
  );
}

export async function listShortLinks(q: ListShortLinksQuery) {
  const { page = 1, pageSize = 10 } = q;
  const where = buildShortLinkWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(shortLinks, where),
    rows: () => withPagination(
      db.select().from(shortLinks).where(where).orderBy(desc(shortLinks.id)).$dynamic(),
      page,
      pageSize,
    ),
    map: mapShortLink,
  });
}

export async function ensureShortLinkExists(id: number): Promise<ShortLinkRow> {
  const [row] = await db.select().from(shortLinks).where(buildShortLinkWhere({ id })).limit(1);
  return requireRow(row, '短链不存在');
}

export async function getShortLink(id: number) {
  return mapShortLink(await ensureShortLinkExists(id));
}

// ─── 写入 ─────────────────────────────────────────────────────────────────────
function parseExpiresAt(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = parseDateTimeInput(value);
  if (!parsed) throw new HTTPException(400, { message: '过期时间格式不正确' });
  return parsed;
}

export async function createShortLink(data: CreateShortLinkInput) {
  ensureSafeTargetUrl(data.targetUrl);
  const expiresAt = parseExpiresAt(data.expiresAt) ?? null;
  const tenantId = getCreateTenantId(currentUser());

  const baseValues = {
    targetUrl: data.targetUrl,
    title: data.title ?? null,
    redirectType: data.redirectType,
    status: data.status,
    expiresAt,
    maxVisits: data.maxVisits ?? null,
    password: data.password ?? null,
    utmSource: data.utmSource ?? null,
    utmMedium: data.utmMedium ?? null,
    utmCampaign: data.utmCampaign ?? null,
    utmTerm: data.utmTerm ?? null,
    utmContent: data.utmContent ?? null,
    remark: data.remark ?? null,
    tenantId,
  };

  // 自定义短码：保留字校验后直插，唯一冲突转 400
  if (data.code) {
    ensureCodeNotReserved(data.code);
    try {
      const [row] = await db.insert(shortLinks).values({ ...baseValues, code: data.code }).returning();
      return mapShortLink(row);
    } catch (err) {
      rethrowPgUniqueViolation(err, `短码 "${data.code}" 已被占用，请更换`);
      throw err;
    }
  }

  // 自动生成：随机短码 + 唯一约束冲突重试
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateShortCode(SHORT_LINK_CODE_LENGTH + (attempt >= 3 ? 1 : 0));
    try {
      const [row] = await db.insert(shortLinks).values({ ...baseValues, code }).returning();
      return mapShortLink(row);
    } catch (err) {
      if (isPgUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new HTTPException(500, { message: '短码生成失败，请重试' });
}

export async function updateShortLink(id: number, data: UpdateShortLinkInput) {
  const before = await ensureShortLinkExists(id);
  if (data.targetUrl !== undefined) ensureSafeTargetUrl(data.targetUrl);
  const expiresAt = parseExpiresAt(data.expiresAt);

  const [row] = await db
    .update(shortLinks)
    .set({
      ...(data.targetUrl !== undefined ? { targetUrl: data.targetUrl } : {}),
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.redirectType !== undefined ? { redirectType: data.redirectType } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(data.maxVisits !== undefined ? { maxVisits: data.maxVisits } : {}),
      ...(data.password !== undefined ? { password: data.password } : {}),
      ...(data.utmSource !== undefined ? { utmSource: data.utmSource } : {}),
      ...(data.utmMedium !== undefined ? { utmMedium: data.utmMedium } : {}),
      ...(data.utmCampaign !== undefined ? { utmCampaign: data.utmCampaign } : {}),
      ...(data.utmTerm !== undefined ? { utmTerm: data.utmTerm } : {}),
      ...(data.utmContent !== undefined ? { utmContent: data.utmContent } : {}),
      ...(data.remark !== undefined ? { remark: data.remark } : {}),
    })
    .where(buildShortLinkWhere({ id }))
    .returning();

  await invalidateShortLinkCache(before.code);
  return mapShortLink(requireRow(row, '短链不存在'));
}

export async function deleteShortLink(id: number): Promise<void> {
  const before = await ensureShortLinkExists(id);
  await db.delete(shortLinks).where(buildShortLinkWhere({ id }));
  await invalidateShortLinkCache(before.code);
}

export async function deleteShortLinks(ids: number[]): Promise<number> {
  const where = buildWhere(inArray(shortLinks.id, ids), buildShortLinkWhere({}));
  const deleted = await db.delete(shortLinks).where(where).returning({ code: shortLinks.code });
  await Promise.all(deleted.map((d) => invalidateShortLinkCache(d.code)));
  return deleted.length;
}

export async function batchUpdateShortLinkStatus(ids: number[], status: 'enabled' | 'disabled'): Promise<number> {
  const where = buildWhere(inArray(shortLinks.id, ids), buildShortLinkWhere({}));
  const updated = await db.update(shortLinks).set({ status }).where(where).returning({ code: shortLinks.code });
  await Promise.all(updated.map((u) => invalidateShortLinkCache(u.code)));
  return updated.length;
}

// ─── 开放 API（open gateway 无管理员会话上下文，独立入口）──────────────────────
export interface CreateOpenShortLinkOptions {
  targetUrl: string;
  code?: string;
  title?: string | null;
  /** YYYY-MM-DD HH:mm:ss */
  expiresAt?: string | null;
}

/** 开放平台创建短链：平台级归属（tenantId=null），remark 记录来源应用便于治理 */
export async function createOpenShortLink(options: CreateOpenShortLinkOptions, appLabel: string) {
  ensureSafeTargetUrl(options.targetUrl);
  const expiresAt = parseExpiresAt(options.expiresAt) ?? null;
  const baseValues = {
    targetUrl: options.targetUrl,
    title: options.title ?? null,
    expiresAt,
    remark: `开放应用「${appLabel}」创建`,
    tenantId: null,
  };

  if (options.code) {
    ensureCodeNotReserved(options.code);
    try {
      const [row] = await db.insert(shortLinks).values({ ...baseValues, code: options.code }).returning();
      return mapShortLink(row);
    } catch (err) {
      rethrowPgUniqueViolation(err, `短码 "${options.code}" 已被占用，请更换`);
      throw err;
    }
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateShortCode(SHORT_LINK_CODE_LENGTH + (attempt >= 3 ? 1 : 0));
    try {
      const [row] = await db.insert(shortLinks).values({ ...baseValues, code }).returning();
      return mapShortLink(row);
    } catch (err) {
      if (isPgUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new HTTPException(500, { message: '短码生成失败，请重试' });
}

/** 开放平台按短码取短链（平台级查询，不做租户过滤；调用方负责 scope 校验） */
export async function findShortLinkByCode(code: string) {
  const [row] = await db.select().from(shortLinks).where(eq(shortLinks.code, code)).limit(1);
  return row ? mapShortLink(row) : null;
}

// ─── 跨域复用入口 ─────────────────────────────────────────────────────────────
export interface EnsureShortLinkOptions {
  targetUrl: string;
  bizType: Exclude<ShortLinkBizType, 'custom'>;
  bizRef: string;
  title?: string | null;
  /** 不传时按当前请求用户的租户归属写入 */
  tenantId?: number | null;
}

/**
 * 为业务对象幂等获取短链：同 bizType+bizRef 已存在则直接复用（目标地址变化时同步更新），
 * 不存在则自动生成。供 messaging / payment / cms 等域在服务层直接调用。
 */
export async function ensureShortLink(options: EnsureShortLinkOptions) {
  ensureSafeTargetUrl(options.targetUrl);
  // 未显式指定租户时：请求上下文内按当前用户归属，后台任务/钩子场景落平台级
  const user = currentUserOrNull();
  const tenantId = options.tenantId !== undefined
    ? options.tenantId
    : (user ? getCreateTenantId(user) : null);
  const [existing] = await db
    .select()
    .from(shortLinks)
    .where(and(eq(shortLinks.bizType, options.bizType), eq(shortLinks.bizRef, options.bizRef)))
    .limit(1);

  if (existing) {
    const patch: Partial<typeof existing> = {};
    if (existing.targetUrl !== options.targetUrl) patch.targetUrl = options.targetUrl;
    if (options.title !== undefined && options.title !== null && existing.title !== options.title) patch.title = options.title;
    if (Object.keys(patch).length > 0) {
      const [row] = await db
        .update(shortLinks)
        .set(patch)
        .where(eq(shortLinks.id, existing.id))
        .returning();
      await invalidateShortLinkCache(existing.code);
      return mapShortLink(row);
    }
    return mapShortLink(existing);
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateShortCode(SHORT_LINK_CODE_LENGTH + (attempt >= 3 ? 1 : 0));
    try {
      const [row] = await db
        .insert(shortLinks)
        .values({
          code,
          targetUrl: options.targetUrl,
          title: options.title ?? null,
          bizType: options.bizType,
          bizRef: options.bizRef,
          tenantId,
        })
        .returning();
      return mapShortLink(row);
    } catch (err) {
      if (isPgUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new HTTPException(500, { message: '短码生成失败，请重试' });
}
