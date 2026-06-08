import { Checkbox, Transfer } from '@douyinfe/semi-ui';
import { X } from 'lucide-react';
import { UserAvatar } from './UserAvatar';

export interface UserTransferUser {
  id: number;
  username: string;
  nickname: string;
  avatar?: string | null;
  departmentName?: string | null;
}

interface UserTransferSelectProps {
  dataSource: UserTransferUser[];
  value: number[];
  onChange: (ids: number[]) => void;
}

interface TransferDataItem {
  key: string;
  value: number;
  label: string;
  disabled: boolean;
  _username: string;
  _avatar?: string | null;
  _departmentName?: string | null;
}

type SourceItem = TransferDataItem & {
  onChange: (value: string | number) => void;
  checked: boolean;
};

type SelectedItem = TransferDataItem & {
  onRemove: () => void;
};

/**
 * 用户穿梭框选择器，展示头像、昵称、账号和部门名称。
 * 两个页面（岗位管理、用户组）共用此组件。
 */
export function UserTransferSelect({ dataSource, value, onChange }: Readonly<UserTransferSelectProps>) {
  const transferData: TransferDataItem[] = dataSource.map((u) => ({
    key: String(u.id),
    value: u.id,
    label: u.nickname,
    disabled: false,
    _username: u.username,
    _avatar: u.avatar,
    _departmentName: u.departmentName,
  }));

  const filter = (input: string, item: TransferDataItem) => {
    const q = input.toLowerCase();
    return (
      item._username.toLowerCase().includes(q) ||
      item.label.toLowerCase().includes(q) ||
      (item._departmentName ?? '').toLowerCase().includes(q)
    );
  };

  const renderSourceItem = (item: SourceItem) => (
    <div
      key={item.key}
      style={{
        height: 52,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
      }}
    >
      <Checkbox
        onChange={() => item.onChange(item.value)}
        checked={item.checked}
        style={{ display: 'flex', alignItems: 'center', width: '100%' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <UserAvatar
            name={item.label}
            avatar={item._avatar}
            size={32}
            semiSize="small"
            style={{ flexShrink: 0 }}
          />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                lineHeight: '20px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.label}
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--semi-color-text-2)',
                  marginLeft: 4,
                  fontWeight: 400,
                }}
              >
                {item._username}
              </span>
            </div>
            {item._departmentName && (
              <div
                style={{
                  fontSize: 12,
                  lineHeight: '16px',
                  color: 'var(--semi-color-text-2)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item._departmentName}
              </div>
            )}
          </div>
        </div>
      </Checkbox>
    </div>
  );

  const renderSelectedItem = (item: SelectedItem) => (
    <div
      key={item.key}
      style={{
        height: 52,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 10,
        justifyContent: 'space-between',
      }}
    >
      <UserAvatar
        name={item.label}
        avatar={item._avatar}
        size={32}
        semiSize="small"
        style={{ flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            lineHeight: '20px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.label}
          <span
            style={{
              fontSize: 12,
              color: 'var(--semi-color-text-2)',
              marginLeft: 4,
              fontWeight: 400,
            }}
          >
            {item._username}
          </span>
        </div>
        {item._departmentName && (
          <div
            style={{
              fontSize: 12,
              lineHeight: '16px',
              color: 'var(--semi-color-text-2)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item._departmentName}
          </div>
        )}
      </div>
      <X
        size={14}
        onClick={item.onRemove}
        style={{ cursor: 'pointer', color: 'var(--semi-color-text-2)', flexShrink: 0 }}
      />
    </div>
  );

  return (
    <Transfer
      style={{ width: '100%' }}
      dataSource={transferData}
      value={value}
      onChange={(values) => onChange((values as number[]) || [])}
      filter={filter}
      renderSourceItem={renderSourceItem as (item: unknown) => React.ReactNode}
      renderSelectedItem={renderSelectedItem as (item: unknown) => React.ReactNode}
      inputProps={{ placeholder: '搜索姓名、账号、部门' }}
      emptyContent={{ left: '暂无可选用户', right: '暂无成员', search: '无匹配用户' }}
    />
  );
}
