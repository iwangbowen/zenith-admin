/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react';
import { Empty, SideSheet, Spin, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps, Data } from '@douyinfe/semi-ui/lib/es/table';
import { Users } from 'lucide-react';
import { UserPreviewCell, type UserPreviewItem, type UserPreviewScope } from '@/components/UserPreviewCell';
import { UserTransferSelect, type UserTransferUser } from '@/components/UserTransferSelect';
import type { Department } from '@zenith/shared/identity';
import ModalFooter from '@/components/ModalFooter';

export interface MemberAssignmentSheetProps<TUser extends UserTransferUser> {
  readonly title: ReactNode;
  readonly visible: boolean;
  readonly onCancel: () => void;
  readonly users: TUser[];
  readonly value: number[];
  readonly onChange: (ids: number[]) => void;
  readonly departments?: Department[];
  readonly loading?: boolean;
  readonly canSave?: boolean;
  readonly saveLoading?: boolean;
  readonly onSave: () => Promise<unknown> | unknown;
  readonly width?: number;
  readonly emptyTitle?: ReactNode;
  readonly emptyDescription?: ReactNode;
}

/** 成员分配抽屉：统一标题、候选用户穿梭框与右对齐保存页脚。 */
export function MemberAssignmentSheet<TUser extends UserTransferUser>({
  title,
  visible,
  onCancel,
  users,
  value,
  onChange,
  departments,
  loading,
  canSave = true,
  saveLoading,
  onSave,
  width = 720,
  emptyTitle = '暂无用户',
  emptyDescription = '请先创建用户',
}: MemberAssignmentSheetProps<TUser>) {
  const handleSave = async () => {
    await onSave();
    Toast.success('保存成功');
  };

  return (
    <SideSheet
      title={(
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Users size={16} />
          <span>{title}</span>
        </span>
      )}
      visible={visible}
      onCancel={onCancel}
      width={width}
      footer={<ModalFooter onCancel={onCancel} onOk={handleSave} okText="保存" loading={saveLoading} disabled={!canSave} />}
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : users.length === 0 ? (
        <Empty title={emptyTitle} description={emptyDescription} />
      ) : (
        <UserTransferSelect
          dataSource={users}
          value={value}
          onChange={onChange}
          departments={departments}
        />
      )}
    </SideSheet>
  );
}

export interface MemberPreviewColumnOptions<T extends Data> {
  readonly title?: ReactNode;
  readonly dataIndex: string;
  readonly width?: number;
  readonly getPreview: (record: T) => UserPreviewItem[] | null | undefined;
  readonly getCount: (record: T) => number | null | undefined;
  readonly getScope?: (record: T) => UserPreviewScope | undefined;
}

/** 成员预览列：头像组、成员数与按范围查看入口。 */
export function memberPreviewColumn<T extends Data>({
  title = '成员',
  dataIndex,
  width,
  getPreview,
  getCount,
  getScope,
}: MemberPreviewColumnOptions<T>): ColumnProps<T> {
  return {
    title,
    dataIndex,
    ...(width === undefined ? {} : { width }),
    render: (_: unknown, record: T) => (
      <UserPreviewCell preview={getPreview(record)} count={getCount(record)} scope={getScope?.(record)} />
    ),
  };
}
