import { HTTPException } from 'hono/http-exception';
import { requireRow } from '../../lib/db-assert';
import { getMastra } from '../../lib/mastra';
import { formatDateTime } from '../../lib/datetime';
import logger from '../../lib/logger';
import { AI_EVAL_SCORERS } from '@zenith/shared/ai';
import type {
  AiEvalDataset,
  AiEvalDatasetItem,
  AiEvalExperiment,
  AiEvalExperimentResult,
  CreateAiEvalDatasetInput,
  UpdateAiEvalDatasetInput,
  AddAiEvalItemsInput,
  RunAiExperimentInput,
} from '@zenith/shared/ai';

/**
 * 模型评测(Mastra Datasets + Experiments 包装):
 * - 评测集 = mastra dataset(版本化,条目 input/groundTruth,落 mastra schema)
 * - 评测运行 = experiment:对数据集全量条目执行注册的目标智能体
 *   (zenith-chat / agent-{id} / 内置示例),按 scorer 打分
 * - 打分器目录见 shared AI_EVAL_SCORERS:code 类零成本;llm 类为 LLM-as-judge
 *   (评审模型 = 当前默认服务商配置,发实验时刷新注册),产出分数与评审理由
 * - 分数持久化在 scores 域(runId = experimentId,datasetItemId 关联条目),
 *   实验记录本身不含分数,读取时按需聚合
 *
 * 本 service 只做视图映射与业务校验,权限由 route 层 guard 控制。
 */

const DEFAULT_SCORER = 'ground-truth';

/** Mastra DatasetRecord 的视图子集 */
interface DatasetRecordView {
  id: string;
  name: string;
  description?: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Mastra Experiment 的视图子集 */
interface ExperimentView {
  id: string;
  name?: string;
  datasetId: string | null;
  targetId: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  totalItems: number;
  succeededCount: number;
  failedCount: number;
  createdAt: Date;
}

/** Mastra ExperimentResult 的视图子集 */
interface ExperimentResultView {
  itemId: string;
  input: unknown;
  output: unknown;
  groundTruth: unknown;
  error: { message: string } | null;
}

/** Mastra ScoreRowData 的视图子集(实验打分行的 entityId = 数据集条目 ID) */
interface ScoreRowView {
  scorerId: string;
  score: number;
  /** LLM 评审理由(code 类打分器为空) */
  reason?: string | null;
  datasetItemId?: string | null;
  entityId?: string | null;
}

function toDateStr(v: Date | string | undefined): string {
  if (!v) return '';
  return formatDateTime(v instanceof Date ? v : new Date(v));
}

function asText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  // agent.generate 的完整结果对象:取正文文本
  if (typeof v === 'object' && typeof (v as { text?: unknown }).text === 'string') {
    return (v as { text: string }).text;
  }
  return JSON.stringify(v);
}

async function getDatasetOrThrow(id: string) {
  const mastra = await getMastra();
  try {
    return await mastra.datasets.get({ id });
  } catch {
    throw new HTTPException(404, { message: '评测集不存在' });
  }
}

async function countItems(dataset: { listItems: (args: { page: number; perPage: number }) => Promise<unknown> }): Promise<number> {
  const res = (await dataset.listItems({ page: 0, perPage: 1 })) as { pagination?: { total?: number } };
  return res.pagination?.total ?? 0;
}

function mapDataset(record: DatasetRecordView, itemCount: number): AiEvalDataset {
  return {
    id: record.id,
    name: record.name,
    description: record.description ?? null,
    itemCount,
    version: record.version,
    createdAt: toDateStr(record.createdAt),
    updatedAt: toDateStr(record.updatedAt),
  };
}

function itemToView(item: { id: string; input: unknown; groundTruth?: unknown }): AiEvalDatasetItem {
  return {
    id: item.id,
    input: asText(item.input),
    groundTruth: item.groundTruth == null ? null : asText(item.groundTruth),
  };
}

// ─── 评测集 CRUD ──────────────────────────────────────────────────────────────

export async function listEvalDatasets(): Promise<AiEvalDataset[]> {
  const mastra = await getMastra();
  const { datasets } = await mastra.datasets.list({ page: 0, perPage: 100 });
  const out: AiEvalDataset[] = [];
  for (const record of datasets as DatasetRecordView[]) {
    let itemCount = 0;
    try {
      const dataset = await mastra.datasets.get({ id: record.id });
      itemCount = await countItems(dataset);
    } catch {
      // 数据集刚被删除等竞态,按 0 处理
    }
    out.push(mapDataset(record, itemCount));
  }
  return out;
}

