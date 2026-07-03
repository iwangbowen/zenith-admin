import { useQuery } from '@tanstack/react-query';
import type { ReportDashboard } from '@zenith/shared';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

export const reportEmbedKeys = {
  all: ['reports', 'embed'] as const,
  dashboard: (dashboardId: number | undefined) => ['reports', 'embed', 'dashboard', dashboardId] as const,
};

export function useReportEmbedDashboard(dashboardId: number | undefined) {
  return useQuery({
    queryKey: reportEmbedKeys.dashboard(dashboardId),
    queryFn: () => request.get<ReportDashboard>(`/api/report/dashboards/${dashboardId}`, { silent: true }).then(unwrap),
    enabled: !!dashboardId,
  });
}
