import type { Tag } from '@zenith/shared';

export const mockTags: Tag[] = [
  { id: 1, name: '重要',   color: '#ef4444', groupName: '优先级',   description: '高优先级事项',    status: 'enabled', sortOrder: 1, createdAt: '2025-01-01 00:00:00', updatedAt: '2025-01-01 00:00:00' },
  { id: 2, name: '紧急',   color: '#f97316', groupName: '优先级',   description: '需要立即处理',    status: 'enabled', sortOrder: 2, createdAt: '2025-01-01 00:00:00', updatedAt: '2025-01-01 00:00:00' },
  { id: 3, name: '普通',   color: '#6b7280', groupName: '优先级',   description: '常规事项',        status: 'enabled', sortOrder: 3, createdAt: '2025-01-01 00:00:00', updatedAt: '2025-01-01 00:00:00' },
  { id: 4, name: '新用户', color: '#2563eb', groupName: '用户标签', description: '新注册用户',      status: 'enabled', sortOrder: 1, createdAt: '2025-01-01 00:00:00', updatedAt: '2025-01-01 00:00:00' },
  { id: 5, name: 'VIP',    color: '#a855f7', groupName: '用户标签', description: 'VIP 会员用户',   status: 'enabled', sortOrder: 2, createdAt: '2025-01-01 00:00:00', updatedAt: '2025-01-01 00:00:00' },
  { id: 6, name: '待处理', color: '#f59e0b', groupName: '状态标签', description: '等待处理的事项', status: 'enabled', sortOrder: 1, createdAt: '2025-01-01 00:00:00', updatedAt: '2025-01-01 00:00:00' },
  { id: 7, name: '已完成', color: '#10b981', groupName: '状态标签', description: '已完成的事项',   status: 'enabled', sortOrder: 2, createdAt: '2025-01-01 00:00:00', updatedAt: '2025-01-01 00:00:00' },
];

let nextTagId = Math.max(...mockTags.map((t) => t.id)) + 1;
export function getNextTagId() {
  return nextTagId++;
}

export function getTagGroups(): string[] {
  const seen = new Set<string>();
  mockTags
    .filter((t) => t.status === 'enabled' && t.groupName)
    .forEach((t) => seen.add(t.groupName as string));
  return [...seen].sort((a, b) => a.localeCompare(b));
}
