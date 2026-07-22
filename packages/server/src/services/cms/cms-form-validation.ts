import { HTTPException } from 'hono/http-exception';
import type { CmsFormField } from '@zenith/shared';
import { compileCmsFormPattern } from './cms-form-pattern';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^1[3-9]\d{9}$/;

function fail(field: CmsFormField, fallback: string): never {
  throw new HTTPException(400, { message: field.errorMessage?.trim() || `「${field.label}」${fallback}` });
}

export function validateCmsFormFields(
  fields: CmsFormField[],
  raw: Record<string, unknown>,
): Record<string, string> {
  const data: Record<string, string> = {};
  for (const field of fields) {
    const rawValue = raw[field.name];
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (field.required && !value) fail(field, '不能为空');
    if (!value) {
      data[field.name] = '';
      continue;
    }
    if (field.minLength != null && value.length < field.minLength) fail(field, `长度不能少于 ${field.minLength}`);
    if (field.maxLength != null && value.length > field.maxLength) fail(field, `长度不能超过 ${field.maxLength}`);
    if (value.length > 2000) fail(field, '内容过长');
    if ((field.fieldType === 'select' || field.fieldType === 'radio')) {
      const allowed = (field.options ?? []).map((option) => option.value);
      if (!allowed.includes(value)) fail(field, '选项无效');
    }
    if (field.fieldType === 'email' && !EMAIL_RE.test(value)) fail(field, '邮箱格式无效');
    if (field.fieldType === 'mobile' && !MOBILE_RE.test(value)) fail(field, '手机号格式无效');
    if (field.fieldType === 'url') {
      try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') fail(field, '网址仅支持 HTTP/HTTPS');
      } catch {
        fail(field, '网址格式无效');
      }
    }
    if (field.fieldType === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number)) fail(field, '必须是有效数字');
      if (field.min != null && number < field.min) fail(field, `不能小于 ${field.min}`);
      if (field.max != null && number > field.max) fail(field, `不能大于 ${field.max}`);
    }
    if (field.pattern) {
      let pattern: ReturnType<typeof compileCmsFormPattern>;
      try {
        pattern = compileCmsFormPattern(field.pattern);
      } catch {
        throw new HTTPException(500, { message: `表单字段「${field.label}」不是有效的 RE2-compatible 规则` });
      }
      if (!pattern.test(value)) fail(field, '格式不符合要求');
    }
    data[field.name] = value;
  }
  return data;
}
