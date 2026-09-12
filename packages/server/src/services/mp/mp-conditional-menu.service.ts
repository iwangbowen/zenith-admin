import { eq, and, desc } from 'drizzle-orm';
import { requireRow } from '../../lib/db-assert';
import { db } from '../../db';
import { mpConditionalMenus } from '../../db/schema';
import type { MpConditionalMenuRow } from '../../db/schema';
import { formatNullableDateTime, formatTimestamps } from '../../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { ensureMpAccountExists } from './mp-account.service';
import {
  addConditionalWechatMenu, delConditionalWechatMenu, tryMatchWechatMenu, WechatApiError,
  type WechatMenuMatchRule,
} from '../../lib/wechat';
import { mapWechatError } from '../../lib/wechat-error';
import type { MpConditionalMenu, MpMenuButton, MpMenuMatchRule, CreateMpConditionalMenuInput, UpdateMpConditionalMenuInput } from '@zenith/shared/mp';

export function mapMpConditionalMenu(row: MpConditionalMenuRow): MpConditionalMenu {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    buttons: (row.buttons ?? []) as MpMenuButton[],
    matchRule: (row.matchRule ?? {}) as MpMenuMatchRule,
    menuId: row.menuId ?? null,
    status: row.status,
    publishedAt: formatNullableDateTime(row.publishedAt),
    ...formatTimestamps(row),
  };
}

/** 本地 camelCase 匹配规则 → 微信 snake_case，过滤空值 */
function toWechatMatchRule(rule: MpMenuMatchRule): WechatMenuMatchRule {
  const out: WechatMenuMatchRule = {};
  if (rule.tagId) out.tag_id = rule.tagId;
  if (rule.sex) out.sex = rule.sex;
  if (rule.country) out.country = rule.country;
  if (rule.province) out.province = rule.province;
  if (rule.city) out.city = rule.city;
  if (rule.clientPlatformType) out.client_platform_type = rule.clientPlatformType;
  if (rule.language) out.language = rule.language;
  return out;
}

async function ensureExists(id: number): Promise<MpConditionalMenuRow> {
  const [row] = await db.select().from(mpConditionalMenus).where(and(eq(mpConditionalMenus.id, id), tenantScope(mpConditionalMenus))).limit(1);
  return requireRow(row, '个性化菜单不存在');
}

export async function getMpConditionalMenuBeforeAudit(id: number) {
  return mapMpConditionalMenu(await ensureExists(id));
}

export async function listMpConditionalMenus(accountId: number): Promise<MpConditionalMenu[]> {
  await ensureMpAccountExists(accountId);
  const rows = await db.select().from(mpConditionalMenus)
    .where(and(eq(mpConditionalMenus.accountId, accountId), tenantScope(mpConditionalMenus)))
    .orderBy(desc(mpConditionalMenus.id));
  return rows.map(mapMpConditionalMenu);
}

export async function createMpConditionalMenu(data: CreateMpConditionalMenuInput): Promise<MpConditionalMenu> {
  await ensureMpAccountExists(data.accountId);
  const [row] = await db.insert(mpConditionalMenus).values({
    accountId: data.accountId, name: data.name, buttons: data.buttons, matchRule: data.matchRule, status: 'draft', tenantId: currentCreateTenantId(),
  }).returning();
  return mapMpConditionalMenu(row);
}

export async function updateMpConditionalMenu(id: number, data: UpdateMpConditionalMenuInput): Promise<MpConditionalMenu> {
  await ensureExists(id);
  const patch: Partial<typeof mpConditionalMenus.$inferInsert> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.buttons !== undefined) patch.buttons = data.buttons;
  if (data.matchRule !== undefined) patch.matchRule = data.matchRule;
  // 内容有变更则回到草稿（需重新发布到微信）
  if (data.buttons !== undefined || data.matchRule !== undefined) patch.status = 'draft';
  if (Object.keys(patch).length === 0) return mapMpConditionalMenu(await ensureExists(id));
  const [row] = await db.update(mpConditionalMenus).set(patch).where(eq(mpConditionalMenus.id, id)).returning();
  return mapMpConditionalMenu(row);
}

/** 发布个性化菜单：若已存在旧 menuid 先删，再 addconditional 写入新 menuid。 */
export async function publishMpConditionalMenu(id: number): Promise<MpConditionalMenu> {
  const existing = await ensureExists(id);
  const account = await ensureMpAccountExists(existing.accountId);
  const buttons = (existing.buttons ?? []) as MpMenuButton[];
  requireRow(buttons[0], '菜单为空，无法发布', 400);
  let menuId: string;
  try {
    if (existing.menuId) {
      try { await delConditionalWechatMenu(account, existing.menuId); } catch { /* 旧菜单可能已不存在，忽略 */ }
    }
    menuId = await addConditionalWechatMenu(account, buttons, toWechatMatchRule((existing.matchRule ?? {}) as MpMenuMatchRule));
  } catch (err) {
    return mapWechatError(err);
  }
  const [row] = await db.update(mpConditionalMenus)
    .set({ menuId, status: 'published', publishedAt: new Date() })
    .where(eq(mpConditionalMenus.id, id)).returning();
  return mapMpConditionalMenu(row);
}

export async function deleteMpConditionalMenu(id: number): Promise<void> {
  const existing = await ensureExists(id);
  if (existing.menuId) {
    const account = await ensureMpAccountExists(existing.accountId);
    try {
      await delConditionalWechatMenu(account, existing.menuId);
    } catch (err) {
      // 微信侧菜单不存在等错误不阻断本地删除
      if (!(err instanceof WechatApiError)) return mapWechatError(err);
    }
  }
  await db.delete(mpConditionalMenus).where(eq(mpConditionalMenus.id, id));
}

/** 匹配测试：返回某用户实际命中的菜单按钮 */
export async function tryMatchMpMenu(accountId: number, userId: string): Promise<{ buttons: MpMenuButton[] }> {
  const account = await ensureMpAccountExists(accountId);
  try {
    const buttons = await tryMatchWechatMenu(account, userId);
    return { buttons };
  } catch (err) {
    return mapWechatError(err);
  }
}
