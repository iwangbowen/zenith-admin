import { describe, expect, it } from 'vitest';
import type { CmsThemePackageManifest } from '@zenith/shared';
import type { CmsTemplateRow } from '../../db/schema';
import { packageTemplateOptions, resolvePackageTemplateEntry } from './cms-template-resolution.service';
import { mapCmsTemplate } from './cms-templates.service';

const manifest: CmsThemePackageManifest = {
  schemaVersion: 2,
  code: 'review-theme',
  name: 'Review Theme',
  version: '1.0.0',
  engine: { min: 2, max: 2 },
  templates: [
    { code: 'news-list', name: 'News List', type: 'list', path: 'templates/list.json' },
    { code: 'news-detail', name: 'News Detail', type: 'detail', path: 'templates/detail.json' },
  ],
  assets: [],
  checksums: {
    'templates/list.json': 'a'.repeat(64),
    'templates/detail.json': 'b'.repeat(64),
  },
  signingKeyId: 'test',
  signature: 'x'.repeat(64),
};

describe('CMS template resolution single source of truth', () => {
  it('uses the same manifest entries for selector availability and runtime resolution', () => {
    const pkg = { manifest };
    const listOptions = packageTemplateOptions(pkg, 'list');
    expect(listOptions).toEqual([{ name: 'news-list', label: 'News List' }]);
    for (const option of listOptions) {
      expect(resolvePackageTemplateEntry(pkg, 'list', option.name)?.code).toBe(option.name);
    }
    expect(resolvePackageTemplateEntry(pkg, 'list', 'missing')).toBeNull();
    expect(resolvePackageTemplateEntry(pkg, 'detail', 'news-detail')?.code).toBe('news-detail');
  });

  it('projects package template activity only from the effective deployment version', () => {
    const row = {
      id: 3,
      siteId: null,
      themeCode: 'review-theme',
      type: 'list',
      code: 'news-list',
      name: 'News List',
      source: 'package',
      status: 'enabled',
      currentVersion: 4,
      activeVersion: 4,
      lifecycleRevision: 0,
      description: null,
      createdBy: null,
      updatedBy: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    } satisfies CmsTemplateRow;
    expect(mapCmsTemplate(row)).toMatchObject({ status: 'disabled', activeVersion: null });
    expect(mapCmsTemplate(row, 2, 'Active Package Name')).toMatchObject({
      name: 'Active Package Name',
      status: 'enabled',
      activeVersion: 2,
    });
  });
});
