import dayjs from 'dayjs';
import { percentOf } from '@zenith/shared/core';
import { importJobContract, IMPORT_TASK_TYPE, IMPORT_TASK_TYPES, IMPORT_PREVIEW_TASK_TYPE } from '@zenith/shared/tasks';
import { CMS_CONTENT_IMPORT_COLUMNS } from '@zenith/shared/cms';
import type { ImportEntityMeta, ImportJobStats } from '@zenith/shared/tasks';
import { mock } from '@/mocks/utils/contract';
import { createImmediateMockTask, getMockAsyncTasks } from './async-tasks';

const entities: ImportEntityMeta[] = [
  {
    entity: 'member.members',
    title: '会员',
    module: '会员中心',
    description: '批量导入前台会员账号，自动初始化积分与钱包账户；手机号/邮箱/用户名全局唯一',
    maxRows: 10000,
    requiresContext: false,
    columns: [
      { key: 'nickname', header: '昵称', required: true, example: '张三' },
      { key: 'phone', header: '手机号', example: '13800001111' },
      { key: 'email', header: '邮箱' },
      { key: 'username', header: '用户名' },
      { key: 'password', header: '初始密码' },
      { key: 'level', header: '等级名称' },
      { key: 'status', header: '状态', enumValues: ['正常', '未激活', '已封禁'] },
      { key: 'remark', header: '备注' },
    ],
  },
  {
    entity: 'identity.users',
    title: '用户',
    module: '用户管理',
    description: '批量导入后台用户，支持部门/岗位/角色编码关联；密码按平台密码策略校验',
    maxRows: 10000,
    requiresContext: false,
    columns: [
      { key: 'username', header: '用户名', required: true },
      { key: 'nickname', header: '昵称', required: true },
      { key: 'email', header: '邮箱' },
      { key: 'password', header: '密码', required: true },
      { key: 'departmentCode', header: '部门编码' },
      { key: 'positionCodes', header: '岗位编码' },
      { key: 'roleCodes', header: '角色编码' },
      { key: 'status', header: '状态', enumValues: ['enabled', 'disabled'] },
    ],
  },
  {
    entity: 'iot.devices',
    title: 'IoT 设备',
    module: 'IoT 设备',
    description: '批量注册设备：SN 留空自动生成，接入密钥自动分配',
    maxRows: 10000,
    requiresContext: false,
    columns: [
      { key: 'name', header: '设备名称', required: true },
      { key: 'productName', header: '产品名称', required: true },
      { key: 'sn', header: 'SN' },
      { key: 'firmwareVersion', header: '固件版本' },
      { key: 'groupNames', header: '分组名称' },
      { key: 'status', header: '状态', enumValues: ['enabled', 'disabled'] },
      { key: 'remark', header: '备注' },
    ],
  },
  {
    entity: 'platform.dict-items',
    title: '字典项',
    module: '系统设置',
    description: '按字典编码批量补充字典项，同字典内项值唯一',
    maxRows: 10000,
    requiresContext: false,
    columns: [
      { key: 'dictCode', header: '字典编码', required: true },
      { key: 'label', header: '项标签', required: true },
      { key: 'value', header: '项值', required: true },
      { key: 'sort', header: '排序' },
      { key: 'status', header: '状态', enumValues: ['enabled', 'disabled'] },
      { key: 'remark', header: '备注' },
    ],
  },
  {
    entity: 'cms.contents',
    title: 'CMS 内容',
    module: 'CMS内容管理',
    description: '需在 CMS 内容管理页选择站点/栏目后导入，逐行创建草稿内容',
    maxRows: 2000,
    requiresContext: true,
    columns: CMS_CONTENT_IMPORT_COLUMNS,
  },
];

