import { maintenanceContract, publicMaintenanceStatusSchema, type MaintenanceLog, type MaintenanceStatus } from '@zenith/shared/ops';
import { mock } from '@/mocks/utils/contract';
import { mockDateTime } from '@/mocks/utils/date';
import { MockHttpError } from '@/mocks/utils/contract';
import { badRequest, conflict, notFound } from '@/mocks/utils/handlers';
import { withinDateRange, matchesFilter } from '@/mocks/utils/filter';

let status: MaintenanceStatus = { enabled: false, version: 0, message: '系统维护中，请稍后重试', estimatedEndAt: null, scheduledStartAt: null, autoEndAt: null, startedAt: null, startedByName: null, updatedAt: null, current: null };
const periods: MaintenanceLog[] = [];
function check(version: number) { if (version !== status.version) throw new MockHttpError(conflict('维护配置已变化，草稿保留', { status: 409 })); }
function settle() {
  const current = periods.find((p) => p.status === 'scheduled' || p.status === 'ongoing') ?? null;
  status = { ...status, current, enabled: current?.status === 'ongoing', startedAt: current?.startedAt ?? null, startedByName: current?.startedByName ?? null, scheduledStartAt: current?.scheduledStartAt ?? null, autoEndAt: current?.autoEndAt ?? null, version: status.version + 1, updatedAt: mockDateTime() };
  return status;
}
function change(period: MaintenanceLog, action: string, reason: string) { period.changes.push({ action, reason, at: mockDateTime(), actor: '演示管理员', message: period.message, estimatedEndAt: period.estimatedEndAt }); }
function create(message: string, reason: string): MaintenanceLog { return { id: periods.length + 1, message, reason, estimatedEndAt: null, scheduledStartAt: null, autoEndAt: null, startedAt: null, startedByName: '演示管理员', endedAt: null, endedByName: null, endReason: null, durationSeconds: null, status: 'ongoing', notifyUserIds: [], remindMinutes: 15, changes: [], createdAt: mockDateTime() }; }
export const maintenanceHandlers = [
  mock(maintenanceContract.status, ({ ok }) => ok(publicMaintenanceStatusSchema.parse(status))),
  mock(maintenanceContract.access, ({ ok }) => ok({ canView: true, canManage: true, canViewLogs: true, canBypass: true })),
  mock(maintenanceContract.detail, ({ ok }) => ok(status)),
  mock(maintenanceContract.logs, ({ query, ok, paginate }) => ok(paginate([...periods].reverse().filter((p) => matchesFilter(p.status, query.status) && (!query.keyword || (p.message + p.reason).includes(query.keyword)) && withinDateRange(p.createdAt, query.startTime, query.endTime))))),
  mock(maintenanceContract.log, ({ params, ok }) => { const p = periods.find((p) => p.id === params.id); if (!p) throw new MockHttpError(notFound('维护记录不存在')); return ok(p); }),
  mock(maintenanceContract.update, ({ body, ok }) => {
    check(body.version); if (status.current?.status === 'scheduled') throw new MockHttpError(conflict('先处理已有计划', { status: 409 }));
    if (body.enabled && !status.enabled) { const p = create(body.message, body.reason); p.startedAt = mockDateTime(); p.estimatedEndAt = body.estimatedEndAt; change(p,'start',body.reason); periods.push(p); }
    else if (status.current) { const p = status.current; if (body.enabled) { p.message = body.message; p.estimatedEndAt = body.estimatedEndAt; change(p,'update',body.reason); } else { p.status = 'completed'; p.endedAt = mockDateTime(); p.endedByName = '演示管理员'; p.endReason = body.reason; change(p,'finish',body.reason); } }
    status = { ...status, message: body.message, estimatedEndAt: body.estimatedEndAt }; return ok(settle());
  }),
  mock(maintenanceContract.plan, ({ body, ok }) => { check(body.version); if (status.current) throw new MockHttpError(conflict('已有时段', { status: 409 })); const p = create(body.message,body.reason); Object.assign(p,body,{ id:p.id,status:'scheduled' }); change(p,'plan',body.reason); periods.push(p); return ok(settle()); }),
  mock(maintenanceContract.start, ({ body, ok }) => { check(body.version); if (status.current?.status !== 'scheduled') throw new MockHttpError(badRequest('没有待开始计划')); status.current.status='ongoing'; status.current.startedAt=mockDateTime(); change(status.current,'start',body.reason); return ok(settle()); }),
  mock(maintenanceContract.cancel, ({ body, ok }) => { check(body.version); if (status.current?.status !== 'scheduled') throw new MockHttpError(badRequest('没有待开始计划')); status.current.status='cancelled'; status.current.endedAt=mockDateTime(); status.current.endReason=body.reason; change(status.current,'cancel',body.reason); return ok(settle()); }),
  mock(maintenanceContract.diagnose, ({ body, ok }) => { check(body.version); return ok({ allowed:true, reason:'演示平台管理员可通行，业务权限仍需验证', version:status.version, exceptions:[], boundaries:['后台任务与关键回调继续运行','不保证数据库停写'] }); }),
];
