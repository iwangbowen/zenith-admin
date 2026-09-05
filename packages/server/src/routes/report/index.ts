import {
  reportAiContract,
  reportAlertContract,
  reportAssetContract,
  reportCategoryContract,
  reportChatbiContract,
  reportDashboardContract,
  reportDashboardOpsContract,
  reportDatasetContract,
  reportDatasourceContract,
  reportDeliveryRunContract,
  reportDqContract,
  reportEnvironmentContract,
  reportExecutionContract,
  reportFillContract,
  reportFolderContract,
  reportGovernanceContract,
  reportMaterializationContract,
  reportMetaContract,
  reportMetricContract,
  reportPrintContract,
  reportPublicContract,
  reportQueryCapacityContract,
  reportSlaContract,
  reportSubscriptionContract,
} from '@zenith/shared/report';
import { defineRouteDomain } from '../_kit';
import reportAiRoutes from './report-ai';
import reportAlertsRoutes from './report-alerts';
import reportAssetsRoutes from './report-assets';
import reportCategoriesRoutes from './report-categories';
import reportChatbiRoutes from './report-chatbi';
import reportDashboardOpsRoutes from './report-dashboard-ops';
import reportDashboardsRoutes from './report-dashboards';
import reportDatasetsRoutes from './report-datasets';
import reportDatasourcesRoutes from './report-datasources';
import reportDeliveryRunsRoutes from './report-delivery-runs';
import reportDqRoutes from './report-dq';
import reportEnvironmentsRoutes from './report-environments';
import reportExecutionsRoutes from './report-executions';
import reportFillRoutes from './report-fill';
import reportFoldersRoutes from './report-folders';
import reportGovernanceRoutes from './report-governance';
import reportMaterializationsRoutes from './report-materializations';
import reportMetaRoutes from './report-meta';
import reportMetricsRoutes from './report-metrics';
import reportPrintRoutes from './report-print';
import reportPublicRoutes from './report-public';
import reportQueryCapacityRoutes from './report-query-capacity';
import reportSlaRoutes from './report-sla';
import reportSubscriptionsRoutes from './report-subscriptions';

export default defineRouteDomain({
  name: 'report',
  mounts: () => [
    [reportDatasourceContract.basePath, reportDatasourcesRoutes, { feature: 'report' }],
    [reportDatasetContract.basePath, reportDatasetsRoutes, { feature: 'report' }],
    // 仪表盘 CRUD 与运维操作共用资源根路径，注册顺序即匹配顺序
    [reportDashboardContract.basePath, reportDashboardsRoutes, { feature: 'report' }],
    [reportDashboardOpsContract.basePath, reportDashboardOpsRoutes, { feature: 'report' }],
    [reportCategoryContract.basePath, reportCategoriesRoutes, { feature: 'report' }],
    [reportSubscriptionContract.basePath, reportSubscriptionsRoutes, { feature: 'report' }],
    [reportPublicContract.basePath, reportPublicRoutes],
    [reportPrintContract.basePath, reportPrintRoutes, { feature: 'report' }],
    [reportAiContract.basePath, reportAiRoutes, { feature: 'report' }],
    [reportAlertContract.basePath, reportAlertsRoutes, { feature: 'report' }],
    [reportFolderContract.basePath, reportFoldersRoutes, { feature: 'report' }],
    [reportMetricContract.basePath, reportMetricsRoutes, { feature: 'report' }],
    [reportGovernanceContract.basePath, reportGovernanceRoutes, { feature: 'report' }],
    [reportEnvironmentContract.basePath, reportEnvironmentsRoutes, { feature: 'report' }],
    [reportMetaContract.basePath, reportMetaRoutes, { feature: 'report' }],
    [reportExecutionContract.basePath, reportExecutionsRoutes, { feature: 'report' }],
    [reportDeliveryRunContract.basePath, reportDeliveryRunsRoutes, { feature: 'report' }],
    [reportDqContract.basePath, reportDqRoutes, { feature: 'report' }],
    [reportMaterializationContract.basePath, reportMaterializationsRoutes, { feature: 'report' }],
    [reportQueryCapacityContract.basePath, reportQueryCapacityRoutes, { feature: 'report' }],
    [reportSlaContract.basePath, reportSlaRoutes, { feature: 'report' }],
    [reportAssetContract.basePath, reportAssetsRoutes, { feature: 'report' }],
    [reportChatbiContract.basePath, reportChatbiRoutes, { feature: 'report' }],
    [reportFillContract.basePath, reportFillRoutes, { feature: 'report' }],
  ],
});
