import { eq, desc } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { aiEvalSets, aiEvalRuns } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { registerTaskHandler, submitAsyncTask, mapAsyncTask } from '../../lib/task-center';
import { chatOnceOpenAICompatible } from '../../lib/ai/adapters/openai-compatible';
import { getRawDefaultProviderConfig, getRawProviderConfig } from './ai-providers.service';
import type { AiEvalSetRow, AiEvalRunRow, AiEvalResult } from '../../db/schema';
import type { CreateAiEvalSetInput, UpdateAiEvalSetInput, RunAiEvalInput } from '@zenith/shared';

function mapSet(row: AiEvalSetRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    items: row.items ?? [],
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function mapRun(row: AiEvalRunRow, setName: string | null = null) {
  return {
    id: row.id,
    setId: row.setId,
    setName,
    configId: row.configId,
    model: row.model,
    status: row.status as 'running' | 'done' | 'failed',
    results: row.results,
    avgDurationMs: row.avgDurationMs,
    totalTokens: row.totalTokens,
    createdAt: formatDateTime(row.createdAt),
  };
}

// ─── 评测集 CRUD ──────────────────────────────────────────────────────────────

export async function listEvalSets() {
  const rows = await db.select().from(aiEvalSets).orderBy(desc(aiEvalSets.updatedAt));
  return rows.map(mapSet);
}

export async function createEvalSet(input: CreateAiEvalSetInput) {
  const user = currentUser();
  const [row] = await db
    .insert(aiEvalSets)
    .values({
      name: input.name,
      description: input.description ?? null,
      items: input.items,
      createdBy: user.userId,
      updatedBy: user.userId,
    })
    .returning();
  return mapSet(row);
}

export async function updateEvalSet(id: number, input: UpdateAiEvalSetInput) {
  const user = currentUser();
  const [existing] = await db.select().from(aiEvalSets).where(eq(aiEvalSets.id, id));
  if (!existing) throw new HTTPException(404, { message: '评测集不存在' });
  const [row] = await db
    .update(aiEvalSets)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.items !== undefined && { items: input.items }),
      updatedBy: user.userId,
    })
    .where(eq(aiEvalSets.id, id))
    .returning();
  return mapSet(row);
}

export async function deleteEvalSet(id: number) {
  const result = await db.delete(aiEvalSets).where(eq(aiEvalSets.id, id)).returning();
  if (result.length === 0) throw new HTTPException(404, { message: '评测集不存在' });
}

// ─── 评测运行（任务中心异步执行） ─────────────────────────────────────────────

export async function listEvalRuns(setId?: number) {
  const conds = setId ? eq(aiEvalRuns.setId, setId) : undefined;
  const rows = await db
    .select({ run: aiEvalRuns, setName: aiEvalSets.name })
    .from(aiEvalRuns)
    .leftJoin(aiEvalSets, eq(aiEvalRuns.setId, aiEvalSets.id))
    .where(conds)
    .orderBy(desc(aiEvalRuns.createdAt))
    .limit(100);
  return rows.map((r) => mapRun(r.run, r.setName));
}

export async function getEvalRun(id: number) {
  const [row] = await db
    .select({ run: aiEvalRuns, setName: aiEvalSets.name })
    .from(aiEvalRuns)
    .leftJoin(aiEvalSets, eq(aiEvalRuns.setId, aiEvalSets.id))
    .where(eq(aiEvalRuns.id, id));
  if (!row) throw new HTTPException(404, { message: '评测运行不存在' });
  return mapRun(row.run, row.setName);
}

/** 提交评测运行（任务中心异步执行，返回任务对象） */
export async function submitEvalRun(setId: number, input: RunAiEvalInput) {
  const user = currentUser();
  const [set] = await db.select().from(aiEvalSets).where(eq(aiEvalSets.id, setId));
  if (!set) throw new HTTPException(404, { message: '评测集不存在' });
  if ((set.items ?? []).length === 0) throw new HTTPException(400, { message: '评测集没有可运行的问题' });

  // 预解析目标配置（校验存在性 + 记录最终模型名）
  const cfg = input.configId ? await getRawProviderConfig(input.configId) : await getRawDefaultProviderConfig();
  if (!cfg) throw new HTTPException(400, { message: '未找到可用的 AI 服务商配置' });
  if (cfg.provider !== 'openai_compatible') throw new HTTPException(400, { message: '评测目前仅支持 OpenAI 兼容服务商' });
  const model = input.model?.trim() || cfg.model;

  const [run] = await db
    .insert(aiEvalRuns)
    .values({ setId, configId: cfg.id, model, status: 'running', createdBy: user.userId })
    .returning();

  const task = await submitAsyncTask({
    taskType: 'ai-eval-run',
    title: `AI 评测：${set.name}（${model}）`,
    payload: { runId: run.id },
  });
  return { run: mapRun(run, set.name), task: mapAsyncTask(task) };
}

