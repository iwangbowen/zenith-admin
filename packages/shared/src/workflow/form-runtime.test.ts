/**
 * 表单运行时的跨字段比较：前端实时校验与服务端提交校验共用 evalWorkflowCompareRule，
 * 这里锁定「同输入同结果」的口径，尤其是日期混合格式（纯日期 vs 带时间）不得差出时区偏移。
 */
import { describe, expect, it } from 'vitest';
import { evalWorkflowCompareRule, WORKFLOW_COMPARE_OP_TEXT } from './form-runtime';

describe('evalWorkflowCompareRule', () => {
  it('数值比较按算子判定', () => {
    expect(evalWorkflowCompareRule('gt', 10, 5, false)).toBe(true);
    expect(evalWorkflowCompareRule('gte', '5', 5, false)).toBe(true);
    expect(evalWorkflowCompareRule('lt', 10, 5, false)).toBe(false);
    expect(evalWorkflowCompareRule('lte', 5, 5, false)).toBe(true);
    expect(evalWorkflowCompareRule('eq', 3, '3', false)).toBe(true);
    expect(evalWorkflowCompareRule('neq', 3, 3, false)).toBe(false);
  });

  it('空值 / 数组 / 不可比较的值一律放行', () => {
    expect(evalWorkflowCompareRule('gt', null, 5, false)).toBe(true);
    expect(evalWorkflowCompareRule('gt', 5, '', false)).toBe(true);
    expect(evalWorkflowCompareRule('gt', [1], 5, false)).toBe(true);
    expect(evalWorkflowCompareRule('gt', 'abc', 5, false)).toBe(true);
    expect(evalWorkflowCompareRule('gt', 'not a date', '2026-08-01', true)).toBe(true);
  });

  it('日期比较按本地时区解析，纯日期与带时间的值可直接比较', () => {
    // 2026-08-01 08:00 晚于当天 00:00：若纯日期按 UTC 解析会在东八区得出相反结论
    expect(evalWorkflowCompareRule('gt', '2026-08-01 08:00:00', '2026-08-01', true)).toBe(true);
    expect(evalWorkflowCompareRule('gte', '2026-08-01', '2026-08-01 00:00:00', true)).toBe(true);
    expect(evalWorkflowCompareRule('lt', '2026-08-01', '2026-08-02', true)).toBe(true);
    expect(evalWorkflowCompareRule('eq', '2026-08-01', '2026-08-01 00:00:00', true)).toBe(true);
  });

  it('算子文案与 core 比较算子标签措辞一致', () => {
    expect(WORKFLOW_COMPARE_OP_TEXT.gte).toBe('大于等于');
    expect(WORKFLOW_COMPARE_OP_TEXT.lte).toBe('小于等于');
  });
});
