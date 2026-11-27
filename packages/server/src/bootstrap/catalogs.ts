/** Role-independent application composition. Registries are complete before ingress starts. */
import { registerImportDefinitions } from './import-definitions';
import { registerExportDefinitions } from './export-definitions';
import { registerJobSources } from './job-monitor-sources';
import { sealImportRegistry } from '../lib/import-center/registry';
import { sealExportRegistry } from '../lib/export-center/registry';
import { sealJobSourceRegistry } from '../lib/job-monitor/registry';

import { registerWorkflowIntegrations } from './workflow-business-adapters';
import { registerAccessTaskHandlers } from '../services/identity/access-tasks';
import { cmsPublishingTaskScopedWhere } from '../services/cms/cms-publishing-access';
import { cmsPublishingAction } from '../services/cms/cms-publishing.service';
import { registerCmsPublishingTaskPolicy } from '../services/tasks/public/access';

let declared = false;

export function declareApplicationCatalogs(): void {
  if (declared) return;
  registerWorkflowIntegrations();
  registerAccessTaskHandlers();
  registerCmsPublishingTaskPolicy({ where: cmsPublishingTaskScopedWhere, retry: cmsPublishingAction });
  registerImportDefinitions();
  registerExportDefinitions();
  registerJobSources();
  sealImportRegistry();
  sealExportRegistry();
  sealJobSourceRegistry();
  declared = true;
}
