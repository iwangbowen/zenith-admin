import { expect, it } from 'vitest';
import { resolveExportPreset } from './export-configuration';
const preview = { formats: ['xlsx', 'csv'] as const, columns: [{ key: 'id', header: 'ID' }, { key: 'name', header: '名称' }], supportsColumns: true };
it('preserves chosen field order while keeping entry point format restrictions', () => {
  expect(resolveExportPreset({ format: 'csv', columns: ['name', 'id'] }, { ...preview, formats: [...preview.formats] }, ['csv'])).toEqual({ format: 'csv', columns: ['name', 'id'] });
  expect(() => resolveExportPreset({ format: 'csv', columns: ['id'] }, { ...preview, formats: [...preview.formats] }, ['xlsx'])).toThrow('文件格式');
});
it('rejects missing template fields instead of silently dropping them', () => {
  expect(() => resolveExportPreset({ format: 'csv', columns: ['deleted', 'id'] }, { ...preview, formats: [...preview.formats] }, ['csv'])).toThrow('失效');
  expect(() => resolveExportPreset({ format: 'csv', columns: ['id', 'id'] }, { ...preview, formats: [...preview.formats] }, ['csv'])).toThrow('重复字段');
});
