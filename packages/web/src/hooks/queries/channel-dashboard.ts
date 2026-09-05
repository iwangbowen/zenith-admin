import { channelDashboardContract } from '@zenith/shared/messaging';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export const channelDashboardKeys = {
  stats: contractKey(channelDashboardContract.dashboard),
};

export function useChannelDashboard() {
  return useApiQuery(channelDashboardContract.dashboard);
}
