/** Local server-console recovery only; no HTTP bypass is exposed. */
import { eq, and } from 'drizzle-orm';
import { loadSettingsEntry, restoreSettings } from '../src/lib/settings';
import { db, closeDb } from '../src/db';
import { users, roles, userRoles } from '../src/db/schema';
import { runAsUser } from '../src/lib/audit-context';

const args = process.argv.slice(2);
const read = (key: string) => args[args.indexOf(key) + 1];
const actorId = Number(read('--actor-id'));
const reason = args.includes('--reason') ? read('--reason')?.trim() : '';
try {
  if (!args.includes('--confirm-disable') || !args.includes('--actor-id') || !Number.isInteger(actorId) || actorId < 1 || !reason || reason.length > 450) {
    throw new Error('Usage: npm run ip-access:recover -w @zenith/server -- --actor-id <platform-admin-id> --reason <reason> --confirm-disable');
  }
  const [actor] = await db.select({ userId: users.id, username: users.username, tenantId: users.tenantId, status: users.status })
    .from(users).where(eq(users.id, actorId));
  const [role] = await db.select({ code: roles.code }).from(userRoles).innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(userRoles.userId, actorId), eq(roles.code, 'super_admin'), eq(roles.status, 'enabled')));
  if (!actor || actor.status !== 'enabled' || actor.tenantId !== null || !role) throw new Error('Recovery actor must be an enabled platform super administrator');
  const current = await loadSettingsEntry(db, 'ipAccess', null);
  const saved = await runAsUser(actorId, () => restoreSettings('ipAccess', { ...actor, roles: ['super_admin'] }, 0, {
    baseToken: current.baseToken, note: '服务器本地恢复：' + reason,
  }));
  process.stdout.write('IP access control disabled. Recovery revision: ' + saved.version + '\n');
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
} finally { await closeDb(); process.exit(process.exitCode ?? 0); }
