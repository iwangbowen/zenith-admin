import { http, HttpResponse } from 'msw';
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

export const maintenanceHandlers = [
  // GET /api/maintenance/status — public
  http.get(`${API}/api/maintenance/status`, () => {
    return HttpResponse.json({ code: 0, message: 'success', data: mockMaintenance });
  }),

  // GET /api/maintenance — admin
  http.get(`${API}/api/maintenance`, () => {
    return HttpResponse.json({ code: 0, message: 'success', data: mockMaintenance });
  }),

  // PUT /api/maintenance — admin
  http.put(`${API}/api/maintenance`, async ({ request }) => {
    const body = await request.json() as {
      enabled: boolean;
      message?: string;
      estimatedEndAt?: string | null;
    };
    mockMaintenance = {
      ...mockMaintenance,
      enabled: body.enabled,
      message: body.message ?? mockMaintenance.message,
      estimatedEndAt: body.estimatedEndAt !== undefined ? body.estimatedEndAt : mockMaintenance.estimatedEndAt,
      startedAt: body.enabled ? mockDateTime() : null,
      startedByName: body.enabled ? '管理员' : null,
      updatedAt: mockDateTime(),
    };
    return HttpResponse.json({ code: 0, message: 'success', data: mockMaintenance });
  }),
];