export async function createEvalDataset(input: CreateAiEvalDatasetInput): Promise<AiEvalDataset> {
  const mastra = await getMastra();
  const dataset = await mastra.datasets.create({
    name: input.name,
    description: input.description ?? undefined,
  });
  let itemCount = 0;
  if (input.items && input.items.length > 0) {
    await dataset.addItems({
      items: input.items.map((i) => ({ input: i.input, groundTruth: i.groundTruth ?? undefined })),
    });
    itemCount = input.items.length;
  }
  const record = (await dataset.getDetails()) as DatasetRecordView;
  return mapDataset(record, itemCount);
}

export async function updateEvalDataset(id: string, input: UpdateAiEvalDatasetInput): Promise<AiEvalDataset> {
  const dataset = await getDatasetOrThrow(id);
  const record = (await dataset.update({
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description ?? undefined } : {}),
  })) as DatasetRecordView;
  return mapDataset(record, await countItems(dataset));
}

export async function deleteEvalDataset(id: string): Promise<void> {
  const mastra = await getMastra();
  await getDatasetOrThrow(id);
  await mastra.datasets.delete({ id });
}

// ─── 条目管理 ─────────────────────────────────────────────────────────────────

export async function listEvalItems(datasetId: string): Promise<AiEvalDatasetItem[]> {
  const dataset = await getDatasetOrThrow(datasetId);
  const res = (await dataset.listItems({ page: 0, perPage: 500 })) as {
    items: Array<{ id: string; input: unknown; groundTruth?: unknown }>;
  };
  return res.items.map(itemToView);
}

export async function addEvalItems(datasetId: string, input: AddAiEvalItemsInput): Promise<AiEvalDatasetItem[]> {
  const dataset = await getDatasetOrThrow(datasetId);
  await dataset.addItems({
    items: input.items.map((i) => ({ input: i.input, groundTruth: i.groundTruth ?? undefined })),
  });
  return listEvalItems(datasetId);
}

export async function deleteEvalItem(datasetId: string, itemId: string): Promise<void> {
  const dataset = await getDatasetOrThrow(datasetId);
  await dataset.deleteItem({ itemId });
}

// ─── 实验(评测运行) ───────────────────────────────────────────────────────────

/** 读取一次实验的全部分数行(runId = experimentId) */
async function listScoreRows(experimentId: string): Promise<ScoreRowView[]> {
  const mastra = await getMastra();
  const scoresStore = (mastra.getStorage() as unknown as {
    stores?: { scores?: { listScoresByRunId: (input: { runId: string; pagination: { page: number; perPage: number } }) => Promise<{ scores: ScoreRowView[] }> } };
  })?.stores?.scores;
  if (!scoresStore) return [];
  try {
    const res = await scoresStore.listScoresByRunId({ runId: experimentId, pagination: { page: 0, perPage: 1000 } });
    return res.scores ?? [];
  } catch (err) {
    logger.warn('[ai-eval] failed to list scores for experiment', { experimentId, err });
    return [];
  }
}

/** 按 scorer 聚合平均分(0-1,保留 3 位小数) */
function avgByScorer(rows: ScoreRowView[]): Record<string, number> | null {
  if (rows.length === 0) return null;
  const sum = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    if (typeof row.score !== 'number' || Number.isNaN(row.score)) continue;
    const agg = sum.get(row.scorerId) ?? { total: 0, count: 0 };
    agg.total += row.score;
    agg.count += 1;
    sum.set(row.scorerId, agg);
  }
  if (sum.size === 0) return null;
  const out: Record<string, number> = {};
  for (const [scorerId, agg] of sum) {
    out[scorerId] = Math.round((agg.total / agg.count) * 1000) / 1000;
  }
  return out;
}

function mapExperiment(exp: ExperimentView, datasetId: string, avgScores: Record<string, number> | null): AiEvalExperiment {
  return {
    id: exp.id,
    name: exp.name || exp.id.slice(0, 8),
    datasetId: exp.datasetId ?? datasetId,
    targetId: exp.targetId ?? '',
    status: exp.status,
    totalCount: exp.totalItems,
    succeededCount: exp.succeededCount,
    failedCount: exp.failedCount,
    avgScores,
    createdAt: toDateStr(exp.createdAt),
  };
}

/**
 * 发起实验(异步):startExperimentAsync 立即返回 experimentId,
 * Mastra 在后台逐条执行,前端经 listExperiments 轮询状态。
 */
