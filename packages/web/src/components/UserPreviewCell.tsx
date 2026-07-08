import { Avatar, AvatarGroup, Space, Tag } from '@douyinfe/semi-ui';

export interface UserPreviewItem {
  id: number;
  nickname: string;
  avatar?: string | null;
}

interface UserPreviewCellProps {
  /** 预览成员列表（最多展示 4 个头像） */
  readonly preview?: UserPreviewItem[] | null;
  /** 成员总数（为 0 时仅显示数量 Tag） */
  readonly count?: number | null;
}

/** 表格「成员 / 用户」列单元格：头像组 + 数量 Tag，Departments / Roles / Positions / UserGroups 等列表页共用 */
export function UserPreviewCell({ preview, count }: UserPreviewCellProps) {
  const list = preview ?? [];
  const total = count ?? 0;
  if (total === 0) return <Tag color="blue">0</Tag>;
  return (
    <Space spacing={6}>
      <AvatarGroup maxCount={4} size="extra-extra-small" overlapFrom="end">
        {list.map((m) => (
          <Avatar
            key={m.id}
            style={{ width: 22, height: 22, minWidth: 22, lineHeight: '22px', fontSize: 12, cursor: 'default' }}
            src={m.avatar ?? undefined}
            alt={m.nickname}
            color="light-blue"
            title={m.nickname}
          >
            {m.nickname?.[0]}
          </Avatar>
        ))}
      </AvatarGroup>
      <Tag color="blue" style={{ flexShrink: 0 }}>{total}</Tag>
    </Space>
  );
}
