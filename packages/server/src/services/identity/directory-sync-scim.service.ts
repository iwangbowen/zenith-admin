import { and, eq } from 'drizzle-orm';
import { hashPassword } from '../../lib/password';
import crypto from 'node:crypto';
import { db } from '../../db';
import {
  directorySyncSources, directorySyncUserLinks, users, userRoles,
  type DirectorySyncSourceRow, type DirectorySyncUserLinkRow, type UserRow,
} from '../../db/schema';
import { timingSafeCompare } from '../../lib/wechat/signature';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { reserveTenantSeats } from '../../lib/tenant-quota';
import { exactTenantCondition } from '../../lib/tenant';
import { syncUserDynamicMembershipsSafe } from './user-group-rules.service';
import logger from '../../lib/logger';
import { forceLogoutAllUserSessions } from './sessions.service';
import { resolveGrantableDefaultRoleIds, userHasPlatformSuperRole } from './role-grant';

/**
 * SCIM 2.0 Server（RFC 7643/7644 最小可用子集）：
 * 供 Azure AD / Okta 等 IdP 主动推送用户开通、变更与停用。
 *
 * - 认证：Bearer Token（同步源的 callbackToken）
 * - 资源：/Users（Groups 暂不支持）
 * - SCIM id：本端为每个绑定生成的 UUID（directory_sync_user_links.externalId）
 * - 操作不写运行记录：SCIM 为单对象推送，落点直接是用户表与绑定表
 */

const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const SCIM_PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

export class ScimError extends Error {
  constructor(readonly status: number, message: string, readonly scimType?: string) {
    super(message);
  }
}

export function scimErrorBody(err: ScimError): Record<string, unknown> {
  return {
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(err.status),
    detail: err.message,
    ...(err.scimType ? { scimType: err.scimType } : {}),
  };
}

/** Bearer 认证：按 URL Key 定位 SCIM 源并校验 Token */
export async function authenticateScimSource(key: string, authorization: string | undefined): Promise<DirectorySyncSourceRow> {
  const [source] = await db.select().from(directorySyncSources)
    .where(and(eq(directorySyncSources.callbackUrlKey, key), eq(directorySyncSources.type, 'scim')))
    .limit(1);
  if (!source) throw new ScimError(404, 'SCIM endpoint not found');
  if (source.status !== 'enabled') throw new ScimError(403, 'SCIM endpoint disabled');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : undefined;
  if (!source.callbackToken || !timingSafeCompare(source.callbackToken, token)) {
    throw new ScimError(401, 'Invalid bearer token');
  }
  return source;
}

function tenantWhere(tenantId: number | null) {
  return exactTenantCondition(users.tenantId, tenantId);
}

interface ScimUserInput {
  userName?: string;
  displayName?: string;
  active?: boolean;
  email?: string | null;
  phone?: string | null;
  externalId?: string;
}

function firstValue(list: unknown): string | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const primary = list.find((item) => (item as { primary?: boolean })?.primary) ?? list[0];
  const value = (primary as { value?: unknown })?.value;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseBooleanish(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^true$/i.test(value)) return true;
    if (/^false$/i.test(value)) return false;
  }
  return undefined;
}

/** 从 SCIM User 资源提取本端关心的字段（宽容解析，忽略未知属性与扩展 schema） */
export function extractScimUser(payload: Record<string, unknown>): ScimUserInput {
  const name = payload.name as { formatted?: string; givenName?: string; familyName?: string } | undefined;
  const displayName = (typeof payload.displayName === 'string' && payload.displayName.trim())
    || name?.formatted?.trim()
    || [name?.familyName, name?.givenName].filter(Boolean).join('')
    || undefined;
  return {
    userName: typeof payload.userName === 'string' && payload.userName.trim() ? payload.userName.trim() : undefined,
    displayName: displayName || undefined,
    active: parseBooleanish(payload.active),
    email: firstValue(payload.emails),
    phone: firstValue(payload.phoneNumbers),
    externalId: typeof payload.externalId === 'string' && payload.externalId ? payload.externalId : undefined,
  };
}

type LinkedUser = { link: DirectorySyncUserLinkRow; user: UserRow };

