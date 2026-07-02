import { formatDateTime } from '@/utils/date';
import type { CellKind } from './grid-format';

/** 编辑提交时的类型转换结果 */
export type CoercionResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const INT_RE = /^-?\d+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/;

/** 编辑器初始文本（借鉴 dbx dataGridCellEditorText：null → 空串） */
export function editorTextForValue(value: unknown, kind: CellKind): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    return kind === 'json' ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  }
  if (kind === 'datetime') {
    if (value instanceof Date) return formatDateTime(value);
    if (typeof value === 'string' && DATETIME_RE.test(value)) return formatDateTime(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/**
 * 智能弯引号标准化（借鉴 dbx：macOS/中文输入法会把 JSON 引号打成弯引号）。
 */
export function normalizeSmartQuotes(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code === 0x201c || code === 0x201d || code === 0x201e || code === 0x201f || code === 0xff02) {
      out += '"';
    } else if (code === 0x2018 || code === 0x2019) {
      out += "'";
    } else {
      out += ch;
    }
  }
  return out;
}

export interface CoerceOptions {
  kind: CellKind;
  /** 原始值：用于「空串 + 原值 null → 保持 null」语义 */
  original: unknown;
  nullable?: boolean;
}

/**
 * 编辑文本 → 类型化值（借鉴 dbx coerceDataGridCellValue）：
 * - 输入 NULL（不区分大小写）→ null
 * - 空串：原值为 null 或列可空 → null；非空列报错
 * - 数字/布尔/JSON/日期时间做类型校验，失败返回错误而非静默落库
 */
export function coerceCellInput(text: string, opts: CoerceOptions): CoercionResult {
  const { kind, original, nullable } = opts;

  if (text.toUpperCase() === 'NULL') {
    if (nullable === false) return { ok: false, error: '该列不允许为 NULL' };
    return { ok: true, value: null };
  }
  if (text === '') {
    if (original === null || original === undefined) return { ok: true, value: null };
    if (kind === 'text' || kind === 'uuid') return { ok: true, value: '' };
    if (nullable === false) return { ok: false, error: '该列不允许为空' };
    return { ok: true, value: null };
  }

  switch (kind) {
    case 'int': {
      const trimmed = text.trim();
      if (!INT_RE.test(trimmed)) return { ok: false, error: '请输入整数' };
      const n = Number(trimmed);
      // 超出 JS 安全整数范围：保留字符串，由 PG cast（防精度丢失，借鉴 dbx 过滤器策略）
      if (Math.abs(n) > MAX_SAFE) return { ok: true, value: trimmed };
      return { ok: true, value: n };
    }
    case 'number': {
      const n = Number(text.trim());
      if (Number.isNaN(n) || !Number.isFinite(n)) return { ok: false, error: '请输入数字' };
      return { ok: true, value: n };
    }
    case 'bool': {
      const t = text.trim().toLowerCase();
      if (t === 'true' || t === '1' || t === 't' || t === 'yes') return { ok: true, value: true };
      if (t === 'false' || t === '0' || t === 'f' || t === 'no') return { ok: true, value: false };
      return { ok: false, error: '请输入 true / false' };
    }
    case 'json': {
      const normalized = normalizeSmartQuotes(text);
      try {
        return { ok: true, value: JSON.parse(normalized) };
      } catch (e) {
        return { ok: false, error: `JSON 无效：${e instanceof Error ? e.message : String(e)}` };
      }
    }
    case 'date': {
      const t = text.trim();
      if (!DATE_RE.test(t)) return { ok: false, error: '格式应为 YYYY-MM-DD' };
      return { ok: true, value: t };
    }
    case 'time': {
      const t = text.trim();
      if (!TIME_RE.test(t)) return { ok: false, error: '格式应为 HH:mm:ss' };
      return { ok: true, value: t.length === 5 ? `${t}:00` : t };
    }
    case 'datetime': {
      const t = text.trim().replace('T', ' ');
      if (!DATETIME_RE.test(t)) return { ok: false, error: '格式应为 YYYY-MM-DD HH:mm:ss' };
      return { ok: true, value: t.length === 16 ? `${t}:00` : t };
    }
    default:
      return { ok: true, value: text };
  }
}

/** 值等价比较（编辑值与原值相同则不产生变更） */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
