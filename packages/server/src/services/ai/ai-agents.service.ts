import { eq, desc, and, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { aiAgents, aiKnowledgeBases, aiProviderConfigs, users } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import type { AiAgentRow } from '../../db/schema';
import type { CreateAiAgentInput, UpdateAiAgentInput } from '@zenith/shared';

function mapAgent(row: AiAgentRow, ownerName?: string | null) {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    avatar: row.avatar,
    systemPrompt: row.systemPrompt,
    configId: row.configId,
    model: row.model,
    temperature: row.temperature,
    knowledgeBaseId: row.knowledgeBaseId,
    tools: row.tools ?? [],
    openingMessage: row.openingMessage,
    suggestedQuestions: row.suggestedQuestions ?? [],
    status: row.status,
    clonedFromId: row.clonedFromId,
    usageCount: row.usageCount,
    isEnabled: row.isEnabled,
    ownerName: ownerName ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export type AgentView = ReturnType<typeof mapAgent>;

async function ensureAgentOwner(id: number): Promise<AiAgentRow> {
  const user = currentUser();
  const [row] = await db.select().from(aiAgents).where(eq(aiAgents.id, id));
  if (!row) throw new HTTPException(404, { message: '智能体不存在' });
  if (row.userId !== user.userId) throw new HTTPException(403, { message: '无权操作此智能体' });
  return row;
}

/** 校验智能体引用的配置 / 知识库存在且归属合法 */
async function validateAgentRefs(input: { configId?: number | null; knowledgeBaseId?: number | null }) {
  if (input.configId) {
    const [cfg] = await db.select({ id: aiProviderConfigs.id, isEnabled: aiProviderConfigs.isEnabled }).from(aiProviderConfigs).where(eq(aiProviderConfigs.id, input.configId));
    if (!cfg || !cfg.isEnabled) throw new HTTPException(400, { message: '所选服务商配置不存在或已禁用' });
  }
  if (input.knowledgeBaseId) {
    const user = currentUser();
    const [kb] = await db.select({ id: aiKnowledgeBases.id, userId: aiKnowledgeBases.userId }).from(aiKnowledgeBases).where(eq(aiKnowledgeBases.id, input.knowledgeBaseId));
    if (!kb || kb.userId !== user.userId) throw new HTTPException(400, { message: '所选知识库不存在或不属于你' });
  }
}

export async function listMyAgents(): Promise<AgentView[]> {
  const user = currentUser();
  const rows = await db.select().from(aiAgents).where(eq(aiAgents.userId, user.userId)).orderBy(desc(aiAgents.updatedAt));
  return rows.map((r) => mapAgent(r));
}

/** 智能体市场：全部已上架且启用的智能体 */
export async function listMarketAgents(): Promise<AgentView[]> {
  const rows = await db
    .select({ agent: aiAgents, ownerName: sql<string | null>`COALESCE(${users.nickname}, ${users.username})` })
    .from(aiAgents)
    .leftJoin(users, eq(aiAgents.userId, users.id))
    .where(and(eq(aiAgents.status, 'published'), eq(aiAgents.isEnabled, true)))
    .orderBy(desc(aiAgents.usageCount), desc(aiAgents.updatedAt));
  return rows.map((r) => mapAgent(r.agent, r.ownerName));
}

/** 待审核列表（管理员） */
export async function listPendingAgents(): Promise<AgentView[]> {
  const rows = await db
    .select({ agent: aiAgents, ownerName: sql<string | null>`COALESCE(${users.nickname}, ${users.username})` })
    .from(aiAgents)
    .leftJoin(users, eq(aiAgents.userId, users.id))
    .where(eq(aiAgents.status, 'pending'))
    .orderBy(aiAgents.updatedAt);
  return rows.map((r) => mapAgent(r.agent, r.ownerName));
}

export async function createAgent(input: CreateAiAgentInput): Promise<AgentView> {
  const user = currentUser();
  await validateAgentRefs(input);
  const [row] = await db
    .insert(aiAgents)
    .values({
      userId: user.userId,
      name: input.name.trim(),
      description: input.description ?? null,
      avatar: input.avatar?.trim() || '🤖',
      systemPrompt: input.systemPrompt,
      configId: input.configId ?? null,
      model: input.model ?? null,
      temperature: input.temperature ?? null,
      knowledgeBaseId: input.knowledgeBaseId ?? null,
      tools: input.tools ?? [],
      openingMessage: input.openingMessage ?? null,
      suggestedQuestions: input.suggestedQuestions ?? [],
      isEnabled: input.isEnabled ?? true,
    })
    .returning();
  return mapAgent(row);
}

export async function updateAgent(id: number, input: UpdateAiAgentInput): Promise<AgentView> {
  const row = await ensureAgentOwner(id);
  await validateAgentRefs(input);
  // 已上架的智能体修改内容后回到私有状态，需重新提交审核
  const contentChanged = input.systemPrompt !== undefined || input.tools !== undefined || input.knowledgeBaseId !== undefined;
  const [updated] = await db
    .update(aiAgents)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.avatar !== undefined ? { avatar: input.avatar?.trim() || '🤖' } : {}),
      ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
      ...(input.configId !== undefined ? { configId: input.configId } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.knowledgeBaseId !== undefined ? { knowledgeBaseId: input.knowledgeBaseId } : {}),
      ...(input.tools !== undefined ? { tools: input.tools } : {}),
      ...(input.openingMessage !== undefined ? { openingMessage: input.openingMessage } : {}),
      ...(input.suggestedQuestions !== undefined ? { suggestedQuestions: input.suggestedQuestions } : {}),
      ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
      ...(row.status === 'published' && contentChanged ? { status: 'private' as const } : {}),
    })
    .where(eq(aiAgents.id, id))
    .returning();
  return mapAgent(updated);
}

