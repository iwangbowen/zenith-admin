import { requireRow } from '../../lib/db-assert';
import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { CMS_INTERACTION_OTHER_PREFIX, CMS_INTERACTION_OTHER_VALUE } from '@zenith/shared/cms';
import type { CmsInteractionRepeatPolicy } from '@zenith/shared/cms';
import { db } from '../../db';
import { cmsInteractions } from '../../db/schema';
import type { CmsInteractionRow } from '../../db/schema';

export async function ensureCmsInteractionExists(id: number): Promise<CmsInteractionRow> {
  const [row] = await db.select().from(cmsInteractions).where(eq(cmsInteractions.id, id)).limit(1);
  return requireRow(row, '互动问卷不存在');
}

export function repeatKeyFor(
  policy: CmsInteractionRepeatPolicy,
  memberId: number | null,
  ipHash: string,
): string | null {
  if (policy === 'multiple') return null;
  if (policy === 'once_per_member') {
    if (!memberId) throw new HTTPException(401, { message: '该互动仅限登录会员参与' });
    return `m:${memberId}`;
  }
  return `i:${ipHash}`;
}

/** 「其他」答案：`__other__` 或 `__other__:自由文本` */
export function isOtherAnswer(value: string): boolean {
  return value === CMS_INTERACTION_OTHER_VALUE || value.startsWith(CMS_INTERACTION_OTHER_PREFIX);
}
