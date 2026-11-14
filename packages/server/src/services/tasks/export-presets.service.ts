import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { CronExpressionParser } from 'cron-parser';
import { HTTPException } from 'hono/http-exception';
import { exportPresetInputSchema } from '@zenith/shared/tasks';
import type * as z from 'zod';
import { db } from '../../db';
import { exportPresets, users } from '../../db/schema';
import { currentUser, hasPermission, runWithCurrentUser } from '../../lib/context';
import { exactTenantCondition, getCreateTenantId } from '../../lib/tenant';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { prepareExport } from '../../lib/export-center/prepare';
import { createExportJob } from './export-jobs.service';
import { getSettings } from '../../lib/settings';
import type { JwtPayload } from '../../middleware/auth';
import { listExportDefinitions } from '../../lib/export-center/registry';
import { getUserPermissions, isSuperAdmin } from '../../lib/permissions';
export function nextExportRun(cron: string, after = new Date()) {
  if (cron.trim().split(/\s+/u).length !== 5) throw new HTTPException(400, { message: '定时表达式需要5段，精度为分钟' });
  try { return CronExpressionParser.parse(cron, { currentDate: after, tz: 'Asia/Shanghai' }).next().toDate(); }
  catch { throw new HTTPException(400, { message: '定时表达式无效' }); }
}
function map(row: typeof exportPresets.$inferSelect, canManage: boolean) {
  return { id: row.id, name: row.name, entity: row.entity, format: row.format, columns: row.columns ?? undefined, query: row.query, shared: row.shared, cron: row.cron, createdBy: row.createdBy, nextRunAt: formatNullableDateTime(row.nextRunAt), lastJobId: row.lastJobId, lastError: row.lastError, createdAt: formatDateTime(row.createdAt), canManage };
}
export async function listExportPresets() {
  const user = currentUser();
  const permissions = await getUserPermissions(user.userId);
  const canManageTeam = await hasPermission('system:export-preset:share');
  const allowed = new Set(listExportDefinitions().filter(def => isSuperAdmin(user) || permissions.includes(def.permissions.export)).map(def => def.entity));
  const rows = await db.select().from(exportPresets).where(and(exactTenantCondition(exportPresets.tenantId, getCreateTenantId(user)), or(eq(exportPresets.createdBy, user.userId), eq(exportPresets.shared, true)))).orderBy(exportPresets.name);
  return rows.filter(row => allowed.has(row.entity)).map(row => {
    const visible = map(row, row.createdBy === user.userId || canManageTeam);
    return row.createdBy === user.userId ? visible : { ...visible, query: {}, cron: null, nextRunAt: null, lastError: null, lastJobId: null };
  });
}
export async function createExportPreset(input: z.output<typeof exportPresetInputSchema>) {
  const user = currentUser();
  if (input.shared && !await hasPermission('system:export-preset:share')) throw new HTTPException(403, { message: '无权发布团队模板' });
  if (input.cron && !await hasPermission('system:export-preset:schedule')) throw new HTTPException(403, { message: '无定时导出权限' });
  if (input.cron && !(await getSettings('exports')).schedulingEnabled) throw new HTTPException(400, { message: '定时导出已由管理员暂停' });
  const prepared = await prepareExport({ entity: input.entity, query: input.query, columns: input.columns, format: input.format, raw: false, watermark: true, executionMode: 'async', scope: 'filtered', splitRows: 0 }, user);
  const [row] = await db.insert(exportPresets).values({ ...input, columns: prepared.selectedColumns, query: prepared.query, tenantId: getCreateTenantId(user), nextRunAt: input.cron ? nextExportRun(input.cron) : null }).returning();
  return map(row, true);
}
export async function deleteExportPreset(id: number) {
  const user = currentUser();
  const [row] = await db.select().from(exportPresets).where(and(eq(exportPresets.id, id), exactTenantCondition(exportPresets.tenantId, getCreateTenantId(user)))).limit(1);
  if (!row || (row.createdBy !== user.userId && (!row.shared || !await hasPermission('system:export-preset:share')))) throw new HTTPException(404, { message: '模板不存在或无权管理' });
  await db.delete(exportPresets).where(eq(exportPresets.id, id));
}
export async function dispatchExportPresets() {
  const settings = await getSettings('exports');
  if (!settings.schedulingEnabled) return '定时导出已停用';
  const now = new Date();
  const candidates = await db.select({ id: exportPresets.id }).from(exportPresets).where(and(lte(exportPresets.nextRunAt, now), or(isNull(exportPresets.leaseUntil), lte(exportPresets.leaseUntil, now)))).orderBy(exportPresets.nextRunAt).limit(20);
  const due = [];
  for (const candidate of candidates) {
    const [claimed] = await db.update(exportPresets).set({ leaseUntil: new Date(Date.now() + 180000) }).where(and(eq(exportPresets.id, candidate.id), lte(exportPresets.nextRunAt, now), or(isNull(exportPresets.leaseUntil), lte(exportPresets.leaseUntil, now)))).returning();
    if (claimed) due.push(claimed);
  }
  let submitted = 0;
  for (const preset of due) {
    try {
      if (!preset.createdBy || !preset.cron || !preset.nextRunAt) throw new Error('定时模板已失效');
      const user = await db.query.users.findFirst({ where: and(eq(users.id, preset.createdBy), eq(users.status, 'enabled')), with: { userRoles: { with: { role: true } } } });
      if (!user) throw new Error('模板创建人已失效');
      const actor: JwtPayload = { userId: user.id, username: user.username, tenantId: user.tenantId, roles: user.userRoles.filter(r => r.role.status === 'enabled').map(r => r.role.code) };
      if (actor.roles.includes('super_admin') && actor.tenantId === null) actor.viewingTenantId = preset.tenantId;
      else if (actor.tenantId !== preset.tenantId) throw new Error('模板所属租户已变更');
      const result = await runWithCurrentUser(actor, async () => {
        if (!await hasPermission('system:export-preset:schedule')) throw new Error('定时导出权限已撤回');
        return createExportJob({ entity: preset.entity, format: preset.format, query: preset.query, columns: preset.columns ?? undefined, raw: false, watermark: true, executionMode: 'async', idempotencyKey: 'schedule:' + preset.id + ':' + preset.nextRunAt!.getTime() });
      });
      await db.update(exportPresets).set({ nextRunAt: nextExportRun(preset.cron, now), lastJobId: result.job.id, lastError: null, leaseUntil: null }).where(and(eq(exportPresets.id, preset.id), eq(exportPresets.leaseUntil, preset.leaseUntil!)));
      submitted++;
    } catch (error) {
      await db.update(exportPresets).set({ lastError: error instanceof HTTPException ? error.message : '定时导出失败，请检查创建人、权限和导出预算', leaseUntil: new Date(Date.now() + 300000) }).where(and(eq(exportPresets.id, preset.id), eq(exportPresets.leaseUntil, preset.leaseUntil!)));
    }
  }
  return '已提交定时导出 ' + submitted + ' 项';
}
