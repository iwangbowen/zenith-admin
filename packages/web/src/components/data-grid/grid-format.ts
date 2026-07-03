import { formatDateTime } from '@/utils/date';

/** 单元格类型分类（驱动渲染 / 对齐 / 编辑器选择） */
export type CellKind =
  | 'bool'
  | 'int'
  | 'number'
  | 'json'
  | 'datetime'
  | 'date'
  | 'time'
  | 'uuid'
  | 'text';

/** 从 PG 数据类型串推断单元格类型 */
export function columnKind(dataType?: string): CellKind {
  if (!dataType) return 'text';
  const t = dataType.toLowerCase();
  if (t === 'boolean') return 'bool';
  if (/^(small|big)?int|^integer$|^serial|^smallserial|^bigserial/.test(t)) return 'int';
  if (/numeric|decimal|real|double|money/.test(t)) return 'number';
  if (/jsonb?$/.test(t)) return 'json';
  if (/^timestamp/.test(t)) return 'datetime';
  if (t === 'date') return 'date';
  if (/^time/.test(t)) return 'time';
  if (t === 'uuid') return 'uuid';
  return 'text';
}

/** 数字类右对齐 */
export function isNumericKind(kind: CellKind): boolean {
  return kind === 'int' || kind === 'number';
}

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

const TYPE_SHORT_NAMES: Record<string, string> = {
  'character varying': 'varchar',
  'timestamp without time zone': 'timestamp',
  'timestamp with time zone': 'timestamptz',
  'time without time zone': 'time',
  'time with time zone': 'timetz',
  'double precision': 'float8',
};

/** 表头类型徽标的缩写形式 */
export function shortTypeName(dataType: string): string {
  const t = dataType.toLowerCase();
  return TYPE_SHORT_NAMES[t] ?? dataType;
}

/**
 * 单元格显示串（表格内单行展示；不含 NULL —— NULL 由渲染层单独处理样式）。
 */
export function displayValue(v: unknown, kind: CellKind): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (kind === 'datetime') {
    if (v instanceof Date) return formatDateTime(v);
    if (typeof v === 'string' && ISO_DATETIME_RE.test(v)) return formatDateTime(v);
  }
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint') return v.toString();
  return JSON.stringify(v);
}

/**
 * 复制串（写剪贴板 / TSV / CSV 单元格值）。
 * 约定：NULL → 空串；对象 → 紧凑 JSON；日期时间 → 统一格式。
 */
export function copyValue(v: unknown, kind: CellKind = 'text'): string {
  if (v === null || v === undefined) return '';
  return displayValue(v, kind);
}

/** 超过该长度视为长文本（详情角标 + 截断） */
export const LONG_TEXT_THRESHOLD = 120;

/** 是否值得展示详情角标（长文本 / JSON 对象） */
export function hasDetail(v: unknown, kind: CellKind): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'object') return true;
  if (kind === 'json') return true;
  return typeof v === 'string' && v.length > LONG_TEXT_THRESHOLD;
}

const IMAGE_URL_RE = /^(https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?\S*)?|data:image\/[a-z+.-]+;base64,[\w+/=]+)$/i;

/** 值是否为可预览的图片地址 */
export function isImageUrl(v: unknown): v is string {
  return typeof v === 'string' && v.length < 4096 && IMAGE_URL_RE.test(v.trim());
}
