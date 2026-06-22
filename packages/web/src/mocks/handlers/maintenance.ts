import { http, HttpResponse } from 'msw';
import type { MaintenanceLog } from '@zenith/shared';
import { mockDateTime } from '@/mocks/utils/date';

const API = import.meta.env.VITE_API_BASE_URL || '';

interface MaintenanceRecord {
  enabled: boolean;
  message: string;
  estimatedEndAt: string | null;
  startedAt: string | null;
  startedByName: string | null;
  updatedAt: string;
}

let mockMaintenance: MaintenanceRecord = {
  enabled: false,
  message: '系统升级维护中，预计 30 分钟后恢复，请稍后重试。',
  estimatedEndAt: null,
  startedAt: null,
  startedByName: null,
  updatedAt: mockDateTime(),
};

// ── 维护记录（每次「开启→关闭」为一条时段）─────────────────────────────────
const mockMaintenanceLogs: MaintenanceLog[] = [
  {
    id: 2,
    message: '数据库主从切换演练',
    estimatedEndAt: '2026-05-20 02:00:00',
    startedAt: '2026-05-20 01:00:00',
    startedByName: '管理员',
    endedAt: '2026-05-20 01:42:00',
    endedByName: '管理员',
    durationSeconds: 2520,
    status: 'completed',
    createdAt: '2026-05-20 01:00:00',
  },
  {
    id: 1,
    message: '系统版本升级 v1.8.0',
    estimatedEndAt: '2026-04-12 23:30:00',
    startedAt: '2026-04-12 23:00:00',
    startedByName: '管理员',
    endedAt: '2026-04-12 23:18:00',
    endedByName: '管理员',
    durationSeconds: 1080,
    status: 'completed',
    createdAt: '2026-04-12 23:00:00',
  },
];

let logIdSeq = 100;

function durationSecondsBetween(start: string, end: string): number {
  const s = new Date(start.replace(' ', 'T')).getTime();
  const e = new Date(end.replace(' ', 'T')).getTime();
  return Math.max(0, Math.round((e - s) / 1000));
}

function findOngoingLog(): MaintenanceLog | undefined {
  return mockMaintenanceLogs.find((l) => l.endedAt === null);
}

export const maintenanceHandlers = [
  // GET /api/maintenance/status — public
  http.get(`${API}/api/maintenance/status`, () => {
    return HttpResponse.json({ code: 0, message: 'success', data: mockMaintenance });
  }),

  // GET /api/maintenance — admin
  http.get(`${API}/api/maintenance`, () => {
    return HttpResponse.json({ code: 0, message: 'success', data: mockMaintenance });
  }),

  // GET /api/maintenance/logs — admin（分页 + 状态筛选）
  http.get(`${API}/api/maintenance/logs`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const status = url.searchParams.get('status');

    let list = [...mockMaintenanceLogs];
    if (status === 'ongoing') list = list.filter((l) => l.status === 'ongoing');
    if (status === 'completed') list = list.filter((l) => l.status === 'completed');
    list.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));

    const total = list.length;
    const start = (page - 1) * pageSize;
    return HttpResponse.json({
      code: 0,
      message: 'success',
      data: { list: list.slice(start, start + pageSize), total, page, pageSize },
    });
  }),

  // PUT /api/maintenance — admin
  http.put(`${API}/api/maintenance`, async ({ request }) => {
    const body = await request.json() as {
      enabled: boolean;
      message?: string;
      estimatedEndAt?: string | null;
    };
    const wasEnabled = mockMaintenance.enabled;
    const now = mockDateTime();
    const message = body.message ?? mockMaintenance.message;
    const estimatedEndAt = body.estimatedEndAt !== undefined ? body.estimatedEndAt : mockMaintenance.estimatedEndAt;

    mockMaintenance = {
      ...mockMaintenance,
      enabled: body.enabled,
      message,
      estimatedEndAt,
      startedAt: body.enabled ? now : null,
      startedByName: body.enabled ? '管理员' : null,
      updatedAt: now,
    };

    // 记录维护时段
    if (!wasEnabled && body.enabled) {
      // OFF → ON：开启新时段
      mockMaintenanceLogs.unshift({
        id: ++logIdSeq,
        message,
        estimatedEndAt,
        startedAt: now,
        startedByName: '管理员',
        endedAt: null,
        endedByName: null,
        durationSeconds: null,
        status: 'ongoing',
        createdAt: now,
      });
    } else {
      const ongoing = findOngoingLog();
      if (ongoing && wasEnabled && !body.enabled) {
        // ON → OFF：关闭时段
        ongoing.endedAt = now;
        ongoing.endedByName = '管理员';
        ongoing.durationSeconds = durationSecondsBetween(ongoing.startedAt ?? now, now);
        ongoing.status = 'completed';
      } else if (ongoing && wasEnabled && body.enabled) {
        // ON → ON：更新进行中时段
        ongoing.message = message;
        ongoing.estimatedEndAt = estimatedEndAt;
      }
    }

    return HttpResponse.json({ code: 0, message: 'success', data: mockMaintenance });
  }),
];
