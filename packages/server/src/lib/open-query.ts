/**
 * Headless 开放 API 的查询 DSL 解析。
 *
 * 全部按白名单 fail-closed：未列入 `CMS_OPEN_SORT_FIELDS` / `CMS_OPEN_CONTENT_FIELDS` /
 * `CMS_OPEN_INCLUDES` 的取值一律报错而不是静默忽略 —— 静默忽略会让调用方以为过滤生效了，
 * 拿到比预期更宽的数据集。`extend.*` 过滤额外要求字段在内容模型中标记为可检索，
 * 避免外部应用通过 JSONB 路径探测未公开的扩展字段。
 *
 * 本文件不依赖数据库，纯解析 + 校验，便于单测。
 */
import { CMS_OPEN_CONTENT_FIELDS, CMS_OPEN_INCLUDES, CMS_OPEN_PAGE_SIZE_MAX, CMS_OPEN_SORT_FIELDS } from '@zenith/shared/cms';
import type { CmsOpenInclude, CmsOpenSortField } from '@zenith/shared/cms';

export class OpenQueryError extends Error {}

export interface CmsOpenSortRule {
  field: CmsOpenSortField;
  direction: 'asc' | 'desc';
}

export interface CmsOpenCursor {
  /** 主排序值（时间戳毫秒或数值） */
  value: number | null;
  id: number;
}

export interface ParsedCmsOpenQuery {
  channels: string[];
  channelPath: string | null;
  tags: string[];
  contentTypes: string[];
  keyword: string | null;
  author: string | null;
  modelCode: string | null;
  flags: { isTop?: boolean; isRecommend?: boolean; isHot?: boolean; isOriginal?: boolean };
  publishedFrom: string | null;
  publishedTo: string | null;
  extendFilters: { field: string; value: string }[];
  sort: CmsOpenSortRule[];
  fields: string[] | null;
  includes: Set<CmsOpenInclude>;
  page: number;
  pageSize: number;
  cursor: CmsOpenCursor | null;
}

const CONTENT_TYPES = new Set(['article', 'album', 'media', 'link']);
const SORT_FIELDS = new Set<string>(CMS_OPEN_SORT_FIELDS);
const CONTENT_FIELDS = new Set<string>(CMS_OPEN_CONTENT_FIELDS);
const INCLUDES = new Set<string>(CMS_OPEN_INCLUDES);
/** 扩展字段名与模型字段命名保持一致，避免 JSONB 路径注入 */
const EXTEND_FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

const DEFAULT_SORT: CmsOpenSortRule[] = [
  { field: 'publishedAt', direction: 'desc' },
  { field: 'id', direction: 'desc' },
];

const DATE_INPUT_RE = /^(?:\d{4}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})$/;

function assertDateInput(value: string | undefined, label: string): void {
  if (!value) return;
  if (!DATE_INPUT_RE.test(value)) throw new OpenQueryError(`${label} 格式不正确`);
  const parts = value.replace(' ', '-').replaceAll(':', '-').split('-').map(Number);
  const [year, month, day, hour = 0, minute = 0, second = 0] = parts;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    !Number.isFinite(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute
    || date.getUTCSeconds() !== second
  ) throw new OpenQueryError(`${label} 不是有效日期`);
}

