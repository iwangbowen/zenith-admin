import { describe, expect, it } from 'vitest';
import { createUserSchema, updateProfileSchema, updateUserSchema } from './validation';

describe('个人资料与用户管理的邮箱校验', () => {
  it.each([
    ['创建用户', createUserSchema.pick({ email: true })],
    ['编辑用户', updateUserSchema.pick({ email: true })],
    ['个人资料', updateProfileSchema.pick({ email: true })],
  ])('%s 支持空邮箱、明确清空和省略字段，并拒绝无效邮箱', (_name, schema) => {
    expect(schema.parse({ email: '' })).toEqual({ email: null });
    expect(schema.parse({ email: null })).toEqual({ email: null });
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ email: 'user@example.com' })).toEqual({ email: 'user@example.com' });
    expect(schema.safeParse({ email: 'invalid-email' }).success).toBe(false);
  });
});
