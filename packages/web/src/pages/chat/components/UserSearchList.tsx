import { useState, useEffect, useCallback } from 'react';
import { Input, Empty, Typography, List as SemiList } from '@douyinfe/semi-ui';
import { Search } from 'lucide-react';
import { request } from '@/utils/request';
import { UserAvatar } from './UserAvatar';
import type { ChatUser } from '../types';

const { Text } = Typography;

export function UserSearchList({ onSelect, excludeIds }: Readonly<{ onSelect: (user: ChatUser) => void; excludeIds?: number[] }>) {
  const [keyword, setKeyword] = useState('');
  const [ulist, setUlist] = useState<ChatUser[]>([]);
  const [loading, setLoading] = useState(false);
  const excludeIdKey = (excludeIds ?? []).join(',');

  const search = useCallback(async (kw: string) => {
    setLoading(true);
    const qs = kw ? `?keyword=${encodeURIComponent(kw)}` : '';
    const res = await request.get<ChatUser[]>(`/api/chat/users${qs}`, { silent: true });
    setLoading(false);
    const excludeIdSet = new Set(excludeIdKey ? excludeIdKey.split(',').map((id) => Number(id)) : []);
    if (res.code === 0 && res.data) setUlist(res.data.filter((u) => !excludeIdSet.has(u.id)));
  }, [excludeIdKey]);

  useEffect(() => { void search(''); }, [search]);
  useEffect(() => {
    const t = setTimeout(() => { void search(keyword); }, 300);
    return () => clearTimeout(t);
  }, [keyword, search]);

  return (
    <SemiList
      dataSource={ulist}
      loading={loading}
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
