/**
 * 用户批量导入 Definition。
 * 校验/落库逻辑与后台创建用户一致：密码策略、部门/岗位/角色编码解析、
 * 租户席位上限、逐行独立 bcrypt、动态用户组收尾同步。
 */
import { hashPassword } from '../../../lib/password';
import { db } from '../../../db/index';
import { users } from '../../../db/schema';
import { tenantCondition, getCreateTenantId } from '../../../lib/tenant';
import { reserveTenantSeats, getTenantUserLimit } from '../../../lib/tenant-quota';
import { validatePassword, type PasswordPolicy } from '@zenith/shared/settings';
import { getSettings } from '../../../lib/settings/index';
import { currentUser } from '../../../lib/context';
import { syncUserDynamicMembershipsSafe } from '../user-group-rules.service';
import { provisionBasicUser } from '../authority-write.service';
import { registerImport } from '../../../lib/import-center/registry';

interface UserRow {
  username: string;
  nickname: string;
  email: string | null;
  hashedPassword: string;
}

interface Prepared {
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
    description: '批量创建基础账号；组织调整与授权请使用独立管理操作',
    columns: [
      { key: 'username', header: '用户名', required: true, example: 'zhangsan' },
      { key: 'nickname', header: '昵称', required: true, example: '张三' },
      { key: 'email', header: '邮箱', example: 'zhangsan@example.com' },
      { key: 'password', header: '密码', required: true, note: '按平台密码策略校验，每行独立加密' },
    ],
    async prepare() {
      const user = currentUser();
      const [existing, policy] = await Promise.all([
        db.select({ username: users.username, email: users.email }).from(users).where(tenantCondition(users, user)),
        getSettings('identitySecurity').then((s) => s.password),
      ]);
      const tenantId = getCreateTenantId(user);
      return {
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
      if (cells.roleCodes || cells.departmentCode || cells.positionCodes || cells.status) throw new Error('导入只接受基础资料，组织和权限需独立管理');
      if (prepared.tenantUserLimit != null && prepared.baseCount + prepared.inserted >= prepared.tenantUserLimit) {
        throw new Error(`超出租户用户数上限（${prepared.tenantUserLimit}）`);
      }
      // 安全要求：每行独立 bcrypt（独立 salt），禁止相同密码复用哈希
      const hashedPassword = await hashPassword(password);
      return { username, nickname, email: email || null, hashedPassword };
    },
    async insertRow(row, prepared) {
      await db.transaction(async (tx) => {
        await reserveTenantSeats(tx, prepared.tenantId);
        const [newUser] = await tx.insert(users).values({
          username: row.username,
          nickname: row.nickname,
          email: row.email,
          password: row.hashedPassword,
          departmentId: null,
          status: 'enabled',
          tenantId: prepared.tenantId,
        }).returning();
        await provisionBasicUser(tx, newUser.id, prepared.tenantId);
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
