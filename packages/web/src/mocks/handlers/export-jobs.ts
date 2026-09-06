import type { QueryOf } from '@zenith/shared/core';
import { exportJobContract } from '@zenith/shared/tasks';
import type { ExportEntityMeta, ExportJob, ExportJobDownload } from '@zenith/shared/tasks';
import { mock } from '@/mocks/utils/contract';
import { requireItem, removeByIds } from '@/mocks/utils/crud';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';
import { includesKeyword } from '@/mocks/utils/filter';

const entities: ExportEntityMeta[] = [
  {
    entity: 'system.users',
    moduleName: '用户管理',
    filenamePrefix: '用户列表',
    formats: ['xlsx', 'csv'],
    renderMode: 'table',
    sensitive: false,
    columns: [
      {
        key: '基础信息',
        header: '基础信息',
        children: [
          { key: 'id', header: 'ID', type: 'number', width: 8 },
          { key: 'username', header: '用户名', width: 18 },
          { key: 'nickname', header: '昵称', width: 18 },
          { key: 'departmentName', header: '部门', width: 18 },
          { key: 'status', header: '状态', width: 10 },
        ],
      },
      {
        key: '联系方式',
        header: '联系方式',
        children: [
          { key: 'email', header: '邮箱', width: 28 },
          { key: 'phone', header: '手机号', width: 18 },
        ],
      },
    ],
    execution: {
      mode: 'sync',
      syncMaxRows: 3000,
      maxRows: 50000,
      forceAsyncWhenSensitive: false,
      forceAsyncWhenRaw: false,
      syncModeOverridesAsyncPolicies: true,
    },
    permissions: {
      export: 'system:user:export',
      exportRaw: 'system:user:export-raw',
      requireExportRawPermission: false,
    },
  },
  {
    entity: 'report.print',
    moduleName: '打印报表',
    filenamePrefix: '打印报表',
    formats: ['xlsx', 'pdf'],
    renderMode: 'custom',
    sensitive: false,
    columns: [],
    execution: {
      mode: 'auto',
      syncMaxRows: 800,
      maxRows: 50000,
      forceAsyncWhenSensitive: false,
      forceAsyncWhenRaw: false,
      syncModeOverridesAsyncPolicies: false,
    },
    permissions: {
      export: 'report:print:list',
      requireExportRawPermission: false,
    },
  },
  {
    entity: 'cms.publish-artifacts',
    moduleName: 'CMS发布中心',
    filenamePrefix: 'CMS发布产物',
    sourcePath: '/cms/publishing',
    formats: ['xlsx', 'csv'],
    renderMode: 'table',
    sensitive: false,
    columns: [
      { key: 'taskId', header: '任务 ID', type: 'number', width: 12 },
      { key: 'path', header: '产物路径', width: 44 },
      { key: 'status', header: '状态', width: 12 },
      { key: 'createdAt', header: '记录时间', type: 'datetime', width: 22 },
    ],
    execution: {
      mode: 'sync',
      syncMaxRows: 5000,
      maxRows: 50000,
      forceAsyncWhenSensitive: false,
      forceAsyncWhenRaw: false,
      syncModeOverridesAsyncPolicies: true,
    },
    permissions: { export: 'cms:publish:view', requireExportRawPermission: false },
  },
  {
    entity: 'cms.publish-logs',
    moduleName: 'CMS发布中心',
    filenamePrefix: 'CMS发布日志',
    sourcePath: '/cms/publishing',
    formats: ['xlsx', 'csv'],
    renderMode: 'table',
    sensitive: false,
    columns: [
      { key: 'taskId', header: '任务 ID', type: 'number', width: 12 },
      { key: 'itemKey', header: '路径/检查点', width: 42 },
      { key: 'status', header: '状态', width: 12 },
      { key: 'message', header: '消息/错误', width: 44 },
    ],
    execution: {
      mode: 'sync',
      syncMaxRows: 5000,
      maxRows: 50000,
      forceAsyncWhenSensitive: false,
      forceAsyncWhenRaw: false,
      syncModeOverridesAsyncPolicies: true,
    },
    permissions: { export: 'cms:publish:view', requireExportRawPermission: false },
  },
  {
    entity: 'cms.distribution-runs',
    moduleName: 'CMS内容管理',
    filenamePrefix: 'CMS内容分发结果',
    sourcePath: '/cms/distribution',
    formats: ['xlsx', 'csv'],
    renderMode: 'table',
    sensitive: false,
    columns: [
      { key: 'taskId', header: '任务 ID', type: 'number', width: 12 },
      { key: 'ruleName', header: '分发规则', width: 28 },
      { key: 'sourceSite', header: '来源站点', width: 24 },
      { key: 'targetSite', header: '目标站点', width: 24 },
      { key: 'outcome', header: '结果', width: 14 },
      { key: 'message', header: '处理说明', width: 42 },
    ],
    execution: {
      mode: 'sync',
      syncMaxRows: 5000,
      maxRows: 50000,
      forceAsyncWhenSensitive: false,
      forceAsyncWhenRaw: false,
      syncModeOverridesAsyncPolicies: true,
    },
    permissions: { export: 'cms:distribution:export', requireExportRawPermission: false },
  },
];

