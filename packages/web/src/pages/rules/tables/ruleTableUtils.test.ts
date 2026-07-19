import { describe, it, expect } from 'vitest';
import { inspectDecisionDraft } from './ruleTableUtils';

const numInput = (key = 'amt') => ({ key, label: '金额', expr: 'form.amount', type: 'number' as const });
const strOutput = { key: 'level', label: '等级', type: 'string' as const };

describe('inspectDecisionDraft 静态分析', () => {
  it('unique 策略下检测区间重叠', () => {
    const issues = inspectDecisionDraft({
      inputs: [numInput()],
      outputs: [strOutput],
      rules: [
        { id: 'a', when: ['>= 100'], then: { level: 'x' } },
        { id: 'b', when: ['[150..200]'], then: { level: 'y' } },
      ],
    }, 'unique');
    expect(issues.some((i) => i.message.includes('重叠'))).toBe(true);
  });

  it('first 策略不报重叠但检测不可达行', () => {
    const issues = inspectDecisionDraft({
      inputs: [numInput()],
      outputs: [strOutput],
      rules: [
        { id: 'a', when: ['>= 10'], then: { level: 'x' } },
        { id: 'b', when: ['>= 100'], then: { level: 'y' } },
      ],
    }, 'first');
    expect(issues.some((i) => i.message.includes('重叠'))).toBe(false);
    expect(issues.some((i) => i.message.includes('永远不会命中'))).toBe(true);
  });

  it('单数值列检测未覆盖区间 gap', () => {
    const issues = inspectDecisionDraft({
      inputs: [numInput()],
      outputs: [strOutput],
      rules: [
        { id: 'a', when: ['[0..10]'], then: { level: 'x' } },
        { id: 'b', when: ['[20..30]'], then: { level: 'y' } },
      ],
    }, 'first');
    expect(issues.some((i) => i.message.includes('未覆盖区间'))).toBe(true);
  });

  it('存在通配行时不报 gap', () => {
    const issues = inspectDecisionDraft({
      inputs: [numInput()],
      outputs: [strOutput],
      rules: [
        { id: 'a', when: ['[0..10]'], then: { level: 'x' } },
        { id: 'b', when: ['-'], then: { level: 'y' } },
      ],
    }, 'first');
    expect(issues.some((i) => i.message.includes('未覆盖区间'))).toBe(false);
  });

  it('校验 in 与开闭区间语法合法性', () => {
    const issues = inspectDecisionDraft({
      inputs: [numInput()],
      outputs: [strOutput],
      rules: [{ id: 'a', when: ['in 1,2,abc'], then: { level: 'x' } }],
    }, 'first');
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('条件无效'))).toBe(true);
  });

  it('表达式输出列跳过字面量类型校验', () => {
    const issues = inspectDecisionDraft({
      inputs: [numInput()],
      outputs: [{ key: 'score', label: '分数', type: 'number' as const, isExpr: true }],
      rules: [{ id: 'a', when: ['>= 1'], then: { score: '= form.amount * 2' } }],
    }, 'first');
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });
});
