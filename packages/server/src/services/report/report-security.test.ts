import { describe, expect, it } from 'vitest';
import { runWithCurrentUser } from '../../lib/context';
import { resolveEffectiveRowRules } from './report-dataset.service';
import { assertPublicDashboardProjection, minimizePublicData } from './report-ops.service';
import {
  maskReportSecret,
  prepareReportSecret,
  REPORT_SECRET_MASK,
  resolveReportSecret,
} from './report-secrets';
import type { JwtPayload } from '../../middleware/auth';
import type { ReportWidget, ReportWidgetDataResult } from '@zenith/shared';

const user = (userId: number, roles: string[] = ['viewer']): JwtPayload => ({
  userId,
  username: `u${userId}`,
  roles,
  tenantId: 1,
});

describe('report row-level security', () => {
  it('fails closed when no rule matches the current user', async () => {
    const rules = await runWithCurrentUser(user(1), () =>
      resolveEffectiveRowRules([{ roles: ['finance'], where: 'dept_id = 1' }]));
    expect(rules).toMatchObject([{ where: '1 = 0' }]);
  });

  it('keeps matching rules and rejects missing execution identity', async () => {
    const rules = await runWithCurrentUser(user(1, ['finance']), () =>
      resolveEffectiveRowRules([{ roles: ['finance'], where: 'dept_id = 1' }]));
    expect(rules).toMatchObject([{ where: 'dept_id = 1' }]);
    expect(() => resolveEffectiveRowRules([{ where: 'dept_id = 1' }])).toThrow();
  });
});

describe('public report projection', () => {
  const result: ReportWidgetDataResult = {
    data: {
      columns: ['name', 'value', 'secret'],
      fields: [
        { name: 'name', label: 'Name', type: 'string' },
        { name: 'value', label: 'Value', type: 'number' },
        { name: 'secret', label: 'Secret', type: 'string' },
      ],
      rows: [{ name: 'A', value: 1, secret: 'hidden' }],
      total: 1,
    },
    error: null,
    durationMs: 5,
    cacheHit: false,
  };

  it('keeps only explicitly referenced chart fields', () => {
    const widgets: ReportWidget[] = [{
      i: 'w1',
      type: 'bar',
      title: 'Chart',
      datasetId: 1,
      options: { categoryField: 'name', valueFields: ['value'] },
    }];
    expect(minimizePublicData(widgets, { w1: result }).w1).toEqual({
      data: {
        columns: ['name', 'value'],
        fields: [
          { name: 'name', label: 'Name', type: 'string' },
          { name: 'value', label: 'Value', type: 'number' },
        ],
        rows: [{ name: 'A', value: 1 }],
        total: 1,
      },
      error: null,
      durationMs: 5,
      cacheHit: false,
    });
  });

  it('returns no columns instead of failing open for an unconfigured table', () => {
    const widgets: ReportWidget[] = [{
      i: 'w1',
      type: 'table',
      title: 'Table',
      datasetId: 1,
      options: {},
    }];
    expect(minimizePublicData(widgets, { w1: result }).w1).toEqual({
      data: { columns: [], fields: [], rows: [{}], total: 1 },
      error: null,
      durationMs: 5,
      cacheHit: false,
    });
    expect(() => assertPublicDashboardProjection(widgets)).toThrow();
  });
});

describe('report secret storage', () => {
  it('encrypts stored webhook values and masks API output', () => {
    const encrypted = prepareReportSecret('https://example.com/hook', null);
    expect(encrypted).toBeTypeOf('string');
    expect(encrypted).not.toBe('https://example.com/hook');
    expect(resolveReportSecret(encrypted)).toBe('https://example.com/hook');
    expect(maskReportSecret(encrypted)).toBe(REPORT_SECRET_MASK);
    expect(prepareReportSecret(REPORT_SECRET_MASK, encrypted)).toBe(encrypted);
  });
});