async function findLinkedUser(sourceId: number, scimId: string): Promise<LinkedUser | null> {
  const [row] = await db.select({ link: directorySyncUserLinks, user: users })
    .from(directorySyncUserLinks)
    .innerJoin(users, eq(directorySyncUserLinks.userId, users.id))
    .where(and(eq(directorySyncUserLinks.sourceId, sourceId), eq(directorySyncUserLinks.externalId, scimId)))
    .limit(1);
  return row ?? null;
}

export function mapScimUser(user: UserRow, link: DirectorySyncUserLinkRow): Record<string, unknown> {
  const externalId = (link.externalData as { scimExternalId?: string } | null)?.scimExternalId;
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: link.externalId,
    ...(externalId ? { externalId } : {}),
    userName: user.username,
    displayName: user.nickname,
    name: { formatted: user.nickname },
    active: user.status === 'enabled',
    emails: user.email ? [{ value: user.email, primary: true }] : [],
    phoneNumbers: user.phone ? [{ value: user.phone, primary: true }] : [],
    meta: { resourceType: 'User' },
  };
}

export function serviceProviderConfig(): Record<string, unknown> {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{
      type: 'oauthbearertoken',
      name: 'OAuth Bearer Token',
      description: 'Authorization: Bearer <token>',
    }],
  };
}

// ─── 查询 ─────────────────────────────────────────────────────────────────────
const DEFAULT_SCIM_START_INDEX = 1;
const DEFAULT_SCIM_COUNT = 100;
const MAX_SCIM_COUNT = 200;

export async function listScimUsers(
  source: DirectorySyncSourceRow,
  query: { filter?: string; startIndex?: number; count?: number },
): Promise<Record<string, unknown>> {
  const startIndex = Math.max(DEFAULT_SCIM_START_INDEX, query.startIndex ?? DEFAULT_SCIM_START_INDEX);
  const count = Math.min(Math.max(0, query.count ?? DEFAULT_SCIM_COUNT), MAX_SCIM_COUNT);

  // 仅支持 IdP 实际使用的等值过滤：userName eq "x" / externalId eq "x"
  let filterField: 'userName' | 'externalId' | null = null;
  let filterValue = '';
  if (query.filter?.trim()) {
    const match = /^(userName|externalId)\s+eq\s+"([^"]*)"$/i.exec(query.filter.trim());
    if (!match) throw new ScimError(400, `Unsupported filter: ${query.filter}`, 'invalidFilter');
    filterField = match[1].toLowerCase() === 'username' ? 'userName' : 'externalId';
    filterValue = match[2];
  }

  const rows = await db.select({ link: directorySyncUserLinks, user: users })
    .from(directorySyncUserLinks)
    .innerJoin(users, eq(directorySyncUserLinks.userId, users.id))
    .where(eq(directorySyncUserLinks.sourceId, source.id))
    .orderBy(directorySyncUserLinks.id);

  const filtered = rows.filter(({ link, user }) => {
    if (!filterField) return true;
    if (filterField === 'userName') return user.username === filterValue;
    return (link.externalData as { scimExternalId?: string } | null)?.scimExternalId === filterValue;
  });

  const page = count === 0 ? [] : filtered.slice(startIndex - 1, startIndex - 1 + count);
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: filtered.length,
    startIndex,
    itemsPerPage: page.length,
    Resources: page.map(({ link, user }) => mapScimUser(user, link)),
  };
}

export async function getScimUser(source: DirectorySyncSourceRow, scimId: string): Promise<Record<string, unknown>> {
  const found = await findLinkedUser(source.id, scimId);
  if (!found) throw new ScimError(404, `User ${scimId} not found`);
  return mapScimUser(found.user, found.link);
}

