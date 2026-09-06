import { eq, desc, sql } from 'drizzle-orm';
import { requireRow } from '../../lib/db-assert';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { aiAgents, aiKnowledgeBases, aiProviderConfigs } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import logger from '../../lib/logger';
import type { AiAgentRow } from '../../db/schema';
import type { AiBuiltinAgent, CreateAiAgentInput, UpdateAiAgentInput } from '@zenith/shared/ai';

/**
 * 自定义智能体(Mastra AgentConfig 形状,创建即用):
 * - 表单智能体:instructions + 模型/modelSettings + 工具 + 知识库,CRUD 时同步注册进 Mastra
 *   (id `agent-{id}`),可被实验(Experiments)评测、在 Studio 调试;
 * - 编程式内置智能体:代码定义(services/biz/demo-agent),列表只读展示,可直接对话。
 */

function mapAgent(row: AiAgentRow) {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    avatar: row.avatar,
    instructions: row.instructions,
    configId: row.configId,
    model: row.model,
    modelSettings: row.modelSettings,
    maxSteps: row.maxSteps,
    knowledgeBaseId: row.knowledgeBaseId,
    tools: row.tools ?? [],
    openingMessage: row.openingMessage,
    suggestedQuestions: row.suggestedQuestions ?? [],
    usageCount: row.usageCount,
    isEnabled: row.isEnabled,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export type AgentView = ReturnType<typeof mapAgent>;

async function ensureAgentOwner(id: number): Promise<AiAgentRow> {
  const user = currentUser();
  const [row] = await db.select().from(aiAgents).where(eq(aiAgents.id, id));
  requireRow(row, '智能体不存在');
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
      instructions: input.instructions,
      configId: input.configId ?? null,
      model: input.model ?? null,
      modelSettings: input.modelSettings ?? null,
      maxSteps: input.maxSteps ?? null,
      knowledgeBaseId: input.knowledgeBaseId ?? null,
      tools: input.tools ?? [],
      openingMessage: input.openingMessage ?? null,
      suggestedQuestions: input.suggestedQuestions ?? [],
      isEnabled: input.isEnabled ?? true,
    })
    .returning();
  void syncBizAgentRegistration(row);
  return mapAgent(row);
}

export async function updateAgent(id: number, input: UpdateAiAgentInput): Promise<AgentView> {
  await ensureAgentOwner(id);
  await validateAgentRefs(input);
  const [updated] = await db
    .update(aiAgents)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.avatar !== undefined ? { avatar: input.avatar?.trim() || '🤖' } : {}),
      ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
      ...(input.configId !== undefined ? { configId: input.configId } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.modelSettings !== undefined ? { modelSettings: input.modelSettings } : {}),
      ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
      ...(input.knowledgeBaseId !== undefined ? { knowledgeBaseId: input.knowledgeBaseId } : {}),
      ...(input.tools !== undefined ? { tools: input.tools } : {}),
      ...(input.openingMessage !== undefined ? { openingMessage: input.openingMessage } : {}),
      ...(input.suggestedQuestions !== undefined ? { suggestedQuestions: input.suggestedQuestions } : {}),
      ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
    })
    .where(eq(aiAgents.id, id))
    .returning();
  void syncBizAgentRegistration(updated);
  return mapAgent(updated);
}

export async function deleteAgent(id: number): Promise<void> {
  await ensureAgentOwner(id);
  await db.delete(aiAgents).where(eq(aiAgents.id, id));
  // 从 Mastra 注册表移除,防止已删除智能体继续被实验/Studio 调用
  try {
    const { getMastra, bizAgentId } = await import('../../lib/mastra');
    const mastra = await getMastra();
    (mastra as unknown as { removeAgent: (key: string) => boolean }).removeAgent(bizAgentId(id));
  } catch (err) {
    logger.warn('[ai-agents] mastra deregistration failed', { agentId: id, err });
  }
}

/**
 * 解析对话可用的智能体(仅本人创建),供聊天流使用。
 * 返回 null 表示智能体不存在、被禁用或无权使用（对话降级为普通模式）。
 */
export async function resolveAgentForChat(agentId: number, userId: number): Promise<AiAgentRow | null> {
  const [row] = await db.select().from(aiAgents).where(eq(aiAgents.id, agentId));
  if (!row || !row.isEnabled) return null;
  if (row.userId !== userId) return null;
  return row;
}

/** 获取智能体详情(仅本人),聊天页展示开场白用 */
export async function getAgentDetail(id: number): Promise<AgentView> {
  const user = currentUser();
  const row = await resolveAgentForChat(id, user.userId);
  return mapAgent(requireRow(row, '智能体不存在'));
}

