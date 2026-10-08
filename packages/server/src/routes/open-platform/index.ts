import {
  apiScopeContract,
  appWebhookContract,
  developerAppContract,
  oauth2AuthContract,
  oauth2ClientContract,
  openApiStatsContract,
  openGatewayContract,
  openSignatureContract,
  ratePlanContract,
} from '@zenith/shared/open-platform';
import { defineRouteDomain } from '../_kit';
import apiScopesRoutes from './api-scopes';
import appWebhooksRoutes from './app-webhooks';
import developerAppsRoutes from './developer-apps';
import oauth2AuthRoutes from './oauth2-auth';
import oauth2ClientsRoutes from './oauth2-clients';
import openApiStatsRoutes from './open-api-stats';
import openGatewayRoutes from './open-gateway';
import openSignatureRoutes from './open-signature';
import ratePlansRoutes from './rate-plans';

export default defineRouteDomain({
  name: 'open-platform',
  licensing: { feature: 'open-platform' },
  mounts: () => [
    [oauth2ClientContract.basePath, oauth2ClientsRoutes, { feature: 'open-platform' }],
    [oauth2AuthContract.basePath, oauth2AuthRoutes, { licenseExempt: 'OAuth2 授权入口保留客户端自身鉴权' }],
    [apiScopeContract.basePath, apiScopesRoutes, { feature: 'open-platform' }],
    [ratePlanContract.basePath, ratePlansRoutes, { feature: 'open-platform' }],
    [openSignatureContract.basePath, openSignatureRoutes, { feature: 'open-platform' }],
    [openApiStatsContract.basePath, openApiStatsRoutes, { feature: 'open-platform' }],
    [appWebhookContract.basePath, appWebhooksRoutes, { feature: 'open-platform' }],
    [developerAppContract.basePath, developerAppsRoutes, { feature: 'open-platform' }],
    [openGatewayContract.basePath, openGatewayRoutes, { licenseExempt: '开放网关保留应用鉴权与配额控制' }],
  ],
});
