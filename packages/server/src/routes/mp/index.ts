import {
  mpAccountContract,
  mpAutoReplyContract,
  mpBroadcastContract,
  mpConditionalMenuContract,
  mpDraftContract,
  mpFanContract,
  mpJsSdkContract,
  mpKfAccountContract,
  mpKfSessionContract,
  mpMaterialContract,
  mpMenuContract,
  mpMessageContract,
  mpOAuthContract,
  mpOAuthPublicContract,
  mpQrcodeContract,
  mpSecurityContract,
  mpStatsContract,
  mpTagContract,
  mpTemplateContract,
} from '@zenith/shared/mp';
import { defineRouteDomain } from '../_kit';
import mpAccountsRoutes from './mp-accounts';
import mpAutoRepliesRoutes from './mp-auto-replies';
import mpBroadcastsRoutes from './mp-broadcasts';
import mpCallbackRoutes from './mp-callback';
import mpConditionalMenuRoutes from './mp-conditional-menus';
import mpDraftsRoutes from './mp-drafts';
import mpFansRoutes from './mp-fans';
import mpJsSdkRoutes from './mp-jssdk';
import mpKfRoutes from './mp-kf';
import mpKfSessionRoutes from './mp-kf-sessions';
import mpMaterialsRoutes from './mp-materials';
import mpMenuRoutes from './mp-menu';
import mpMessagesRoutes from './mp-messages';
import mpOAuthPublicRoutes from './mp-oauth-public';
import mpOAuthRoutes from './mp-oauth';
import mpQrcodesRoutes from './mp-qrcodes';
import mpSecurityRoutes from './mp-security';
import mpStatsRoutes from './mp-stats';
import mpTagsRoutes from './mp-tags';
import mpTemplatesRoutes from './mp-templates';

export default defineRouteDomain({
  name: 'mp',
  mounts: () => [
    // 微信服务器回调按渠道协议返回 XML / 纯文本 ACK，不走 JSON 契约
    ['/api/public/mp/callback', mpCallbackRoutes],
    [mpOAuthPublicContract.basePath, mpOAuthPublicRoutes],
    [mpAccountContract.basePath, mpAccountsRoutes, { feature: 'mp' }],
    [mpTagContract.basePath, mpTagsRoutes, { feature: 'mp' }],
    [mpFanContract.basePath, mpFansRoutes, { feature: 'mp' }],
    [mpMessageContract.basePath, mpMessagesRoutes, { feature: 'mp' }],
    [mpAutoReplyContract.basePath, mpAutoRepliesRoutes, { feature: 'mp' }],
    [mpMenuContract.basePath, mpMenuRoutes, { feature: 'mp' }],
    [mpMaterialContract.basePath, mpMaterialsRoutes, { feature: 'mp' }],
    [mpDraftContract.basePath, mpDraftsRoutes, { feature: 'mp' }],
    [mpTemplateContract.basePath, mpTemplatesRoutes, { feature: 'mp' }],
    [mpStatsContract.basePath, mpStatsRoutes, { feature: 'mp' }],
    [mpBroadcastContract.basePath, mpBroadcastsRoutes, { feature: 'mp' }],
    [mpQrcodeContract.basePath, mpQrcodesRoutes, { feature: 'mp' }],
    [mpOAuthContract.basePath, mpOAuthRoutes, { feature: 'mp' }],
    [mpKfAccountContract.basePath, mpKfRoutes, { feature: 'mp' }],
    [mpKfSessionContract.basePath, mpKfSessionRoutes, { feature: 'mp' }],
    [mpConditionalMenuContract.basePath, mpConditionalMenuRoutes, { feature: 'mp' }],
    [mpSecurityContract.basePath, mpSecurityRoutes, { feature: 'mp' }],
    [mpJsSdkContract.basePath, mpJsSdkRoutes, { feature: 'mp' }],
  ],
});
