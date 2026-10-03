import { SEED_DIRECTORY_SYNC_SOURCES } from '@zenith/shared/seed';
import type { DirectorySyncConflict, DirectorySyncRun, DirectorySyncRunItem, DirectorySyncSource } from '@zenith/shared/identity';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockDirectorySyncSources: DirectorySyncSource[] = SEED_DIRECTORY_SYNC_SOURCES.map((s) => ({
  ...s,
  lastRunAt: mockDateTimeOffset(-3600 * 1000),
  nextRunAt: s.status === 'enabled' && s.cronExpression ? mockDateTimeOffset(3600 * 1000) : null,
}));

let nextSourceId = nextIdFrom(mockDirectorySyncSources);
export function getNextDirectorySyncSourceId(): number {
  return nextSourceId++;
}

// ─── 运行记录：由演示源派生两条已完成记录 ─────────────────────────────────────────
export const mockDirectorySyncRuns: DirectorySyncRun[] = [
  {
    id: 2,
    sourceId: 1,
    sourceName: mockDirectorySyncSources[0]?.name ?? '总部 AD 域',
    triggerType: 'schedule',
    dryRun: false,
    status: 'success',
    totalFetched: 58,
    deptCreated: 1,
    deptUpdated: 0,
    userCreated: 3,
    userLinked: 1,
    userUpdated: 2,
    userDisabled: 1,
    skipped: 50,
    conflictCount: 0,
    failedCount: 0,
    message: '同步完成：新增 3、绑定 1、更新 2、禁用 1，部门新增 1、更新 0，冲突 0，失败 0',
    errorMessage: null,
    triggeredBy: null,
    startedAt: mockDateTimeOffset(-3600 * 1000),
    finishedAt: mockDateTimeOffset(-3590 * 1000),
    createdAt: mockDateTimeOffset(-3600 * 1000),
  },
  {
    id: 1,
    sourceId: 2,
    sourceName: mockDirectorySyncSources[1]?.name ?? '钉钉通讯录',
    triggerType: 'manual',
    dryRun: false,
    status: 'partial',
    totalFetched: 132,
    deptCreated: 6,
    deptUpdated: 0,
    userCreated: 24,
    userLinked: 8,
    userUpdated: 0,
    userDisabled: 0,
    skipped: 96,
    conflictCount: 2,
    failedCount: 2,
    message: '同步完成：新增 24、绑定 8、更新 0、禁用 0，部门新增 6、更新 0，冲突 2，失败 2',
    errorMessage: null,
    triggeredBy: 1,
    startedAt: mockDateTimeOffset(-86400 * 1000),
    finishedAt: mockDateTimeOffset(-86395 * 1000),
    createdAt: mockDateTimeOffset(-86400 * 1000),
  },
];

mockDirectorySyncRuns.unshift({
  ...mockDirectorySyncRuns[0], id: 3, status: 'running', totalFetched: 0,
  deptCreated: 0, deptUpdated: 0, userCreated: 0, userLinked: 0, userUpdated: 0, userDisabled: 0,
  skipped: 0, conflictCount: 0, failedCount: 0, message: '同步进程停止后遗留的运行记录',
  startedAt: mockDateTimeOffset(-90 * 60_000), finishedAt: null, createdAt: mockDateTimeOffset(-90 * 60_000),
});

let nextRunId = nextIdFrom(mockDirectorySyncRuns);
export function getNextDirectorySyncRunId(): number {
  return nextRunId++;
}

export const mockDirectorySyncRunItems: DirectorySyncRunItem[] = [
  { id: 1, runId: 2, entityType: 'department', externalId: 'name:研发中心', name: '研发中心', action: 'create', applied: true, diff: null, message: null, createdAt: mockDateTimeOffset(-3595 * 1000) },
  { id: 2, runId: 2, entityType: 'user', externalId: 'ad-1001', name: '王小明', action: 'create', applied: true, diff: null, message: null, createdAt: mockDateTimeOffset(-3595 * 1000) },
  { id: 3, runId: 2, entityType: 'user', externalId: 'ad-1002', name: '陈静', action: 'update', applied: true, diff: { phone: { from: '13800000001', to: '13900000001' } }, message: null, createdAt: mockDateTimeOffset(-3595 * 1000) },
  { id: 4, runId: 2, entityType: 'user', externalId: 'ad-0902', name: '离职员工A', action: 'disable', applied: true, diff: { status: { from: 'enabled', to: 'disabled' } }, message: '源侧已移除，账号已禁用', createdAt: mockDateTimeOffset(-3595 * 1000) },
  { id: 5, runId: 1, entityType: 'user', externalId: 'dt-2001', name: '刘倩', action: 'conflict', applied: false, diff: { nickname: { from: '刘倩(本地改)', to: '刘倩' } }, message: '字段 nickname 两侧均有修改，已挂起待裁决', createdAt: mockDateTimeOffset(-86398 * 1000) },
  { id: 6, runId: 1, entityType: 'user', externalId: 'dt-2002', name: '赵磊', action: 'fail', applied: false, diff: null, message: '手机号与既有账号唯一约束冲突', createdAt: mockDateTimeOffset(-86398 * 1000) },
];

