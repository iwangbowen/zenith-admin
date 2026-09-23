import * as z from 'zod';
import { CMS_COMPONENT_FIELD_TYPES, CMS_FIELD_TYPES } from './constants';

const childFields = z.object({ name: z.string().regex(/^[a-z][a-z0-9_]*$/), label: z.string().min(1), fieldType: z.enum(CMS_COMPONENT_FIELD_TYPES), required: z.boolean().optional() });
export const cmsFieldConfigurationSchema = z.object({
  min: z.number().optional(), max: z.number().optional(),
  minLength: z.int().min(0).optional(), maxLength: z.int().min(1).max(2_000_000).optional(),
  unique: z.boolean().optional(),
  referenceModelIds: z.array(z.int().positive()).max(50).optional(),
  requiredWhen: z.object({ field: z.string().min(1), equals: z.union([z.string(), z.number(), z.boolean()]) }).optional(),
  fields: z.array(childFields).max(100).optional(),
  blockTypes: z.array(z.object({ code: z.string().min(1), label: z.string().min(1), fields: z.array(childFields).max(100) })).max(30).optional(),
}).strict();
export type CmsFieldConfiguration = z.infer<typeof cmsFieldConfigurationSchema>;

export const cmsQualityIssueSchema = z.object({
  rule: z.string(), severity: z.enum(['error', 'warning']), fieldPath: z.string(), message: z.string(),
});
export type CmsQualityIssue = z.infer<typeof cmsQualityIssueSchema>;

type FieldDefinition = Omit<z.infer<typeof childFields>, 'fieldType'> & { fieldType: (typeof CMS_FIELD_TYPES)[number]; configuration?: CmsFieldConfiguration | null; options?: { value: string; label: string }[] | null; resolvedOptions?: { value: string; label: string }[] };
export function validateCmsStructuredFields(fields: readonly FieldDefinition[], values: Record<string, unknown>, strict: boolean, prefix = 'extend'): CmsQualityIssue[] {
  const issues: CmsQualityIssue[] = [];
  const issue = (fieldPath: string, message: string, rule = 'model') => issues.push({ rule, severity: 'error', fieldPath, message });
  for (const key of Object.keys(values)) if (!fields.some((field) => field.name === key)) issue(`${prefix}.${key}`, '字段未在此模型版本定义');
  for (const field of fields) {
    const path = `${prefix}.${field.name}`;
    const value = values[field.name];
    const config = field.configuration ?? {};
    const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0);
    const required = field.required || (config.requiredWhen && values[config.requiredWhen.field] === config.requiredWhen.equals);
    if (empty) { if (strict && required) issue(path, `「${field.label}」为发布必填`); continue; }
    if (typeof value === 'string') {
      if (config.minLength != null && value.length < config.minLength) issue(path, `至少 ${config.minLength} 个字符`);
      if (config.maxLength != null && value.length > config.maxLength) issue(path, `最多 ${config.maxLength} 个字符`);
    }
    const validReference = (item: unknown) => typeof item === 'number' && Number.isSafeInteger(item) && item > 0;
    switch (field.fieldType) {
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) issue(path, '需要有限数字');
        else if ((config.min != null && value < config.min) || (config.max != null && value > config.max)) issue(path, '数值超出允许范围');
        break;
      case 'switch': if (typeof value !== 'boolean') issue(path, '需要布尔值'); break;
      case 'reference': if (!validReference(value)) issue(path, '请选择内容'); break;
      case 'references': if (!Array.isArray(value) || !value.every(validReference)) issue(path, '需要内容 ID 数组'); break;
      case 'object':
        if (typeof value !== 'object' || Array.isArray(value)) issue(path, '需要结构化对象');
        else issues.push(...validateCmsStructuredFields(config.fields ?? [], value as Record<string, unknown>, strict, path));
        break;
      case 'array':
      case 'blocks':
        if (!Array.isArray(value)) { issue(path, '需要组件数组'); break; }
        if (value.length > (config.maxLength ?? 1000)) issue(path, '组件数量超出上限');
        value.forEach((item, index) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) { issue(`${path}.${index}`, '组件需要对象'); return; }
          if (field.fieldType === 'blocks') {
            const block = config.blockTypes?.find((type) => type.code === item.blockType);
            if (!block) issue(`${path}.${index}.blockType`, '未知区块类型');
            else { const { blockType: _type, ...data } = item; issues.push(...validateCmsStructuredFields(block.fields, data, strict, `${path}.${index}`)); }
          } else issues.push(...validateCmsStructuredFields(config.fields ?? [], item, strict, `${path}.${index}`));
        });
        break;
      case 'select': case 'radio': case 'checkbox': {
        const options = field.resolvedOptions ?? field.options ?? [];
        const selected = field.fieldType === 'checkbox' ? value : [value];
        if (!Array.isArray(selected) || !selected.every((item) => typeof item === 'string' && options.some((option) => option.value === item))) issue(path, '选项已失效或配置为空');
        break;
      }
      default: if (typeof value !== 'string') issue(path, '需要文本值');
    }
  }
  return issues;
}
