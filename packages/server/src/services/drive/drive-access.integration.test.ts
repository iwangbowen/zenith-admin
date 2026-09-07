import { afterAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { DRIVE_ROLES, driveRoleAtLeast } from '@zenith/shared/drive';
import { config } from '../../config';
import * as schema from '../../db/schema';
import { resolveNodeRoles, visibleNodeCondition } from './drive-access.service';
import { EMPTY_SUBJECTS, type DriveSubjectSet } from './drive-acl';
import { retainManagedFiles, releaseManagedFiles } from '../files/file-gc.service';

vi.mock('../../lib/pg-boss-scheduler', () => ({ registerSystemRecurringJob: vi.fn(), sendSystemJob: vi.fn() }));

// Uses only connection-local TEMP tables; it never modifies application data.
const client = postgres(config.databaseUrl, { max: 1, onnotice: () => undefined });
const testDb = drizzle(client, { schema, casing: 'snake_case' });
afterAll(() => client.end());

describe.skipIf(process.env.DRIVE_DB_TESTS !== '1')('drive ACL PostgreSQL parity', () => {
  it('uses the same role matrix for SQL visibility, totals and resolved roles', async () => {
    await testDb.transaction(async (executor) => {
      for (const table of ['drive_nodes', 'drive_spaces', 'drive_space_members', 'drive_node_permissions', 'departments']) {
        await executor.execute(sql.raw(`CREATE TEMP TABLE ${table} ON COMMIT DROP AS SELECT * FROM public.${table} WITH NO DATA`));
      }
      await executor.execute(sql`
        INSERT INTO drive_spaces (id, type, owner_id, default_member_role, status)
        VALUES (1, 'team', 99, 'editor', 'enabled'), (2, 'team', 99, 'manager', 'enabled'), (3, 'team', 99, 'editor', 'disabled')
      `);
      await executor.execute(sql`
        INSERT INTO drive_nodes (id, space_id, acl_chain_ids, acl_open)
        VALUES (1, 1, '{}', false), (2, 1, '{1}', false), (3, 1, '{1,2}', false),
          (4, 1, '{}', true), (5, 2, '{}', false), (6, 3, '{}', false), (7, 1, '{}', false)
      `);
      await executor.execute(sql`
        INSERT INTO drive_node_permissions (node_id, subject_type, subject_id, role, expire_at)
        VALUES (1, 'user', 10, 'viewer', null), (2, 'role', 30, 'downloader', null),
          (6, 'user', 10, 'manager', null), (7, 'user', 10, 'manager', now() - interval '1 second')
      `);
      const subjects: DriveSubjectSet = {
        userId: 10, user: new Set([10]), role: new Set([30]), department: new Set(),
        user_group: new Set(), departmentId: null, isAdmin: false,
      };
      const nodes = await executor.select().from(schema.driveNodes).orderBy(schema.driveNodes.id);
      const roles = await resolveNodeRoles(nodes, subjects, executor);
      expect(nodes.map((n) => roles.get(n.id)?.role)).toEqual(['viewer', 'downloader', 'downloader', 'editor', 'manager', null, null]);
      for (const role of DRIVE_ROLES) {
        const where = visibleNodeCondition(subjects, role);
        const visible = await executor.select({ id: schema.driveNodes.id }).from(schema.driveNodes).where(where).orderBy(schema.driveNodes.id);
        const expected = nodes.filter((n) => driveRoleAtLeast(roles.get(n.id)?.role, role)).map((n) => n.id);
        expect(visible.map((n) => n.id)).toEqual(expected);
        expect(await executor.$count(schema.driveNodes, where)).toBe(expected.length);
      }
      expect(await executor.$count(schema.driveNodes, visibleNodeCondition(EMPTY_SUBJECTS))).toBe(0);
    });
  });

  it('counts duplicate references and refuses to resurrect a GC tombstone', async () => {
    await testDb.transaction(async (executor) => {
      await executor.execute(sql`CREATE TEMP TABLE managed_files ON COMMIT DROP AS SELECT * FROM public.managed_files WITH NO DATA`);
      const id = '00000000-0000-4000-8000-000000000001';
      await executor.execute(sql`INSERT INTO managed_files (id, ref_count, gc_state, orphaned_at)
        VALUES (${id}, 0, 'orphan', now() - interval '2 days')`);
      await retainManagedFiles(executor, [id, id, null]);
      const [retained] = await executor.execute(sql`SELECT ref_count, gc_state, orphaned_at FROM managed_files`);
      expect(retained).toMatchObject({ ref_count: 2, gc_state: 'live', orphaned_at: null });
      await releaseManagedFiles(executor, [id, id]);
      const [released] = await executor.execute(sql`SELECT ref_count, gc_state, orphaned_at FROM managed_files`);
      expect(released).toMatchObject({ ref_count: 0, gc_state: 'orphan' });
      expect(released.orphaned_at).not.toBeNull();
      await expect(releaseManagedFiles(executor, [id])).rejects.toThrow('reference count mismatch');
      await executor.execute(sql`UPDATE managed_files SET gc_state = 'deleting'`);
      await expect(retainManagedFiles(executor, [id])).rejects.toThrow('回收流程');
      expect((await executor.execute(sql`SELECT ref_count FROM managed_files`))[0].ref_count).toBe(0);
    });
  });
});
