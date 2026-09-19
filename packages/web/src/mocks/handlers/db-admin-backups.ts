import { HttpResponse } from 'msw';
import { dbAdminContract, type DbBackup } from '@zenith/shared/ops';
import { mock } from '@/mocks/utils/contract';
import { nextIdFrom, notFound } from '@/mocks/utils/handlers';
import { mockDateTime, mockFileTimestamp } from '@/mocks/utils/date';

const mockBackups: DbBackup[] = [
  {
    id: 1,
    name: 'pg_dump-20250601_120000',
    type: 'pg_dump',
    fileId: '018f6f8a-0001-7000-8000-000000000001',
    fileSize: 1048576,
    status: 'success',
    tables: null,
    startedAt: '2025-06-01 12:00:00',
    completedAt: '2025-06-01 12:00:05',
    durationMs: 5000,
    errorMessage: null,
    createdBy: 1,
    createdByName: '管理员',
    createdAt: '2025-06-01 12:00:00',
    updatedAt: '2025-06-01 12:00:05',
  },
  {
    id: 2,
    name: 'drizzle-export-20250602_083000',
    type: 'drizzle_export',
    fileId: '018f6f8a-0002-7000-8000-000000000002',
    fileSize: 524288,
    status: 'success',
    tables: null,
    startedAt: '2025-06-02 08:30:00',
    completedAt: '2025-06-02 08:30:03',
    durationMs: 3000,
    errorMessage: null,
    createdBy: 1,
    createdByName: '管理员',
    createdAt: '2025-06-02 08:30:00',
    updatedAt: '2025-06-02 08:30:03',
  },
  {
    id: 3,
    name: 'cron-pg_dump-20250603_030000',
    type: 'pg_dump',
    fileId: null,
    fileSize: null,
    status: 'failed',
    tables: null,
    startedAt: '2025-06-03 03:00:00',
    completedAt: '2025-06-03 03:00:01',
    durationMs: 1200,
    errorMessage: 'pg_dump: command not found',
    createdBy: null,
    createdByName: null,
    createdAt: '2025-06-03 03:00:00',
    updatedAt: '2025-06-03 03:00:01',
  },
];

export const dbAdminBackupsHandlers = [
  mock(dbAdminContract.backups, ({ query, ok, paginate }) => {
    let filtered = [...mockBackups];
    if (query.status) filtered = filtered.filter((b) => b.status === query.status);
    if (query.type) filtered = filtered.filter((b) => b.type === query.type);
    return ok(paginate(filtered));
  }),

  // Demo 模式下备份即时完成：直接以 success 落列表，回执仍按契约返回 pending
  mock(dbAdminContract.createBackup, ({ body, ok }) => {
    const id = nextIdFrom(mockBackups);
    const now = mockDateTime();
    const backup: DbBackup = {
      id,
      name: body.name || `${body.type}-${mockFileTimestamp()}`,
      type: body.type,
      status: 'success',
      fileId: `018f6f8a-${String(id).padStart(4, '0')}-7000-8000-${String(id).padStart(12, '0')}`,
      fileSize: Math.floor(Math.random() * 1048576),
      tables: null,
      startedAt: now,
      completedAt: now,
      durationMs: Math.floor(Math.random() * 5000),
      errorMessage: null,
      createdBy: 1,
      createdByName: '管理员',
      createdAt: now,
      updatedAt: now,
    };
    mockBackups.unshift(backup);
    return ok({ id, name: backup.name, status: 'pending' }, '备份任务已创建（演示）');
  }),

  // 备份产物是 restricted 文件，真实环境只能经这条带权限的路由下载；Demo 模式给出同样的边界与占位内容
  mock(dbAdminContract.downloadBackup, ({ params }) => {
    const backup = mockBackups.find((b) => b.id === params.id);
    if (!backup) return notFound('备份记录不存在');
    if (!backup.fileId) return notFound('该备份没有关联文件（尚未完成或未配置默认存储）');
    return new HttpResponse(`演示模式下「${backup.name}」的备份内容占位。`, {
      status: 200,
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(backup.name)}`,
      },
    });
  }),

  mock(dbAdminContract.removeBackup, ({ params, ok }) => {
    const idx = mockBackups.findIndex((b) => b.id === params.id);
    if (idx === -1) return notFound('备份记录不存在');
    mockBackups.splice(idx, 1);
    return ok(null, '已删除');
  }),
];
