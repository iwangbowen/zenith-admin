import { useState } from 'react';
import { Button, Input, Tabs, TabPane, Toast } from '@douyinfe/semi-ui';
import { UserSearchList } from './UserSearchList';
import type { ChatConversation } from '@zenith/shared';
import type { ChatUser } from '../types';
import { useCreateChatGroup } from '@/hooks/queries/chat';

export function NewChatPanel({
  onSelectUser, onGroupCreated,
}: Readonly<{
  onSelectUser: (user: ChatUser) => void;
  onGroupCreated: (conv: ChatConversation) => void;
}>) {
  const [groupName, setGroupName] = useState('');
  const createGroupMutation = useCreateChatGroup();

  const handleCreateGroup = async () => {
    if (!groupName.trim()) { Toast.warning('请输入群聊名称'); return; }
    let conv: ChatConversation;
    try {
      conv = await createGroupMutation.mutateAsync(groupName.trim());
    } catch {
      return;
    }
    onGroupCreated(conv);
  };

  return (
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
          />
          <Button type="primary" loading={createGroupMutation.isPending} onClick={() => { void handleCreateGroup(); }} block>
            创建群聊
          </Button>
        </div>
      </TabPane>
    </Tabs>
  );
}
