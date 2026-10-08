import {
  analyticsCampaignContract,
  analyticsContract,
  analyticsExperimentContract,
  analyticsSiteContract,
  dashboardContract,
  frontendErrorContract,
  sessionReplayContract,
} from '@zenith/shared/analytics';
import { defineRouteDomain } from '../_kit';
import analyticsCampaignsRoutes from './analytics-campaigns';
import analyticsExperimentsRoutes from './analytics-experiments';
import analyticsRoutes from './analytics';
import analyticsSitesRoutes from './analytics-sites';
import dashboardRoutes from './dashboard';
import frontendErrorsRoutes from './frontend-errors';
import sessionReplaysRoutes from './session-replays';

export default defineRouteDomain({
  name: 'analytics',
  licensing: { feature: 'analytics' },
  mounts: () => [
    [analyticsContract.basePath, analyticsRoutes, { feature: 'analytics' }],
    [analyticsSiteContract.basePath, analyticsSitesRoutes, { feature: 'analytics' }],
    [analyticsCampaignContract.basePath, analyticsCampaignsRoutes, { feature: 'analytics' }],
    [analyticsExperimentContract.basePath, analyticsExperimentsRoutes, { feature: 'analytics' }],
    [frontendErrorContract.basePath, frontendErrorsRoutes, { licenseExempt: '前端异常监控属于基础可观测性' }],
    [sessionReplayContract.basePath, sessionReplaysRoutes, { licenseExempt: '会话回放保留现有基础监控可用性' }],
    [dashboardContract.basePath, dashboardRoutes, { licenseExempt: '首页仪表盘属于基础能力' }],
  ],
});
