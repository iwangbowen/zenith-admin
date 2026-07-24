import { describe, expect, it } from 'vitest';
import { planCmsSiteMove, validateCmsSiteEnablement } from './cms-site-hierarchy-policy';

describe('CMS site hierarchy policy', () => {
  const rows = [
    { id: 1, parentId: null, status: 'enabled' as const },
    { id: 2, parentId: 1, status: 'enabled' as const },
    { id: 3, parentId: 2, status: 'enabled' as const },
    { id: 4, parentId: null, status: 'enabled' as const },
  ];

  it('rejects self-parent and descendant cycles', () => {
    expect(() => planCmsSiteMove(rows, 2, 2)).toThrow(/自身/);
    expect(() => planCmsSiteMove(rows, 1, 3)).toThrow(/子树/);
  });

  it('preserves the whole subtree and computes its resulting depth', () => {
    expect(planCmsSiteMove(rows, 2, 4)).toMatchObject({
      subtreeIds: [2, 3],
      oldDepth: 2,
      newDepth: 2,
      subtreeHeight: 2,
    });
  });

  it('rejects moves whose subtree would exceed the configured depth', () => {
    const deep = Array.from({ length: 8 }, (_, index) => ({
      id: index + 1,
      parentId: index === 0 ? null : index,
      status: 'enabled' as const,
    }));
    const leafWithChild = [
      ...deep,
      { id: 20, parentId: null, status: 'enabled' as const },
      { id: 21, parentId: 20, status: 'enabled' as const },
    ];
    expect(() => planCmsSiteMove(leafWithChild, 20, 7)).toThrow(/超过 8 层/);
  });

  it('requires enabled ancestors and disabled descendants in status transitions', () => {
    expect(() => validateCmsSiteEnablement(rows, 1, 'disabled')).toThrow(/子站点/);
    const disabledParent = rows.map((row) => row.id === 1 ? { ...row, status: 'disabled' as const } : row);
    expect(() => validateCmsSiteEnablement(disabledParent, 2, 'enabled')).toThrow(/父站点已停用/);
  });
});
