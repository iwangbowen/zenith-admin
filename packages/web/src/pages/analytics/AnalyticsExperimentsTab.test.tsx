import { describe, expect, it } from 'vitest';
import { toApiDateTime } from './AnalyticsExperimentsTab';

describe('toApiDateTime — DatePicker 的 Date 值归一为接口时间字符串', () => {
  // 漏掉 Date 分支不会报错：Date 会被 JSON 序列化成 "2026-08-09T07:30:00.000Z"，
  // 后端按本地时区解析后产生数小时偏移，且构建/类型检查/页面渲染全部正常
  it('formats a Date into YYYY-MM-DD HH:mm:ss without timezone suffix', () => {
    const result = toApiDateTime(new Date(2026, 7, 9, 15, 30, 45));
    expect(result).toBe('2026-08-09 15:30:45');
    expect(result).not.toContain('T');
    expect(result).not.toContain('Z');
  });

  // 编辑回填时表单里是接口返回的字符串，不能被再格式化一次
  it('passes an already-formatted string through unchanged', () => {
    expect(toApiDateTime('2026-01-01 10:00:00')).toBe('2026-01-01 10:00:00');
  });

  // 留空表示「不限 / 手动启动」，必须是 null 而不是空串——空串会过不了后端的 min(1) 校验
  it('normalizes empty input to null', () => {
    expect(toApiDateTime(null)).toBeNull();
    expect(toApiDateTime(undefined)).toBeNull();
    expect(toApiDateTime('')).toBeNull();
    expect(toApiDateTime('   ')).toBeNull();
  });
});
