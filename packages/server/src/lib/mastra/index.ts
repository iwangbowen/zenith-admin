import { config } from '../../config';
import { getSettings } from '../settings';
import logger from '../logger';
import type { Mastra } from '@mastra/core';
import type { PostgresStore, PgVector } from '@mastra/pg';
import type { Memory } from '@mastra/memory';
import type { AiModelSource } from '../ai/mastra-models';

/**
 * Mastra 运行时单例基座。
 *
 * 职责边界(运行时全量 + 薄业务账本):
 * - Mastra storage(PostgreSQL 同库独立 `mastra` schema,首次使用自动建表):
 *   memory(上下文引擎)/ workflows(挂起恢复)/ traces(执行观测)/
 *   datasets & experiments(评测)等运行时域的权威;
 * - 业务账本(public schema,drizzle 管理)仍是 UI 渲染与审计/反馈/用量的权威。
 *
 * ⚠️ @mastra/* 均为重依赖:全部惰性加载,禁止顶层静态 import 值。
 * PostgresStore 内部使用 node-postgres 连接池(与 drizzle 的 postgres-js 各自独立),
 * 连接同一数据库;池上限独立配置,避免挤占业务连接。
 */

const MASTRA_SCHEMA = 'mastra';

/** 聊天 Agent 动态参数的 requestContext 键 */
export const CHAT_MODEL_CHAIN_KEY = 'zenith-chat-model-chain';
export const CHAT_SYSTEM_PROMPT_KEY = 'zenith-chat-system-prompt';
export const CHAT_TOOLS_KEY = 'zenith-chat-tools';

let storagePromise: Promise<PostgresStore> | null = null;

/**
 * Mastra 存储(PostgresStoreVNext,mastra schema);进程内单例。
 * VNext 的 observability 域(logs/metrics/traces)支持 Studio 日志页;
 * observability 连接必须显式给出——本项目复用同库(低量级,官方允许并警告),
 * 生产高量级场景可改为独立观测库连接。
 */
export function getMastraStorage(): Promise<PostgresStore> {
  storagePromise ??= (async () => {
    const { PostgresStoreVNext } = await import('@mastra/pg');
    const store = new PostgresStoreVNext({
      id: 'zenith-mastra-storage',
      connectionString: config.databaseUrl,
      schemaName: MASTRA_SCHEMA,
      max: 10,
      observability: { connectionString: config.databaseUrl },
    });
    await store.init();
    logger.info('[mastra] PostgresStoreVNext initialized (schema: mastra, observability: same-db)');
    return store;
  })();
  return storagePromise;
}

let vectorPromise: Promise<PgVector> | null = null;

/** Mastra 向量库(PgVector,mastra schema);语义召回与知识库共用 */
export function getMastraVector(): Promise<PgVector> {
  vectorPromise ??= (async () => {
    const { PgVector } = await import('@mastra/pg');
    return new PgVector({
      id: 'zenith-mastra-vector',
      connectionString: config.databaseUrl,
      schemaName: MASTRA_SCHEMA,
      max: 5,
    });
  })();
  return vectorPromise;
}

/**
 * 解析 embedding 模型:运行时设置 `ai.embeddingModel`(裸模型名)+ 默认服务商的端点与密钥。
 * 返回 null 表示未配置(语义召回与向量检索退化为关闭/关键词)。
 */
export async function resolveEmbedderConfig(): Promise<{ key: string; source: AiModelSource; model: string } | null> {
  const model = (await getSettings('ai')).embeddingModel;
  if (!model) return null;
  // 惰性 import 避免模块加载环(providers.service 依赖 lib/ai 层)
  const { getRawDefaultProviderConfig } = await import('../../services/ai/ai-providers.service');
  const cfg = await getRawDefaultProviderConfig();
  if (!cfg) return null;
  return {
    key: `${cfg.providerId}|${cfg.baseUrl ?? ''}|${model}`,
    source: cfg,
    model,
  };
}

const memoryCache = new Map<string, Promise<Memory>>();

/**
 * 聊天记忆实例(按 embedding 配置缓存;配置变化自动重建)。
 * - 始终启用 lastMessages(最近 20 条,替代自研滑窗裁剪)
 * - working memory(resource 域用户画像):模型自动维护跨对话的用户信息,
 *   实例级默认开启,是否生效由调用时 per-call options 按用户设置覆盖
 * - 配置了 embedding 模型时启用 semantic recall(当前对话内向量召回早期内容)
 */
export function getChatMemory(): Promise<Memory> {
  return (async () => {
    const embedder = await resolveEmbedderConfig();
    const cacheKey = embedder?.key ?? 'no-embedder';
    let cached = memoryCache.get(cacheKey);
    if (!cached) {
      cached = (async () => {
        const [{ Memory }, storage] = await Promise.all([import('@mastra/memory'), getMastraStorage()]);
        const workingMemory = {
          enabled: true,
          scope: 'resource' as const,
          template: [
            '# 用户画像',
            '- 称呼:',
            '- 职业/角色:',
            '- 技术栈/工作背景:',
            '- 偏好(语言/风格/格式):',
            '- 长期目标:',
            '',
            '仅记录用户主动透露的稳定事实与偏好;不要记录敏感信息(证件号/密码/精确住址)。',
          ].join('\n'),
        };
        if (!embedder) {
          return new Memory({
            storage: storage as never,
            options: { lastMessages: 20, semanticRecall: false, workingMemory },
          });
        }
        const [{ ModelRouterEmbeddingModel }, vector] = await Promise.all([
          import('@mastra/core/llm'),
          getMastraVector(),
        ]);
        const { toMastraModel } = await import('../ai/mastra-models');
        return new Memory({
          storage: storage as never,
          vector: vector as never,
          embedder: new ModelRouterEmbeddingModel(toMastraModel(embedder.source, embedder.model)),
          options: {
            lastMessages: 20,
            semanticRecall: { topK: 4, messageRange: 2, scope: 'thread' },
            workingMemory,
          },
        });
      })();
      memoryCache.set(cacheKey, cached);
      // 失败不缓存,允许下次重试
      cached.catch(() => memoryCache.delete(cacheKey));
    }
    return cached;
  })();
}

