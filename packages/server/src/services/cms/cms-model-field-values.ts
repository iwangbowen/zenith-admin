import dayjs from 'dayjs';
import type { CmsModelFieldValue } from '../../cms/themes/types';
import type { cmsModelFields } from '../../db/schema';
import { listCmsModelFields, resolveCmsModelFieldOptions } from './cms-models.service';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import { cmsModelVersions } from '../../db/schema';
import { parseDateTimeInput } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';

type CmsModelFieldRow = typeof cmsModelFields.$inferSelect;
async function renderModelFields(modelId: number, modelVersionId?: number | null): Promise<CmsModelFieldRow[]> {
  if (!modelVersionId) return listCmsModelFields(modelId);
  const [version] = await db.select().from(cmsModelVersions).where(and(eq(cmsModelVersions.id, modelVersionId), eq(cmsModelVersions.modelId, modelId))).limit(1);
  requireRow(version, '内容使用的模型版本不存在');
  return version.fields.map((field) => ({ ...field, configuration: field.configuration ?? null, createdBy: null, updatedBy: null,
    createdAt: parseDateTimeInput(field.createdAt) ?? version.createdAt, updatedAt: parseDateTimeInput(field.updatedAt) ?? version.createdAt }));
}

/**
 * 组装详情页「模型字段表」展示值（Theme API `ctx.content.modelFields`）：
 * 取模型中勾选 showInDetail 的字段，按 detailGroup 分组、detailSort 排序，
 * 并把原始 extend 值格式化为可直接渲染的 displayValue（日期格式化、选项/字典翻译、开关转是否）。
 */
export async function buildCmsModelFieldValues(
  modelId: number | null | undefined,
  extend: Record<string, unknown> | null | undefined,
  modelVersionId?: number | null,
): Promise<CmsModelFieldValue[]> {
  if (!modelId) return [];
  const fields = (await renderModelFields(modelId, modelVersionId)).filter((f) => f.showInDetail);
  if (fields.length === 0) return [];
  const resolved = await resolveCmsModelFieldOptions(fields);
  const values = extend ?? {};
  return fields
    .map((field) => {
      const rawValue = values[field.name];
      return {
        name: field.name,
        label: field.label,
        fieldType: field.fieldType,
        rawValue,
        displayValue: formatDisplayValue(field.fieldType, rawValue, resolved.get(field.id) ?? []),
        group: field.detailGroup?.trim() || null,
        sort: field.detailSort,
      };
    })
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

/** 列表场景的字段定义预载结果：showInList=true 的字段 + 已解析选项 */
export interface CmsListModelFieldDefs {
  fields: CmsModelFieldRow[];
  options: Map<number, { label: string; value: string }[]>;
}

/**
 * 批量预载各模型 showInList 字段定义（列表卡片角标场景）。
 * 一次列表渲染通常只涉及 1-2 个模型；无 showInList 字段的模型不占条目。
 */
export async function loadCmsListModelFieldDefs(
  modelIds: readonly (number | null | undefined | { modelId: number | null; modelVersionId?: number | null })[],
): Promise<Map<number, CmsListModelFieldDefs>> {
  const distinct = new Map<number, { modelId: number; modelVersionId?: number | null }>();
  for (const value of modelIds) {
    const entry = typeof value === 'number' ? { modelId: value, modelVersionId: null } : value;
    if (entry?.modelId) distinct.set(entry.modelVersionId ? -entry.modelVersionId : entry.modelId, { ...entry, modelId: entry.modelId });
  }
  const defs = new Map<number, CmsListModelFieldDefs>();
  for (const [key, { modelId, modelVersionId }] of distinct) {
    const fields = (await renderModelFields(modelId, modelVersionId)).filter((f) => f.showInList);
    if (fields.length === 0) continue;
    defs.set(key, { fields, options: await resolveCmsModelFieldOptions(fields) });
  }
  return defs;
}

/** 同步组装列表项模型字段（消费 loadCmsListModelFieldDefs 预载结果），按字段 sort 排序 */
export function buildCmsListModelFieldValues(
  modelId: number | null | undefined,
  extend: Record<string, unknown> | null | undefined,
  defs: Map<number, CmsListModelFieldDefs>,
  modelVersionId?: number | null,
): CmsModelFieldValue[] {
  const def = modelId ? defs.get(modelVersionId ? -modelVersionId : modelId) : undefined;
  if (!def) return [];
  const values = extend ?? {};
  return def.fields
    .map((field) => {
      const rawValue = values[field.name];
      return {
        name: field.name,
        label: field.label,
        fieldType: field.fieldType,
        rawValue,
        displayValue: formatDisplayValue(field.fieldType, rawValue, def.options.get(field.id) ?? []),
        group: null,
        sort: field.sort,
      };
    })
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

function optionLabel(options: { label: string; value: string }[], value: unknown): string {
  const raw = String(value);
  return options.find((o) => o.value === raw)?.label ?? raw;
}

function formatDisplayValue(
  fieldType: string,
  value: unknown,
  options: { label: string; value: string }[],
): string {
  if (value === undefined || value === null || value === '') return '';
  switch (fieldType) {
    case 'date': {
      const d = dayjs(value as string | number | Date);
      return d.isValid() ? d.format('YYYY-MM-DD') : String(value);
    }
    case 'datetime': {
      const d = dayjs(value as string | number | Date);
      return d.isValid() ? d.format('YYYY-MM-DD HH:mm:ss') : String(value);
    }
    case 'select':
    case 'radio':
      return optionLabel(options, value);
    case 'checkbox': {
      const list = Array.isArray(value) ? value : [value];
      return list.map((v) => optionLabel(options, v)).join('、');
    }
    case 'switch':
      return value === true || value === 'true' ? '是' : '否';
    case 'richtext':
      // 富文本字段不适合键值表；输出纯文本摘要，完整渲染由主题自行处理 rawValue
      return String(value).replace(/<[^>]+>/g, '').slice(0, 200);
    default:
      return String(value);
  }
}
