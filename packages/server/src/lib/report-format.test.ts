/**
 * 报表字段格式化 + 数据源类型谓词单测（@zenith/shared 纯函数）。
 */
import { describe, it, expect } from 'vitest';
import { formatReportValue, isExternalDbType, isSqlLikeType } from '@zenith/shared';

describe('formatReportValue', () => {
  it('null/undefined → 空串', () => {
    expect(formatReportValue(null)).toBe('');
    expect(formatReportValue(undefined)).toBe('');
  });
  it('无格式配置 → 原样字符串', () => {
    expect(formatReportValue(123)).toBe('123');
    expect(formatReportValue('abc')).toBe('abc');
  });
  it('number：千分位 + 小数位 + 前后缀', () => {
    expect(formatReportValue(1234567, { kind: 'number', decimals: 0 })).toBe('1,234,567');
    expect(formatReportValue(12.5, { kind: 'number', decimals: 2, prefix: '$', suffix: '元' })).toBe('$12.50元');
    expect(formatReportValue(1234, { kind: 'number', thousands: false, decimals: 0 })).toBe('1234');
  });
  it('percent：值 ×100 加 %', () => {
    expect(formatReportValue(0.1234, { kind: 'percent', decimals: 2 })).toBe('12.34%');
    expect(formatReportValue('x', { kind: 'percent' })).toBe('x'); // 非数值原样
  });
  it('currency：货币符号 + 两位小数', () => {
    expect(formatReportValue(99.9, { kind: 'currency' })).toBe('¥99.90');
    expect(formatReportValue(99.9, { kind: 'currency', currencySymbol: '$' })).toBe('$99.90');
  });
  it('date：截断到 10 位；datetime：截断到 19 位', () => {
    expect(formatReportValue('2026-03-23 14:30:00', { kind: 'date' })).toBe('2026-03-23');
    expect(formatReportValue('2026-03-23 14:30:00', { kind: 'datetime' })).toBe('2026-03-23 14:30:00');
  });
  it('dict：按映射翻译，缺失回落原值', () => {
    expect(formatReportValue('1', { kind: 'dict' }, { '1': '启用', '0': '禁用' })).toBe('启用');
    expect(formatReportValue('9', { kind: 'dict' }, { '1': '启用' })).toBe('9');
  });
});

describe('数据源类型谓词', () => {
  it('isExternalDbType 仅对 mysql/postgresql/sqlserver 为真', () => {
    expect(isExternalDbType('mysql')).toBe(true);
    expect(isExternalDbType('postgresql')).toBe(true);
    expect(isExternalDbType('sqlserver')).toBe(true);
    expect(isExternalDbType('sql')).toBe(false);
    expect(isExternalDbType('api')).toBe(false);
    expect(isExternalDbType('static')).toBe(false);
  });
  it('isSqlLikeType 含内置 sql 与外部库，排除 api/static', () => {
    expect(isSqlLikeType('sql')).toBe(true);
    expect(isSqlLikeType('mysql')).toBe(true);
    expect(isSqlLikeType('sqlserver')).toBe(true);
    expect(isSqlLikeType('api')).toBe(false);
    expect(isSqlLikeType('static')).toBe(false);
  });
});