/** 对话 → Mastra thread 的确定性映射(不需要在账本加映射列) */
export function chatThreadId(conversationId: number): string {
  return `conv:${conversationId}`;
}

/** 用户 → Mastra resource 的确定性映射 */
export function chatResourceId(userId: number): string {
  return `user:${userId}`;
}

/** 业务智能体(ai_agents)→ Mastra agent ID 的确定性映射 */
export function bizAgentId(agentId: number): string {
  return `agent-${agentId}`;
}

let mastraPromise: Promise<Mastra> | null = null;

/**
 * 注册式 Mastra 实例(进程内单例):
 * - `zenith-chat`:聊天 Agent,模型链/提示词/工具经 requestContext 每次调用动态注入
 * - `agent-{id}`:业务智能体(ai_agents),CRUD 时同步注册,可被实验评测与 Studio 调试
 * - storage / vectors / observability(traces+metrics 自动采集,敏感数据自动脱敏)
 */
export function getMastra(): Promise<Mastra> {
  mastraPromise ??= buildMastra().catch((err) => {
    mastraPromise = null;
    throw err;
  });
  return mastraPromise;
}

async function buildMastra(): Promise<Mastra> {
  const [{ Mastra }, { Agent }, storage, vector] = await Promise.all([
    import('@mastra/core/mastra'),
    import('@mastra/core/agent'),
    getMastraStorage(),
    getMastraVector(),
  ]);
  const { Observability, MastraStorageExporter, SensitiveDataFilter } = await import('@mastra/observability');
  const { ZenithMastraLogger } = await import('./logger');

  const chatAgent = new Agent({
    id: 'zenith-chat',
    name: 'Zenith Chat',
    instructions: ({ requestContext }) =>
      (requestContext.get(CHAT_SYSTEM_PROMPT_KEY) as string | undefined)?.trim() || '你是一个乐于助人的智能助手。',
    // 业务聊天每次经 requestContext 注入模型链;无注入(Studio 详情/调试、评测 target)
    // 时回退到系统默认服务商配置,否则解析出 undefined 会让 Studio 报 Agent not found
    model: (async ({ requestContext }: { requestContext: { get: (k: string) => unknown } }) => {
      const injected = requestContext.get(CHAT_MODEL_CHAIN_KEY);
      if (injected) return injected;
      const [{ getRawDefaultProviderConfig }, { buildModelChain }] = await Promise.all([
        import('../../services/ai/ai-providers.service'),
        import('../ai/mastra-models'),
      ]);
      const cfg = await getRawDefaultProviderConfig();
      if (!cfg) throw new Error('没有可用的默认 AI 服务商配置');
      return buildModelChain([{ source: cfg, model: cfg.defaultModel, maxRetries: 1, modelSettings: cfg.modelSettings ?? undefined }]);
    }) as never,
    tools: (({ requestContext }: { requestContext: { get: (k: string) => unknown } }) =>
      requestContext.get(CHAT_TOOLS_KEY) ?? {}) as never,
    memory: (() => getChatMemory()) as never,
  });

  const mastra = new Mastra({
    agents: { 'zenith-chat': chatAgent },
    storage: storage as never,
    vectors: { default: vector as never },
    // 系统 pino 适配器(见 ./logger):原生日志统一进主日志体系(文件轮转/告警计数/reqId),
    // 按系统级别(默认 info)输出;observability 导出独立于该级别,
    // 观测存储收 debug 全量(聊天链路的 Mastra 内部日志均为 debug 级),Studio /logs 页据此可查
    logger: new ZenithMastraLogger(),
    observability: new Observability({
      configs: {
        default: {
          serviceName: 'zenith-ai',
          exporters: [new MastraStorageExporter()],
          spanOutputProcessors: [new SensitiveDataFilter()],
          logging: { enabled: true, level: 'debug' },
        },
      },
    }) as never,
  });

  // 业务智能体批量注册(失败不阻塞实例可用性;传入实例避免与 getMastra 互等死锁)
  try {
    const { registerAllBizAgents } = await import('../../services/ai/ai-agents.service');
    await registerAllBizAgents(mastra);
  } catch (err) {
    logger.warn('[mastra] register biz agents failed', err);
  }

  // 编程式内置智能体(业务示例:Agent×Workflow 双向整合教学)
  try {
    const { registerDemoAgents } = await import('../../services/biz-demo/demo-agent');
    await registerDemoAgents(mastra);
  } catch (err) {
    logger.warn('[mastra] register demo agents failed', err);
  }

  // IoT 设备助手（编程式：设备状态/告警/异常查询工具）
  try {
    const { registerIotAgent } = await import('../../services/iot/iot-ai-agent');
    await registerIotAgent(mastra);
  } catch (err) {
    logger.warn('[mastra] register iot agent failed', err);
  }

  // 评测打分器(code 类必注册;llm 类以当前默认服务商为评审模型,发实验时会刷新)
  const { registerAllScorers } = await import('./scorers');
  await registerAllScorers(mastra);

  logger.info('[mastra] instance ready (agents registered)');
  return mastra;
}
