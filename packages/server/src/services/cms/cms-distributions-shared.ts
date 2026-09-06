import { requireRow } from '../../lib/db-assert';
import { CronExpressionParser } from 'cron-parser';
import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CmsDistributionFilters } from '@zenith/shared/cms';
import { db } from '../../db';
import { cmsDistributionRules } from '../../db/schema';
import { assertChannelAccess } from './cms-channels.service';
import { assertSiteAccess } from './cms-sites.service';

export const SYSTEM_USER = { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null };
export const DISTRIBUTION_TASK_TYPE = 'cms-distribution-sync';
const SCHEDULER_TIMEZONE = 'Asia/Shanghai';

export function normalizedFilters(value: Partial<CmsDistributionFilters> | undefined): CmsDistributionFilters {
  return {
    statuses: ['published'],
    contentTypes: [...(value?.contentTypes ?? [])],
    keyword: value?.keyword?.trim() || null,
    publishedFrom: value?.publishedFrom ?? null,
    publishedTo: value?.publishedTo ?? null,
  };
}

export function nextSchedule(cron: string | null, from = new Date()): Date | null {
  if (!cron) return null;
  try {
    return CronExpressionParser.parse(cron.trim(), {
      currentDate: from,
      tz: SCHEDULER_TIMEZONE,
    }).next().toDate();
  } catch {
    throw new HTTPException(400, { message: 'Cron 表达式无效' });
  }
}

export async function ensureCmsDistributionRuleExists(id: number) {
  const row = await db.query.cmsDistributionRules.findFirst({
    where: eq(cmsDistributionRules.id, id),
    with: {
      sourceSite: { columns: { name: true } },
      sourceChannel: { columns: { name: true } },
      targetSite: { columns: { name: true } },
      targetChannel: { columns: { name: true } },
    },
  });
  return requireRow(row, '分发规则不存在');
}

export async function ensureRuleAccessible(id: number) {
  const row = await ensureCmsDistributionRuleExists(id);
  await assertSiteAccess(row.sourceSiteId);
  await assertSiteAccess(row.targetSiteId);
  if (row.sourceChannelId != null) await assertChannelAccess(row.sourceChannelId);
  await assertChannelAccess(row.targetChannelId);
  return row;
}
