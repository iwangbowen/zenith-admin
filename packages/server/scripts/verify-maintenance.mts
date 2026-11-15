/** Explicit development-only PostgreSQL regression; never resets existing maintenance records. */
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { db, closeDb } from '../src/db/index.ts';
import { maintenanceLogs, notificationOutbox } from '../src/db/schema.ts';
import { runWithCurrentUser } from '../src/lib/context/principal.ts';
import { formatDateTime } from '../src/lib/datetime.ts';
import { getMaintenanceStatus, invalidateMaintenanceCache, maintenanceAction, planMaintenance, runMaintenanceLifecycle, updateMaintenanceStatus } from '../src/services/ops/maintenance.service.ts';

assert.equal(process.env.NODE_ENV, 'development', 'Run only against an explicit development environment');
const actorId = Number(process.env.MAINTENANCE_TEST_ACTOR_ID ?? 1);
const actor = { userId: actorId, username: 'maintenance-verification', tenantId: null, roles: [] };
const created: number[] = [];
let failed: unknown;
try {
  await runWithCurrentUser(actor, async () => {
    let state = await getMaintenanceStatus();
    assert.equal(state.current, null, 'Refuse to modify a pre-existing open maintenance period');
    const content = { message: '维护链路专项验证', reason: '开发环境验证', estimatedEndAt: null, autoEndAt: null };
    const plan = async () => {
      state = await getMaintenanceStatus();
      state = await planMaintenance({ ...content, version: state.version, scheduledStartAt: formatDateTime(new Date(Date.now() + 600_000)), notifyUserIds: [], remindMinutes: 15 });
      created.push(state.current!.id); return state.current!.id;
    };
    const id = await plan();
    await Promise.all([runMaintenanceLifecycle(), runMaintenanceLifecycle()]);
    const reminders = await db.$count(notificationOutbox, eq(notificationOutbox.dedupeKey, 'maintenance:' + id + ':reminder'));
    assert.equal(reminders, 1, 'Concurrent reminders must create one durable outbox intent');
    await db.update(maintenanceLogs).set({ scheduledStartAt: new Date(Date.now() - 1000) }).where(eq(maintenanceLogs.id, id));
    await Promise.all([runMaintenanceLifecycle(), runMaintenanceLifecycle()]);
    invalidateMaintenanceCache(); state = await getMaintenanceStatus();
    assert.equal(state.enabled, true); assert.equal(state.current!.id, id);
    const started = state.startedAt;
    state = await updateMaintenanceStatus({ ...content, version: state.version, enabled: true, message: '验证说明更新' });
    assert.equal(state.startedAt, started); assert.equal(state.current!.id, id);
    await db.update(maintenanceLogs).set({ autoEndAt: new Date(Date.now() - 1000) }).where(eq(maintenanceLogs.id, id));
    await runMaintenanceLifecycle(); invalidateMaintenanceCache(); state = await getMaintenanceStatus();
    assert.equal(state.enabled, false); assert.equal(state.current, null);

    const cancelled = await plan();
    state = await maintenanceAction('cancel', { version: state.version, reason: '验证取消后调度不补开' });
    await runMaintenanceLifecycle(); assert.equal((await getMaintenanceStatus()).current, null);
    const expired = await plan();
    await db.update(maintenanceLogs).set({ scheduledStartAt: new Date(Date.now() - 120_000), estimatedEndAt: new Date(Date.now() - 60_000) }).where(eq(maintenanceLogs.id, expired));
    await runMaintenanceLifecycle(); invalidateMaintenanceCache(); assert.equal((await getMaintenanceStatus()).enabled, false);
    const [expiredRow] = await db.select().from(maintenanceLogs).where(eq(maintenanceLogs.id, expired));
    assert.equal(expiredRow.status, 'cancelled'); assert.equal(expiredRow.startedAt, null);

    state = await getMaintenanceStatus();
    const concurrent = await Promise.allSettled([1, 2].map(() => updateMaintenanceStatus({ ...content, version: state.version, enabled: true })));
    assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter((r) => r.status === 'rejected' && r.reason.status === 409).length, 1);
    state = await getMaintenanceStatus(); created.push(state.current!.id);
    await updateMaintenanceStatus({ ...content, version: state.version, enabled: false, reason: '专项验证完成，恢复服务' });
    const [open] = await db.execute<{ count: number }>(sql`select count(*)::int as count from maintenance_logs where status in ('scheduled','ongoing')`);
    assert.equal(open.count, 0);
    process.stdout.write(JSON.stringify({ passed: ['concurrent reminder idempotency', 'scheduled start fencing', 'content update preserves period', 'automatic recovery', 'cancelled plan stays closed', 'expired window skipped', 'concurrent manual start 409'], periods: created, cancelled }) + '\n');
  });
} catch (error) { failed = error; process.stderr.write(String(error) + '\n'); }
finally {
  await runWithCurrentUser(actor, async () => {
    invalidateMaintenanceCache(); const state = await getMaintenanceStatus();
    if (state.current && created.includes(state.current.id)) {
      if (state.current.status === 'scheduled') await maintenanceAction('cancel', { version: state.version, reason: '验证收尾恢复' });
      else await updateMaintenanceStatus({ version: state.version, enabled: false, message: state.message, estimatedEndAt: null, autoEndAt: null, reason: '验证收尾恢复' });
    }
  });
  await closeDb(); process.exit(failed ? 1 : 0);
}