let nextRunItemId = nextIdFrom(mockDirectorySyncRunItems);
export function getNextDirectorySyncRunItemId(): number {
  return nextRunItemId++;
}

export const mockDirectorySyncConflicts: DirectorySyncConflict[] = [
  {
    id: 1,
    sourceId: 2,
    sourceName: mockDirectorySyncSources[1]?.name ?? '钉钉通讯录',
    runId: 1,
    entityType: 'user',
    externalId: 'dt-2001',
    name: '刘倩',
    conflictType: 'field_conflict',
    sourceData: { username: '13700000001', nickname: '刘倩', email: 'liuqian@example.com', phone: '13700000001' },
    localData: { nickname: '刘倩(本地改)' },
    candidateUserIds: [],
    status: 'pending',
    resolution: null,
    resolvedBy: null,
    resolvedByNickname: null,
    resolvedAt: null,
    createdAt: mockDateTimeOffset(-86398 * 1000),
    updatedAt: mockDateTimeOffset(-86398 * 1000),
  },
  {
    id: 2,
    sourceId: 2,
    sourceName: mockDirectorySyncSources[1]?.name ?? '钉钉通讯录',
    runId: 1,
    entityType: 'user',
    externalId: 'dt-2003',
    name: '周伟',
    conflictType: 'multi_match',
    sourceData: { username: '13700000003', nickname: '周伟', email: null, phone: '13700000003' },
    localData: null,
    candidateUserIds: [2, 3],
    status: 'pending',
    resolution: null,
    resolvedBy: null,
    resolvedByNickname: null,
    resolvedAt: null,
    createdAt: mockDateTimeOffset(-86398 * 1000),
    updatedAt: mockDateTimeOffset(-86398 * 1000),
  },
];

let nextConflictId = nextIdFrom(mockDirectorySyncConflicts);
export function getNextDirectorySyncConflictId(): number {
  return nextConflictId++;
}

/** 模拟一次同步执行：写入运行记录与明细，并回写源的最近状态 */
export function simulateDirectorySyncRun(source: DirectorySyncSource, opts: { dryRun: boolean; triggerType: 'manual' | 'preview' }): DirectorySyncRun {
  const now = mockDateTime();
  const run: DirectorySyncRun = {
    id: getNextDirectorySyncRunId(),
    sourceId: source.id,
    sourceName: source.name,
    triggerType: opts.triggerType,
    dryRun: opts.dryRun,
    status: 'success',
    totalFetched: 42,
    deptCreated: 0,
    deptUpdated: 1,
    userCreated: 1,
    userLinked: 0,
    userUpdated: 2,
    userDisabled: 0,
    skipped: 38,
    conflictCount: 0,
    failedCount: 0,
    message: opts.dryRun
      ? '预览完成：将新增 1、绑定 0、更新 2、禁用 0，部门新增 0、更新 1，冲突 0'
      : '同步完成：新增 1、绑定 0、更新 2、禁用 0，部门新增 0、更新 1，冲突 0，失败 0',
    errorMessage: null,
    triggeredBy: 1,
    startedAt: now,
    finishedAt: now,
    createdAt: now,
  };
  mockDirectorySyncRuns.unshift(run);
  mockDirectorySyncRunItems.push(
    { id: getNextDirectorySyncRunItemId(), runId: run.id, entityType: 'user', externalId: 'demo-3001', name: '新同事', action: 'create', applied: !opts.dryRun, diff: null, message: opts.dryRun ? '预览' : null, createdAt: now },
    { id: getNextDirectorySyncRunItemId(), runId: run.id, entityType: 'user', externalId: 'demo-3002', name: '张三', action: 'update', applied: !opts.dryRun, diff: { email: { from: 'old@example.com', to: 'new@example.com' } }, message: opts.dryRun ? '预览' : null, createdAt: now },
    { id: getNextDirectorySyncRunItemId(), runId: run.id, entityType: 'department', externalId: 'demo-dept-1', name: '市场部', action: 'update', applied: !opts.dryRun, diff: { name: { from: '市场一部', to: '市场部' } }, message: opts.dryRun ? '预览' : null, createdAt: now },
  );
  if (!opts.dryRun) {
    source.lastRunAt = now;
    source.lastRunStatus = 'success';
  }
  return run;
}
