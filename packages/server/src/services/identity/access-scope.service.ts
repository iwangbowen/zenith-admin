import { and, asc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { AccessPolicySnapshot, AccessScopeOptions } from '@zenith/shared/identity';
import { buildPermissionDirectory } from '@zenith/shared/permission-features';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { menus, roles, users } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { requireRow } from '../../lib/db-assert';
import { availableNavigation, getPageReadCode, isPermissionAvailable } from '../../lib/page-access';
import { tenantCondition } from '../../lib/tenant';
import { getTenantPackageFeatureSet } from '../../lib/tenant-package';
import { loadEffectiveAccessPolicies } from './access-policy.service';
import { assertAuthorityActor, roleBeneficiaries } from './authority-write.service';
import { buildMenuTree, mapMenu } from './menus.service';

export async function loadAccessScope(
  tenantId: number | null,
  mode: { kind: 'request' } | { kind: 'assign'; platform: boolean; owned: readonly string[]; pageIds: readonly number[] },
  executor: DbExecutor = db,
): Promise<AccessScopeOptions> {
  const [rows, features] = await Promise.all([
    executor.select().from(menus).orderBy(asc(menus.sort), asc(menus.id)),
    getTenantPackageFeatureSet(tenantId, executor === db ? undefined : executor),
  ]);
  const navigation = availableNavigation(rows, features, tenantId === null);
  const { items } = buildPermissionDirectory(navigation.map(mapMenu));
  const codes = items.map(item => item.code).filter(code => isPermissionAvailable(code, features));
  const allowed = new Set(codes);
  const policies = new Map((await loadEffectiveAccessPolicies(codes, tenantId, executor)).map(policy => [policy.permissionCode, policy]));
  const canSelect = (code: string, policy: AccessPolicySnapshot | undefined) => {
    if (!allowed.has(code)) return false;
    if (mode.kind === 'request') return policy?.enabled === true;
    return mode.platform || (mode.owned.includes(code) && policy?.riskLevel === 'low' && policy.enabled);
  };
  const selectablePageIds = navigation.flatMap(page => {
    if (page.type !== 'menu') return [];
    if (mode.kind === 'assign' && !mode.platform && !mode.pageIds.includes(page.id)) return [];
    const code = getPageReadCode(page);
    if (code) return canSelect(code, policies.get(code)) ? [page.id] : [];
    return mode.kind === 'assign' ? [page.id] : [];
  });
  return {
    pages: buildMenuTree(navigation.map(mapMenu)),
    selectablePageIds,
    permissions: items.filter(item => allowed.has(item.code)).map(item => ({
      ...item, selectable: canSelect(item.code, policies.get(item.code)), policy: policies.get(item.code),
    })),
  };
}

export async function getAssignmentScope(target: 'role' | 'user', id: number): Promise<AccessScopeOptions> {
  const actor = currentUser();
  return db.transaction(async tx => {
    const subject = target === 'role'
      ? await tx.query.roles.findFirst({ where: and(eq(roles.id, id), tenantCondition(roles, actor)), columns: { tenantId: true, code: true } })
      : await tx.query.users.findFirst({ where: and(eq(users.id, id), tenantCondition(users, actor)), columns: { tenantId: true } });
    const { tenantId } = requireRow(subject, '授权对象不存在');
    const authority = await assertAuthorityActor(tx, tenantId,
      target === 'role' ? 'system:role:assign' : 'system:user:assign',
      target === 'role' ? await roleBeneficiaries(tx, id) : [id]);
    if (!authority.platform && subject && 'code' in subject && ['super_admin', 'security_admin', 'tenant_admin'].includes(subject.code)) {
      throw new HTTPException(403, { message: '系统角色由平台管理员维护' });
    }
    return loadAccessScope(tenantId, { kind: 'assign', ...authority }, tx);
  });
}
