import { useMemo } from 'react';
import { Space, Spin, Tree, Typography } from '@douyinfe/semi-ui';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { Building2 } from 'lucide-react';
import { UserAvatar } from '@/components/UserAvatar';
import { useChatOrgData } from '@/hooks/queries/chat';
import { usePinyinReady } from '@/hooks/usePinyinReady';
import { textMatches } from '@/utils/pinyin';
import type { ChatOrgUser } from '@zenith/shared/chat';
import type { ChatUser } from '../types';

const { Text } = Typography;

const USER_KEY_PREFIX = 'u-';
const DEPT_KEY_PREFIX = 'd-';
const UNASSIGNED_KEY = 'd-unassigned';

function userKey(id: number): string {
  return `${USER_KEY_PREFIX}${id}`;
}

/**
 * 组织架构选人树（部门 → 成员）。
 * - 单选模式：点击成员触发 onSelectUser（用于发起私聊/添加群成员）
 * - 多选模式：勾选成员或整个部门，onChange 返回选中的用户列表（用于建群选人）
 */
export function OrgTreePicker({
  multiple = false, excludeIds, value, onChange, onSelectUser, height = 320,
}: Readonly<{
  multiple?: boolean;
  /** 需要排除的用户 ID（如已在群内的成员） */
  excludeIds?: number[];
  /** 多选模式：受控选中的用户 ID 列表 */
  value?: number[];
  /** 多选模式：选中变化回调 */
  onChange?: (users: ChatUser[]) => void;
  /** 单选模式：点击成员回调 */
  onSelectUser?: (user: ChatUser) => void;
  height?: number;
}>) {
  const orgQuery = useChatOrgData();

  const { treeData, userMap, deptUserMap } = useMemo(() => {
    const departments = orgQuery.data?.departments ?? [];
    const users = (orgQuery.data?.users ?? []).filter((u) => !excludeIds?.includes(u.id));

    const uMap = new Map<number, ChatOrgUser>(users.map((u) => [u.id, u]));

    const makeUserNode = (u: ChatOrgUser): TreeNodeData => ({
      key: userKey(u.id),
      value: userKey(u.id),
      label: (
        <Space spacing={6}>
          <UserAvatar name={u.nickname} avatar={u.avatar} size={20} />
          <span style={{ fontSize: 12 }}>{u.nickname}</span>
          <Text type="tertiary" style={{ fontSize: 11 }}>@{u.username}</Text>
        </Space>
      ),
      // 供内置搜索匹配
      filterLabel: `${u.nickname} ${u.username}`,
    } as TreeNodeData);

    const deptNodes = new Map<number, TreeNodeData>();
    for (const d of departments) {
      deptNodes.set(d.id, {
        key: `${DEPT_KEY_PREFIX}${d.id}`,
        value: `${DEPT_KEY_PREFIX}${d.id}`,
        label: (
          <Space spacing={6}>
            <Building2 size={13} style={{ color: 'var(--semi-color-text-2)' }} />
            <span style={{ fontSize: 12, fontWeight: 500 }}>{d.name}</span>
          </Space>
        ),
        filterLabel: d.name,
        children: [],
      } as TreeNodeData);
    }

    const roots: TreeNodeData[] = [];
    for (const d of departments) {
      const node = deptNodes.get(d.id)!;
      const parent = d.parentId ? deptNodes.get(d.parentId) : undefined;
      if (parent) parent.children!.push(node);
      else roots.push(node);
    }

    const unassigned: ChatOrgUser[] = [];
    for (const u of users) {
      const deptNode = u.departmentId ? deptNodes.get(u.departmentId) : undefined;
      if (deptNode) deptNode.children!.push(makeUserNode(u));
      else unassigned.push(u);
    }
    if (unassigned.length > 0) {
      roots.push({
        key: UNASSIGNED_KEY,
        value: UNASSIGNED_KEY,
        label: (
          <Space spacing={6}>
            <Building2 size={13} style={{ color: 'var(--semi-color-text-2)' }} />
            <span style={{ fontSize: 12, fontWeight: 500 }}>未分配部门</span>
          </Space>
        ),
        filterLabel: '未分配部门',
        children: unassigned.map(makeUserNode),
      } as TreeNodeData);
    }

    // 部门 key → 该部门（含子部门）下所有用户 ID，用于展开"勾选部门=全选成员"
    const duMap = new Map<string, number[]>();
    const collect = (node: TreeNodeData): number[] => {
      const ids: number[] = [];
      for (const child of node.children ?? []) {
        const key = String(child.key);
        if (key.startsWith(USER_KEY_PREFIX)) ids.push(Number(key.slice(USER_KEY_PREFIX.length)));
        else ids.push(...collect(child));
      }
      duMap.set(String(node.key), ids);
      return ids;
    };
    for (const root of roots) collect(root);

    return { treeData: roots, userMap: uMap, deptUserMap: duMap };
  }, [orgQuery.data, excludeIds]);

  const toChatUser = (u: ChatOrgUser): ChatUser => ({ id: u.id, nickname: u.nickname, username: u.username, avatar: u.avatar });
  // 拼音词典就绪后重渲染，补上已输入关键字的拼音命中
  usePinyinReady();
  // 部门 / 成员搜索：子串 + 拼音首字母 / 全拼

  if (orgQuery.isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
        <Spin />
      </div>
    );
  }
  if (treeData.length === 0) {
    return <Text type="tertiary" style={{ display: 'block', padding: '16px 0', textAlign: 'center', fontSize: 12 }}>暂无可选成员</Text>;
  }

  if (multiple) {
    const checkedKeys = (value ?? []).filter((id) => userMap.has(id)).map(userKey);
    return (
      <Tree
        treeData={treeData}
        multiple
        filterTreeNode={(input, _node, data) => {
          const fl = (data as { filterLabel?: string } | undefined)?.filterLabel ?? '';
          return textMatches(fl, String(input));
        }}
        showFilteredOnly
        searchPlaceholder="搜索部门 / 成员"
        value={checkedKeys}
        onChange={(val) => {
          const keys = (Array.isArray(val) ? val : [val]).map(String);
          const ids = new Set<number>();
          for (const key of keys) {
            if (key.startsWith(USER_KEY_PREFIX)) {
              ids.add(Number(key.slice(USER_KEY_PREFIX.length)));
            } else {
              for (const id of deptUserMap.get(key) ?? []) ids.add(id);
            }
          }
          const users = [...ids].map((id) => userMap.get(id)).filter((u): u is ChatOrgUser => !!u).map(toChatUser);
          onChange?.(users);
        }}
        style={{ maxHeight: height, overflowY: 'auto' }}
      />
    );
  }

  return (
    <Tree
      treeData={treeData}
      filterTreeNode={(input, _node, data) => {
        const fl = (data as { filterLabel?: string } | undefined)?.filterLabel ?? '';
        return textMatches(fl, String(input));
      }}
      showFilteredOnly
      searchPlaceholder="搜索部门 / 成员"
      expandAction="click"
      onSelect={(selectedKey) => {
        const key = String(selectedKey);
        if (!key.startsWith(USER_KEY_PREFIX)) return;
        const user = userMap.get(Number(key.slice(USER_KEY_PREFIX.length)));
        if (user) onSelectUser?.(toChatUser(user));
      }}
      style={{ maxHeight: height, overflowY: 'auto' }}
    />
  );
}
