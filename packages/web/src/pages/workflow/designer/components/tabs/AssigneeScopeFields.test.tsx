import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@douyinfe/semi-ui', () => ({
  Form: {
    Slot: ({ label, children }: { label: ReactNode; children: ReactNode }) => (
      <label>
        <span>{label}</span>
        {children}
      </label>
    ),
  },
  InputNumber: ({ value, onChange }: { value: number; onChange: (value: number) => void }) => (
    <input value={value} onChange={(event) => onChange(Number(event.target.value))} />
  ),
  Radio: ({ value, children }: { value: string; children: ReactNode }) => (
    <button type="button" data-value={value}>{children}</button>
  ),
  RadioGroup: ({ children, onChange }: { children: ReactNode; onChange: (event: { target: { value: string } }) => void }) => (
    <div
      onClick={(event) => {
        const value = (event.target as HTMLElement).closest('button')?.dataset.value;
        if (value) onChange({ target: { value } });
      }}
    >
      {children}
    </div>
  ),
  Select: ({ optionList = [], onChange, multiple }: {
    optionList?: Array<{ value: number | string; label: string }>;
    onChange: (value: unknown) => void;
    multiple?: boolean;
  }) => (
    <div>
      {optionList.map((option) => (
        <button
          type="button"
          key={String(option.value)}
          onClick={() => onChange(multiple ? [option.value] : option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
  Typography: {
    Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  },
}));

import { MultiLevelEndFields, SelectScopeFields } from './AssigneeScopeFields';

describe('AssigneeScopeFields', () => {
  it('emits scope type changes and clears selected scope ids', () => {
    const onChange = vi.fn();
    render(
      <SelectScopeFields
        scopeType="user"
        scopeIds={[1]}
        scopeOptions={[{ value: 1, label: '张三' }]}
        label="可选范围"
        allowEmpty={false}
        help="发起人在发起申请时，需在上述范围内挑选具体审批人"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText('角色'));
    expect(onChange).toHaveBeenCalledWith({ selectScopeType: 'role', selectScopeIds: [] });
  });

  it('emits scope id changes for the approver-select variant', () => {
    const onChange = vi.fn();
    render(
      <SelectScopeFields
        scopeType="role"
        scopeIds={[]}
        scopeOptions={[{ value: 2, label: '主管' }]}
        label="可选范围（留空=无范围限制）"
        allowEmpty
        help="上一节点审批人在审批通过时，需为本节点选择具体审批人"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText('主管'));
    expect(onChange).toHaveBeenCalledWith({ selectScopeIds: [2] });
  });

  it('emits manager multi-level endpoint patches including role endpoint', () => {
    const onChange = vi.fn();
    render(
      <MultiLevelEndFields
        endType="role"
        endLevel={1}
        endRoleId={1}
        roles={[{ id: 1, name: '总监' }, { id: 2, name: 'VP' }]}
        includeRole
        topLevelLabel="最高层级（直到没有上级）"
        help="从发起人的直属上级开始，逐级向上审批，直至审批终点"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText('VP'));
    expect(onChange).toHaveBeenCalledWith({ multiLevelEndRoleId: 2 });
  });

  it('emits department-head level endpoint patches without role endpoint', () => {
    const onChange = vi.fn();
    render(
      <MultiLevelEndFields
        endType="level"
        endLevel={2}
        roles={[{ id: 1, name: '总监' }]}
        includeRole={false}
        topLevelLabel="最高层级（直到没有上级部门）"
        help="从发起人的直属部门负责人开始，逐级向上审批"
        onChange={onChange}
      />,
    );

    expect(screen.queryByText('指定角色')).not.toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('2'), { target: { value: '3' } });
    expect(onChange).toHaveBeenCalledWith({ multiLevelEndLevel: 3 });
  });
});
