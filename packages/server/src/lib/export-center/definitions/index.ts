import { registerExport } from '../registry';
import { usersExportDefinition } from './users';
import { reportDatasetExportDefinition } from './report-dataset';
import { reportPrintExportDefinition } from './report-print';
import { legacyExportDefinitions } from './legacy';

let registered = false;

export function registerExportDefinitions(): void {
  if (registered) return;
  registerExport(usersExportDefinition as unknown as Parameters<typeof registerExport>[0]);
  registerExport(reportDatasetExportDefinition as unknown as Parameters<typeof registerExport>[0]);
  registerExport(reportPrintExportDefinition as unknown as Parameters<typeof registerExport>[0]);
  for (const definition of legacyExportDefinitions) {
    registerExport(definition);
  }
  registered = true;
}
