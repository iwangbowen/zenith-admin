import { useState, useEffect } from 'react';
import { Input, Empty, Typography, List as SemiList } from '@douyinfe/semi-ui';
import { Search } from 'lucide-react';
import { UserAvatar } from '@/components/UserAvatar';
import type { ChatUser } from '../types';
import { useChatUsers } from '@/hooks/queries/chat';

const { Text } = Typography;

export function UserSearchList({ onSelect, excludeIds }: Readonly<{ onSelect: (user: ChatUser) => void; excludeIds?: number[] }>) {
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const excludeIdKey = (excludeIds ?? []).join(',');
  const usersQuery = useChatUsers({ keyword: debouncedKeyword || undefined });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword), 300);
    return () => clearTimeout(t);
  }, [keyword]);

  const excludeIdSet = new Set(excludeIdKey ? excludeIdKey.split(',').map(Number) : []);
  const ulist = (usersQuery.data ?? []).filter((u) => !excludeIdSet.has(u.id));

  return (
    <SemiList
      dataSource={ulist}
      loading={usersQuery.isFetching}
      split={false}
      style={{ marginTop: 8, maxHeight: 280, overflowY: 'auto' }}
      header={<Input prefix={<Search size={14} />} placeholder="搜索用户名 / 昵称" value={keyword} onChange={setKeyword} size="small" />}
      emptyContent={<Empty description="暂无用户" style={{ padding: '16px 0' }} imageStyle={{ width: 56 }} />}
      renderItem={(u: ChatUser) => (
        <SemiList.Item
          key={u.id}
          align="center"
          onClick={() => onSelect(u)}
          style={{ padding: '8px 4px', cursor: 'pointer', borderRadius: 6 }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--semi-color-fill-0)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          header={<UserAvatar name={u.nickname} avatar={u.avatar} />}
          main={(
            <div>
              <Text strong style={{ fontSize: 13 }}>{u.nickname}</Text>
              <Text type="tertiary" style={{ fontSize: 12, display: 'block' }}>@{u.username}</Text>
            </div>
          )}
        />
      )}
    />
  );
}
