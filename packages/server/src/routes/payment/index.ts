import { bizPayDemoContract } from '@zenith/shared/biz';
import { paymentWebhookContract } from '@zenith/shared/open-platform';
import {
  paymentAppContract,
  paymentCapabilityContract,
  paymentDisputeContract,
  paymentFeeRuleContract,
  paymentJournalContract,
  paymentLinkContract,
  paymentLinkPublicContract,
  paymentMethodContract,
  paymentOpsContract,
  paymentOrderContract,
  paymentPreauthContract,
  paymentReconContract,
  paymentReportContract,
  paymentRiskOpsContract,
  paymentRiskRuleContract,
  paymentSettlementContract,
  paymentSharingContract,
  paymentSigningContract,
  paymentTransferContract,
} from '@zenith/shared/payment';
import { defineRouteDomain } from '../_kit';
import bizPayDemoRoutes from './biz-pay-demo';
import paymentAppRoutes from './payment-apps';
import paymentContractRoutes from './payment-contracts';
import paymentCapabilityRoutes from './payment-capabilities';
import paymentDisputeRoutes from './payment-disputes';
import paymentFeeRoutes from './payment-fee';
import paymentJournalRoutes from './payment-journals';
import paymentLinkPublicRoutes from './payment-link-public';
import paymentLinkRoutes from './payment-links';
import paymentMethodRoutes from './payment-methods';
import paymentOpsRoutes from './payment-ops';
import paymentPreauthRoutes from './payment-preauths';
import paymentPublicRoutes from './payment-public';
import paymentReconRoutes from './payment-recon';
import paymentReportRoutes from './payment-reports';
import paymentRiskOpsRoutes from './payment-risk-ops';
import paymentRiskRoutes from './payment-risk';
import paymentRoutes from './payment';
import paymentSettlementRoutes from './payment-settlements';
import paymentSharingRoutes from './payment-sharing';
import paymentTransferRoutes from './payment-transfers';
import paymentWebhookRoutes from './payment-webhooks';

export default defineRouteDomain({
  name: 'payment',
  mounts: () => [
    [paymentCapabilityContract.basePath, paymentCapabilityRoutes, { feature: 'payment' }],
    // 商户配置 / 订单 / 退款 / 回调日志 / 统计与签约代扣共用 `/api/payment` 根：两个路由器先后挂载，顺序不可调换
    [paymentOrderContract.basePath, paymentRoutes, { feature: 'payment' }],
    [paymentReconContract.basePath, paymentReconRoutes, { feature: 'payment' }],
    [paymentWebhookContract.basePath, paymentWebhookRoutes, { feature: 'payment' }],
    [paymentJournalContract.basePath, paymentJournalRoutes, { feature: 'payment' }],
    [paymentOpsContract.basePath, paymentOpsRoutes, { feature: 'payment' }],
    [paymentFeeRuleContract.basePath, paymentFeeRoutes, { feature: 'payment' }],
    [paymentSettlementContract.basePath, paymentSettlementRoutes, { feature: 'payment' }],
    [paymentSharingContract.basePath, paymentSharingRoutes, { feature: 'payment' }],
    [paymentTransferContract.basePath, paymentTransferRoutes, { feature: 'payment' }],
    [paymentAppContract.basePath, paymentAppRoutes, { feature: 'payment' }],
    [paymentLinkContract.basePath, paymentLinkRoutes, { feature: 'payment' }],
    [paymentRiskRuleContract.basePath, paymentRiskRoutes, { feature: 'payment' }],
    [paymentMethodContract.basePath, paymentMethodRoutes, { feature: 'payment' }],
    [paymentReportContract.basePath, paymentReportRoutes, { feature: 'payment' }],
    [paymentDisputeContract.basePath, paymentDisputeRoutes, { feature: 'payment' }],
    [paymentRiskOpsContract.basePath, paymentRiskOpsRoutes, { feature: 'payment' }],
    [paymentPreauthContract.basePath, paymentPreauthRoutes, { feature: 'payment' }],
    [paymentSigningContract.basePath, paymentContractRoutes, { feature: 'payment' }],
    // 渠道异步回调返回渠道约定的纯文本 ACK，不走 JSON 契约
    ['/api/public/payment/notify', paymentPublicRoutes],
    [paymentLinkPublicContract.basePath, paymentLinkPublicRoutes],
    [bizPayDemoContract.basePath, bizPayDemoRoutes, { feature: 'payment' }],
  ],
});