// ─── 写入 ─────────────────────────────────────────────────────────────────────
async function applyUserPatch(userId: number, source: DirectorySyncSourceRow, input: ScimUserInput): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.userName) patch.username = input.userName.slice(0, 32);
  if (input.displayName) patch.nickname = input.displayName.slice(0, 32);
  if (input.email !== undefined) patch.email = input.email;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.active !== undefined) patch.status = input.active ? 'enabled' : 'disabled';
  if (Object.keys(patch).length === 0) return;
  try {
    await db.update(users).set(patch).where(eq(users.id, userId));
  } catch (err) {
    rethrowScimUniqueViolation(err);
    throw err;
  }
  if (input.active === false && (source.lifecycle?.kickSessions ?? true)) {
    await forceLogoutAllUserSessions(userId).catch((err) => {
      logger.warn(`[directory-sync-scim] 强制下线用户 ${userId} 失败`, err);
    });
  }
  // SCIM patch 可能变更状态等动态组条件属性
  syncUserDynamicMembershipsSafe([userId], 'SCIM 用户更新');
}

function rethrowScimUniqueViolation(err: unknown): void {
  try {
    rethrowPgUniqueViolation(err, 'uniqueness conflict');
  } catch (mapped) {
    if (mapped instanceof Error && mapped.message === 'uniqueness conflict') {
      throw new ScimError(409, 'userName / email / phone already exists', 'uniqueness');
    }
    throw mapped;
  }
}

