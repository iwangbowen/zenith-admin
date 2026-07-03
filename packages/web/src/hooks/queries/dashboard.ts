import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Announcement } from '@zenith/shared';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';
import { announcementKeys } from './announcements';

export type DashboardAnnouncement = Announcement & { isRead: boolean };

export interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  onlineUsers: number;
  todayLogins: number;
  todayOperations: number;
}

export interface LoginTrendItem {
  date: string;
  successCount: number;
  failCount: number;
}

export interface OperationTypeItem {
  module: string;
  count: number;
  fill?: string;
}

export interface UserActivityItem {
  date: string;
  activeUsers: number;
}

export interface DashboardCharts {
  loginTrend: LoginTrendItem[];
  operationTypes: OperationTypeItem[];
  userActivity: UserActivityItem[];
}

export const dashboardKeys = {
  all: ['dashboard'] as const,
  announcements: ['dashboard', 'announcements'] as const,
  announcementDetail: (id: number | undefined) => ['dashboard', 'announcements', 'detail', id] as const,
  stats: ['dashboard', 'stats'] as const,
  charts: ['dashboard', 'charts'] as const,
};

export function useDashboardAnnouncements() {
  return useQuery({
    queryKey: dashboardKeys.announcements,
    queryFn: () =>
      request.get<DashboardAnnouncement[]>('/api/announcements/published', { silent: true }).then(unwrap),
  });
}

export function useDashboardAnnouncementDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.announcementDetail(id),
    queryFn: () => request.get<Announcement>(`/api/announcements/${id}`, { silent: true }).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useDashboardStats(enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.stats,
    queryFn: () => request.get<DashboardStats>('/api/dashboard/stats', { silent: true }).then(unwrap),
    enabled,
  });
}

export function useDashboardCharts(enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.charts,
    queryFn: () => request.get<DashboardCharts>('/api/dashboard/charts', { silent: true }).then(unwrap),
    enabled,
  });
}

export function useMarkDashboardAnnouncementRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/announcements/${id}/read`, undefined, { silent: true }).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dashboardKeys.announcements });
      void qc.invalidateQueries({ queryKey: announcementKeys.my });
    },
  });
}
