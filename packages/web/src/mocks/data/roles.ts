import type { Role } from '@zenith/shared/identity';
import { SEED_ROLES } from '@zenith/shared/seed';
import { SEED_MENUS } from '@zenith/shared/seed/menus';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockRoles: Role[] = SEED_ROLES.map((r) => ({
  ...r,
  permissionCodes: r.id === 1
    ? undefined
    : [...new Set([
        ...(r.permissionCodes ?? []),
        ...(r.menuIds ?? []).flatMap(id => SEED_MENUS.find(menu => menu.id === id)?.permission ? [SEED_MENUS.find(menu => menu.id === id)!.permission!] : []),
      ])],
  userCount: r.code === 'super_admin' ? 3 : 5,
  userPreview: r.code === 'super_admin'
    ? [
        { id: 1, nickname: '系统管理员', avatar: null },
        { id: 2, nickname: '张三', avatar: null },
        { id: 3, nickname: '李四', avatar: null },
      ]
    : [
        { id: 4, nickname: '王五', avatar: null },
        { id: 5, nickname: '赵六', avatar: null },
        { id: 6, nickname: '孙七', avatar: null },
        { id: 7, nickname: '周八', avatar: null },
        { id: 8, nickname: '吴九', avatar: null },
      ],
}));

let nextRoleId = nextIdFrom(mockRoles);
export function getNextRoleId() {
  return nextRoleId++;
}
