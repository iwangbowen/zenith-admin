import { eq, desc } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { analyticsSavedReports } from '../../db/schema';
import type { AnalyticsSavedReportRow } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { mergeWhere } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';

export function mapSavedReport(row: AnalyticsSavedReportRow) {
  return {
    id: row.id,
    name: row.name,
    reportType: row.reportType,
    config: row.config,
    createdBy: row.createdBy,
    createdByName: row.createdByName,
    createdAt: formatDateTime(row.createdAt),
  };
}

export async function listSavedReports(reportType: string) {
  const where = mergeWhere(eq(analyticsSavedReports.reportType, reportType), tenantScope(analyticsSavedReports));
  const rows = await db.select().from(analyticsSavedReports).where(where).orderBy(desc(analyticsSavedReports.id)).limit(100);
  return rows.map(mapSavedReport);
}

export async function createSavedReport(input: { name: string; reportType: string; config: Record<string, unknown> }) {
  const user = currentUser();
  const [row] = await db
    .insert(analyticsSavedReports)
    .values({
      tenantId: currentCreateTenantId(),
      name: input.name,
      reportType: input.reportType,
      config: input.config,
      createdBy: user.userId,
      createdByName: user.username,
    })
    .returning();
  return mapSavedReport(row);
}

export async function deleteSavedReport(id: number) {
  const [row] = await db
    .select({ id: analyticsSavedReports.id })
    .from(analyticsSavedReports)
    .where(mergeWhere(eq(analyticsSavedReports.id, id), tenantScope(analyticsSavedReports)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: '报表不存在' });
  await db.delete(analyticsSavedReports).where(eq(analyticsSavedReports.id, id));
}
