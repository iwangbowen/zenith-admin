import { HttpResponse } from 'msw';
import { dbAdminContract, type DbBackup } from '@zenith/shared/ops';
import { mock } from '@/mocks/utils/contract';
import { mockBackups } from '@/mocks/data/db-admin-backups';
import { conflict, nextIdFrom, notFound } from '@/mocks/utils/handlers';
import { mockDateTime, mockFileTimestamp } from '@/mocks/utils/date';
import { isDbBackupStuck } from '@/utils/stuck-jobs';
import { parseDateTimeParam } from '@/utils/date';
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

  mock(dbAdminContract.markBackupFailed, ({ params, ok }) => {
    const backup = mockBackups.find((item) => item.id === params.id);
    if (!backup) return notFound('备份记录不存在', { status: 404 });
    if (!isDbBackupStuck(backup)) return conflict('仅可标记运行超过两小时或等待超过十分钟且尚未结束的备份', { status: 409 });
    const now = mockDateTime();
    Object.assign(backup, { status: 'failed', completedAt: now, updatedAt: now, errorMessage: '管理员手动标记卡死备份为失败',
      durationMs: Math.min(2_147_483_647, Math.max(0, Date.now() - (parseDateTimeParam(backup.startedAt ?? backup.createdAt)?.getTime() ?? Date.now()))) });
    return ok(backup, '卡死备份已标记为失败');
  }),
];
