import { describe, expect, it } from 'vitest';
import { declareApplicationCatalogs } from './catalogs';
import { getImportDefinition, registerImport } from '../lib/import-center/registry';
import { getExportDefinition, listExportDefinitions, registerExport } from '../lib/export-center/registry';
import { getJobSource, listJobSources, registerJobSource } from '../lib/job-monitor/registry';
import { getTaskHandler } from '../lib/task-center/registry';

describe('role-independent application catalogs', () => {
  it('declares worker import/export and monitor capabilities without loading HTTP routes', () => {
    declareApplicationCatalogs();
    expect(getImportDefinition('identity.users').entity).toBe('identity.users');
    expect(getExportDefinition('system.users').entity).toBe('system.users');
    expect(listExportDefinitions().length).toBeGreaterThan(50);
    expect(getTaskHandler('data-import')).toBeDefined();
    expect(getTaskHandler('identity-access-grant-apply')).toBeDefined();
    expect(getTaskHandler('identity-access-review-build')).toBeDefined();
    expect(getJobSource('async-task')).toBeDefined();
    expect(listJobSources().length).toBeGreaterThan(15);
  });

  it('is repeatable at composition level and rejects mutation after freezing', () => {
    declareApplicationCatalogs();
    const exports = listExportDefinitions().length;
    const sources = listJobSources().length;
    declareApplicationCatalogs();
    expect(listExportDefinitions()).toHaveLength(exports);
    expect(listJobSources()).toHaveLength(sources);
    expect(() => registerExport(getExportDefinition('system.users'))).toThrow('冻结');
    expect(() => registerImport(getImportDefinition('identity.users'))).toThrow('冻结');
    expect(() => registerJobSource(getJobSource('async-task')!)).toThrow('冻结');
  });
});
