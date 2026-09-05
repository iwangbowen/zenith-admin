import {
  cmsAdContract,
  cmsChannelContract,
  cmsCollectContract,
  cmsCommentContract,
  cmsContentContract,
  cmsDashboardContract,
  cmsDistributionContract,
  cmsErrorProneWordContract,
  cmsFormContract,
  cmsFriendLinkContract,
  cmsInteractionContract,
  cmsModelContract,
  cmsPageContract,
  cmsPublishingContract,
  cmsResourceContract,
  cmsSearchContract,
  cmsSensitiveWordContract,
  cmsSeoContract,
  cmsSiteContract,
  cmsStatContract,
  cmsStaticContract,
  cmsSubscriptionContract,
  cmsTagContract,
  cmsUploadContract,
  cmsWidgetContract,
  publicCmsContract,
} from '@zenith/shared/cms';
import { defineRouteDomain } from '../_kit';
import cmsAdsRoutes from './ads';
import cmsChannelsRoutes from './channels';
import cmsCollectRoutes from './collect';
import cmsCommentsRoutes from './comments';
import cmsContentsRoutes from './contents';
import cmsDashboardRoutes from './dashboard';
import cmsDistributionRoutes from './distributions';
import cmsErrorProneWordsRoutes from './error-prone-words';
import cmsFormsRoutes from './forms';
import cmsFriendLinksRoutes from './friend-links';
import cmsInteractionsRoutes from './interactions';
import cmsModelsRoutes from './models';
import cmsPagesRoutes from './pages';
import cmsPublishingRoutes from './publishing';
import cmsResourcesRoutes from './resources';
import cmsSearchRoutes from './search';
import cmsSensitiveWordsRoutes from './sensitive-words';
import cmsSeoRoutes from './seo';
import cmsSitesRoutes from './sites';
import cmsStaticRoutes from './static';
import cmsStatsRoutes from './stats';
import cmsSubscriptionsRoutes from './subscriptions';
import cmsTagsRoutes from './tags';
import cmsUploadRoutes from './upload';
import cmsWidgetsRoutes from './widgets';
import { createCmsFrontPublicRoutes } from './front-public';
import { createCmsFrontendRoutes } from './frontend';

export default defineRouteDomain({
  name: 'cms',
  mounts: () => [
    [cmsSiteContract.basePath, cmsSitesRoutes, { feature: 'cms' }],
    [cmsModelContract.basePath, cmsModelsRoutes, { feature: 'cms' }],
    [cmsChannelContract.basePath, cmsChannelsRoutes, { feature: 'cms' }],
    [cmsContentContract.basePath, cmsContentsRoutes, { feature: 'cms' }],
    [cmsTagContract.basePath, cmsTagsRoutes, { feature: 'cms' }],
    [cmsFriendLinkContract.basePath, cmsFriendLinksRoutes, { feature: 'cms' }],
    [cmsStaticContract.basePath, cmsStaticRoutes, { feature: 'cms' }],
    [cmsSearchContract.basePath, cmsSearchRoutes, { feature: 'cms' }],
    [cmsSeoContract.basePath, cmsSeoRoutes, { feature: 'cms' }],
    [cmsCommentContract.basePath, cmsCommentsRoutes, { feature: 'cms' }],
    [cmsAdContract.basePath, cmsAdsRoutes, { feature: 'cms' }],
    [cmsFormContract.basePath, cmsFormsRoutes, { feature: 'cms' }],
    [cmsSensitiveWordContract.basePath, cmsSensitiveWordsRoutes, { feature: 'cms' }],
    [cmsErrorProneWordContract.basePath, cmsErrorProneWordsRoutes, { feature: 'cms' }],
    [cmsInteractionContract.basePath, cmsInteractionsRoutes, { feature: 'cms' }],
    [cmsStatContract.basePath, cmsStatsRoutes, { feature: 'cms' }],
    [cmsCollectContract.basePath, cmsCollectRoutes, { feature: 'cms' }],
    [cmsPageContract.basePath, cmsPagesRoutes, { feature: 'cms' }],
    [cmsWidgetContract.basePath, cmsWidgetsRoutes, { feature: 'cms' }],
    [cmsDashboardContract.basePath, cmsDashboardRoutes, { feature: 'cms' }],
    [cmsPublishingContract.basePath, cmsPublishingRoutes, { feature: 'cms' }],
    [cmsDistributionContract.basePath, cmsDistributionRoutes, { feature: 'cms' }],
    [cmsResourceContract.basePath, cmsResourcesRoutes, { feature: 'cms' }],
    [cmsSubscriptionContract.basePath, cmsSubscriptionsRoutes, { feature: 'cms' }],
    // 站点级上传入口挂在各子资源之后，避免资源根前缀抢先匹配
    [cmsUploadContract.basePath, cmsUploadRoutes, { feature: 'cms' }],
    [publicCmsContract.basePath, createCmsFrontPublicRoutes()],
  ],
  // 在全部域的 mounts 之后兜底注册
  fallback: () => [
    ['/', createCmsFrontendRoutes()],
  ],
});
