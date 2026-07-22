import { RE2JS } from 're2js';

export function compileCmsFormPattern(pattern: string): RE2JS {
  if (!pattern || pattern.length > 200 || /[\0\r\n]/.test(pattern)) {
    throw new Error('规则长度或基础语法无效');
  }
  return RE2JS.compile(pattern);
}

export function testCmsFormPattern(pattern: string, value: string): boolean {
  return compileCmsFormPattern(pattern).test(value);
}
