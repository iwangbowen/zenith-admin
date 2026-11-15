/** Local console recovery uses a live, enabled platform administrator and the normal lifecycle lock. */
import { eq } from 'drizzle-orm';
import { db, closeDb } from '../db';
import { users } from '../db/schema';
import { runAsUser } from '../lib/audit-context';
import { runWithCurrentUser } from '../lib/context/principal';
import { maintenanceAccess } from '../lib/maintenance-access';
import { getMaintenanceStatus, maintenanceAction, updateMaintenanceStatus } from '../services/ops/maintenance.service';

const args = process.argv.slice(2);
const read = (key: string) => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
try {
  const actorId = Number(read('--actor-id')); const reason = read('--reason')?.trim();
  if (!args.includes('--confirm-disable') || !Number.isSafeInteger(actorId) || actorId < 1 || !reason || reason.length > 450) {
    throw new Error('Usage: npm run maintenance:recover -- --actor-id <platform-admin-id> --reason <reason> --confirm-disable');
  }
  const [actor] = await db.select({ userId: users.id, username: users.username, tenantId: users.tenantId, status: users.status }).from(users).where(eq(users.id, actorId));
  if (!actor || actor.status !== 'enabled' || actor.tenantId !== null) throw new Error('Recovery actor must be an enabled platform maintenance administrator');
  const principal = { ...actor, roles: [] as string[] };
  if (!(await maintenanceAccess(principal)).canManage) throw new Error('Recovery actor lacks maintenance management permission');
  const saved = await runWithCurrentUser(principal, () => runAsUser(actorId, async () => {
    const state = await getMaintenanceStatus();
    if (state.current?.status === 'scheduled') return maintenanceAction('cancel', { version: state.version, reason: '服务器本地恢复：' + reason });
    if (!state.enabled) return state;
    return updateMaintenanceStatus({ version: state.version, enabled: false, message: state.message, estimatedEndAt: state.estimatedEndAt, autoEndAt: null, reason: '服务器本地恢复：' + reason });
  }));
  process.stdout.write('Maintenance disabled. Version: ' + saved.version + '\n');
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n'); process.exitCode = 1;
} finally { await closeDb(); process.exit(process.exitCode ?? 0); }