let nextJobId = 4;

const jobs: ExportJob[] = [
  {
    id: 1,
    entity: 'system.users',
    moduleName: '用户管理',
    format: 'xlsx',
    status: 'success',
    executionMode: 'async',
    query: { status: 'enabled' },
    columns: null,
    rowCount: 128,
    fileId: '018f6f8a-0005-7000-8000-000000000005',
    filename: '用户列表_20260626_090000_1.xlsx',
    fileSize: 76432,
    raw: true,
    masked: false,
    sensitive: false,
    watermark: false,
    errorMessage: null,
    expiresAt: '2026-06-29 09:00:00',
    fileDeletedAt: null,
    deleteReason: null,
    downloadCount: 2,
    lastDownloadedAt: mockDateTimeOffset(-3600 * 1000),
    tenantId: null,
    createdBy: 1,
    createdByName: '管理员',
    startedAt: '2026-06-26 09:00:01',
    completedAt: '2026-06-26 09:00:03',
    createdAt: '2026-06-26 09:00:00',
    updatedAt: '2026-06-26 09:00:03',
  },
  {
    id: 2,
    entity: 'system.users',
    moduleName: '用户管理',
    format: 'csv',
    status: 'running',
    executionMode: 'async',
    query: {},
    columns: null,
    rowCount: 12000,
    fileId: null,
    filename: '用户列表_20260626_100000_2.csv',
    fileSize: null,
    raw: true,
    masked: false,
    sensitive: false,
    watermark: false,
    errorMessage: null,
    expiresAt: '2026-06-29 10:00:00',
    fileDeletedAt: null,
    deleteReason: null,
    downloadCount: 0,
    lastDownloadedAt: null,
    tenantId: null,
    createdBy: 1,
    createdByName: '管理员',
    startedAt: '2026-06-26 10:00:01',
    completedAt: null,
    createdAt: '2026-06-26 10:00:00',
    updatedAt: '2026-06-26 10:00:01',
  },
  {
    id: 3,
    entity: 'system.users',
    moduleName: '用户管理',
    format: 'xlsx',
    status: 'failed',
    executionMode: 'async',
    query: {},
    columns: null,
    rowCount: 8000,
    fileId: null,
    filename: '用户列表_20260626_103000_3.xlsx',
    fileSize: null,
    raw: true,
    masked: false,
    sensitive: false,
    watermark: false,
    errorMessage: 'Demo 模式：模拟对象存储写入失败',
    expiresAt: '2026-06-27 10:30:00',
    fileDeletedAt: null,
    deleteReason: null,
    downloadCount: 0,
    lastDownloadedAt: null,
    tenantId: null,
    createdBy: 1,
    createdByName: '管理员',
    startedAt: '2026-06-26 10:30:01',
    completedAt: '2026-06-26 10:30:03',
    createdAt: '2026-06-26 10:30:00',
    updatedAt: '2026-06-26 10:30:03',
  },
];

const downloads: ExportJobDownload[] = [
  {
    id: 1,
    jobId: 1,
    downloadedBy: 1,
    downloadedByName: '管理员',
    tenantId: null,
    ip: '127.0.0.1',
    userAgent: 'Demo Browser',
    createdAt: mockDateTimeOffset(-7200 * 1000),
  },
  {
    id: 2,
    jobId: 1,
    downloadedBy: 1,
    downloadedByName: '管理员',
    tenantId: null,
    ip: '127.0.0.1',
    userAgent: 'Demo Browser',
    createdAt: mockDateTimeOffset(-3600 * 1000),
  },
];

