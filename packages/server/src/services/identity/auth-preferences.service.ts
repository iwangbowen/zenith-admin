import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  canOverridePreference,
  getPreferenceValue,
  preferenceDefinitions,
  readUserPreferencesDocument,
  type UserPreferencesDocument,
} from '@zenith/shared/preferences';
import { db } from '../../db';
import { users } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { getSettings } from '../../lib/settings';

/** 个人覆盖跟随账号，平台管理员切换租户视角不切换个人偏好。 */
export async function getMyPreferences(): Promise<UserPreferencesDocument> {
  const userId = currentUser().userId;
  const [row] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, userId)).limit(1);
  return readUserPreferencesDocument(row?.preferences);
}

export async function saveMyPreferences(document: UserPreferencesDocument): Promise<UserPreferencesDocument> {
  const userId = currentUser().userId;
  // 冷设置读取会借用全局连接，必须在事务外完成。
  const { preferences: policy } = await getSettings('ui');
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ preferences: users.preferences }).from(users).where(eq(users.id, userId)).for('update');
    const previous = readUserPreferencesDocument(row?.preferences);
    for (const definition of preferenceDefinitions) {
      if (canOverridePreference(definition.path, policy)) continue;
      const nextValue = getPreferenceValue(document.overrides, definition.path);
      const oldValue = getPreferenceValue(previous.overrides, definition.path);
      // 可以清除旧覆盖，也可以保留暂不生效的旧值；不允许通过旧页面或直接 API 新增 / 修改锁定项。
      if (nextValue !== undefined && !Object.is(nextValue, oldValue)) {
        throw new HTTPException(403, { message: `「${definition.label}」由系统统一设置，无法修改；请刷新偏好设置后重试` });
      }
    }
    await tx.update(users).set({ preferences: document }).where(eq(users.id, userId));
  });
  return document;
}
