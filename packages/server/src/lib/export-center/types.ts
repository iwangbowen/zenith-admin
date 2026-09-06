import type ExcelJS from 'exceljs';
import type { ExportJobFormat } from '@zenith/shared/tasks';
import type { JwtPayload } from '../../middleware/auth';
import type { MaskType, CustomMaskRule } from '../masking';

export type ExportFormat = ExportJobFormat;
export type ExportRequestMode = 'sync' | 'async' | 'auto';
export type ExportExecutionMode = 'sync' | 'async';
export type ExportRenderMode = 'table' | 'layout' | 'custom';
export type ExportColumnType = 'string' | 'number' | 'datetime' | 'date' | 'enum' | 'money' | 'boolean';

export interface ExportExecutionPolicy {
  mode: ExportRequestMode;
  syncMaxRows: number;
  /**
   * 导出行数绝对上限（sync / async 通用）。exceljs `writeBuffer()` 对整本 workbook 的
   * 终局序列化是主线程连续 CPU 段，CSV 也是全量内存累积——上限封住无界输入。
   * 提交时按 `countRows()` 快速失败；countRows 不准或恒为 0 的 legacy 定义由
   * writer 渲染循环的行数兜底拦截（ExportRuntimeContext.rowLimit）。
   */
  maxRows: number;
  forceAsyncWhenSensitive: boolean;
  forceAsyncWhenRaw: boolean;
  syncModeOverridesAsyncPolicies: boolean;
}

export interface ExportRetentionPolicy {
  normalDays: number;
  sensitiveDays: number;
  rawDays: number;
}

export interface ExportPermissions {
  export: string;
  exportRaw?: string;
  requireExportRawPermission?: boolean;
  manageJobs?: string;
  tenantManageJobs?: string;
}

export interface ExportStyleSet {
  title?: Partial<ExcelJS.Style>;
  meta?: Partial<ExcelJS.Style>;
  header?: Partial<ExcelJS.Style>;
  body?: Partial<ExcelJS.Style>;
  summary?: Partial<ExcelJS.Style>;
}

export interface ExportColumn<TRow extends Record<string, unknown> = Record<string, unknown>> {
  key?: keyof TRow & string;
  header: string;
  width?: number;
  type?: ExportColumnType;
  enumMap?: Record<string, string>;
  /**
   * 敏感列：脱敏导出（`masked=true`）时打码。
   * - `true`：按 `maskKey` 命中数据脱敏中心的生效策略；未绑定时按字段名推断内置类型
   * - 直接给脱敏类型（`'phone'`）：无策略绑定，固定按该类型打码
   */
  sensitive?: boolean | MaskType;
  /**
   * 绑定契约敏感字段（`entity.field`，如 `User.phone`）：脱敏导出按数据脱敏中心对该字段的
   * 生效策略打码（类型 / 自定义规则 / 停用），与页面展示同一口径
   */
  maskKey?: string;
  style?: Partial<ExcelJS.Style>;
  headerStyle?: Partial<ExcelJS.Style>;
  transform?: (value: unknown, row: TRow) => unknown;
  children?: ExportColumn<TRow>[];
}

export interface ExportLayoutSheet<TRow extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  title?: {
    text: string;
    merge?: string;
    style?: Partial<ExcelJS.Style>;
  };
  metaRows?: Array<Array<string>>;
  table?: {
    startRow?: number;
    columns?: ExportColumn<TRow>[];
    freezeHeader?: boolean;
    autoFilter?: boolean;
  };
}

export interface ExportLayout<TRow extends Record<string, unknown> = Record<string, unknown>> {
  sheets: ExportLayoutSheet<TRow>[];
}

export interface ExportMaskRule {
  maskType: MaskType;
  customRule?: CustomMaskRule | null;
}

export interface ExportRuntimeContext<TQuery extends Record<string, unknown> = Record<string, unknown>> {
  jobId: number;
  entity: string;
  moduleName: string;
  format: ExportFormat;
  query: TQuery;
  selectedColumns: string[] | null;
  raw: boolean;
  masked: boolean;
  sensitive: boolean;
  watermark: boolean;
  currentUser: JwtPayload;
  createdByName: string | null;
  exportedAt: Date;
  /**
   * 脱敏导出时预加载的规则映射（key: `entity.field`，即契约敏感字段键）。
   * `masked=true` 时由导出任务执行器注入；敏感列渲染时按 `maskKey` 匹配生效策略打码，
   * 未绑定策略的敏感列按声明类型或字段名回退到内置脱敏。
   */
  maskRules?: Map<string, ExportMaskRule> | null;
  /** 渲染阶段行数兜底上限（来自执行策略 maxRows）；写入行数超过即中止任务 */
  rowLimit?: number | null;
}

export interface ExportRenderedFile {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
  /**
   * 实际写入文件的数据行数（不含表头）。用于导出任务完成后回写 `row_count`，
   * 使导出中心「进度」列显示真实行数。`null` 表示无法确定（前端显示「已完成」）。
   */
  rowCount?: number | null;
}

export interface ExportDefinition<
  TQuery extends Record<string, unknown> = Record<string, unknown>,
  TRow extends Record<string, unknown> = Record<string, unknown>,
> {
  entity: string;
  moduleName: string;
  filenamePrefix: string;
  sourcePath?: string;
  formats?: ExportFormat[];
  renderMode?: ExportRenderMode;
  sheetName?: string;
  permissions: ExportPermissions;
  execution?: Partial<ExportExecutionPolicy>;
  retention?: Partial<ExportRetentionPolicy>;
  columns: ExportColumn<TRow>[];
  /**
   * 动态列解析钩子（可选）。用于列结构在运行时才能确定的导出（如报表数据集）。
   * 提供后，writer 渲染时调用它替代静态 `columns`，xlsx / csv 均可用。
   */
  resolveColumns?: (query: TQuery, user: JwtPayload) => Promise<ExportColumn<TRow>[]> | ExportColumn<TRow>[];
  styles?: ExportStyleSet;
  layout?: ExportLayout<TRow>;
  countRows: (query: TQuery, user: JwtPayload) => Promise<number>;
  streamRows: (
    query: TQuery,
    user: JwtPayload,
    ctx: ExportRuntimeContext<TQuery>,
  ) => AsyncIterable<TRow> | Iterable<TRow> | Promise<AsyncIterable<TRow> | Iterable<TRow>>;
  renderFile?: (ctx: ExportRuntimeContext<TQuery>) => Promise<ExportRenderedFile>;
  renderWorkbook?: (workbook: ExcelJS.Workbook, ctx: ExportRuntimeContext<TQuery>) => Promise<void>;
}

export type AnyExportDefinition = ExportDefinition<Record<string, unknown>, Record<string, unknown>>;

export const DEFAULT_EXPORT_EXECUTION: ExportExecutionPolicy = {
  mode: 'sync',
  syncMaxRows: 5000,
  maxRows: 50_000,
  forceAsyncWhenSensitive: false,
  forceAsyncWhenRaw: false,
  syncModeOverridesAsyncPolicies: true,
};

export const DEFAULT_EXPORT_RETENTION: ExportRetentionPolicy = {
  normalDays: 7,
  sensitiveDays: 3,
  rawDays: 1,
};