export function parsePositiveInteger(value: string | undefined, fallback: number, label: string, max?: number): number {
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new OpenQueryError(`${label} 必须是正整数`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new OpenQueryError(`${label} 必须是正整数`);
  if (max != null && parsed > max) throw new OpenQueryError(`${label} 不能大于 ${max}`);
  return parsed;
}

function splitList(value: string | undefined | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

function parseBool(value: string | undefined | null, label: string): boolean | undefined {
  if (value == null || value === '') return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new OpenQueryError(`${label} 仅接受 true/false`);
}

/** `-publishedAt,+id` → 排序规则；字段不在白名单直接报错 */
export function parseCmsOpenSort(raw: string | undefined | null): CmsOpenSortRule[] {
  const tokens = splitList(raw);
  if (tokens.length === 0) return DEFAULT_SORT;
  const rules: CmsOpenSortRule[] = [];
  for (const token of tokens) {
    const direction = token.startsWith('-') ? 'desc' : 'asc';
    const field = token.replace(/^[+-]/, '');
    if (!SORT_FIELDS.has(field)) {
      throw new OpenQueryError(`不支持的排序字段「${field}」，可用：${[...SORT_FIELDS].join(', ')}`);
    }
    rules.push({ field: field as CmsOpenSortField, direction });
  }
  // 保证全序：末位补 id，否则分页在并列值上会漏行或重复
  if (!rules.some((rule) => rule.field === 'id')) {
    rules.push({ field: 'id', direction: rules[0].direction });
  }
  return rules;
}

export function parseCmsOpenFields(raw: string | undefined | null): string[] | null {
  const fields = splitList(raw);
  if (fields.length === 0) return null;
  for (const field of fields) {
    if (!CONTENT_FIELDS.has(field)) {
      throw new OpenQueryError(`不支持的字段「${field}」`);
    }
  }
  // id 始终保留，客户端才能对齐增量同步与本地缓存
  return [...new Set(['id', ...fields])];
}

export function parseCmsOpenIncludes(raw: string | undefined | null): Set<CmsOpenInclude> {
  const includes = splitList(raw);
  for (const item of includes) {
    if (!INCLUDES.has(item)) {
      throw new OpenQueryError(`不支持的 include「${item}」，可用：${[...INCLUDES].join(', ')}`);
    }
  }
  return new Set(includes as CmsOpenInclude[]);
}

/** 游标编解码：base64url(`{value}:{id}`)，value 为空用 `-` 占位 */
export function encodeCmsOpenCursor(cursor: CmsOpenCursor): string {
  const value = cursor.value == null ? '-' : String(cursor.value);
  return Buffer.from(`${value}:${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCmsOpenCursor(raw: string | undefined | null): CmsOpenCursor | null {
  if (!raw) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new OpenQueryError('cursor 格式不正确');
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw new OpenQueryError('cursor 格式不正确');
  }
  const match = /^(-|\d+):(\d+)$/.exec(decoded);
  if (!match) throw new OpenQueryError('cursor 格式不正确');
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id < 0) throw new OpenQueryError('cursor 格式不正确');
  if (match[1] === '-') return { value: null, id };
  const value = Number(match[1]);
  if (!Number.isSafeInteger(value)) throw new OpenQueryError('cursor 格式不正确');
  return { value, id };
}

/** `extend.price=99` 形式的扩展字段过滤；字段名先做词法校验，是否可用由调用方按模型再核 */
export function parseCmsOpenExtendFilters(query: Record<string, string>): { field: string; value: string }[] {
  const filters: { field: string; value: string }[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith('extend.')) continue;
    const field = key.slice('extend.'.length);
    if (!EXTEND_FIELD_RE.test(field)) {
      throw new OpenQueryError(`扩展字段名「${field}」不合法`);
    }
    if (value.length > 200) throw new OpenQueryError(`扩展字段「${field}」的过滤值过长`);
    filters.push({ field, value });
  }
  return filters;
}

export function parseCmsOpenQuery(query: Record<string, string>): ParsedCmsOpenQuery {
  const contentTypes = splitList(query.contentType);
  for (const type of contentTypes) {
    if (!CONTENT_TYPES.has(type)) throw new OpenQueryError(`不支持的内容形态「${type}」`);
  }

  const pageSize = parsePositiveInteger(query.pageSize, 20, 'pageSize', CMS_OPEN_PAGE_SIZE_MAX);
  const page = parsePositiveInteger(query.page, 1, 'page');
  const publishedFrom = query.publishedFrom?.trim() || null;
  const publishedTo = query.publishedTo?.trim() || null;
  assertDateInput(publishedFrom ?? undefined, 'publishedFrom');
  assertDateInput(publishedTo ?? undefined, 'publishedTo');
  if (publishedFrom && publishedTo && publishedFrom > publishedTo) {
    throw new OpenQueryError('publishedFrom 不能晚于 publishedTo');
  }

  return {
    channels: splitList(query.channel),
    channelPath: query.channelPath?.trim() || null,
    tags: splitList(query.tag),
    contentTypes,
    keyword: query.keyword?.trim().slice(0, 64) || null,
    author: query.author?.trim().slice(0, 50) || null,
    modelCode: query.model?.trim() || null,
    flags: {
      isTop: parseBool(query.isTop, 'isTop'),
      isRecommend: parseBool(query.isRecommend, 'isRecommend'),
      isHot: parseBool(query.isHot, 'isHot'),
      isOriginal: parseBool(query.isOriginal, 'isOriginal'),
    },
    publishedFrom,
    publishedTo,
    extendFilters: parseCmsOpenExtendFilters(query),
    sort: parseCmsOpenSort(query.sort),
    fields: parseCmsOpenFields(query.fields),
    includes: parseCmsOpenIncludes(query.include),
    page,
    pageSize,
    cursor: decodeCmsOpenCursor(query.cursor),
  };
}

/**
 * 按 `fields` 裁剪输出对象；未指定时原样返回。
 *
 * `id` 始终保留 —— 客户端要靠它对齐增量同步与本地缓存。返回类型仍标注为 `T`：
 * 输出对象的字段在契约实体（`cmsOpenContentSchema`）中除 id 外均为 optional，裁剪后的形态依然满足该契约。
 */
export function pickCmsOpenFields<T extends { id: number }>(row: T, fields: string[] | null): T {
  if (!fields) return row;
  const source = row as Record<string, unknown>;
  const out: Record<string, unknown> = { id: row.id };
  for (const field of fields) {
    if (field in source) out[field] = source[field];
  }
  return out as T;
}
