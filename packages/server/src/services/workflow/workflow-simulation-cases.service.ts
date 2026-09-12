/**
 * 流程仿真用例服务：保存/列出/删除按流程定义归档的测试场景（表单数据 + 决策 + 发起人）。
 * 取代设计器仿真抽屉原先的 localStorage 占位，落库 + 租户隔离 + 重名覆盖（按 definitionId + name 唯一）。
 */
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db';
import { workflowSimulationCases, workflowDefinitions } from '../../db/schema';
import type { WorkflowSimulationCaseRow } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { formatTimestamps } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import type { WorkflowSimulationCase, WorkflowSimulationDecision, SaveWorkflowSimulationCaseInput } from '@zenith/shared/workflow';
import { requireRow } from '../../lib/db-assert';
import { buildWhere } from '../../lib/where-helpers';

function mapCase(row: WorkflowSimulationCaseRow): WorkflowSimulationCase {
  return {
    id: row.id,
    definitionId: row.definitionId,
    name: row.name,
    starterUserId: row.starterUserId ?? null,
    formData: (row.formData ?? {}) as Record<string, unknown>,
    decisions: (row.decisions ?? []) as WorkflowSimulationDecision[],
    tenantId: row.tenantId ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    ...formatTimestamps(row),
  };
}

/** 校验流程定义在当前租户可见（越权 / 不存在抛 404）。 */
async function ensureDefinitionAccess(definitionId: number): Promise<void> {
  const [def] = await db.select({ id: workflowDefinitions.id }).from(workflowDefinitions)
    .where(buildWhere(eq(workflowDefinitions.id, definitionId), tenantCondition(workflowDefinitions, currentUser()))).limit(1);
  requireRow(def, '流程定义不存在');
}

export async function listSimulationCases(definitionId: number): Promise<WorkflowSimulationCase[]> {
  await ensureDefinitionAccess(definitionId);
  const rows = await db.select().from(workflowSimulationCases)
    .where(buildWhere(eq(workflowSimulationCases.definitionId, definitionId), tenantCondition(workflowSimulationCases, currentUser())))
    .orderBy(desc(workflowSimulationCases.id));
  return rows.map(mapCase);
}

export async function saveSimulationCase(input: SaveWorkflowSimulationCaseInput): Promise<WorkflowSimulationCase> {
  await ensureDefinitionAccess(input.definitionId);
  const user = currentUser();
  const formData = (input.formData ?? {}) as Record<string, unknown>;
  const decisions = (input.decisions ?? []) as WorkflowSimulationDecision[];
  try {
    const [row] = await db.insert(workflowSimulationCases)
      .values({
        definitionId: input.definitionId,
        name: input.name,
        starterUserId: input.starterUserId ?? null,
        formData,
        decisions,
        tenantId: getCreateTenantId(user),
        createdBy: user.userId,
        updatedBy: user.userId,
      })
      // 同名（同一定义内）覆盖：更新场景内容而非新增
      .onConflictDoUpdate({
        target: [workflowSimulationCases.definitionId, workflowSimulationCases.name],
        set: { starterUserId: input.starterUserId ?? null, formData, decisions, updatedBy: user.userId, updatedAt: new Date() },
      })
      .returning();
    return mapCase(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '用例名称已存在');
    throw err;
  }
}

export async function deleteSimulationCase(id: number): Promise<void> {
  const [row] = await db.select({ id: workflowSimulationCases.id }).from(workflowSimulationCases)
    .where(buildWhere(eq(workflowSimulationCases.id, id), tenantCondition(workflowSimulationCases, currentUser()))).limit(1);
  requireRow(row, '仿真用例不存在');
  await db.delete(workflowSimulationCases).where(eq(workflowSimulationCases.id, row.id));
}
