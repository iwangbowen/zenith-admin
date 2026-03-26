import { http, HttpResponse } from 'msw';

const API = import.meta.env.VITE_API_BASE_URL || '';

let nextId = 3;

const mockBackups = [
  {
    id: 1,
    name: 'pg_dump-2025-06-01T12-00-00-000Z',
    type: 'pg_dump',
    fileId: 1,
    fileSize: 1048576,
    status: 'success',
    tables: null,
    startedAt: '2025-06-01T12:00:00.000Z',
    completedAt: '2025-06-01T12:00:05.000Z',
    durationMs: 5000,
    errorMessage: null,
    createdBy: 1,
    createdByName: '管理员',
    createdAt: '2025-06-01T12:00:00.000Z',
  },
  {
    id: 2,
    name: 'drizzle-export-2025-06-02T08-30-00-000Z',
    type: 'drizzle_export',
    fileId: 2,
    fileSize: 524288,
    status: 'success',
    tables: null,
    startedAt: '2025-06-02T08:30:00.000Z',
    completedAt: '2025-06-02T08:30:03.000Z',
    durationMs: 3000,
    errorMessage: null,
    createdBy: 1,
    createdByName: '管理员',
    createdAt: '2025-06-02T08:30:00.000Z',
  },
];

export const dbBackupsHandlers = [
  // 列表
  http.get(`${API}/api/db-backups`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const status = url.searchParams.get('status');
    const type = url.searchParams.get('type');

    let filtered = [...mockBackups];
    if (status) filtered = filtered.filter((b) => b.status === status);
    if (type) filtered = filtered.filter((b) => b.type === type);

    const start = (page - 1) * pageSize;
    const list = filtered.slice(start, start + pageSize);

    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: { list, total: filtered.length, page, pageSize },
    });
  }),

  // 创建
  http.post(`${API}/api/db-backups`, async ({ request }) => {
    const body = (await request.json()) as { name?: string; type?: string };
    const id = nextId++;
    const now = new Date().toISOString();
    const backupType = body.type ?? 'pg_dump';
    const backup = {
      id,
      name: body.name || `${backupType}-${now}`,
      type: backupType,
      status: 'success',
      fileId: id,
      fileSize: Math.floor(Math.random() * 1048576),
      startedAt: now,
      completedAt: now,
      durationMs: Math.floor(Math.random() * 5000),
      errorMessage: null,
      createdBy: 1,
      createdByName: '管理员',
      createdAt: now,
    };
    mockBackups.unshift(backup as (typeof mockBackups)[number]);

    return HttpResponse.json({
      code: 0,
      message: '备份任务已创建（演示）',
      data: { id, name: backup.name, status: 'success' },
    });
  }),

  // 删除
  http.delete(`${API}/api/db-backups/:id`, ({ params }) => {
    const id = Number(params.id);
    const idx = mockBackups.findIndex((b) => b.id === id);
    if (idx >= 0) mockBackups.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '已删除', data: null });
  }),
];
