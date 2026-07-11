import { describe, it, expect } from 'vitest';
import type { WorkflowFormField } from '@zenith/shared';
import {
  findField,
  updateField,
  removeField,
  insertField,
  isDescendant,
  flattenAllFields,
  renameFieldKey,
  formulaReferencesKey,
  findFieldDependents,
  pruneFieldReferences,
} from './form-tree';

/** 构造嵌套树：顶层 text + 分栏(row) 内含 amount，明细(detail) 内含 price */
function makeTree(): WorkflowFormField[] {
  return [
    { key: 'name', label: '姓名', type: 'text' },
    {
      key: 'layout', label: '分栏', type: 'row',
      columns: [
        { fields: [{ key: 'amount', label: '金额', type: 'number' }] },
        { fields: [] },
      ],
    },
    {
      key: 'items', label: '明细', type: 'detail',
      children: [{ key: 'price', label: '单价', type: 'number' }],
    },
  ] as unknown as WorkflowFormField[];
}

describe('form-tree 查找与遍历', () => {
  it('findField 递归命中分栏列与明细子字段', () => {
    const tree = makeTree();
    expect(findField(tree, 'name')?.label).toBe('姓名');
    expect(findField(tree, 'amount')?.label).toBe('金额');
    expect(findField(tree, 'price')?.label).toBe('单价');
    expect(findField(tree, 'missing')).toBeNull();
  });

  it('flattenAllFields 展开全部层级', () => {
    const keys = flattenAllFields(makeTree()).map((f) => f.key);
    expect(keys).toEqual(['name', 'layout', 'amount', 'items', 'price']);
  });

  it('isDescendant 判断容器包含关系', () => {
    const tree = makeTree();
    expect(isDescendant(tree, 'layout', 'amount')).toBe(true);
    expect(isDescendant(tree, 'items', 'price')).toBe(true);
    expect(isDescendant(tree, 'layout', 'price')).toBe(false);
  });
});

describe('form-tree 增删改（不可变）', () => {
  it('updateField 深层更新且不改原树', () => {
    const tree = makeTree();
    const next = updateField(tree, 'amount', { label: '总金额' });
    expect(findField(next, 'amount')?.label).toBe('总金额');
    expect(findField(tree, 'amount')?.label).toBe('金额');
  });

  it('removeField 从嵌套容器删除并返回被删字段', () => {
    const [next, removed] = removeField(makeTree(), 'amount');
    expect(removed?.key).toBe('amount');
    expect(findField(next, 'amount')).toBeNull();
    expect(findField(next, 'layout')).not.toBeNull();
  });

  it('removeField 未命中返回 null', () => {
    const [next, removed] = removeField(makeTree(), 'missing');
    expect(removed).toBeNull();
    expect(flattenAllFields(next)).toHaveLength(5);
  });

  it('insertField 支持 root 定位与 beforeKey', () => {
    const field = { key: 'new', label: '新字段', type: 'text' } as WorkflowFormField;
    const appended = insertField(makeTree(), { container: 'root' }, field);
    expect(appended[appended.length - 1].key).toBe('new');
    const before = insertField(makeTree(), { container: 'root', beforeKey: 'layout' }, field);
    expect(before.map((f) => f.key)).toEqual(['name', 'new', 'layout', 'items']);
  });

  it('insertField 插入分栏列', () => {
    const field = { key: 'new', label: '新字段', type: 'text' } as WorkflowFormField;
    const next = insertField(makeTree(), { container: 'col', rowKey: 'layout', colIndex: 1 }, field);
    expect(isDescendant(next, 'layout', 'new')).toBe(true);
  });
});

describe('form-tree 引用维护', () => {
  it('formulaReferencesKey 匹配普通引用与明细列引用', () => {
    expect(formulaReferencesKey('SUM({items.price})', 'items')).toBe(true);
    expect(formulaReferencesKey('{amount} * 2', 'amount')).toBe(true);
    expect(formulaReferencesKey('{amount2} * 2', 'amount')).toBe(false);
    expect(formulaReferencesKey(undefined, 'amount')).toBe(false);
  });

  it('renameFieldKey 级联更新公式 / 联动规则 / 级联父字段', () => {
    const tree: WorkflowFormField[] = [
      { key: 'a', label: 'A', type: 'number' },
      { key: 'total', label: '合计', type: 'formula', formula: '{a} * 2' },
      {
        key: 'b', label: 'B', type: 'text',
        visibilityRules: { logic: 'and', rules: [{ field: 'a', operator: 'eq', value: 1 }] },
      },
    ] as unknown as WorkflowFormField[];
    const next = renameFieldKey(tree, 'a', 'a2');
    expect(findField(next, 'a')).toBeNull();
    expect(findField(next, 'a2')).not.toBeNull();
    expect(findField(next, 'total')?.formula).toBe('{a2} * 2');
    expect(findField(next, 'b')?.visibilityRules?.rules[0].field).toBe('a2');
  });

  it('findFieldDependents 汇总依赖原因', () => {
    const tree: WorkflowFormField[] = [
      { key: 'a', label: 'A', type: 'number' },
      { key: 'total', label: '合计', type: 'formula', formula: 'SUM({a})' },
      {
        key: 'b', label: 'B', type: 'text',
        visibilityRules: { logic: 'and', rules: [{ field: 'a', operator: 'eq', value: 1 }] },
      },
    ] as unknown as WorkflowFormField[];
    const deps = findFieldDependents(tree, 'a');
    const byKey = new Map(deps.map((d) => [d.field.key, d.reasons]));
    expect(byKey.get('total')).toContain('公式引用');
    expect(byKey.get('b')).toContain('联动规则');
  });

  it('pruneFieldReferences 清理孤儿引用但保留公式', () => {
    const tree: WorkflowFormField[] = [
      {
        key: 'b', label: 'B', type: 'text',
        visibilityRules: { logic: 'and', rules: [{ field: 'a', operator: 'eq', value: 1 }] },
        daysFromKey: 'a',
      },
      { key: 'total', label: '合计', type: 'formula', formula: 'SUM({a})' },
    ] as unknown as WorkflowFormField[];
    const next = pruneFieldReferences(tree, 'a');
    const b = findField(next, 'b');
    expect(b?.visibilityRules).toBeUndefined();
    expect(b?.daysFromKey).toBeUndefined();
    // 公式保留，交由 validateFormSchema 提示
    expect(findField(next, 'total')?.formula).toBe('SUM({a})');
  });
});