function buildMockImportStats(): ImportJobStats {
  const importTasks = getMockAsyncTasks().filter((task) => (IMPORT_TASK_TYPES as readonly string[]).includes(task.taskType));
  const counts: Record<string, number> = { pending: 0, running: 0, success: 0, failed: 0, cancelled: 0 };
  for (const task of importTasks) counts[task.status] = (counts[task.status] ?? 0) + 1;
  const success = counts.success ?? 0;
  const failed = counts.failed ?? 0;
  const today = dayjs().startOf('day');
  const durations = importTasks
    .filter((task) => task.status === 'success' && task.startedAt && task.completedAt)
    .map((task) => dayjs(task.completedAt).diff(dayjs(task.startedAt), 'millisecond'));
  const dailyMap = new Map<string, { submitted: number; success: number; failed: number }>();
  const hourlyMap = new Map<string, { submitted: number; failed: number }>();
  for (const task of importTasks) {
    const date = dayjs(task.createdAt).format('YYYY-MM-DD');
    const daily = dailyMap.get(date) ?? { submitted: 0, success: 0, failed: 0 };
    daily.submitted += 1;
    if (task.status === 'success') daily.success += 1;
    if (task.status === 'failed') daily.failed += 1;
    dailyMap.set(date, daily);
    const hour = dayjs(task.createdAt).format('YYYY-MM-DD HH:00');
    const hourly = hourlyMap.get(hour) ?? { submitted: 0, failed: 0 };
    hourly.submitted += 1;
    if (task.status === 'failed') hourly.failed += 1;
    hourlyMap.set(hour, hourly);
  }
  const entityMap = new Map<string, { entity: string; total: number; success: number; failed: number; processedRows: number; failedRows: number }>();
  for (const task of importTasks) {
    const entity = (task.payload as { entity?: string } | null)?.entity;
    if (!entity) continue;
    const row = entityMap.get(entity) ?? { entity, total: 0, success: 0, failed: 0, processedRows: 0, failedRows: 0 };
    row.total += 1;
    if (task.status === 'success') row.success += 1;
    if (task.status === 'failed') row.failed += 1;
    row.processedRows += task.processedCount;
    row.failedRows += task.failedCount;
    entityMap.set(entity, row);
  }
  const submitterMap = new Map<string, { userId: number | null; username: string; count: number; failed: number }>();
  for (const task of importTasks) {
    const key = String(task.createdBy ?? 'system');
    const row = submitterMap.get(key) ?? { userId: task.createdBy, username: task.createdByName ?? '系统', count: 0, failed: 0 };
    row.count += 1;
    if (task.status === 'failed') row.failed += 1;
    submitterMap.set(key, row);
  }
  const modeOf = (mode: 'preview' | 'import') => {
    const rows = importTasks.filter((task) => (mode === 'preview' ? task.taskType === IMPORT_PREVIEW_TASK_TYPE : task.taskType === IMPORT_TASK_TYPE));
    return {
      mode,
      total: rows.length,
      success: rows.filter((task) => task.status === 'success').length,
      failed: rows.filter((task) => task.status === 'failed').length,
      processedRows: rows.reduce((sum, task) => sum + task.processedCount, 0),
      failedRows: rows.reduce((sum, task) => sum + task.failedCount, 0),
    };
  };
  return {
    total: importTasks.length,
    pending: counts.pending ?? 0,
    running: counts.running ?? 0,
    success,
    failed,
    cancelled: counts.cancelled ?? 0,
    successRate: percentOf(success, success + failed),
    avgDurationMs: durations.length > 0 ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
    today: {
      submitted: importTasks.filter((task) => dayjs(task.createdAt).isAfter(today)).length,
      success: importTasks.filter((task) => dayjs(task.createdAt).isAfter(today) && task.status === 'success').length,
      failed: importTasks.filter((task) => dayjs(task.createdAt).isAfter(today) && task.status === 'failed').length,
      yesterdaySubmitted: importTasks.filter((task) => dayjs(task.createdAt).isBefore(today) && dayjs(task.createdAt).isAfter(today.subtract(1, 'day'))).length,
    },
    daily: Array.from({ length: 14 }, (_, index) => {
      const date = dayjs().subtract(13 - index, 'day').format('YYYY-MM-DD');
      const row = dailyMap.get(date);
      return { date, submitted: row?.submitted ?? 0, success: row?.success ?? 0, failed: row?.failed ?? 0 };
    }),
    hourly: Array.from({ length: 24 }, (_, index) => {
      const hour = dayjs().startOf('hour').subtract(23 - index, 'hour').format('YYYY-MM-DD HH:00');
      const row = hourlyMap.get(hour);
      return { hour, submitted: row?.submitted ?? 0, failed: row?.failed ?? 0 };
    }),
    modes: [modeOf('import'), modeOf('preview')],
    topEntities: [...entityMap.values()].sort((a, b) => b.total - a.total).slice(0, 5),
    topSubmitters: [...submitterMap.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    rows: {
      processed: importTasks.reduce((sum, task) => sum + task.processedCount, 0),
      failed: importTasks.reduce((sum, task) => sum + task.failedCount, 0),
    },
  };
}

export const importJobsHandlers = [
  mock(importJobContract.stats, ({ ok }) => ok(buildMockImportStats())),
  mock(importJobContract.entities, ({ ok }) => ok(entities)),
  mock(importJobContract.inspect, ({ body, ok }) => {
    const entity = entities.find(item => item.entity === body.entity);
    const headers = entity?.columns.map(column => column.header) ?? [];
    return ok({ entity: body.entity, filename: 'demo-import.xlsx', headers, rowCount: 1, sample: [Object.fromEntries(headers.map(header => [header, '示例值']))], suggestedMapping: Object.fromEntries(entity?.columns.map(column => [column.key, column.header]) ?? []) });
  }),
  mock(importJobContract.submit, ({ body, ok }) => {
    const dryRun = body.dryRun ?? false;
    const title = entities.find((entity) => entity.entity === body.entity)?.title ?? '数据';
    const task = createImmediateMockTask({
      taskType: dryRun ? IMPORT_PREVIEW_TASK_TYPE : IMPORT_TASK_TYPE,
      title: `${title}${dryRun ? '预检' : '导入'}`, module: '导入中心', payload: body, allowConcurrent: dryRun,
    });
    task.result = { total: 1, succeeded: 1, failed: 0, dryRun, errorFileId: null, errorFileName: null };
    return ok(task, '任务已完成，可查看处理结果');
  }),
  mock(importJobContract.confirm, ({ params, ok }) => {
    const task = createImmediateMockTask({ taskType: IMPORT_TASK_TYPE, title: '数据导入', module: '导入中心', payload: { previewTaskId: params.id }, allowConcurrent: false });
    task.result = { total: 1, succeeded: 1, failed: 0, dryRun: false, errorFileId: null, errorFileName: null };
    return ok(task, '正式导入任务已提交');
  }),
];
