import { eq, and } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { mpMenus } from '../../db/schema';
import type { MpMenuRow } from '../../db/schema';
import { formatNullableDateTime, formatTimestamps } from '../../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { ensureMpAccountExists } from './mp-account.service';
import { createWechatMenu, getWechatMenu, deleteWechatMenu, WechatApiError } from '../../lib/wechat';
import type { MpMenuButton, MpMenu } from '@zenith/shared/mp';

function mapWechatError(err: unknown): never {
  if (err instanceof WechatApiError) throw new HTTPException(400, { message: err.message });
  throw new HTTPException(502, { message: '调用微信接口失败，请检查网络或稍后重试' });
}

export function mapMpMenu(row: MpMenuRow): MpMenu {
  return {
    id: row.id,
    accountId: row.accountId,
    buttons: (row.buttons ?? []) as MpMenuButton[],
    status: row.status,
    publishedAt: formatNullableDateTime(row.publishedAt),
    ...formatTimestamps(row),
  };
}

function emptyMenu(accountId: number): MpMenu {
  return { id: 0, accountId, buttons: [], status: 'draft', publishedAt: null, createdAt: '', updatedAt: '' };
}

export async function getMpMenu(accountId: number): Promise<MpMenu> {
  await ensureMpAccountExists(accountId);
  const [row] = await db.select().from(mpMenus).where(and(eq(mpMenus.accountId, accountId), tenantScope(mpMenus))).limit(1);
  return row ? mapMpMenu(row) : emptyMenu(accountId);
}

export async function saveMpMenu(accountId: number, buttons: MpMenuButton[]): Promise<MpMenu> {
  await ensureMpAccountExists(accountId);
  const tenantId = currentCreateTenantId();
  const [row] = await db.insert(mpMenus)
    .values({ accountId, buttons, status: 'draft', tenantId })
    .onConflictDoUpdate({ target: mpMenus.accountId, set: { buttons, status: 'draft' } })
    .returning();
  return mapMpMenu(row);
}

export async function publishMpMenu(accountId: number): Promise<MpMenu> {
  const account = await ensureMpAccountExists(accountId);
  const current = await getMpMenu(accountId);
  if (!current.buttons || current.buttons.length === 0) {
    throw new HTTPException(400, { message: '菜单为空，无法发布' });
  }
  try {
    await createWechatMenu(account, current.buttons);
  } catch (err) {
    mapWechatError(err);
  }
  const [row] = await db.update(mpMenus).set({ status: 'published', publishedAt: new Date() }).where(eq(mpMenus.accountId, accountId)).returning();
  return mapMpMenu(row);
}

export async function pullMpMenu(accountId: number): Promise<MpMenu> {
  const account = await ensureMpAccountExists(accountId);
  let buttons: MpMenuButton[];
  try {
    buttons = await getWechatMenu(account);
  } catch (err) {
    return mapWechatError(err);
  }
  return saveMpMenu(accountId, buttons);
}

export async function deleteMpMenu(accountId: number): Promise<MpMenu> {
  const account = await ensureMpAccountExists(accountId);
  try {
    await deleteWechatMenu(account);
  } catch (err) {
    mapWechatError(err);
  }
  const [row] = await db.update(mpMenus).set({ buttons: [], status: 'draft', publishedAt: null }).where(eq(mpMenus.accountId, accountId)).returning();
  return row ? mapMpMenu(row) : emptyMenu(accountId);
}
