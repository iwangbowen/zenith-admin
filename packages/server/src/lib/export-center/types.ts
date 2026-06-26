import type ExcelJS from 'exceljs';
import type { JwtPayload } from '../../middleware/auth';

export type ExportFormat = 'xlsx' | 'csv';
export type ExportRequestMode = 'sync' | 'async' | 'auto';
export type ExportExecutionMode = 'sync' | 'async';
export type ExportRenderMode = 'table' | 'layout' | 'custom';
export type ExportColumnType = 'string' | 'number' | 'datetime' | 'date' | 'enum' | 'money' | 'boolean';

export interface ExportExecutionPolicy {
  mode: ExportRequestMode;
  syncMaxRows: number;
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
  sensitive?: boolean;
  maskEntity?: string;
  maskField?: string;
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
}

export interface ExportDefinition<
  TQuery extends Record<string, unknown> = Record<string, unknown>,
  TRow extends Record<string, unknown> = Record<string, unknown>,
> {
  entity: string;
  moduleName: string;
  filenamePrefix: string;
  formats?: ExportFormat[];
  renderMode?: ExportRenderMode;
  sheetName?: string;
  permissions: ExportPermissions;
  execution?: Partial<ExportExecutionPolicy>;
  retention?: Partial<ExportRetentionPolicy>;
  columns: ExportColumn<TRow>[];
  styles?: ExportStyleSet;
  layout?: ExportLayout<TRow>;
  countRows: (query: TQuery, user: JwtPayload) => Promise<number>;
  streamRows: (
    query: TQuery,
    user: JwtPayload,
    ctx: ExportRuntimeContext<TQuery>,
  ) => AsyncIterable<TRow> | Iterable<TRow> | Promise<AsyncIterable<TRow> | Iterable<TRow>>;
  renderWorkbook?: (workbook: ExcelJS.Workbook, ctx: ExportRuntimeContext<TQuery>) => Promise<void>;
}

export type AnyExportDefinition = ExportDefinition<Record<string, unknown>, Record<string, unknown>>;

export const DEFAULT_EXPORT_EXECUTION: ExportExecutionPolicy = {
  mode: 'sync',
  syncMaxRows: 5000,
  forceAsyncWhenSensitive: false,
  forceAsyncWhenRaw: false,
  syncModeOverridesAsyncPolicies: true,
};

export const DEFAULT_EXPORT_RETENTION: ExportRetentionPolicy = {
  normalDays: 7,
  sensitiveDays: 3,
  rawDays: 1,
};
