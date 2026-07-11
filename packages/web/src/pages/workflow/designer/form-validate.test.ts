import { describe, it, expect } from 'vitest';
import type { WorkflowFormField } from '@zenith/shared';
import { validateFormSchema, countErrors } from './form-validate';

const f = (partial: Partial<WorkflowFormField> & { key: string; type: WorkflowFormField['type'] }): WorkflowFormField =>
  ({ label: partial.key, ...partial }) as WorkflowFormField;

describe('validateFormSchema', () => {
  it('空表单给出 warning', () => {
    const issues = validateFormSchema([]);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe('warning');
  });

  it('合法表单无 issue', () => {
    const issues = validateFormSchema([
      f({ key: 'name', type: 'text', label: '姓名' }),
      f({ key: 'kind', type: 'select', label: '类型', options: ['甲', '乙'] }),
    ]);
    expect(issues).toHaveLength(0);
  });

  it('空标签 / 重复 key 报 error（重复只报一次）', () => {
    const issues = validateFormSchema([
      f({ key: 'a', type: 'text', label: '' }),
      f({ key: 'dup', type: 'text', label: 'X' }),
      f({ key: 'dup', type: 'text', label: 'Y' }),
    ]);
    expect(issues.filter((i) => i.message === '字段名称为空')).toHaveLength(1);
    expect(issues.filter((i) => i.message.startsWith('字段 key 重复'))).toHaveLength(1);
    expect(countErrors(issues)).toBe(2);
  });

  it('选项类字段空选项报 error、重复选项报 warning', () => {
    const issues = validateFormSchema([
      f({ key: 's1', type: 'select', label: '空选项', options: [] }),
      f({ key: 's2', type: 'radio', label: '重复选项', options: ['A', 'A'] }),
    ]);
    expect(issues.find((i) => i.fieldKey === 's1')?.message).toBe('选项为空');
    expect(issues.find((i) => i.fieldKey === 's2')?.level).toBe('warning');
  });

  it('区间与正则非法报 error', () => {
    const issues = validateFormSchema([
      f({ key: 'n', type: 'number', label: '数量', min: 10, max: 1 }),
      f({ key: 't', type: 'text', label: '文本', pattern: '([' }),
    ]);
    expect(issues.find((i) => i.fieldKey === 'n')?.message).toBe('最小值大于最大值');
    expect(issues.find((i) => i.fieldKey === 't')?.message).toBe('正则表达式无效');
  });

  it('联动条件引用不存在的字段报 error', () => {
    const issues = validateFormSchema([
      f({
        key: 'b', type: 'text', label: 'B',
        visibilityRules: { logic: 'and', rules: [{ field: 'ghost', operator: 'eq', value: 1 }] } as WorkflowFormField['visibilityRules'],
      }),
    ]);
    expect(issues.some((i) => i.message.includes('ghost'))).toBe(true);
  });

  it('公式字段：空公式 warning、引用缺失 error、非法表达式 error、自引用 warning', () => {
    const issues = validateFormSchema([
      f({ key: 'amount', type: 'number', label: '金额' }),
      f({ key: 'f1', type: 'formula', label: '空', formula: '' }),
      f({ key: 'f2', type: 'formula', label: '缺失引用', formula: '{ghost} + 1' }),
      f({ key: 'f3', type: 'formula', label: '非法', formula: '{amount} +' }),
      f({ key: 'f4', type: 'formula', label: '自引用', formula: '{f4} + {amount}' }),
    ]);
    expect(issues.find((i) => i.fieldKey === 'f1')?.message).toBe('公式为空');
    expect(issues.find((i) => i.fieldKey === 'f2')?.message).toContain('ghost');
    expect(issues.find((i) => i.fieldKey === 'f3')?.message).toBe('公式表达式无效');
    expect(issues.filter((i) => i.fieldKey === 'f4').some((i) => i.message === '公式引用了自身')).toBe(true);
  });

  it('比较校验：自引用与缺失目标报 error', () => {
    const issues = validateFormSchema([
      f({
        key: 'start', type: 'date', label: '开始',
        compareRules: [{ field: 'start', operator: 'lt' }, { field: 'ghost', operator: 'lt' }] as WorkflowFormField['compareRules'],
      }),
    ]);
    expect(issues.some((i) => i.message === '比较校验不能引用字段自身')).toBe(true);
    expect(issues.some((i) => i.message.includes('ghost'))).toBe(true);
  });
});
