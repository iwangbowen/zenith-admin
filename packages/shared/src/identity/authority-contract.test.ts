import { describe, expect, it } from 'vitest';
import { createUserSchema, updateUserSchema, updateUserOrganizationSchema, manageUserSchema } from './validation';
import { userListQuery } from './contracts/users';

describe('user list filters', () => {
  it('parses role IDs and online/offline filters and treats cleared controls as absent', () => {
    expect(userListQuery.parse({ roleId: '3', onlineStatus: 'offline' })).toMatchObject({ roleId: 3, onlineStatus: 'offline' });
    expect(userListQuery.parse({ onlineStatus: 'online' }).onlineStatus).toBe('online');
    expect(userListQuery.parse({ roleId: undefined, onlineStatus: '' })).toMatchObject({ roleId: undefined, onlineStatus: undefined });
  });

  it('rejects invalid role IDs and unsupported online states', () => {
    for (const roleId of ['0', '-1', '1.5', 'invalid']) expect(userListQuery.safeParse({ roleId }).success).toBe(false);
    expect(userListQuery.safeParse({ onlineStatus: 'unknown' }).success).toBe(false);
  });
});

describe('identity profile authority boundary', () => {
  it.each([
    { roleIds: [1] }, { roleIds: [] }, { departmentId: 1 }, { positionIds: [1] },
    { status: 'enabled' }, { permissionCodes: ['system:user:assign'] }, { dataScope: 'all' },
  ])('rejects authority fields in both ordinary create and update: %j', fields => {
    expect(createUserSchema.safeParse({ username: 'normal', nickname: '普通用户', password: '123456', ...fields }).success).toBe(false);
    expect(updateUserSchema.safeParse({ nickname: '普通用户', ...fields }).success).toBe(false);
  });

  it('creation accepts manage-shaped commands so create can apply authority in one transaction', () => {
    const parsed = createUserSchema.parse({ username: 'normal', nickname: '普通用户', password: '123456', organization: { departmentId: null, positionIds: [] }, roles: { roleIds: [3] } });
    expect(parsed.organization).toEqual({ departmentId: null, positionIds: [] });
    expect(parsed.roles).toEqual({ roleIds: [3] });
  });

  it('keeps profile editing independent from organization changes', () => {
    expect(updateUserSchema.parse({ nickname: '新昵称', email: '' })).toEqual({ nickname: '新昵称', email: null });
    expect(updateUserOrganizationSchema.parse({ departmentId: null, positionIds: [] })).toEqual({ departmentId: null, positionIds: [] });
    expect(updateUserOrganizationSchema.safeParse({ departmentId: 1 }).success).toBe(false);
  });

  it('accepts a single editor submission while keeping each authority command separate', () => {
    const commands = { profile: { nickname: '新昵称' }, organization: { departmentId: 1, positionIds: [2] }, roles: { roleIds: [3] } };
    expect(manageUserSchema.parse(commands)).toEqual(commands);
    expect(manageUserSchema.parse({ roles: { roleIds: [] } })).toEqual({ roles: { roleIds: [] } });
    expect(manageUserSchema.safeParse({ profile: { roleIds: [3] } }).success).toBe(false);
    expect(manageUserSchema.safeParse({ roles: { roleIds: [0] } }).success).toBe(false);
    expect(manageUserSchema.safeParse({}).success).toBe(false);
  });
});
