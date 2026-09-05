import type { ReportAssetTemplate, ReportDashboard, ReportDataset, ReportDatasource, ReportDqRule, ReportEnvironment, ReportFillTemplate, ReportFolder, ReportMetric, ReportPrintTemplate, ReportQueryQuota, ReportSlaRule } from '../report/contracts';
import { SEED_DATE } from './_base';

// ─── 报表中心：示例数据源 / 数据集 / 仪表盘 ─────────────────────────────────────
export const SEED_REPORT_DATASOURCES: ReportDatasource[] = [
  { id: 1, name: '内置主库', type: 'sql', config: { connection: 'internal' }, status: 'enabled', remark: '应用 PostgreSQL 主库（只读）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '静态数据', type: 'static', config: {}, status: 'enabled', remark: '静态/文件数据集容器（JSON / Excel / CSV 上传）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_REPORT_DATASETS: ReportDataset[] = [
  {
    id: 1,
    name: '菜单类型分布',
    datasourceId: 1,
    type: 'sql',
    content: { sql: "SELECT type AS name, count(*)::int AS value FROM menus WHERE (${mstatus} = '' OR status::text = ${mstatus}) GROUP BY type ORDER BY value DESC" },
    fields: [
      { name: 'name', label: '类型', type: 'string' },
      { name: 'value', label: '数量', type: 'number' },
    ],
    params: [
      { name: 'mstatus', label: '菜单状态', type: 'string', defaultValue: '' },
    ],
    computedFields: [],
    cacheTtl: 0,
    status: 'enabled',
    remark: '示例：按类型统计菜单数量',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 2,
    name: '部门用户榜',
    datasourceId: 1,
    type: 'sql',
    content: { sql: 'SELECT d.name AS name, count(u.id)::int AS value FROM departments d LEFT JOIN users u ON u.department_id = d.id GROUP BY d.name ORDER BY value DESC LIMIT 20' },
    fields: [
      { name: 'name', label: '部门', type: 'string' },
      { name: 'value', label: '人数', type: 'number' },
    ],
    params: [],
    computedFields: [],
    cacheTtl: 30,
    status: 'enabled',
    remark: '示例：各部门用户数排行（大屏滚动榜单数据源）',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  // ─── 行为中心阶段 1：报表中心接入（复用内置主库，租户视角安全）────────────────
  {
    id: 3,
    name: '行为事件趋势',
    datasourceId: 1,
    type: 'sql',
    content: {
      sql: "SELECT to_char(timezone('Asia/Shanghai', created_at), 'YYYY-MM-DD') AS name, count(*)::int AS value FROM user_events WHERE created_at >= now() - (${days}::int * INTERVAL '1 day') AND (${__tenantId}::int IS NULL OR tenant_id = ${__tenantId}) GROUP BY 1 ORDER BY 1",
    },
    fields: [
      { name: 'name', label: '日期', type: 'string' },
      { name: 'value', label: '事件数', type: 'number' },
    ],
    params: [
      { name: 'days', label: '统计天数', type: 'number', defaultValue: 30 },
    ],
    computedFields: [],
    cacheTtl: 60,
    status: 'enabled',
    remark: '行为中心：按天统计埋点事件量趋势（平台超管不选租户时看全平台，选定租户/普通租户用户仅看本租户）',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 4,
    name: '行为事件来源分布',
    datasourceId: 1,
    type: 'sql',
    content: {
      sql: "SELECT source AS name, count(*)::int AS value FROM user_events WHERE created_at >= now() - (${days}::int * INTERVAL '1 day') AND (${__tenantId}::int IS NULL OR tenant_id = ${__tenantId}) GROUP BY source ORDER BY value DESC",
    },
    fields: [
      { name: 'name', label: '来源', type: 'string' },
      { name: 'value', label: '事件数', type: 'number' },
    ],
    params: [
      { name: 'days', label: '统计天数', type: 'number', defaultValue: 30 },
    ],
    computedFields: [],
    cacheTtl: 60,
    status: 'enabled',
    remark: '行为中心：按来源（web_admin/web_member/server）统计埋点事件占比',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 5,
    name: '埋点质量趋势',
    datasourceId: 1,
    type: 'sql',
    content: {
      sql: "SELECT to_char(stat_date, 'YYYY-MM-DD') AS name, sum(count)::int AS value FROM analytics_event_quality_daily WHERE stat_date >= (now() - (${days}::int * INTERVAL '1 day'))::date AND (${__tenantId}::int IS NULL OR tenant_id = ${__tenantId}) GROUP BY 1 ORDER BY 1",
    },
    fields: [
      { name: 'name', label: '日期', type: 'string' },
      { name: 'value', label: '问题事件数', type: 'number' },
    ],
    params: [
      { name: 'days', label: '统计天数', type: 'number', defaultValue: 30 },
    ],
    computedFields: [],
    cacheTtl: 60,
    status: 'enabled',
    remark: '行为中心：埋点质量日聚合问题事件量趋势（缺失必填/类型不符/非法枚举/事件已停用）',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

export const SEED_REPORT_DASHBOARDS: ReportDashboard[] = [
  {
    id: 1,
    name: '示例仪表盘',
    layout: [
      { i: 'w1', x: 0, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
      { i: 'w2', x: 3, y: 0, w: 5, h: 6, minW: 2, minH: 2 },
      { i: 'w3', x: 8, y: 0, w: 4, h: 6, minW: 2, minH: 2 },
    ],
    canvasLayout: [],
    widgets: [
      { i: 'w1', type: 'kpi', title: '菜单总数', datasetId: 1, options: { valueField: 'value', aggregate: 'sum', unit: '个' }, paramBindings: [{ filterId: 'f_status', param: 'mstatus' }] },
      { i: 'w2', type: 'bar', title: '菜单类型分布', datasetId: 1, options: { categoryField: 'name', valueFields: ['value'] }, paramBindings: [{ filterId: 'f_status', param: 'mstatus' }] },
      { i: 'w3', type: 'pie', title: '类型占比', datasetId: 1, options: { categoryField: 'name', valueFields: ['value'] }, paramBindings: [{ filterId: 'f_status', param: 'mstatus' }] },
    ],
    filters: [
      { id: 'f_status', label: '菜单状态', type: 'select', defaultValue: '', optionSource: { kind: 'static', options: [{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }] } },
    ],
    config: { theme: 'light' },
    status: 'enabled',
    lifecycleStatus: 'published',
    revision: 1,
    publishedSnapshot: {
      name: '示例仪表盘',
      layout: [
        { i: 'w1', x: 0, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
        { i: 'w2', x: 3, y: 0, w: 5, h: 6, minW: 2, minH: 2 },
        { i: 'w3', x: 8, y: 0, w: 4, h: 6, minW: 2, minH: 2 },
      ],
      canvasLayout: [],
      widgets: [
        { i: 'w1', type: 'kpi', title: '菜单总数', datasetId: 1, options: { valueField: 'value', aggregate: 'sum', unit: '个' }, paramBindings: [{ filterId: 'f_status', param: 'mstatus' }] },
        { i: 'w2', type: 'bar', title: '菜单类型分布', datasetId: 1, options: { categoryField: 'name', valueFields: ['value'] }, paramBindings: [{ filterId: 'f_status', param: 'mstatus' }] },
        { i: 'w3', type: 'pie', title: '类型占比', datasetId: 1, options: { categoryField: 'name', valueFields: ['value'] }, paramBindings: [{ filterId: 'f_status', param: 'mstatus' }] },
      ],
      filters: [
        { id: 'f_status', label: '菜单状态', type: 'select', defaultValue: '', optionSource: { kind: 'static', options: [{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }] } },
      ],
      config: { theme: 'light' },
      categoryId: null,
      remark: '内置示例，可直接编辑或删除',
    },
    publishedAt: SEED_DATE,
    publishedBy: 1,
    publishedByName: '系统',
    remark: '内置示例，可直接编辑或删除',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 2,
    name: '运营数据大屏',
    layout: [
      { i: 's1', x: 0, y: 0, w: 4, h: 3 },
      { i: 's2', x: 0, y: 3, w: 4, h: 6 },
      { i: 's3', x: 4, y: 3, w: 4, h: 6 },
      { i: 's4', x: 8, y: 0, w: 4, h: 9 },
    ],
    canvasLayout: [
      { i: 's1', x: 40, y: 40, w: 560, h: 180, z: 1 },
      { i: 's2', x: 40, y: 250, w: 560, h: 360, z: 1 },
      { i: 's3', x: 640, y: 250, w: 560, h: 360, z: 1 },
      { i: 's4', x: 1240, y: 40, w: 640, h: 570, z: 1 },
    ],
    widgets: [
      { i: 's1', type: 'flipper', title: '菜单总数', datasetId: 1, options: { valueField: 'value', aggregate: 'sum', unit: '个', flipDigits: 4 } },
      { i: 's2', type: 'bar', title: '菜单类型分布', datasetId: 1, options: { categoryField: 'name', valueFields: ['value'] } },
      { i: 's3', type: 'pie', title: '类型占比', datasetId: 1, options: { categoryField: 'name', valueFields: ['value'] } },
      { i: 's4', type: 'scrollList', title: '部门用户榜', datasetId: 2, options: { categoryField: 'name', valueFields: ['value'], showRank: true, scrollSpeed: 1 } },
    ],
    filters: [],
    config: { theme: 'dark', layoutMode: 'canvas', screenConfig: { width: 1920, height: 1080, scaleMode: 'fit', background: '#0a1330' }, refreshInterval: 30 },
    status: 'enabled',
    lifecycleStatus: 'published',
    revision: 1,
    publishedSnapshot: {
      name: '运营数据大屏',
      layout: [
        { i: 's1', x: 0, y: 0, w: 4, h: 3 },
        { i: 's2', x: 0, y: 3, w: 4, h: 6 },
        { i: 's3', x: 4, y: 3, w: 4, h: 6 },
        { i: 's4', x: 8, y: 0, w: 4, h: 9 },
      ],
      canvasLayout: [
        { i: 's1', x: 40, y: 40, w: 560, h: 180, z: 1 },
        { i: 's2', x: 40, y: 250, w: 560, h: 360, z: 1 },
        { i: 's3', x: 640, y: 250, w: 560, h: 360, z: 1 },
        { i: 's4', x: 1240, y: 40, w: 640, h: 570, z: 1 },
      ],
      widgets: [
        { i: 's1', type: 'flipper', title: '菜单总数', datasetId: 1, options: { valueField: 'value', aggregate: 'sum', unit: '个', flipDigits: 4 } },
        { i: 's2', type: 'bar', title: '菜单类型分布', datasetId: 1, options: { categoryField: 'name', valueFields: ['value'] } },
        { i: 's3', type: 'pie', title: '类型占比', datasetId: 1, options: { categoryField: 'name', valueFields: ['value'] } },
        { i: 's4', type: 'scrollList', title: '部门用户榜', datasetId: 2, options: { categoryField: 'name', valueFields: ['value'], showRank: true, scrollSpeed: 1 } },
      ],
      filters: [],
      config: { theme: 'dark', layoutMode: 'canvas', screenConfig: { width: 1920, height: 1080, scaleMode: 'fit', background: '#0a1330' }, refreshInterval: 30 },
      categoryId: null,
      remark: '内置大屏示例：自由画布 + 深色科技皮肤 + 翻牌器/滚动榜单',
    },
    publishedAt: SEED_DATE,
    publishedBy: 1,
    publishedByName: '系统',
    remark: '内置大屏示例：自由画布 + 深色科技皮肤 + 翻牌器/滚动榜单',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 3,
    name: '行为分析概览',
    layout: [
      { i: 'a1', x: 0, y: 0, w: 12, h: 6, minW: 4, minH: 3 },
      { i: 'a2', x: 0, y: 6, w: 6, h: 6, minW: 3, minH: 3 },
      { i: 'a3', x: 6, y: 6, w: 6, h: 6, minW: 3, minH: 3 },
    ],
    canvasLayout: [],
    widgets: [
      { i: 'a1', type: 'line', title: '行为事件趋势', datasetId: 3, options: { categoryField: 'name', valueFields: ['value'] } },
      { i: 'a2', type: 'bar', title: '事件来源分布', datasetId: 4, options: { categoryField: 'name', valueFields: ['value'] } },
      { i: 'a3', type: 'line', title: '埋点质量趋势', datasetId: 5, options: { categoryField: 'name', valueFields: ['value'] } },
    ],
    filters: [],
    config: { theme: 'light' },
    status: 'enabled',
    lifecycleStatus: 'published',
    revision: 1,
    publishedSnapshot: {
      name: '行为分析概览',
      layout: [
        { i: 'a1', x: 0, y: 0, w: 12, h: 6, minW: 4, minH: 3 },
        { i: 'a2', x: 0, y: 6, w: 6, h: 6, minW: 3, minH: 3 },
        { i: 'a3', x: 6, y: 6, w: 6, h: 6, minW: 3, minH: 3 },
      ],
      canvasLayout: [],
      widgets: [
        { i: 'a1', type: 'line', title: '行为事件趋势', datasetId: 3, options: { categoryField: 'name', valueFields: ['value'] } },
        { i: 'a2', type: 'bar', title: '事件来源分布', datasetId: 4, options: { categoryField: 'name', valueFields: ['value'] } },
        { i: 'a3', type: 'line', title: '埋点质量趋势', datasetId: 5, options: { categoryField: 'name', valueFields: ['value'] } },
      ],
      filters: [],
      config: { theme: 'light' },
      categoryId: null,
      remark: '行为中心阶段 1：内置看板，绑定事件趋势/来源分布/质量趋势 3 个数据集，直接获得分享/订阅能力',
    },
    publishedAt: SEED_DATE,
    publishedBy: 1,
    publishedByName: '系统',
    remark: '行为中心阶段 1：内置看板，绑定事件趋势/来源分布/质量趋势 3 个数据集，直接获得分享/订阅能力',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

export const SEED_REPORT_PRINT_TEMPLATES: ReportPrintTemplate[] = [
  {
    id: 1,
    name: '部门用户统计表',
    datasetId: 2,
    content: {
      grid: {
        rows: 4,
        cols: 2,
        colWidths: [220, 120],
        cells: [
          { row: 0, col: 0, v: '部门用户统计表', s: { bold: true, fontSize: 16, align: 'center' } },
          { row: 1, col: 0, v: '部门', s: { bold: true, align: 'center', border: true, background: '#f0f0f0' } },
          { row: 1, col: 1, v: '人数', s: { bold: true, align: 'center', border: true, background: '#f0f0f0' } },
          { row: 2, col: 0, v: '${name}', s: { border: true } },
          { row: 2, col: 1, v: '${value}', s: { border: true, align: 'right' } },
          { row: 3, col: 0, v: '合计', s: { bold: true, border: true } },
          { row: 3, col: 1, v: '${SUM(value)}', s: { bold: true, border: true, align: 'right' } },
        ],
        merges: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }],
      },
    },
    params: [],
    pageConfig: { paper: 'A4', orientation: 'portrait', margin: { top: 20, right: 20, bottom: 20, left: 20 }, header: '部门用户统计', footer: '第 {page} 页 / 共 {pages} 页' },
    status: 'enabled',
    remark: '内置示例：表头 + 明细纵向扩展 + 合计行（${SUM}），可直接预览/打印/导出',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

// ─── 报表中心 P2：治理、质量、容量、资产与填报基线 ─────────────────────────────
export const SEED_REPORT_FOLDERS: ReportFolder[] = [
  { id: 1, tenantId: null, parentId: null, name: '示例数据源', resourceType: 'datasource', ownerId: 1, sort: 10, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, tenantId: null, parentId: null, name: '示例数据集', resourceType: 'dataset', ownerId: 1, sort: 20, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, tenantId: null, parentId: null, name: '示例仪表盘', resourceType: 'dashboard', ownerId: 1, sort: 30, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, tenantId: null, parentId: null, name: '语义指标', resourceType: 'metric', ownerId: 1, sort: 40, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5, tenantId: null, parentId: null, name: '打印模板', resourceType: 'print_template', ownerId: 1, sort: 50, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 6, tenantId: null, parentId: null, name: '资产模板', resourceType: 'asset_template', ownerId: 1, sort: 60, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 7, tenantId: null, parentId: null, name: '填报模板', resourceType: 'fill_template', ownerId: 1, sort: 70, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_REPORT_ENVIRONMENTS: ReportEnvironment[] = [
  { id: 1, tenantId: null, code: 'dev', name: '开发环境', kind: 'development', description: '报表资源开发与联调环境', baseUrl: null, config: {}, isDefault: true, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, tenantId: null, code: 'staging', name: '预发布环境', kind: 'staging', description: '发布审批后的验收环境', baseUrl: null, config: {}, isDefault: false, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, tenantId: null, code: 'prod', name: '生产环境', kind: 'production', description: '仅允许审批通过的版本发布', baseUrl: null, config: {}, isDefault: false, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_REPORT_METRICS: ReportMetric[] = [
  {
    id: 1,
    tenantId: null,
    folderId: 4,
    ownerId: 1,
    code: 'department_user_total',
    name: '部门用户总数',
    description: '基于部门用户榜数据集汇总各部门用户数量',
    type: 'simple',
    datasetId: 2,
    sourceField: 'value',
    formula: null,
    aggregate: 'sum',
    dimensions: ['name'],
    timeField: null,
    unit: '人',
    format: '#,##0',
    caliber: '按当前数据集筛选条件汇总 value 字段；不包含已删除用户。',
    lifecycleStatus: 'published',
    revision: 1,
    publishedSnapshot: {
      code: 'department_user_total',
      name: '部门用户总数',
      type: 'simple',
      datasetId: 2,
      sourceField: 'value',
      aggregate: 'sum',
      dimensions: ['name'],
      unit: '人',
      format: '#,##0',
    },
    publishedAt: SEED_DATE,
    publishedBy: 1,
    deprecatedAt: null,
    deprecatedBy: null,
    deprecationReason: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

export const SEED_REPORT_DQ_RULES: ReportDqRule[] = [
  {
    id: 1, tenantId: null, datasetId: 2, name: '部门名称不能为空', type: 'not_null',
    field: 'name', severity: 'high', config: {}, cron: '0 7 * * *', timezone: 'Asia/Shanghai',
    enabled: true, lastRunAt: null, lastStatus: null, createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 2, tenantId: null, datasetId: 2, name: '部门榜至少包含一行', type: 'row_count',
    field: null, severity: 'medium', config: { minRows: 1 }, cron: null, timezone: 'Asia/Shanghai',
    enabled: true, lastRunAt: null, lastStatus: null, createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

/** 数值 0 表示对应日配额不限；仍保留并发上限保护数据库。 */
export const SEED_REPORT_QUERY_QUOTAS: ReportQueryQuota[] = [
  {
    id: 1, tenantId: null, scope: 'tenant', userId: null, maxConcurrent: 20,
    dailyQueryLimit: 0, dailyRowLimit: 0, dailyByteLimit: 0, dailyCostLimit: 0,
    resetTimezone: 'Asia/Shanghai', enabled: true, createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_REPORT_SLA_RULES: ReportSlaRule[] = [
  {
    id: 1, tenantId: null, datasetId: 2, name: '部门用户榜质量分',
    type: 'dq_score', targetValue: 95, warningValue: 98, windowMinutes: 1440,
    cron: '15 7 * * *', timezone: 'Asia/Shanghai', severity: 'high', channels: ['inApp'],
    recipients: null, webhookUrl: null, silenceMins: 120, enabled: true,
    lastEvaluatedAt: null, lastNotifiedAt: null, createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_REPORT_ASSET_TEMPLATES: ReportAssetTemplate[] = [
  {
    id: 1, tenantId: null, folderId: 6, ownerId: 1, code: 'standard_analysis_dashboard',
    name: '标准分析仪表盘', type: 'dashboard', description: '带筛选区的空白分析仪表盘，可复用后绑定数据集。',
    content: {
      layout: [],
      canvasLayout: [],
      widgets: [],
      filters: [],
      config: { theme: 'light', refreshInterval: 0 },
      status: 'enabled',
      remark: '由报表资产模板创建',
    },
    previewFileId: null, version: 1, usageCount: 0, status: 'enabled',
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_REPORT_FILL_TEMPLATES: ReportFillTemplate[] = [
  {
    id: 1,
    tenantId: null,
    folderId: 7,
    ownerId: 1,
    code: 'monthly_operation_fill',
    name: '月度运营数据填报',
    description: '示例填报模板：提交后进入人工审核，通过后同步到生成数据集。',
    formSchema: {
      fields: [
        { key: 'period', label: '统计月份', type: 'date', dateFormat: 'YYYY-MM', required: true },
        { key: 'department', label: '部门', type: 'text', required: true, maxLength: 64 },
        { key: 'activeUsers', label: '活跃用户数', type: 'number', required: true, min: 0, precision: 0, unit: '人' },
        { key: 'revenue', label: '营业收入', type: 'amount', required: true, min: 0, precision: 2, currency: 'CNY', unit: '元' },
        { key: 'remark', label: '备注', type: 'textarea', required: false, maxLength: 500 },
      ],
      settings: {
        description: '请按月填报运营数据。审核通过后数据会异步同步到报表数据集。',
        submitButtonText: '提交审核',
        labelPosition: 'left',
        labelWidth: 96,
      },
    },
    publishedSchema: {
      fields: [
        { key: 'period', label: '统计月份', type: 'date', dateFormat: 'YYYY-MM', required: true },
        { key: 'department', label: '部门', type: 'text', required: true, maxLength: 64 },
        { key: 'activeUsers', label: '活跃用户数', type: 'number', required: true, min: 0, precision: 0, unit: '人' },
        { key: 'revenue', label: '营业收入', type: 'amount', required: true, min: 0, precision: 2, currency: 'CNY', unit: '元' },
        { key: 'remark', label: '备注', type: 'textarea', required: false, maxLength: 500 },
      ],
      settings: {
        description: '请按月填报运营数据。审核通过后数据会异步同步到报表数据集。',
        submitButtonText: '提交审核',
        labelPosition: 'left',
        labelWidth: 96,
      },
    },
    publishedRevision: 1,
    workflowDefinitionId: null,
    needReview: true,
    generatedDatasetId: null,
    status: 'published',
    revision: 1,
    publishedAt: SEED_DATE,
    publishedBy: 1,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];