export async function incrementAgentUsage(agentId: number): Promise<void> {
  await db
    .update(aiAgents)
    .set({ usageCount: sql`${aiAgents.usageCount} + 1` })
    .where(eq(aiAgents.id, agentId));
}

// ─── Mastra 注册(表单智能体 → 一等 Mastra Agent,供实验评测 / Studio 调试) ────

/** 构造并注册单个表单智能体到 Mastra 实例(id `agent-{id}`);先移除旧注册再加(addAgent 重复 key 会抛错) */
async function syncBizAgentRegistration(row: AiAgentRow): Promise<void> {
  try {
    const [{ getMastra, bizAgentId, getChatMemory }, { Agent }] = await Promise.all([
      import('../../lib/mastra'),
      import('@mastra/core/agent'),
    ]);
    const mastra = await getMastra();
    const key = bizAgentId(row.id);
    const registry = mastra as unknown as { removeAgent: (key: string) => boolean };
    registry.removeAgent(key);
    if (!row.isEnabled) return; // 停用即注销,不再作为实验/Studio 目标
    const agent = await buildMastraAgentFromRow(row, Agent, getChatMemory);
    mastra.addAgent(agent as never, key);
  } catch (err) {
    logger.warn('[ai-agents] sync mastra registration failed', { agentId: row.id, err });
  }
}

type AgentCtor = (typeof import('@mastra/core/agent'))['Agent'];

/** DB 行 → Mastra Agent(模型链静态解析;KB 绑定转 kb-search 工具,使其在实验/Studio 中也可用) */
async function buildMastraAgentFromRow(
  row: AiAgentRow,
  Agent: AgentCtor,
  getChatMemory: (typeof import('../../lib/mastra'))['getChatMemory'],
) {
  const { getRawProviderConfig, getRawDefaultProviderConfig } = await import('./ai-providers.service');
  const { buildModelChain } = await import('../../lib/ai/mastra-models');
  const { getMastraTools, createKbSearchTool } = await import('../../lib/ai/tools');

  const cfg = row.configId
    ? await getRawProviderConfig(row.configId).catch(() => null)
    : await getRawDefaultProviderConfig();
  if (!cfg) throw new Error('智能体缺少可用的服务商配置');
  const model = row.model && cfg.models.includes(row.model) ? row.model : cfg.defaultModel;

  const tools = await getMastraTools(row.tools ?? []);
  if (row.knowledgeBaseId) {
    tools['kb_search'] = await createKbSearchTool(row.knowledgeBaseId, row.userId);
  }

  return new Agent({
    id: `agent-${row.id}`,
    name: row.name,
    description: row.description ?? undefined,
    instructions: row.instructions,
    model: buildModelChain([{
      source: cfg,
      model,
      maxRetries: 1,
      modelSettings: { ...cfg.modelSettings, ...row.modelSettings },
    }]),
    ...(Object.keys(tools).length > 0 ? { tools: tools as never } : {}),
    memory: (() => getChatMemory()) as never,
    ...(row.maxSteps ? { maxSteps: row.maxSteps } : {}),
  });
}

/** 启动时批量注册全部启用的表单智能体(getMastra 初始化时调用,传入实例避免互等死锁) */
export async function registerAllBizAgents(mastra: { addAgent: (agent: never, key?: string) => unknown }): Promise<void> {
  const rows = await db.select().from(aiAgents).where(eq(aiAgents.isEnabled, true));
  if (rows.length === 0) return;
  const [{ bizAgentId, getChatMemory }, { Agent }] = await Promise.all([
    import('../../lib/mastra'),
    import('@mastra/core/agent'),
  ]);
  for (const row of rows) {
    try {
      const agent = await buildMastraAgentFromRow(row, Agent, getChatMemory);
      mastra.addAgent(agent as never, bizAgentId(row.id));
    } catch (err) {
      logger.warn('[ai-agents] register agent failed', { agentId: row.id, err });
    }
  }
  logger.info(`[ai-agents] registered ${rows.length} biz agents into mastra`);
}

// ─── 编程式内置智能体(业务示例:services/biz-demo/demo-agent) ────────────────

/** 内置智能体清单(列表只读展示,可直接对话;定义见 services/biz-demo/demo-agent 与 services/iot/iot-ai-agent) */
export async function listBuiltinAgents(): Promise<AiBuiltinAgent[]> {
  const { DEMO_AGENT_METAS } = await import('../biz-demo/demo-agent');
  const { IOT_AGENT_METAS } = await import('../iot/iot-ai-agent');
  return [...DEMO_AGENT_METAS, ...IOT_AGENT_METAS];
}
