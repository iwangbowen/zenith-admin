import type { Dict, DictItem } from '@zenith/shared';

export const mockDicts: Dict[] = [
  { id: 1, name: '通用状态',     code: 'common_status',         description: '通用启用/禁用状态',  status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 3, name: '菜单类型',     code: 'menu_type',             description: '菜单节点类型',       status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 4, name: '用户性别',     code: 'user_gender',           description: '用户性别',           status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 5, name: '显示状态',     code: 'menu_visible',          description: '菜单显示/隐藏状态',  status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 6, name: '通知类型',     code: 'notice_type',           description: '通知公告类型',       status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 7, name: '通知发布状态', code: 'notice_publish_status', description: '通知公告的发布状态',  status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 8, name: '通知优先级',   code: 'notice_priority',       description: '通知公告优先级',     status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
];

export const mockDictItems: DictItem[] = [
  // 通用状态 (dictId: 1)
  { id: 1,  dictId: 1, label: '启用',   value: 'active',       color: 'green',  sort: 1, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 2,  dictId: 1, label: '禁用',   value: 'disabled',     color: 'grey',   sort: 2, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  // 菜单类型 (dictId: 3)
  { id: 3,  dictId: 3, label: '目录',   value: 'directory',    color: 'blue',   sort: 1, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 4,  dictId: 3, label: '菜单',   value: 'menu',         color: 'green',  sort: 2, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 5,  dictId: 3, label: '按钮',   value: 'button',       color: 'orange', sort: 3, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  // 用户性别 (dictId: 4)
  { id: 6,  dictId: 4, label: '男',     value: 'male',         color: 'blue',   sort: 1, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 7,  dictId: 4, label: '女',     value: 'female',       color: 'pink',   sort: 2, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 8,  dictId: 4, label: '保密',   value: 'secret',       color: 'grey',   sort: 3, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  // 显示状态 (dictId: 5)
  { id: 9,  dictId: 5, label: '显示',   value: 'show',         color: 'green',  sort: 1, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 10, dictId: 5, label: '隐藏',   value: 'hidden',       color: 'grey',   sort: 2, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  // 通知类型 (dictId: 6)
  { id: 11, dictId: 6, label: '通知',   value: 'notice',       color: 'blue',   sort: 1, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 12, dictId: 6, label: '公告',   value: 'announcement', color: 'cyan',   sort: 2, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 13, dictId: 6, label: '警告',   value: 'warning',      color: 'orange', sort: 3, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  // 通知发布状态 (dictId: 7)
  { id: 14, dictId: 7, label: '草稿',   value: 'draft',        color: 'grey',   sort: 1, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 15, dictId: 7, label: '已发布', value: 'published',    color: 'green',  sort: 2, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 16, dictId: 7, label: '已撤回', value: 'recalled',     color: 'orange', sort: 3, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  // 通知优先级 (dictId: 8)
  { id: 17, dictId: 8, label: '低',     value: 'low',          color: 'grey',   sort: 1, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 18, dictId: 8, label: '中',     value: 'medium',       color: 'blue',   sort: 2, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  { id: 19, dictId: 8, label: '高',     value: 'high',         color: 'red',    sort: 3, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
];

let nextDictId = 9;
export function getNextDictId() {
  return nextDictId++;
}

let nextDictItemId = 20;
export function getNextDictItemId() {
  return nextDictItemId++;
}
