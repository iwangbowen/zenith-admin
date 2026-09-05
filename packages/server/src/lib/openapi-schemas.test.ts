/**
 * openapi-schemas 校验工具单测：
 *  - formatZodIssue：Zod v4 issue → 中文文案（v4 码表 + 结构化字段）
 */
import { describe, it, expect } from 'vitest';
import { z } from '@hono/zod-openapi';
import { formatZodIssue } from './openapi-schemas';

const firstIssue = (schema: z.ZodType, input: unknown) => {
  const result = schema.safeParse(input);
  if (result.success) throw new Error('期望解析失败');
  return result.error.issues[0];
};

describe('formatZodIssue', () => {
  it('无 issue 时返回通用提示', () => {
    expect(formatZodIssue(undefined)).toBe('请求参数错误');
  });

  it('业务自定义中文消息直接展示，不拼字段名', () => {
    const schema = z.object({ name: z.string().min(2, '名称至少 2 个字') });
    expect(formatZodIssue(firstIssue(schema, { name: 'a' }))).toBe('名称至少 2 个字');
  });

  it('缺少必填字段 → 缺少必填参数「字段」', () => {
    const schema = z.object({ name: z.string() });
    expect(formatZodIssue(firstIssue(schema, {}))).toBe('缺少必填参数「name」');
  });

  it('类型错误带期望类型', () => {
    const schema = z.object({ age: z.number() });
    expect(formatZodIssue(firstIssue(schema, { age: 'x' }))).toBe('参数「age」类型不正确，期望 number');
  });

  it('枚举错误（v4 code=invalid_value）列出允许值', () => {
    const schema = z.object({ status: z.enum(['on', 'off']) });
    expect(formatZodIssue(firstIssue(schema, { status: 'x' }))).toBe('参数「status」取值不在允许范围内（允许："on" / "off"）');
  });

  it('字符串长度上限（too_big + origin=string）', () => {
    const schema = z.object({ remark: z.string().max(5) });
    expect(formatZodIssue(firstIssue(schema, { remark: '123456' }))).toBe('参数「remark」长度不能超过 5 个字符');
  });

  it('数值下限（too_small + origin=number）', () => {
    const schema = z.object({ page: z.number().min(1) });
    expect(formatZodIssue(firstIssue(schema, { page: 0 }))).toBe('参数「page」不能小于 1');
  });

  it('数组项数下限（too_small + origin=array）', () => {
    const schema = z.object({ ids: z.array(z.number()).min(1) });
    expect(formatZodIssue(firstIssue(schema, { ids: [] }))).toBe('参数「ids」至少需要 1 项');
  });

  it('格式错误（invalid_format）带格式名', () => {
    const schema = z.object({ email: z.email() });
    expect(formatZodIssue(firstIssue(schema, { email: 'not-mail' }))).toBe('参数「email」格式不正确（要求 email 格式）');
  });

  it('未知字段（unrecognized_keys）列出字段名', () => {
    const schema = z.strictObject({ a: z.string() });
    expect(formatZodIssue(firstIssue(schema, { a: 'x', extra: 1 }))).toBe('包含未知字段：extra');
  });

  it('步进错误（not_multiple_of）', () => {
    const schema = z.object({ step: z.number().multipleOf(5) });
    expect(formatZodIssue(firstIssue(schema, { step: 3 }))).toBe('参数「step」必须是 5 的倍数');
  });

  it('未知 code 落到通用兜底', () => {
    expect(formatZodIssue({ code: 'something_else', message: 'nope', path: [] })).toBe('参数校验未通过');
  });
});