/** 按契约查询参数筛选（服务端语义：实体 / 状态 / 格式精确匹配，关键字匹配模块名、文件名与实体） */
function filterJobs(query: QueryOf<typeof exportJobContract.list>) {
  return jobs.filter((job) => {
    if (query.entity && job.entity !== query.entity) return false;
    if (query.status && job.status !== query.status) return false;
    if (query.format && job.format !== query.format) return false;
    if (query.keyword && !includesKeyword(query.keyword, job.moduleName, job.filename, job.entity)) return false;
    return true;
  });
}

function makeDownloadResponse(job: ExportJob) {
  const content = job.format === 'csv'
    ? '\uFEFFID,用户名,昵称\n1,admin,管理员\n'
    : job.format === 'pdf'
      ? '%PDF-1.4\n% Demo PDF\n'
    : 'Demo export file';
  return new Response(content, {
    headers: {
      'Content-Type': job.format === 'csv'
        ? 'text/csv; charset=utf-8'
        : job.format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(job.filename ?? `export-${job.id}.${job.format}`)}`,
    },
  });
}

export const exportJobsHandlers = [
  mock(exportJobContract.entities, ({ ok }) => ok(entities)),

  mock(exportJobContract.list, ({ query, ok, paginate }) => ok(paginate(filterJobs(query).sort((a, b) => b.id - a.id)))),

  mock(exportJobContract.create, ({ body, ok }) => {
    const entity = entities.find((item) => item.entity === body.entity);
    if (!entity) return notFound('导出实体不存在', { status: 404 });
    const id = nextJobId++;
    const format = body.format;
    const sensitive = entity.sensitive;
    const raw = body.raw;
    const forceAsync = body.executionMode === 'async';
    const now = mockDateTime();
    const job: ExportJob = {
      id,
      entity: entity.entity,
      moduleName: entity.moduleName,
      format,
      status: forceAsync ? 'pending' : 'success',
      executionMode: forceAsync ? 'async' : 'sync',
      query: body.query,
      columns: null,
      rowCount: 42,
      fileId: forceAsync ? null : '018f6f8a-0005-7000-8000-000000000005',
      filename: `${entity.filenamePrefix}_${id}.${format}`,
      fileSize: forceAsync ? null : 32768,
      raw,
      masked: !raw,
      sensitive,
      watermark: body.watermark,
      errorMessage: null,
      expiresAt: raw ? '2026-06-27 00:00:00' : '2026-06-29 00:00:00',
      fileDeletedAt: null,
      deleteReason: null,
      downloadCount: 0,
      lastDownloadedAt: null,
      tenantId: null,
      createdBy: 1,
      createdByName: '管理员',
      startedAt: forceAsync ? null : now,
      completedAt: forceAsync ? null : now,
      createdAt: now,
      updatedAt: now,
    };
    jobs.unshift(job);
    return ok({ mode: job.executionMode, job }, '导出任务已创建');
  }),

  mock(exportJobContract.downloads, ({ params, ok }) => ok(downloads.filter((item) => item.jobId === params.id))),

  mock(exportJobContract.download, ({ params }) => {
    const job = requireItem(jobs, params.id, '导出任务不存在', { status: 404 });
    if (job.status !== 'success') return badRequest('导出文件尚未生成', { status: 400 });
    job.downloadCount += 1;
    job.lastDownloadedAt = mockDateTime();
    downloads.unshift({
      id: downloads.length + 1,
      jobId: job.id,
      downloadedBy: 1,
      downloadedByName: '管理员',
      tenantId: null,
      ip: '127.0.0.1',
      userAgent: 'Demo Browser',
      createdAt: job.lastDownloadedAt,
    });
    return makeDownloadResponse(job);
  }),

  mock(exportJobContract.detail, ({ params, ok }) => {
    const job = requireItem(jobs, params.id, '导出任务不存在', { status: 404 });
    return ok(job);
  }),

  mock(exportJobContract.cancel, ({ params, ok }) => {
    const job = requireItem(jobs, params.id, '导出任务不存在', { status: 404 });
    job.status = 'cancelled';
    job.completedAt = mockDateTime();
    job.updatedAt = job.completedAt;
    return ok(job, '已取消');
  }),

  mock(exportJobContract.retry, ({ params, ok }) => {
    const job = requireItem(jobs, params.id, '导出任务不存在', { status: 404 });
    job.status = 'pending';
    job.errorMessage = null;
    job.startedAt = null;
    job.completedAt = null;
    job.updatedAt = mockDateTime();
    return ok(job, '已重试');
  }),

  mock(exportJobContract.remove, ({ params, ok }) => {
    requireItem(jobs, params.id, '导出任务不存在', { status: 404 });
    removeByIds(jobs, [params.id]);
    return ok(null, '已删除');
  }),
];
