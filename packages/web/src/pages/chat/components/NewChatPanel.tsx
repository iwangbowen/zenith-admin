import { useState } from 'react';
import { Button, Input, Tabs, TabPane, Toast, Typography } from '@douyinfe/semi-ui';
import { request } from '@/utils/request';
import { UserSearchList } from './UserSearchList';
import type { ChatConversation } from '@zenith/shared';
import type { ChatUser } from '../types';

const { Title } = Typography;

export function NewChatPanel({
  onSelectUser, onGroupCreated, onClose,
}: Readonly<{
  onSelectUser: (user: ChatUser) => void;
  onGroupCreated: (conv: ChatConversation) => void;
  onClose: () => void;
}>) {
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreateGroup = async () => {
    if (!groupName.trim()) { Toast.warning('请输入群聊名称'); return; }
    setCreating(true);
    const res = await request.post<ChatConversation>('/api/chat/conversations/group', { name: groupName.trim() });
    setCreating(false);
    if (res.code === 0 && res.data) {
      onGroupCreated(res.data);
    } else {
      Toast.error(res.message ?? '创建失败');
    }
  };

  return (
    <div style={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 8 }}>
        <Title heading={6} style={{ margin: 0, flex: 1 }}>新建对话</Title>
        <Button size="small" type="tertiary" theme="borderless" onClick={onClose}>取消</Button>
      </div>
      <Tabs size="small" defaultActiveKey="direct">
        <TabPane tab="私聊" itemKey="direct">
          <div style={{ paddingTop: 8 }}>
            <UserSearchList onSelect={onSelectUser} />
          </div>
        </TabPane>
        <TabPane tab="创建群聊" itemKey="group">
          <div style={{ paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Input
              placeholder="群聊名称（最多 64 字符）"
              value={groupName}
              onChange={setGroupName}
              maxLength={64}
              size="small"
            />
            <Button type="primary" size="small" loading={creating} onClick={() => { void handleCreateGroup(); }} block>
              创建群聊
            </Button>
          </div>
        </TabPane>
      </Tabs>
    </div>
  );
}