export async function runEvalExperiment(
  datasetId: string,
  input: RunAiExperimentInput,
): Promise<{ experimentId: string; name: string }> {
  const mastra = await getMastra();
  const dataset = await getDatasetOrThrow(datasetId);
  if ((await countItems(dataset)) === 0) {
    throw new HTTPException(400, { message: '评测集没有可运行的条目' });
  }
  let agent: unknown;
  try {
    agent = mastra.getAgentById(input.targetId);
  } catch {
    agent = null;
  }
  requireRow(agent, '评测目标智能体不存在或未注册', 400);

  const name = input.name?.trim() || `exp-${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const scorers = input.scorers && input.scorers.length > 0 ? [...new Set(input.scorers)] : [DEFAULT_SCORER];

  // llm 类打分器:发起前以当前默认服务商刷新注册(评审模型跟随配置);无可用配置时明确报错
  const llmScorers = new Set(AI_EVAL_SCORERS.filter((s) => s.kind === 'llm').map((s) => s.id as string));
  if (scorers.some((s) => llmScorers.has(s))) {
    const { ensureLlmScorers } = await import('../../lib/mastra/scorers');
    const ok = await ensureLlmScorers(mastra);
    if (!ok) {
      throw new HTTPException(400, { message: 'LLM 评审打分器需要系统默认 AI 服务商配置,请先在 AI 服务商中设置默认配置' });
    }
  }

  // 需要期望答案的打分器:校验数据集条目已填 groundTruth
  const needsGt = new Set(AI_EVAL_SCORERS.filter((s) => s.needsGroundTruth).map((s) => s.id as string));
  if (scorers.some((s) => needsGt.has(s))) {
    const { items } = (await dataset.listItems({ page: 0, perPage: 500 })) as unknown as {
      items: Array<{ groundTruth?: unknown }>;
    };
    if (items.some((i) => i.groundTruth == null || asText(i.groundTruth).trim() === '')) {
      throw new HTTPException(400, { message: '所选打分器需要期望答案,请先为全部条目填写期望要点' });
    }
  }

  const { experimentId } = await dataset.startExperimentAsync({
    name,
    targetType: 'agent',
    targetId: input.targetId,
    scorers,
    maxConcurrency: 2,
  });
  logger.info('[ai-eval] experiment started', { datasetId, experimentId, name, targetId: input.targetId, scorers });
  return { experimentId, name };
}

export async function listEvalExperiments(datasetId: string): Promise<AiEvalExperiment[]> {
  const dataset = await getDatasetOrThrow(datasetId);
  const { experiments } = (await dataset.listExperiments({ page: 0, perPage: 20 })) as unknown as {
    experiments: ExperimentView[];
  };
  const out: AiEvalExperiment[] = [];
  for (const exp of experiments) {
    // 分数存 scores 域,实验记录不含;只为已完成实验聚合平均分
    const avgScores = exp.status === 'completed' ? avgByScorer(await listScoreRows(exp.id)) : null;
    out.push(mapExperiment(exp, datasetId, avgScores));
  }
  return out;
}

export async function getEvalExperimentResults(
  datasetId: string,
  experimentId: string,
): Promise<{ experiment: AiEvalExperiment; results: AiEvalExperimentResult[] }> {
  const dataset = await getDatasetOrThrow(datasetId);
  const exp = (await dataset.getExperiment({ experimentId })) as ExperimentView | null;
  const experiment = requireRow(exp, '实验不存在');

  const { results: rows } = (await dataset.listExperimentResults({
    experimentId,
    page: 0,
    perPage: 500,
  })) as unknown as { results: ExperimentResultView[] };

  const scoreRows = await listScoreRows(experimentId);
  const scoresByItem = new Map<string, Record<string, number>>();
  const reasonsByItem = new Map<string, Record<string, string>>();
  for (const row of scoreRows) {
    const itemId = row.datasetItemId ?? row.entityId;
    if (!itemId || typeof row.score !== 'number') continue;
    const bucket = scoresByItem.get(itemId) ?? {};
    bucket[row.scorerId] = Math.round(row.score * 1000) / 1000;
    scoresByItem.set(itemId, bucket);
    if (row.reason && row.reason.trim()) {
      const rb = reasonsByItem.get(itemId) ?? {};
      rb[row.scorerId] = row.reason.trim();
      reasonsByItem.set(itemId, rb);
    }
  }

  const results: AiEvalExperimentResult[] = rows.map((r) => ({
    itemId: r.itemId,
    input: asText(r.input),
    groundTruth: r.groundTruth == null ? null : asText(r.groundTruth),
    output: r.output == null ? '' : asText(r.output),
    scores: scoresByItem.get(r.itemId) ?? {},
    reasons: reasonsByItem.get(r.itemId) ?? {},
    error: r.error ? r.error.message : null,
  }));

  return { experiment: mapExperiment(experiment, datasetId, avgByScorer(scoreRows)), results };
}
