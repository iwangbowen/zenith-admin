import { describe, it, expect } from 'vitest';
import type { WorkflowFormField } from '@zenith/shared';
import { diffFormFields } from './form-diff';

const f = (partial: Partial<WorkflowFormField> & { key: string; type: WorkflowFormField['type'] }): WorkflowFormField =>
  ({ label: partial.key, ...partial }) as WorkflowFormField;

describe('diffFormFields（F14 变更摘要）', () => {
  it('识别新增 / 删除 / 修改', () => {
    const baseline = [
      f({ key: 'a', type: 'text', label: '甲' }),
      f({ key: 'b', type: 'number', label: '乙', min: 1 }),
    ];
    const current = [
      f({ key: 'a', type: 'text', label: '甲', required: true }),
      f({ key: 'c', type: 'date', label: '丙' }),
    ];
    const diff = diffFormFields(baseline, current);
    expect(diff.find((d) => d.kind === 'added')?.key).toBe('c');
    expect(diff.find((d) => d.kind === 'removed')?.key).toBe('b');
    const modified = diff.find((d) => d.kind === 'modified');
    expect(modified?.key).toBe('a');
    expect(modified?.detail).toContain('必填');
  });

  it('结合重命名映射识别 renamed 而非「删+增」', () => {
    const baseline = [f({ key: 'oldKey', type: 'text', label: '字段' })];
    const current = [f({ key: 'newKey', type: 'text', label: '字段' })];
    const diff = diffFormFields(baseline, current, { oldKey: 'newKey' });
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ kind: 'renamed', key: 'newKey', detail: 'oldKey → newKey' });
  });

  it('重命名 + 属性变更同时报告两条', () => {
    const baseline = [f({ key: 'oldKey', type: 'text', label: '字段' })];
    const current = [f({ key: 'newKey', type: 'text', label: '字段', maxLength: 10 })];
    const diff = diffFormFields(baseline, current, { oldKey: 'newKey' });
    expect(diff.map((d) => d.kind).sort()).toEqual(['modified', 'renamed']);
  });

  it('嵌套容器内字段参与对比；无变更返回空', () => {
    const tree = [
      f({ key: 'grp', type: 'group', label: '组', children: [f({ key: 'inner', type: 'text', label: '内' })] }),
    ];
    expect(diffFormFields(tree, structuredClone(tree))).toHaveLength(0);
    const changed = structuredClone(tree);
    (changed[0].children as WorkflowFormField[])[0].placeholder = 'x';
    const diff = diffFormFields(tree, changed);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ kind: 'modified', key: 'inner' });
  });
});
