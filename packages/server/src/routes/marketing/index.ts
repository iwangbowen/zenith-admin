import { marketingCampaignContract, memberMarketingContract } from '@zenith/shared/marketing';
import { defineRouteDomain } from '../_kit';
import marketingCampaignsRoutes from './marketing-campaigns';
import memberMarketingRoutes from './member-marketing';

export default defineRouteDomain({
  name: 'marketing',
  licensing: { feature: 'growth' },
  mounts: () => [
    [marketingCampaignContract.basePath, marketingCampaignsRoutes],
    [memberMarketingContract.basePath, memberMarketingRoutes],
  ],
});
