import { useMemo, useState } from 'react';
import { Button, Select, Space, Table, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, Trash2 } from 'lucide-react';
import {
  DRIVE_ROLE_DESCRIPTIONS,
  DRIVE_ROLE_LABELS,
  DRIVE_ROLE_OPTIONS,
  DRIVE_SUBJECT_TYPE_LABELS,
  DRIVE_SUBJECT_TYPE_OPTIONS,
  type DriveRole,
  type DriveSubjectType,
} from '@zenith/shared/drive';
import UserSelect from '@/components/UserSelect';
import DepartmentSelect from '@/components/DepartmentSelect';
import { useAllRoles } from '@/hooks/queries/roles';
import { useUserGroupList } from '@/hooks/queries/user-groups';
import { useAllUsers } from '@/hooks/queries/users';
import { useFlatDepartments } from '@/hooks/queries/departments';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

export interface SubjectGrant {
  subjectType: DriveSubjectType;
  subjectId: number;
  role: DriveRole;
  /** 面板展示名（服务端返回的现有授权自带；新加的由选择器解析） */
  subjectName?: string | null;
}

interface DriveSubjectPickerProps {
  readonly value: SubjectGrant[];
  readonly onChange: (next: SubjectGrant[]) => void;
  readonly disabled?: boolean;
  /** 只允许的主体类型；缺省四类全部 */
  readonly subjectTypes?: readonly DriveSubjectType[];
  /** 表格空态文案 */
  readonly emptyText?: string;
}

const SUBJECT_TAG_COLOR: Record<DriveSubjectType, 'blue' | 'green' | 'orange' | 'purple'> = {
  user: 'blue', department: 'green', role: 'orange', user_group: 'purple',
};

/**
 * 四类授权主体（用户 / 部门 / 角色 / 用户组）× 角色 的统一编辑器。
 * 空间成员与节点授权共用：上方「添加」行，下方为已授权列表（可改角色 / 移除）。
 */
