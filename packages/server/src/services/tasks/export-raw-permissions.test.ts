import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnyExportDefinition } from '../../lib/export-center/types';
import type { JwtPayload } from '../../middleware/auth';

const permissionMock = vi.hoisted(() => ({
  values: [] as string[],
  get: vi.fn(),
}));

vi.mock('../../lib/permissions', () => ({
  getUserPermissions: permissionMock.get,
  isSuperAdmin: vi.fn(() => false),
}));

import { assertExportPermission, resolveExecutionMode } from './export-jobs.service';

const user = {
  userId: 8,
  username: 'cms-operator',
  roles: ['cms_operator'],
  tenantId: null,
} as JwtPayload;

function definition(exportPermission: string, rawPermission: string): AnyExportDefinition {
  return {
    entity: 'test',
    moduleName: 'CMS',
    filenamePrefix: 'test',
    sheetName: 'test',
    formats: ['csv'],
    columns: [],
    permissions: {
      export: exportPermission,
      exportRaw: rawPermission,
      requireExportRawPermission: true,
    },
    countRows: async () => 0,
    streamRows: async () => [],
  } as AnyExportDefinition;
}

describe('CMS raw export permissions', () => {
  beforeEach(() => {
    permissionMock.values = [];
    permissionMock.get.mockImplementation(async () => permissionMock.values);
  });

  it.each([
    ['cms:ad-event:export', 'cms:ad-event:export-raw'],
    ['cms:interaction:export', 'cms:interaction:export-raw'],
    ['cms:subscription:export', 'cms:subscription:export-raw'],
  ])('does not let ordinary %s holders request raw data', async (normal, raw) => {
    permissionMock.values = [normal];
    await expect(assertExportPermission(definition(normal, raw), false, user)).resolves.toBeUndefined();
    await expect(assertExportPermission(definition(normal, raw), true, user))
      .rejects.toMatchObject({ status: 403 });
    permissionMock.values.push(raw);
    await expect(assertExportPermission(definition(normal, raw), true, user)).resolves.toBeUndefined();
  });
});

it('fails closed when sensitive export has no raw permission configured', async () => {
  permissionMock.values = ['test:export'];
  const d = definition('test:export', 'test:raw');
  d.permissions = { export: 'test:export' };
  d.columns = [{ key: 'phone', header: 'Phone', sensitive: true }];
  await expect(assertExportPermission(d, true, user)).rejects.toMatchObject({ status: 403 });
  await expect(assertExportPermission(d, false, user)).resolves.toBeUndefined();
});

it('server budget overrides explicit sync and entity auto stays authoritative', () => {
  const d = definition('test', 'test:raw');
  d.execution = { mode: 'auto', syncMaxRows: 10, maxRows: 50000 };
  expect(resolveExecutionMode('sync', 11, false, false, d)).toBe('async');
  expect(resolveExecutionMode(undefined, 5, false, false, d)).toBe('sync');
  d.execution = { ...d.execution, mode: 'async' };
  expect(resolveExecutionMode('sync', 1, false, false, d)).toBe('async');
});
