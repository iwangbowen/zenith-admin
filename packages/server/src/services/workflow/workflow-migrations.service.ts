import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { WorkflowFlowData } from '@zenith/shared';
import { db } from '../../db';
import { workflowInstances, workflowDefinitions, workflowTokens, workflowTasks, workflowInstanceMigrations } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { toDefinitionSnapshot } from './instances/shared';
import { getCreateTenantId } from '../../lib/tenant';
import { formatDateTime } from '../../lib/datetime';
import { buildMigrationNodes } from '../../lib/workflow-migration';

async function activeNodeState(instanceId: number) {
  const [tokens, tasks] = await Promise.all([
    db.select({ nodeKey: workflowTokens.nodeKey }).from(workflowTokens).where(and(eq(workflowTokens.instanceId, instanceId), eq(workflowTokens.status, 'active'))),
    db.select({ nodeKey: workflowTasks.nodeKey }).from(workflowTasks).where(and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.status, 'pending'))),
  ]);
  const map = new Map<string, { nodeKey: string; tasks: number; tokens: number }>();
  for (const t of tokens) { const e = map.get(t.nodeKey) ?? { nodeKey: t.nodeKey, tasks: 0, tokens: 0 }; e.tokens++; map.set(t.nodeKey, e); }
  for (const t of tasks) { const e = map.get(t.nodeKey) ?? { nodeKey: t.nodeKey, tasks: 0, tokens: 0 }; e.tasks++; map.set(t.nodeKey, e); }
  return [...map.values()];
}

async function loadForMigration(instanceId: number) {
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, instanceId)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '实例不存在' });
  const [def] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, inst.definitionId)).limit(1);
  if (!def) throw new HTTPException(400, { message: '流程定义不存在' });
  const fromVersion = inst.definitionSnapshot?.version ?? 0;
  return { inst, def, fromVersion, toVersion: def.version };
}

export async function preflightMigration(instanceId: number) {
  const { inst, def, fromVersion, toVersion } = await loadForMigration(instanceId);
  const newFlow = def.flowData as WorkflowFlowData;
  const { nodes, blocked } = buildMigrationNodes(newFlow, await activeNodeState(instanceId));
  return { instanceId: inst.id, fromVersion, toVersion, migratable: inst.status === 'running' && fromVersion !== toVersion && blocked.length === 0, nodes, blocked };
}

export async function migrateInstance(instanceId: number) {
  const { inst, def, fromVersion, toVersion } = await loadForMigration(instanceId);
  if (inst.status !== 'running') throw new HTTPException(400, { message: '仅进行中实例可迁移' });
  if (fromVersion === toVersion) throw new HTTPException(400, { message: '已是最新版本' });
  const newFlow = def.flowData as WorkflowFlowData;
  const { nodes, blocked } = buildMigrationNodes(newFlow, await activeNodeState(instanceId));
  if (blocked.length) throw new HTTPException(400, { message: `存在新版本缺失的活动节点，无法迁移：${blocked.join(', ')}` });
  return db.transaction(async (tx) => {
    await tx.update(workflowInstances).set({ definitionSnapshot: toDefinitionSnapshot(def) }).where(eq(workflowInstances.id, instanceId));
    await tx.insert(workflowInstanceMigrations).values({
      instanceId, definitionId: def.id, fromVersion, toVersion,
      nodeMap: Object.fromEntries(nodes.map((n) => [n.nodeKey, n.nodeKey])), status: 'done',
      createdBy: currentUser()?.userId ?? null, tenantId: getCreateTenantId(currentUser()),
    });
    return { instanceId, fromVersion, toVersion, migrated: true };
  });
}

/** 批量迁移某定义下全部可迁移运行实例（单失败不阻断，≤200/批） */
export async function batchMigrate(definitionId: number) {
  const rows = await db.select({ id: workflowInstances.id }).from(workflowInstances)
    .where(and(eq(workflowInstances.definitionId, definitionId), eq(workflowInstances.status, 'running'))).limit(200);
  let migrated = 0; const failed: number[] = [];
  for (const r of rows) { try { await migrateInstance(r.id); migrated++; } catch { failed.push(r.id); } }
  return { total: rows.length, migrated, failed };
}

export async function listMigrations(instanceId: number) {
  const rows = await db.select().from(workflowInstanceMigrations).where(eq(workflowInstanceMigrations.instanceId, instanceId)).orderBy(workflowInstanceMigrations.id);
  return rows.map((r) => ({ id: r.id, instanceId: r.instanceId, fromVersion: r.fromVersion, toVersion: r.toVersion, status: r.status, note: r.note ?? null, createdAt: formatDateTime(r.createdAt) }));
}
