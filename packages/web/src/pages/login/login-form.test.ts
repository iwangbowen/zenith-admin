/**
 * 登录表单只保留提交校验和输入数据完整性，校验提示时机由页面体验决定。
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isEmail, useLoginForm, type FieldRules } from './login-form';

interface Values extends Record<string, string> {
  username: string;
  email: string;
}

const RULES: FieldRules<Values> = {
  username: [{ required: true, message: '请输入用户名' }],
  email: [
    { required: true, message: '请输入邮箱' },
    { validator: (value) => (value && !isEmail(value) ? '邮箱格式不正确' : undefined), message: '邮箱格式不正确' },
  ],
};

function mount(initial: Values = { username: '', email: '' }) {
  return renderHook(() => useLoginForm<Values>(initial, RULES));
}

describe('useLoginForm 提交数据校验', () => {
  it('拒绝缺少必填字段的提交，通过时返回最新值', () => {
    const { result } = mount();
    let outcome: Values | null = null;
    act(() => { outcome = result.current.validate(); });
    expect(outcome).toBeNull();

    act(() => {
      result.current.field('username').onChange('admin');
      result.current.field('email').onChange('admin@example.com');
    });
    act(() => { outcome = result.current.validate(); });
    expect(outcome).toEqual({ username: 'admin', email: 'admin@example.com' });
  });

  it('同一事件内连续输入按最新值校验，不依赖重渲染', () => {
    const { result } = mount({ username: 'admin', email: '' });
    act(() => {
      result.current.field('email').onChange('x@');
      result.current.field('email').onChange('x@y.io');
    });
    expect(result.current.values.email).toBe('x@y.io');
    let outcome: Values | null = null;
    act(() => { outcome = result.current.validate(); });
    expect(outcome).toEqual({ username: 'admin', email: 'x@y.io' });
  });
});