export function DriveSubjectPicker({ value, onChange, disabled, subjectTypes, emptyText = '尚未添加协作者' }: DriveSubjectPickerProps) {
  const [subjectType, setSubjectType] = useState<DriveSubjectType>('user');
  const [subjectIds, setSubjectIds] = useState<number[]>([]);
  const [role, setRole] = useState<DriveRole>('viewer');
  const { data: roles } = useAllRoles({ enabled: subjectType === 'role' });
  const groupsQuery = useUserGroupList({ page: 1, pageSize: 200 }, subjectType === 'user_group');
  const { data: users } = useAllUsers();
  const { data: departments } = useFlatDepartments();

  const typeOptions = useMemo(
    () => DRIVE_SUBJECT_TYPE_OPTIONS.filter((o) => !subjectTypes || subjectTypes.includes(o.value)),
    [subjectTypes],
  );

  const nameOf = (type: DriveSubjectType, id: number): string | null => {
    switch (type) {
      case 'user': return users?.find((u) => u.id === id)?.nickname ?? null;
      case 'department': return departments?.find((d) => d.id === id)?.name ?? null;
      case 'role': return roles?.find((r) => r.id === id)?.name ?? null;
      case 'user_group': return groupsQuery.data?.list.find((g) => g.id === id)?.name ?? null;
      default: return null;
    }
  };

  const add = () => {
    if (subjectIds.length === 0) return;
    const existing = new Set(value.map((v) => `${v.subjectType}:${v.subjectId}`));
    const additions: SubjectGrant[] = subjectIds
      .filter((id) => !existing.has(`${subjectType}:${id}`))
      .map((id) => ({ subjectType, subjectId: id, role, subjectName: nameOf(subjectType, id) }));
    // 已存在的同主体：更新角色
    const updated = value.map((v) => (v.subjectType === subjectType && subjectIds.includes(v.subjectId) ? { ...v, role } : v));
    onChange([...updated, ...additions]);
    setSubjectIds([]);
  };

  const commonSelectProps = { multiple: true, value: subjectIds, onChange: (v: number | number[] | undefined) => setSubjectIds(Array.isArray(v) ? v : v ? [v] : []) };
  const subjectSelect = subjectType === 'user'
    ? <UserSelect {...commonSelectProps} placeholder="选择用户" />
    : subjectType === 'department'
      ? <DepartmentSelect {...commonSelectProps} placeholder="选择部门（含子部门成员）" />
      : subjectType === 'role'
        ? (
            <Select multiple filter maxTagCount={3} style={{ width: '100%' }} placeholder="选择角色" value={subjectIds}
              onChange={(v) => setSubjectIds((v as number[]) ?? [])}
              optionList={(roles ?? []).map((r) => ({ value: r.id, label: r.name }))} />
          )
        : (
            <Select multiple filter maxTagCount={3} style={{ width: '100%' }} placeholder="选择用户组" value={subjectIds}
              loading={groupsQuery.isPending}
              onChange={(v) => setSubjectIds((v as number[]) ?? [])}
              optionList={(groupsQuery.data?.list ?? []).map((g) => ({ value: g.id, label: g.name }))} />
          );

  const columns: ColumnProps<SubjectGrant>[] = [
    {
      title: '主体', dataIndex: 'subjectName', minWidth: 160,
      render: (_: unknown, r: SubjectGrant) => (
        <Space>
          <Tag color={SUBJECT_TAG_COLOR[r.subjectType]} size="small">{DRIVE_SUBJECT_TYPE_LABELS[r.subjectType]}</Tag>
          <Typography.Text>{r.subjectName ?? nameOf(r.subjectType, r.subjectId) ?? `#${r.subjectId}`}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '角色', dataIndex: 'role', width: 150,
      render: (_: unknown, r: SubjectGrant) => (
        <Select size="small" style={{ width: 120 }} value={r.role} disabled={disabled}
          onChange={(v) => onChange(value.map((x) => (x === r ? { ...x, role: v as DriveRole } : x)))}
          optionList={DRIVE_ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
      ),
    },
    {
      title: '', dataIndex: 'actions', width: 60,
      render: (_: unknown, r: SubjectGrant) => (
        <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={14} />} disabled={disabled}
          aria-label="移除" onClick={() => onChange(value.filter((x) => x !== r))} />
      ),
    },
  ];

  return (
    <div className="drive-subject-picker">
      {!disabled && (
        <div className="drive-subject-picker__add">
          <Select style={{ width: 110 }} value={subjectType} onChange={(v) => { setSubjectType(v as DriveSubjectType); setSubjectIds([]); }}
            optionList={typeOptions.map((o) => ({ value: o.value, label: o.label }))} />
          <div style={{ flex: 1, minWidth: 160 }}>{subjectSelect}</div>
          <Select style={{ width: 110 }} value={role} onChange={(v) => setRole(v as DriveRole)}
            optionList={DRIVE_ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            renderOptionItem={(item) => (
              // Semi 自定义选项必须自行接管点击 / 悬停事件与选中态样式
              <div
                role="option"
                aria-selected={item.selected}
                className={`semi-select-option drive-subject-picker__role-option${item.selected ? ' semi-select-option-selected' : ''}${item.focused ? ' semi-select-option-focused' : ''}`}
                onClick={(e) => item.onClick?.(e)}
                onMouseEnter={(e) => item.onMouseEnter?.(e)}
                onKeyDown={(e) => { if (e.key === 'Enter') item.onClick?.(e as unknown as React.MouseEvent); }}
                tabIndex={-1}
              >
                <div>{item.label}</div>
                <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)' }}>{DRIVE_ROLE_DESCRIPTIONS[item.value as DriveRole]}</div>
              </div>
            )} />
          <Button icon={<Plus size={14} />} theme="solid" onClick={add} disabled={subjectIds.length === 0}>添加</Button>
        </div>
      )}
      <Table<SubjectGrant> size="small" columns={columns} dataSource={value} pagination={false}
        rowKey={(r) => `${r?.subjectType}:${r?.subjectId}`} empty={emptyText} />
      <Typography.Text type="tertiary" size="small">
        {DRIVE_ROLE_OPTIONS.map((o) => `${DRIVE_ROLE_LABELS[o.value]}：${DRIVE_ROLE_DESCRIPTIONS[o.value]}`).join('；')}
      </Typography.Text>
      <span hidden>{EMPTY_PLACEHOLDER}</span>
    </div>
  );
}