export async function deleteAgent(id: number): Promise<void> {
  await ensureAgentOwner(id);
  await db.delete(aiAgents).where(eq(aiAgents.id, id));
}

/** 提交上架审核 */
export async function submitAgentPublish(id: number): Promise<AgentView> {
  const row = await ensureAgentOwner(id);
  if (row.status === 'published') throw new HTTPException(400, { message: '该智能体已上架' });
  if (row.status === 'pending') throw new HTTPException(400, { message: '该智能体已在审核中' });
  const [updated] = await db.update(aiAgents).set({ status: 'pending' }).where(eq(aiAgents.id, id)).returning();
  return mapAgent(updated);
}

/** 撤回上架（已上架 → 私有） */
export async function unpublishAgent(id: number): Promise<AgentView> {
  const row = await ensureAgentOwner(id);
  if (row.status !== 'published' && row.status !== 'pending') {
    throw new HTTPException(400, { message: '该智能体未上架' });
  }
  const [updated] = await db.update(aiAgents).set({ status: 'private' }).where(eq(aiAgents.id, id)).returning();
  return mapAgent(updated);
}

/** 管理员审核（通过 / 驳回） */
export async function reviewAgent(id: number, approve: boolean): Promise<AgentView> {
  const [row] = await db.select().from(aiAgents).where(eq(aiAgents.id, id));
  if (!row) throw new HTTPException(404, { message: '智能体不存在' });
  if (row.status !== 'pending') throw new HTTPException(400, { message: '该智能体不在待审核状态' });
  const [updated] = await db
    .update(aiAgents)
    .set({ status: approve ? 'published' : 'rejected' })
    .where(eq(aiAgents.id, id))
    .returning();
  return mapAgent(updated);
}

/** 从市场克隆一个已上架智能体为自己的私有副本（不复制知识库绑定，属主不同） */
export async function cloneAgent(id: number): Promise<AgentView> {
  const user = currentUser();
  const [src] = await db.select().from(aiAgents).where(eq(aiAgents.id, id));
  if (!src || src.status !== 'published' || !src.isEnabled) {
    throw new HTTPException(404, { message: '智能体不存在或未上架' });
  }
  const [row] = await db
    .insert(aiAgents)
    .values({
      userId: user.userId,
      name: `${src.name} 副本`.slice(0, 100),
      description: src.description,
      avatar: src.avatar,
      systemPrompt: src.systemPrompt,
      configId: src.configId,
      model: src.model,
      temperature: src.temperature,
      knowledgeBaseId: null,
      tools: src.tools ?? [],
      openingMessage: src.openingMessage,
      suggestedQuestions: src.suggestedQuestions ?? [],
      clonedFromId: src.id,
    })
    .returning();
  return mapAgent(row);
}

/**
 * 解析对话可用的智能体（本人私有 / 任何人已上架），供聊天流使用。
 * 返回 null 表示智能体不存在、被禁用或无权使用（对话降级为普通模式）。
 */
export async function resolveAgentForChat(agentId: number, userId: number): Promise<AiAgentRow | null> {
  const [row] = await db.select().from(aiAgents).where(eq(aiAgents.id, agentId));
  if (!row || !row.isEnabled) return null;
  if (row.userId !== userId && row.status !== 'published') return null;
  return row;
}

/** 获取智能体详情（本人任意状态 / 他人仅已上架），聊天页展示开场白用 */
export async function getAgentDetail(id: number): Promise<AgentView> {
  const user = currentUser();
  const row = await resolveAgentForChat(id, user.userId);
  if (!row) throw new HTTPException(404, { message: '智能体不存在或未上架' });
  return mapAgent(row);
}

export async function incrementAgentUsage(agentId: number): Promise<void> {
  await db
    .update(aiAgents)
    .set({ usageCount: sql`${aiAgents.usageCount} + 1` })
    .where(eq(aiAgents.id, agentId));
}
