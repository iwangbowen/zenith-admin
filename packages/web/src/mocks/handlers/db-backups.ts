import { dbBackupContract, type DbBackup } from '@zenith/shared/ops';
import { mock } from '@/mocks/utils/contract';
import { nextIdFrom } from '@/mocks/utils/handlers';
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
];

export const dbBackupsHandlers = [
  mock(dbBackupContract.list, ({ query, ok, paginate }) => {
    let filtered = [...mockBackups];
    if (query.status) filtered = filtered.filter((b) => b.status === query.status);
    if (query.type) filtered = filtered.filter((b) => b.type === query.type);
    return ok(paginate(filtered));
  }),

  // Demo 模式下备份即时完成：直接以 success 落列表，回执仍按契约返回 pending
  mock(dbBackupContract.create, ({ body, ok }) => {
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

  mock(dbBackupContract.remove, ({ params, ok }) => {
    const idx = mockBackups.findIndex((b) => b.id === params.id);
    if (idx >= 0) mockBackups.splice(idx, 1);
    return ok(null, '已删除');
  }),
];
