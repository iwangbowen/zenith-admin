import { useQuery } from '@tanstack/react-query';
import type { ChannelDashboard } from '@zenith/shared';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

export const channelDashboardKeys = {
  all: ['channel-dashboard'] as const,
  stats: ['channel-dashboard', 'stats'] as const,
};

export function useChannelDashboard() {
  return useQuery({
    queryKey: channelDashboardKeys.stats,
    queryFn: () => request.get<ChannelDashboard>('/api/channels/dashboard').then(unwrap),
  });
}
