// ─── 节点级表单字段权限（shared 纯函数）单元测试 ────────────────────────────────
import { describe, expect, it } from 'vitest';
import {
  applyFieldPermissionsToFields,
  hasEditableFieldPermission,
  resolveNodeFieldPermissions,
  sanitizeFormUpdatesByNodePerms,
} from '@zenith/shared';
import type { WorkflowFieldPermission, WorkflowFlowData, WorkflowFormField } from '@zenith/shared';

const flowData = {
  nodes: [
    { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
    {
      id: 'n2', position: { x: 0, y: 0 },
      data: {
        key: 'approve_1', type: 'approve', label: '主管审批',
        fieldPermissions: { amount: 'edit', reason: 'read', secret: 'hidden' },
      },
    },
    { id: 'n3', position: { x: 0, y: 0 }, data: { key: 'approve_2', type: 'approve', label: '经理审批' } },
  ],
  edges: [],
} as unknown as WorkflowFlowData;

describe('resolveNodeFieldPermissions', () => {
  it('返回节点配置的权限表', () => {
    expect(resolveNodeFieldPermissions(flowData, 'approve_1')).toEqual({ amount: 'edit', reason: 'read', secret: 'hidden' });
  });
  it('节点不存在 / 未配置 / flowData 为空时返回 undefined', () => {
    expect(resolveNodeFieldPermissions(flowData, 'missing')).toBeUndefined();
    expect(resolveNodeFieldPermissions(flowData, 'approve_2')).toBeUndefined();
    expect(resolveNodeFieldPermissions(null, 'approve_1')).toBeUndefined();
  });
});

describe('hasEditableFieldPermission', () => {
  it('存在 edit 字段时为 true，否则为 false', () => {
    expect(hasEditableFieldPermission({ a: 'edit', b: 'read' })).toBe(true);
    expect(hasEditableFieldPermission({ a: 'read', b: 'hidden' })).toBe(false);
    expect(hasEditableFieldPermission(undefined)).toBe(false);
  });
});

describe('sanitizeFormUpdatesByNodePerms', () => {
  const perms: Record<string, WorkflowFieldPermission> = { amount: 'edit', reason: 'read', secret: 'hidden' };
  it('仅保留 edit 字段，read/hidden/未声明字段全部丢弃', () => {
    expect(sanitizeFormUpdatesByNodePerms(perms, { amount: 100, reason: 'hack', secret: 'leak', other: 'x' }))
      .toEqual({ amount: 100 });
  });
  it('节点无权限配置时视为无可写字段（写权限必须显式声明）', () => {
    expect(sanitizeFormUpdatesByNodePerms(undefined, { amount: 100 })).toEqual({});
    expect(sanitizeFormUpdatesByNodePerms({}, { amount: 100 })).toEqual({});
  });
  it('updates 为空时返回空对象', () => {
    expect(sanitizeFormUpdatesByNodePerms(perms, undefined)).toEqual({});
  });
});

describe('applyFieldPermissionsToFields', () => {
  const fields: WorkflowFormField[] = [
    { key: 'amount', label: '金额', type: 'amount', required: true },
    { key: 'reason', label: '事由', type: 'text', required: true },
    { key: 'secret', label: '密级', type: 'text' },
    {
      key: 'layout', label: '分栏', type: 'row',
      columns: [
        { span: 12, fields: [{ key: 'inner_secret', label: '内部字段', type: 'text' }] },
        { span: 12, fields: [{ key: 'inner_edit', label: '内部可编辑', type: 'text' }] },
      ],
    },
    {
      key: 'items', label: '明细', type: 'detail',
      children: [{ key: 'price', label: '单价', type: 'number' }],
    },
  ];
  const perms: Record<string, WorkflowFieldPermission> = {
    amount: 'edit', reason: 'read', secret: 'hidden', inner_secret: 'hidden', inner_edit: 'edit',
  };

  it('hidden 字段（含容器内嵌套）被移除', () => {
    const out = applyFieldPermissionsToFields(fields, perms);
    const flat = JSON.stringify(out);
    expect(flat).not.toContain('"secret"');
    expect(flat).not.toContain('inner_secret');
    expect(flat).toContain('inner_edit');
  });

  it('edit 字段保持可编辑，read/未配置字段置为只读且取消必填', () => {
    const out = applyFieldPermissionsToFields(fields, perms);
    const amount = out.find((f) => f.key === 'amount');
    const reason = out.find((f) => f.key === 'reason');
    const items = out.find((f) => f.key === 'items');
    expect(amount?.readOnly).toBeUndefined();
    expect(amount?.required).toBe(true);
    expect(reason?.readOnly).toBe(true);
    expect(reason?.required).toBe(false);
    // 未在权限表中的容器与其子列默认只读
    expect(items?.readOnly).toBe(true);
  });

  it('权限表为空时原样返回（引用不变）', () => {
    expect(applyFieldPermissionsToFields(fields, undefined)).toBe(fields);
    expect(applyFieldPermissionsToFields(fields, {})).toBe(fields);
  });

  it('不修改入参（返回新数组）', () => {
    const before = JSON.stringify(fields);
    applyFieldPermissionsToFields(fields, perms);
    expect(JSON.stringify(fields)).toBe(before);
  });
});