/** 注册评测任务 handler（index.ts 启动时调用一次） */
export function registerAiEvalTaskHandlers(): void {
  registerTaskHandler({
    taskType: 'ai-eval-run',
    title: 'AI 模型评测',
    module: '智能助手',
    allowConcurrent: false,
    async run(ctx) {
      const runId = Number((ctx.payload as { runId?: number }).runId);
      const [run] = await db.select().from(aiEvalRuns).where(eq(aiEvalRuns.id, runId));
      if (!run) throw new Error('评测运行记录不存在');
      const [set] = await db.select().from(aiEvalSets).where(eq(aiEvalSets.id, run.setId));
      if (!set) throw new Error('评测集不存在');
      const cfg = run.configId ? await getRawProviderConfig(run.configId) : await getRawDefaultProviderConfig();
      if (!cfg) throw new Error('AI 服务商配置不存在');

      const items = set.items ?? [];
      // 断点恢复：跳过已完成条目
      const results: AiEvalResult[] = Array.isArray(ctx.checkpoint?.results)
        ? (ctx.checkpoint.results as AiEvalResult[])
        : [];

      for (let i = results.length; i < items.length; i++) {
        const item = items[i];
        const started = Date.now();
        try {
          const answer = await chatOnceOpenAICompatible(
            {
              baseUrl: cfg.baseUrl,
              apiKey: cfg.apiKey,
              model: run.model,
              maxTokens: Math.min(cfg.maxTokens, 2048),
              temperature: cfg.temperature,
              systemPrompt: cfg.systemPrompt,
            },
            [{ role: 'user', content: item.question }],
            { timeoutMs: 60_000 },
          );
          const durationMs = Date.now() - started;
          results.push({
            question: item.question,
            expected: item.expected,
            answer: answer.slice(0, 8000),
            durationMs,
            // 非流式接口未返回 usage 时按字符估算
            tokensInput: Math.ceil(item.question.length / 4),
            tokensOutput: Math.ceil(answer.length / 4),
          });
          await ctx.reportItems([{ key: `q-${i + 1}`, label: item.question.slice(0, 100), status: 'success', message: `${durationMs}ms` }]);
        } catch (err) {
          const durationMs = Date.now() - started;
          const message = err instanceof Error ? err.message : '调用失败';
          results.push({ question: item.question, expected: item.expected, answer: '', durationMs, tokensInput: 0, tokensOutput: 0, error: message });
          await ctx.reportItems([{ key: `q-${i + 1}`, label: item.question.slice(0, 100), status: 'failed', message: message.slice(0, 200) }]);
        }
        const { cancelRequested } = await ctx.progress({
          processed: i + 1,
          total: items.length,
          note: `已评测 ${i + 1}/${items.length} 题`,
          checkpoint: { results },
        });
        if (cancelRequested) {
          await persistRunResults(runId, results, 'failed');
          return;
        }
      }

      await persistRunResults(runId, results, 'done');
      return { total: items.length, failed: results.filter((r) => r.error).length };
    },
  });
}

async function persistRunResults(runId: number, results: AiEvalResult[], status: 'done' | 'failed') {
  const okResults = results.filter((r) => !r.error);
  const avgDurationMs = okResults.length > 0 ? Math.round(okResults.reduce((acc, r) => acc + r.durationMs, 0) / okResults.length) : null;
  const totalTokens = results.reduce((acc, r) => acc + r.tokensInput + r.tokensOutput, 0);
  await db
    .update(aiEvalRuns)
    .set({ status, results, avgDurationMs, totalTokens })
    .where(eq(aiEvalRuns.id, runId));
}

/** 兜底：删除评测运行记录 */
export async function deleteEvalRun(id: number) {
  const result = await db.delete(aiEvalRuns).where(eq(aiEvalRuns.id, id)).returning();
  if (result.length === 0) throw new HTTPException(404, { message: '评测运行不存在' });
}
