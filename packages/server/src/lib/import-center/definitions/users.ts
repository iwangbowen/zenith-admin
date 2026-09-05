/**
 * 用户批量导入 Definition（收编 users.service 原同步 Excel 导入）。
 * 校验/落库逻辑与后台创建用户一致：密码策略、部门/岗位/角色编码解析、
 * 租户席位上限、逐行独立 bcrypt、动态用户组收尾同步。
 */
import { hashPassword } from '../../password';
import { db } from '../../../db';
import { departments, positions, roles, users } from '../../../db/schema';
import { tenantCondition, getCreateTenantId } from '../../../lib/tenant';
import { reserveTenantSeats, getTenantUserLimit } from '../../../lib/tenant-quota';
import { validatePassword, type PasswordPolicy } from '@zenith/shared/settings';
import { getSettings } from '../../../lib/settings';
import { currentUser } from '../../../lib/context';
import { setUserRoles, setUserPositions } from '../../../services/identity/users.service';
import { syncUserDynamicMembershipsSafe } from '../../../services/identity/user-group-rules.service';
import { registerImport } from '../registry';

interface UserRow {
  username: string;
  nickname: string;
  email: string | null;
  hashedPassword: string;
  departmentId: number | null;
  roleIds: number[];
  positionIds: number[];
  status: 'enabled' | 'disabled';
}

interface Prepared {
  deptByCode: Map<string, number>;
  roleByCode: Map<string, number>;
  positionByCode: Map<string, number>;
  usernames: Set<string>;
  emails: Set<string>;
  policy: PasswordPolicy;
  tenantId: number | null;
  tenantUserLimit: number | null;
  baseCount: number;
  inserted: number;
  importedUserIds: number[];
}

export function registerUsersImport(): void {
  registerImport<UserRow, Prepared>({
    entity: 'identity.users',
    title: '用户',
    module: '用户管理',
    permission: 'system:user:import',
    description: '批量导入后台用户，支持部门/岗位/角色编码关联；密码按平台密码策略校验',
    columns: [
      { key: 'username', header: '用户名', required: true, example: 'zhangsan' },
      { key: 'nickname', header: '昵称', required: true, example: '张三' },
      { key: 'email', header: '邮箱', example: 'zhangsan@example.com' },
      { key: 'password', header: '密码', required: true, note: '按平台密码策略校验，每行独立加密' },
      { key: 'departmentCode', header: '部门编码', example: 'technology' },
      { key: 'positionCodes', header: '岗位编码', example: 'engineer', note: '多个用逗号分隔' },
      { key: 'roleCodes', header: '角色编码', example: 'normal_user', note: '多个用逗号分隔' },
      { key: 'status', header: '状态', enumValues: ['enabled', 'disabled'], example: 'enabled' },
    ],
    async prepare() {
      const user = currentUser();
      const [allDepts, allRoles, allPositions, existing, policy] = await Promise.all([
        db.select({ id: departments.id, code: departments.code }).from(departments).where(tenantCondition(departments, user)),
        db.select({ id: roles.id, code: roles.code }).from(roles).where(tenantCondition(roles, user)),
        db.select({ id: positions.id, code: positions.code }).from(positions).where(tenantCondition(positions, user)),
        db.select({ username: users.username, email: users.email }).from(users).where(tenantCondition(users, user)),
        getSettings('identitySecurity').then((s) => s.password),
      ]);
      const tenantId = getCreateTenantId(user);
      return {
        deptByCode: new Map(allDepts.map((d) => [d.code, d.id])),
        roleByCode: new Map(allRoles.map((r) => [r.code, r.id])),
        positionByCode: new Map(allPositions.map((p) => [p.code, p.id])),
        usernames: new Set(existing.map((u) => u.username)),
        emails: new Set(existing.map((u) => u.email).filter((e): e is string => !!e)),
        policy,
        tenantId,
        tenantUserLimit: await getTenantUserLimit(tenantId),
        baseCount: existing.length,
        inserted: 0,
        importedUserIds: [],
      };
    },
    async parseRow(cells, prepared) {
      const { username, nickname, email, password } = cells;
      if (!username || !nickname || !password) throw new Error('用户名、昵称、密码为必填项');
      const policyError = validatePassword(password, prepared.policy);
      if (policyError) throw new Error(policyError);
      if (prepared.usernames.has(username) || (email && prepared.emails.has(email))) {
        throw new Error(`用户名或邮箱已存在: ${username}${email ? ` / ${email}` : ''}`);
      }
      let departmentId: number | null = null;
      if (cells.departmentCode) {
        const id = prepared.deptByCode.get(cells.departmentCode);
        if (!id) throw new Error(`部门编码不存在: ${cells.departmentCode}`);
        departmentId = id;
      }
      const resolveCodes = (raw: string, map: Map<string, number>, kind: string): number[] => {
        const codes = raw ? raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];
        const missing = codes.filter((code) => !map.has(code));
        if (missing.length > 0) throw new Error(`${kind}编码不存在: ${missing.join(', ')}`);
        return codes.map((code) => map.get(code)!);
      };
      const roleIds = resolveCodes(cells.roleCodes, prepared.roleByCode, '角色');
      const positionIds = resolveCodes(cells.positionCodes, prepared.positionByCode, '岗位');
      let status: 'enabled' | 'disabled' = 'enabled';
      if (cells.status) {
        const normalized = cells.status.toLowerCase();
        if (normalized !== 'enabled' && normalized !== 'disabled') {
          throw new Error(`状态值无效: ${cells.status}（仅支持 enabled/disabled 或留空）`);
        }
        status = normalized;
      }
      if (prepared.tenantUserLimit != null && prepared.baseCount + prepared.inserted >= prepared.tenantUserLimit) {
        throw new Error(`超出租户用户数上限（${prepared.tenantUserLimit}）`);
      }
      // 安全要求：每行独立 bcrypt（独立 salt），禁止相同密码复用哈希
      const hashedPassword = await hashPassword(password);
      return { username, nickname, email: email || null, hashedPassword, departmentId, roleIds, positionIds, status };
    },
    async insertRow(row, prepared) {
      await db.transaction(async (tx) => {
        await reserveTenantSeats(tx, prepared.tenantId);
        const [newUser] = await tx.insert(users).values({
          username: row.username,
          nickname: row.nickname,
          email: row.email,
          password: row.hashedPassword,
          departmentId: row.departmentId,
          status: row.status,
          tenantId: prepared.tenantId,
        }).returning();
        if (row.roleIds.length > 0) await setUserRoles(tx, newUser.id, row.roleIds);
        if (row.positionIds.length > 0) await setUserPositions(tx, newUser.id, row.positionIds);
        prepared.importedUserIds.push(newUser.id);
      });
      prepared.usernames.add(row.username);
      if (row.email) prepared.emails.add(row.email);
      prepared.inserted += 1;
    },
    rowLabel: (row) => `${row.nickname}（${row.username}）`,
    async finalize(prepared) {
      if (prepared.importedUserIds.length > 0) {
        syncUserDynamicMembershipsSafe(prepared.importedUserIds, '批量导入用户');
      }
    },
  });
}
