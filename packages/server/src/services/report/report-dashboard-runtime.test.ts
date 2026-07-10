import { describe, expect, it } from 'vitest';
import { applyEmbedFilterScope, compareDashboardSnapshots, ensureAccessAllowedByIp } from './report-dashboard-runtime';
import type { ReportDashboardSnapshot } from '@zenith/shared';

const left: ReportDashboardSnapshot = {
  name: '左侧',
  layout: [{ i: 'w1', x: 0, y: 0, w: 4, h: 4 }],
  canvasLayout: [],
  widgets: [{ i: 'w1', type: 'bar', title: '柱状图', datasetId: 1, options: { categoryField: 'name', valueFields: ['value'] } }],
  filters: [],
  config: { theme: 'light' },
  categoryId: null,
  remark: null,
};

const right: ReportDashboardSnapshot = {
  name: '右侧',
  layout: [{ i: 'w1', x: 0, y: 0, w: 6, h: 4 }, { i: 'w2', x: 6, y: 0, w: 6, h: 4 }],
  canvasLayout: [],
  widgets: [
    { i: 'w1', type: 'bar', title: '柱状图（新）', datasetId: 1, options: { categoryField: 'name', valueFields: ['value'] } },
    { i: 'w2', type: 'table', title: '明细表', datasetId: 2, options: { columns: [{ name: 'name', label: '名称' }] } },
  ],
  filters: [{ id: 'f1', label: '状态', type: 'select', optionSource: { kind: 'static', options: [{ value: 'enabled', label: '启用' }] } }],
  config: { theme: 'dark' },
  categoryId: 1,
  remark: 'changed',
};

describe('compareDashboardSnapshots', () => {
  it('返回组件增改与布局/筛选/config 差异', () => {
    const diff = compareDashboardSnapshots(left, right, { leftLabel: '旧', rightLabel: '新' });
    expect(diff.leftLabel).toBe('旧');
    expect(diff.rightLabel).toBe('新');
    expect(diff.widgets.added.map((item) => item.id)).toContain('w2');
    expect(diff.widgets.modified.map((item) => item.id)).toContain('w1');
    expect(diff.layoutChanged).toBe(true);
    expect(diff.filtersChanged).toBe(true);
    expect(diff.configChanged).toBe(true);
    expect(diff.metadataChanged).toBe(true);
  });
});

describe('ensureAccessAllowedByIp', () => {
  it('支持单 IP 与 CIDR 白名单', () => {
    expect(ensureAccessAllowedByIp('192.168.1.10', ['10.0.0.1'], ['192.168.1.0/24'])).toBe(true);
    expect(ensureAccessAllowedByIp('10.0.0.1', ['10.0.0.1'], [])).toBe(true);
    expect(ensureAccessAllowedByIp('172.16.0.1', ['10.0.0.1'], ['192.168.1.0/24'])).toBe(false);
  });
});

describe('applyEmbedFilterScope', () => {
  it('仅放行允许筛选并强制固定筛选值', () => {
    const scoped = applyEmbedFilterScope(
      { allowA: 'x', denyB: 'y', fixC: 'override' },
      { allowedFilterIds: ['allowA'], fixedFilters: { fixC: 'fixed' } },
    );
    expect(scoped).toEqual({ allowA: 'x', fixC: 'fixed' });
  });
});
