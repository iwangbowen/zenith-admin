import { describe, it, expect } from 'vitest';
import { collectWorkflowFormValidationErrors, collectMissingRequiredFields } from '@zenith/shared';
import type { WorkflowFormField } from '@zenith/shared';

const f = (partial: Partial<WorkflowFormField> & { key: string; type: WorkflowFormField['type'] }): WorkflowFormField =>
  ({ label: partial.key, ...partial }) as WorkflowFormField;

const kinds = (fields: WorkflowFormField[], values: Record<string, unknown>) =>
  collectWorkflowFormValidationErrors(fields, values).map((e) => e.kind);

describe('collectWorkflowFormValidationErrors 服务端全量校验', () => {
  it('文本长度与正则', () => {
    const fields = [f({ key: 'code', type: 'text', label: '编码', minLength: 3, maxLength: 5, pattern: '^[A-Z]+$', patternMessage: '仅大写字母' })];
    expect(kinds(fields, { code: 'AB' })).toEqual(['length']);
    expect(kinds(fields, { code: 'ABCDEF' })).toEqual(['length']);
    const patternErr = collectWorkflowFormValidationErrors(fields, { code: 'abc' });
    expect(patternErr[0]).toMatchObject({ kind: 'pattern' });
    expect(patternErr[0].message).toContain('仅大写字母');
    expect(kinds(fields, { code: 'ABC' })).toEqual([]);
  });

  it('数值范围（number/amount）', () => {
    const fields = [f({ key: 'qty', type: 'number', label: '数量', min: 1, max: 10 })];
    expect(kinds(fields, { qty: 0 })).toEqual(['range']);
    expect(kinds(fields, { qty: 11 })).toEqual(['range']);
    expect(kinds(fields, { qty: 5 })).toEqual([]);
    expect(kinds(fields, {})).toEqual([]); // 空值不做范围校验（非必填）
  });

  it('日期可选范围（custom 最早/最晚）', () => {
    const fields = [f({ key: 'd', type: 'date', label: '日期', dateLimit: 'custom', minDate: '2026-01-01', maxDate: '2026-12-31' })];
    expect(kinds(fields, { d: '2025-12-31' })).toEqual(['dateLimit']);
    expect(kinds(fields, { d: '2027-01-01' })).toEqual(['dateLimit']);
    expect(kinds(fields, { d: '2026-06-15' })).toEqual([]);
  });

  it('跨字段比较（日期 gt）', () => {
    const fields = [
      f({ key: 'start', type: 'date', label: '开始' }),
      f({ key: 'end', type: 'date', label: '结束', compareRules: [{ operator: 'gt', field: 'start', message: '结束需晚于开始' }] }),
    ];
    const bad = collectWorkflowFormValidationErrors(fields, { start: '2026-07-15', end: '2026-07-10' });
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ kind: 'compare', key: 'end' });
    expect(kinds(fields, { start: '2026-07-15', end: '2026-07-20' })).toEqual([]);
  });

  it('自定义校验公式（结果为真通过；不可计算放行）', () => {
    const fields = [
      f({ key: 'a', type: 'number', label: 'A' }),
      f({ key: 'b', type: 'number', label: 'B', validationFormula: '{b} > {a}', validationMessage: 'B 必须大于 A' }),
    ];
    const bad = collectWorkflowFormValidationErrors(fields, { a: 10, b: 5 });
    expect(bad[0]).toMatchObject({ kind: 'formula', key: 'b' });
    expect(bad[0].message).toContain('B 必须大于 A');
    expect(kinds(fields, { a: 10, b: 20 })).toEqual([]);
    // 引用为空 → NaN 比较为 false → 报错；b 也为空则必填/公式都不触发（无 required）
    expect(kinds(fields, { b: 5 })).toEqual(['formula']);
  });

  it('明细行级：行必填（尊重行内显隐）、列唯一、行内校验公式', () => {
    const fields = [
      f({
        key: 'items', type: 'detail', label: '明细',
        children: [
          f({ key: 'name', type: 'text', label: '名称', required: true, unique: true }),
          f({
            key: 'qty', type: 'number', label: '数量', required: true,
            visibilityRules: { logic: 'and', rules: [{ field: 'name', operator: 'notEmpty', value: '' }] },
          }),
          f({ key: 'price', type: 'number', label: '单价', validationFormula: '{price} > 0', validationMessage: '单价需为正数' }),
        ],
      }),
    ];
    // 行1 name 空 → 行必填；行内 qty 因 name 空被隐藏，不计
    expect(kinds(fields, { items: [{ price: 1 }] })).toEqual(['detail']);
    // 唯一列重复
    const dup = collectWorkflowFormValidationErrors(fields, { items: [
      { name: '甲', qty: 1, price: 1 }, { name: '甲', qty: 2, price: 2 },
    ] });
    expect(dup.map((e) => e.kind)).toEqual(['detail']);
    expect(dup[0].message).toContain('重复');
    // 行内校验公式
    const bad = collectWorkflowFormValidationErrors(fields, { items: [{ name: '甲', qty: 1, price: -5 }] });
    expect(bad[0].message).toContain('单价需为正数');
    // 合法
    expect(kinds(fields, { items: [{ name: '甲', qty: 1, price: 3 }, { name: '乙', qty: 2, price: 4 }] })).toEqual([]);
  });

  it('跳过规则：不可见 / perms hidden|read / readOnly 不参与', () => {
    const fields = [
      f({ key: 'flag', type: 'switch', label: '开关' }),
      f({
        key: 'hiddenByRule', type: 'text', label: '联动隐藏', minLength: 5,
        visibilityRules: { logic: 'and', rules: [{ field: 'flag', operator: 'eq', value: true }] },
      }),
      f({ key: 'ro', type: 'text', label: '只读', readOnly: true, minLength: 5 }),
      f({ key: 'permHidden', type: 'text', label: '权限隐藏', minLength: 5 }),
    ];
    const errors = collectWorkflowFormValidationErrors(
      fields,
      { flag: false, hiddenByRule: 'x', ro: 'x', permHidden: 'x' },
      { permHidden: 'hidden' },
    );
    expect(errors).toEqual([]);
  });

  it('collectMissingRequiredFields 兼容语义不变（仅必填标签列表）', () => {
    const fields = [
      f({ key: 'a', type: 'text', label: '甲', required: true }),
      f({ key: 'b', type: 'text', label: '乙', minLength: 5 }),
    ];
    expect(collectMissingRequiredFields(fields, { b: 'x' })).toEqual(['甲']);
  });
});