async function updateLinkSnapshot(linkId: number, input: ScimUserInput, existing: DirectorySyncUserLinkRow): Promise<void> {
  const prev = (existing.externalData ?? {}) as Record<string, unknown>;
  await db.update(directorySyncUserLinks).set({
    externalData: {
      ...prev,
      ...(input.externalId ? { scimExternalId: input.externalId } : {}),
      ...(input.userName ? { username: input.userName } : {}),
      ...(input.displayName ? { nickname: input.displayName } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
    },
    lastSeenAt: new Date(),
  }).where(eq(directorySyncUserLinks.id, linkId));
}

export async function createScimUser(source: DirectorySyncSourceRow, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const input = extractScimUser(payload);
  if (!input.userName) throw new ScimError(400, 'userName is required', 'invalidValue');

  // 已存在同名绑定 → 409（IdP 会先 GET filter 再决定 PATCH）
  const existing = await db.select({ link: directorySyncUserLinks, user: users })
    .from(directorySyncUserLinks)
    .innerJoin(users, eq(directorySyncUserLinks.userId, users.id))
    .where(eq(directorySyncUserLinks.sourceId, source.id));
  if (existing.some(({ user }) => user.username === input.userName)) {
    throw new ScimError(409, `User with userName "${input.userName}" already exists`, 'uniqueness');
  }

  const scimId = crypto.randomUUID();
  const lifecycle = source.lifecycle ?? { disableOnLeave: true, kickSessions: true, defaultRoleIds: [] };

  // 匹配既有本地账号（按 username，租户内）→ 绑定而非重建；平台超管永不被自动接管，
  // 视为未匹配走新建，最终由 username 唯一约束以 409 拒绝
  const [candidate] = await db.select().from(users)
    .where(and(eq(users.username, input.userName), tenantWhere(source.tenantId)))
    .limit(1);
  const matched = candidate && !(await userHasPlatformSuperRole(candidate.id)) ? candidate : undefined;

  let userId: number;
  if (matched) {
    userId = matched.id;
    await db.insert(directorySyncUserLinks).values({
      sourceId: source.id,
      externalId: scimId,
      userId,
      externalData: { scimExternalId: input.externalId ?? null },
      lastSeenAt: new Date(),
    });
    await applyUserPatch(userId, source, input);
  } else {
    const password = await hashPassword(crypto.randomBytes(32).toString('hex'));
    try {
      userId = await db.transaction(async (tx) => {
        await reserveTenantSeats(tx, source.tenantId);
        const [created] = await tx.insert(users).values({
          username: input.userName!.slice(0, 32),
          nickname: (input.displayName ?? input.userName!).slice(0, 32),
          email: input.email ?? null,
          phone: input.phone ?? null,
          password,
          status: input.active === false ? 'disabled' : 'enabled',
          tenantId: source.tenantId,
        }).returning();
        await tx.insert(directorySyncUserLinks).values({
          sourceId: source.id,
          externalId: scimId,
          userId: created.id,
          externalData: { scimExternalId: input.externalId ?? null },
          lastSeenAt: new Date(),
        });
        const roleIds = await resolveGrantableDefaultRoleIds(lifecycle.defaultRoleIds, source.tenantId, tx);
        if (roleIds.length > 0) {
          await tx.insert(userRoles).values(roleIds.map((roleId) => ({ userId: created.id, roleId }))).onConflictDoNothing();
        }
        return created.id;
      });
    } catch (err) {
      rethrowScimUniqueViolation(err);
      throw err;
    }
    syncUserDynamicMembershipsSafe([userId], 'SCIM 建号');
  }

  const created = await findLinkedUser(source.id, scimId);
  if (!created) throw new ScimError(500, 'create failed');
  return mapScimUser(created.user, created.link);
}

export async function replaceScimUser(source: DirectorySyncSourceRow, scimId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const found = await findLinkedUser(source.id, scimId);
  if (!found) throw new ScimError(404, `User ${scimId} not found`);
  const input = extractScimUser(payload);
  await applyUserPatch(found.user.id, source, input);
  await updateLinkSnapshot(found.link.id, input, found.link);
  const updated = await findLinkedUser(source.id, scimId);
  return mapScimUser(updated!.user, updated!.link);
}

/** PATCH（RFC 7644 3.5.2）：兼容 Azure AD 的 path 风格与无 path 的 value 对象风格 */
export async function patchScimUser(source: DirectorySyncSourceRow, scimId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const schemas = Array.isArray(payload.schemas) ? payload.schemas : [];
  if (!schemas.includes(SCIM_PATCH_SCHEMA)) throw new ScimError(400, 'Invalid PatchOp payload', 'invalidSyntax');
  const operations = Array.isArray(payload.Operations) ? payload.Operations : [];
  const found = await findLinkedUser(source.id, scimId);
  if (!found) throw new ScimError(404, `User ${scimId} not found`);

  const input: ScimUserInput = {};
  for (const op of operations as Array<{ op?: string; path?: string; value?: unknown }>) {
    const kind = (op.op ?? '').toLowerCase();
    if (kind !== 'add' && kind !== 'replace' && kind !== 'remove') {
      throw new ScimError(400, `Unsupported op: ${op.op}`, 'invalidValue');
    }
    const path = (op.path ?? '').trim();
    if (!path) {
      // 无 path：value 是资源片段
      if (op.value && typeof op.value === 'object') Object.assign(input, extractScimUser(op.value as Record<string, unknown>));
      continue;
    }
    const lower = path.toLowerCase();
    if (lower === 'active') {
      input.active = kind === 'remove' ? true : parseBooleanish(op.value);
    } else if (lower === 'username') {
      if (typeof op.value === 'string' && op.value.trim()) input.userName = op.value.trim();
    } else if (lower === 'displayname' || lower === 'name.formatted') {
      if (kind === 'remove') continue;
      if (typeof op.value === 'string' && op.value.trim()) input.displayName = op.value.trim();
    } else if (lower.startsWith('emails')) {
      input.email = kind === 'remove' ? null : (typeof op.value === 'string' ? op.value.trim() : firstValue(op.value) ?? firstValue([op.value]));
    } else if (lower.startsWith('phonenumbers')) {
      input.phone = kind === 'remove' ? null : (typeof op.value === 'string' ? op.value.trim() : firstValue(op.value) ?? firstValue([op.value]));
    } else if (lower === 'externalid') {
      if (typeof op.value === 'string') input.externalId = op.value;
    }
    // 其余路径（企业扩展等）宽容忽略
  }

  await applyUserPatch(found.user.id, source, input);
  await updateLinkSnapshot(found.link.id, input, found.link);
  const updated = await findLinkedUser(source.id, scimId);
  return mapScimUser(updated!.user, updated!.link);
}

/** DELETE：按生命周期策略停用本地账号（保留绑定，避免 IdP 误删导致数据丢失） */
export async function deleteScimUser(source: DirectorySyncSourceRow, scimId: string): Promise<void> {
  const found = await findLinkedUser(source.id, scimId);
  if (!found) throw new ScimError(404, `User ${scimId} not found`);
  await applyUserPatch(found.user.id, source, { active: false });
}
