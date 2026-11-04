/** Role-independent application composition. Registries are complete before ingress starts. */
import { registerImportDefinitions } from './import-definitions';
import { registerExportDefinitions } from './export-definitions';
import { registerJobSources } from './job-monitor-sources';
import { sealImportRegistry } from '../lib/import-center/registry';
import { sealExportRegistry } from '../lib/export-center/registry';
import { sealJobSourceRegistry } from '../lib/job-monitor/registry';

let declared = false;

export function declareApplicationCatalogs(): void {
  if (declared) return;
  registerImportDefinitions();
  registerExportDefinitions();
  registerJobSources();
  sealImportRegistry();
  sealExportRegistry();
  sealJobSourceRegistry();
  declared = true;
}
