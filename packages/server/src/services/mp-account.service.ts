import { eq, and, or, ilike, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { mpAccounts } from '../db/schema';
import type { MpAccountRow } from '../db/schema';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { formatDateTime } from '../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../lib/tenant';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { refreshMpAccessToken, clearMpAccessToken, WechatApiError } from '../lib/wechat';
import type { DbExecutor } from '../db/types';
import type { CreateMpAccountInput, UpdateMpAccountInput, MpAccountType } from '@zenith/shared';

const SECRET_MASK = '******';

/** 列表 / 详情 / 写操作返回：appSecret 脱敏 */
export function mapMpAccountSafe(row: MpAccountRow) {
  return {
    id: row.id,
    name: row.name,
    account: row.account ?? null,
    appId: row.appId,
    appSecret: row.appSecret ? SECRET_MASK : '',
    token: row.token,
    encodingAesKey: row.encodingAesKey ?? null,
    encryptMode: row.encryptMode,
    type: row.type,
    qrCodeUrl: row.qrCodeUrl ?? null,
    isDefault: row.isDefault,
    status: row.status,
    remark: row.remark ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 编辑回显：appSecret 留空（前端不传则后端保持原值） */
export function mapMpAccountForEdit(row: MpAccountRow) {
  return { ...mapMpAccountSafe(row), appSecret: '' };
}

export async function ensureMpAccountExists(id: number): Promise<MpAccountRow> {
  const [row] = await db.select().from(mpAccounts)
    .where(and(eq(mpAccounts.id, id), tenantScope(mpAccounts))).limit(1);
  if (!row) throw new HTTPException(404, { message: '公众号不存在' });
  return row;
}

export interface ListMpAccountsQuery {
  keyword?: string;
  type?: MpAccountType;
  status?: 'enabled' | 'disabled';
  page: number;
  pageSize: number;
}

export async function listMpAccounts(q: ListMpAccountsQuery) {
  const conditions: SQL[] = [];
  const tenant = tenantScope(mpAccounts);
  if (tenant) conditions.push(tenant);
  if (q.keyword) {
    const kw = `%${escapeLike(q.keyword)}%`;
    const matched = or(
      ilike(mpAccounts.name, kw),
      ilike(mpAccounts.account, kw),
      ilike(mpAccounts.appId, kw),
    );
    if (matched) conditions.push(matched);
  }
  if (q.type) conditions.push(eq(mpAccounts.type, q.type));
  if (q.status) conditions.push(eq(mpAccounts.status, q.status));
  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(mpAccounts, where),
    withPagination(db.select().from(mpAccounts).where(where).orderBy(mpAccounts.id).$dynamic(), q.page, q.pageSize),
  ]);
  return { list: list.map(mapMpAccountSafe), total, page: q.page, pageSize: q.pageSize };
}

export async function getMpAccount(id: number) {
  return mapMpAccountForEdit(await ensureMpAccountExists(id));
}

export async function getMpAccountBeforeAudit(id: number) {
  return mapMpAccountSafe(await ensureMpAccountExists(id));
}

/** 取消同租户内其它默认公众号（保证默认唯一） */
async function clearOtherDefaults(executor: DbExecutor): Promise<void> {
  const conds: SQL[] = [eq(mpAccounts.isDefault, true)];
  const tenant = tenantScope(mpAccounts);
  if (tenant) conds.push(tenant);
  await executor.update(mpAccounts).set({ isDefault: false }).where(and(...conds));
}

export async function createMpAccount(data: CreateMpAccountInput) {
  try {
    return await db.transaction(async (tx) => {
      const tenantId = currentCreateTenantId();
      if (data.isDefault) await clearOtherDefaults(tx);
      const [row] = await tx.insert(mpAccounts).values({ ...data, tenantId }).returning();
      return mapMpAccountSafe(row);
    });
  } catch (err) {
    rethrowPgUniqueViolation(err, '该 AppID 已存在');
  }
}

export async function updateMpAccount(id: number, data: UpdateMpAccountInput) {
  await ensureMpAccountExists(id);
  try {
    const row = await db.transaction(async (tx) => {
      if (data.isDefault === true) await clearOtherDefaults(tx);
      const patch: Partial<typeof mpAccounts.$inferInsert> = { ...data };
      if (!data.appSecret) delete patch.appSecret; // 留空表示保持原值
      const [updated] = await tx.update(mpAccounts).set(patch).where(eq(mpAccounts.id, id)).returning();
      return updated;
    });
    // 凭证可能变更，清除缓存的 access_token，下次按新配置重新获取
    await clearMpAccessToken(id);
    return mapMpAccountSafe(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该 AppID 已存在');
  }
}

export async function deleteMpAccount(id: number) {
  await ensureMpAccountExists(id);
  await db.delete(mpAccounts).where(eq(mpAccounts.id, id));
  await clearMpAccessToken(id);
}

/** 设为默认公众号（同租户内唯一） */
export async function setMpAccountDefault(id: number) {
  const row = await ensureMpAccountExists(id);
  await db.transaction(async (tx) => {
    await clearOtherDefaults(tx);
    await tx.update(mpAccounts).set({ isDefault: true }).where(eq(mpAccounts.id, id));
  });
  return mapMpAccountSafe({ ...row, isDefault: true });
}

/** 测试连接：用账号凭证向微信换取 access_token，验证 AppID/AppSecret 是否有效。 */
export async function testMpAccountConnection(id: number): Promise<{ success: boolean; message: string }> {
  const row = await ensureMpAccountExists(id);
  if (!row.appSecret) throw new HTTPException(400, { message: '请先配置 AppSecret' });
  try {
    await refreshMpAccessToken(row);
    return { success: true, message: '连接成功，access_token 已获取并缓存' };
  } catch (err) {
    if (err instanceof WechatApiError) throw new HTTPException(400, { message: err.message });
    throw new HTTPException(502, { message: '调用微信接口失败，请检查网络或稍后重试' });
  }
}

/**
 * 公开回调专用：按 id 查询公众号（不做租户过滤，因回调无登录上下文）。
 * 返回签名校验与消息解密/落库所需字段。
 */
export async function getMpAccountForCallback(id: number): Promise<
  Pick<MpAccountRow, 'id' | 'appId' | 'token' | 'encryptMode' | 'encodingAesKey' | 'tenantId' | 'status'> | null
> {
  const [row] = await db.select({
    id: mpAccounts.id,
    appId: mpAccounts.appId,
    token: mpAccounts.token,
    encryptMode: mpAccounts.encryptMode,
    encodingAesKey: mpAccounts.encodingAesKey,
    tenantId: mpAccounts.tenantId,
    status: mpAccounts.status,
  }).from(mpAccounts).where(eq(mpAccounts.id, id)).limit(1);
  return row ?? null;
}
