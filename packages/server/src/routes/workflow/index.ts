import {
  workflowAttachmentContract,
  workflowAutomationContract,
  workflowCategoryContract,
  workflowConnectorContract,
  workflowDataSourceContract,
  workflowDefinitionContract,
  workflowDelegationContract,
  workflowEngineContract,
  workflowEventSubscriptionContract,
  workflowExternalCallbackContract,
  workflowFormContract,
  workflowHealthContract,
  workflowInstanceContract,
  workflowQuickPhraseContract,
  workflowSavedViewContract,
  workflowScheduleContract,
  workflowSimulationCaseContract,
  workflowTemplateContract,
  workflowTriggerCallbackContract,
  workflowTriggerExecutionContract,
} from '@zenith/shared/workflow';
import { defineRouteDomain } from '../_kit';
import workflowAttachmentsRoutes from './workflow-attachments';
import workflowAutomationsRoutes from './workflow-automations';
import workflowCategoriesRoutes from './workflow-categories';
import workflowConnectorsRoutes from './workflow-connectors';
import workflowDataSourcesRoutes from './workflow-data-sources';
import workflowDefinitionsRoutes from './workflow-definitions';
import workflowDelegationsRoutes from './workflow-delegations';
import workflowEngineRoutes from './workflow-engine';
import workflowEventSubscriptionsRoutes from './workflow-event-subscriptions';
import workflowExternalCallbackRoutes from './workflow-external-callback';
import workflowFormsRoutes from './workflow-forms';
import workflowHealthRoutes from './workflow-health';
import workflowInstancesRoutes from './workflow-instances';
import workflowQuickPhrasesRoutes from './workflow-quick-phrases';
import workflowSavedViewsRoutes from './workflow-saved-views';
import workflowSchedulesRoutes from './workflow-schedules';
import workflowSimulationCasesRoutes from './workflow-simulation-cases';
import workflowTemplatesRoutes from './workflow-templates';
import workflowTriggerCallbackRoutes from './workflow-trigger-callback';
import workflowTriggerExecutionsRoutes from './workflow-trigger-executions';

// 子资源前缀先挂载，资源根路径（实例 / 任务 / 运维契约共用）最后挂载
export default defineRouteDomain({
  name: 'workflow',
  mounts: () => [
    [workflowDefinitionContract.basePath, workflowDefinitionsRoutes, { feature: 'workflow' }],
    [workflowCategoryContract.basePath, workflowCategoriesRoutes, { feature: 'workflow' }],
    [workflowFormContract.basePath, workflowFormsRoutes, { feature: 'workflow' }],
    [workflowEventSubscriptionContract.basePath, workflowEventSubscriptionsRoutes, { feature: 'workflow' }],
    [workflowTriggerExecutionContract.basePath, workflowTriggerExecutionsRoutes, { feature: 'workflow' }],
    [workflowAutomationContract.basePath, workflowAutomationsRoutes, { feature: 'workflow' }],
    [workflowScheduleContract.basePath, workflowSchedulesRoutes, { feature: 'workflow' }],
    [workflowDataSourceContract.basePath, workflowDataSourcesRoutes, { feature: 'workflow' }],
    [workflowConnectorContract.basePath, workflowConnectorsRoutes, { feature: 'workflow' }],
    [workflowSimulationCaseContract.basePath, workflowSimulationCasesRoutes, { feature: 'workflow' }],
    [workflowSavedViewContract.basePath, workflowSavedViewsRoutes, { feature: 'workflow' }],
    [workflowDelegationContract.basePath, workflowDelegationsRoutes, { feature: 'workflow' }],
    [workflowQuickPhraseContract.basePath, workflowQuickPhrasesRoutes, { feature: 'workflow' }],
    [workflowTemplateContract.basePath, workflowTemplatesRoutes, { feature: 'workflow' }],
    [workflowAttachmentContract.basePath, workflowAttachmentsRoutes, { feature: 'workflow' }],
    [workflowHealthContract.basePath, workflowHealthRoutes, { feature: 'workflow' }],
    [workflowEngineContract.basePath, workflowEngineRoutes, { feature: 'workflow' }],
    [workflowExternalCallbackContract.basePath, workflowExternalCallbackRoutes],
    [workflowTriggerCallbackContract.basePath, workflowTriggerCallbackRoutes],
    [workflowInstanceContract.basePath, workflowInstancesRoutes, { feature: 'workflow' }],
  ],
});
