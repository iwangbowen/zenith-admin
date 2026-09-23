import { HTTPException } from 'hono/http-exception';
import dayjs from 'dayjs';
import { validateCmsStructuredFields } from '@zenith/shared/cms';
import type { CmsModelFieldRow } from '../../db/schema';
import { listCmsModelFields, resolveCmsModelFieldOptions } from './cms-models.service';

/**
 * 模型自定义字段（extend）的服务端统一校验与默认值回填。
 *
 * 所有写入口（REST 创建/更新、站点导入、采集入库、站群分发、Headless 写入）共用，
 * 避免「前端表单校验通过、非 UI 通道漏填必填字段直接发布」的数据质量缺口：
 * - draft（保存草稿）：只校验类型与选项合法性，允许缺失必填；
 * - publish（提交审核 / 发布）：额外强制必填字段非空。
 */
export type CmsExtendValidateMode = 'draft' | 'publish';

function isEmptyExtendValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function isDateLike(value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return false;
  return dayjs(value as string | number | Date).isValid();
}

function validateFieldValue(
  field: CmsModelFieldRow,
  value: unknown,
  options: { label: string; value: string }[],
  errors: string[],
): void {
  switch (field.fieldType) {
    case 'reference': case 'references': case 'object': case 'array': case 'blocks':
      break; // Structured validation is shared with editor and revision publication.
    case 'number': {
      const num = typeof value === 'number' ? value : Number(String(value).trim());
      if (Number.isNaN(num)) errors.push(`「${field.label}」需为数字`);
      break;
    }
    case 'date':
    case 'datetime': {
      if (!isDateLike(value)) errors.push(`「${field.label}」日期格式无效`);
      break;
    }
    case 'select':
    case 'radio': {
      const allowed = new Set(options.map((o) => o.value));
      if (!allowed.has(String(value))) {
        errors.push(`「${field.label}」的值不在可选项内`);
      }
      break;
    }
    case 'checkbox': {
      const values = Array.isArray(value) ? value : [value];
      const allowed = new Set(options.map((o) => o.value));
      if (allowed.size > 0) {
        const invalid = values.filter((v) => !allowed.has(String(v)));
        if (invalid.length > 0) errors.push(`「${field.label}」含不在可选项内的值`);
      }
      break;
    }
    case 'switch': {
      if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
        errors.push(`「${field.label}」需为开关值`);
      }
      break;
    }
    default:
      // text / textarea / richtext / image / file：任意标量字符串均可
      if (typeof value !== 'string' && typeof value !== 'number') {
        errors.push(`「${field.label}」格式无效`);
      }
  }
}

/**
 * 校验 extend 值与模型字段定义的一致性；校验失败抛 400 并列出全部问题字段。
 * `modelId` 为空（栏目未绑定模型）时直接放行。
 */
export async function validateCmsModelExtend(
  modelId: number | null | undefined,
  extend: Record<string, unknown> | null | undefined,
  mode: CmsExtendValidateMode,
): Promise<void> {
  if (!modelId) return;
  const fields = await listCmsModelFields(modelId);
  const resolved = await resolveCmsModelFieldOptions(fields);
  const values = extend ?? {};
  const errors: string[] = [];
  errors.push(...validateCmsStructuredFields(fields.map((field) => ({ ...field, resolvedOptions: resolved.get(field.id) ?? [] })), values, mode === 'publish').map((issue) => `${issue.fieldPath}: ${issue.message}`));
  for (const field of fields) {
    const value = values[field.name];
    if (isEmptyExtendValue(value)) {
      if (mode === 'publish' && field.required) errors.push(`「${field.label}」为必填`);
      continue;
    }
    validateFieldValue(field, value, resolved.get(field.id) ?? [], errors);
  }
  if (errors.length > 0) {
    throw new HTTPException(400, { message: `模型字段校验失败：${errors.join('；')}` });
  }
}

function parseDefaultValue(field: CmsModelFieldRow): unknown {
  const raw = field.defaultValue?.trim();
  if (!raw) return undefined;
  switch (field.fieldType) {
    case 'number': case 'reference':
      return Number(raw);
    case 'object': case 'array': case 'blocks': case 'references':
      try { return JSON.parse(raw) as unknown; } catch { return undefined; }
    case 'switch':
      return raw === 'true';
    case 'checkbox':
      // 支持 JSON 数组或逗号分隔两种书写
      if (raw.startsWith('[')) {
        try {
          const parsed: unknown = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed.map(String) : [raw];
        } catch {
          return [raw];
        }
      }
      return raw.split(',').map((v) => v.trim()).filter(Boolean);
    default:
      return raw;
  }
}

/**
 * 创建内容时为缺失/留空的模型字段回填 defaultValue。
 * 只补缺，不覆盖调用方显式提供的值。
 */
export async function applyCmsModelFieldDefaults(
  modelId: number | null | undefined,
  extend: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown>> {
  const values = { ...(extend ?? {}) };
  if (!modelId) return values;
  const fields = await listCmsModelFields(modelId);
  for (const field of fields) {
    if (!isEmptyExtendValue(values[field.name])) continue;
    const fallback = parseDefaultValue(field);
    if (fallback !== undefined) values[field.name] = fallback;
  }
  return values;
}
