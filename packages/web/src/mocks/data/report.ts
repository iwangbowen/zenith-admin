/**
 * 报表中心 Demo Mock 数据。
 * 数据源 / 数据集 / 仪表盘直接复用 @zenith/shared 的 SEED_REPORT_* 常量（深拷贝，避免污染种子）。
 * 由于 Demo 无后端数据库，数据集取数返回「按 datasetId 预置」的静态结果，供图表/大屏渲染。
 */
import {
  SEED_REPORT_DATASOURCES, SEED_REPORT_DATASETS, SEED_REPORT_DASHBOARDS,
} from '@zenith/shared';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';
import type {
  ReportDatasource, ReportDataset, ReportDashboard, ReportDataResult,
  ReportDashboardCategory, ReportAlertRule, ReportPrintTemplate, ReportDashboardSubscription,
  ReportDashboardComment, ReportDashboardVersion, ReportDashboardShare,
} from '@zenith/shared';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const mockReportDatasources: ReportDatasource[] = clone(SEED_REPORT_DATASOURCES);
export const mockReportDatasets: ReportDataset[] = clone(SEED_REPORT_DATASETS);
export const mockReportDashboards: ReportDashboard[] = clone(SEED_REPORT_DASHBOARDS);

/** 按 datasetId 预置的静态取数结果（Demo 离线渲染用） */
export const mockReportDataByDataset: Record<number, ReportDataResult> = {
  1: {
    columns: ['name', 'value'],
    rows: [
      { name: '菜单', value: 24 },
      { name: '目录', value: 9 },
      { name: '按钮', value: 53 },
    ],
    total: 3,
  },
  2: {
    columns: ['name', 'value'],
    rows: [
      { name: '研发部', value: 28 },
      { name: '产品部', value: 16 },
      { name: '市场部', value: 13 },
      { name: '运营部', value: 11 },
      { name: '财务部', value: 7 },
      { name: '人事部', value: 5 },
    ],
    total: 6,
  },
};

/** 取某数据集的预置结果（缺省回落空集） */
export function getMockDatasetData(datasetId: number | null | undefined): ReportDataResult {
  if (datasetId && mockReportDataByDataset[datasetId]) return clone(mockReportDataByDataset[datasetId]);
  return { columns: [], rows: [], total: 0 };
}

/** 组装某仪表盘的「组件 id → 取数结果」映射 */
export function buildDashboardData(dashboard: ReportDashboard): Record<string, ReportDataResult> {
  const out: Record<string, ReportDataResult> = {};
  for (const w of dashboard.widgets ?? []) {
    if (w.datasetId) out[w.i] = getMockDatasetData(w.datasetId);
  }
  return out;
}

export const mockReportCategories: ReportDashboardCategory[] = [
  { id: 1, name: '运营分析', sort: 1, remark: '运营核心看板', createdAt: mockDateTime(), updatedAt: mockDateTime() },
  { id: 2, name: '系统监控', sort: 2, remark: null, createdAt: mockDateTime(), updatedAt: mockDateTime() },
];

export const mockReportAlerts: ReportAlertRule[] = [
  {
    id: 1, name: '菜单总数异常预警', datasetId: 1, datasetName: '菜单类型分布', field: 'value', groupByField: null, aggregate: 'sum',
    op: 'gt', threshold: 200, cron: '0 9 * * *', channels: ['inApp'], recipients: null, webhookUrl: null,
    silenceMins: 60, notifyOnRecover: false, enabled: true,
    lastCheckedAt: mockDateTimeOffset(-3600000), lastTriggered: false, lastValue: 86, lastNotifiedAt: null, remark: '示例预警规则',
    createdBy: 1, createdAt: mockDateTime(), updatedAt: mockDateTime(),
  },
];

export const mockReportPrintTemplates: ReportPrintTemplate[] = [
  {
    id: 1, name: '部门人数清单', datasetId: 2, datasetName: '部门用户榜',
    content: {
      grid: {
        rows: 3, cols: 2, colWidths: [200, 120],
        cells: [
          { row: 0, col: 0, v: '部门人数清单', s: { bold: true, align: 'center' } },
          { row: 1, col: 0, v: '${name}' },
          { row: 1, col: 1, v: '${value}' },
          { row: 2, col: 0, v: '合计', s: { bold: true } },
          { row: 2, col: 1, v: '${SUM(value)}' },
        ],
        merges: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }],
      },
    },
    params: [], pageConfig: { paper: 'A4', orientation: 'portrait', header: '${name} 报表', footer: '第 {page}/{pages} 页' },
    status: 'enabled', remark: '示例打印模板', createdBy: 1, updatedBy: 1, createdAt: mockDateTime(), updatedAt: mockDateTime(),
  },
];

export const mockReportSubscriptions: ReportDashboardSubscription[] = [
  {
    id: 1, dashboardId: 1, dashboardName: '示例仪表盘', cron: '0 8 * * 1', channels: ['email'],
    recipients: 'ops@example.com', webhookUrl: null, enabled: true, remark: '每周一早 8 点推送', lastRunAt: mockDateTimeOffset(-86400000),
    createdBy: 1, createdAt: mockDateTime(), updatedAt: mockDateTime(),
  },
];

export const mockReportComments: ReportDashboardComment[] = [
  { id: 1, dashboardId: 1, widgetId: null, content: '这个看板很直观，建议加个环比。', userId: 1, userName: '管理员', userAvatar: null, createdAt: mockDateTimeOffset(-7200000) },
];

export const mockReportVersions: ReportDashboardVersion[] = [];
export const mockReportShares: ReportDashboardShare[] = [];

let dsId = 100; export const getNextReportDatasourceId = () => ++dsId;
let dsetId = 100; export const getNextReportDatasetId = () => ++dsetId;
let dashId = 100; export const getNextReportDashboardId = () => ++dashId;
let catId = 100; export const getNextReportCategoryId = () => ++catId;
let alertId = 100; export const getNextReportAlertId = () => ++alertId;
let printId = 100; export const getNextReportPrintId = () => ++printId;
let subId = 100; export const getNextReportSubscriptionId = () => ++subId;
let commentId = 100; export const getNextReportCommentId = () => ++commentId;
let versionId = 100; export const getNextReportVersionId = () => ++versionId;
let shareId = 100; export const getNextReportShareId = () => ++shareId;
