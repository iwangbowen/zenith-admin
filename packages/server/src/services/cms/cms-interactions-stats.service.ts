import { percentOf as sharedPercentOf } from '@zenith/shared/core';
import { requireRow } from '../../lib/db-assert';
import {
  and,
  eq,
  inArray,
  sql,
} from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { CMS_INTERACTION_MATRIX_SEPARATOR, CMS_INTERACTION_NPS_MAX, CMS_INTERACTION_OTHER_PREFIX, CMS_INTERACTION_OTHER_VALUE } from '@zenith/shared/cms';
import type { CmsInteractionCrossStats, CmsInteractionQuestionType, CmsInteractionPublicStats, CmsInteractionQuestionStats, CmsInteractionStats, CmsInteractionTextAnswer, CmsInteractionTrendStats } from '@zenith/shared/cms';
import { db } from '../../db';
import {
  cmsInteractionAnswers,
  cmsInteractionQuestions,
  cmsInteractionResponses,
  cmsInteractions,
} from '../../db/schema';
import type { CmsInteractionQuestionRow } from '../../db/schema';
import { formatDate, formatDateTime } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { keywordCondition } from '../../lib/where-helpers';
import { buildListResult } from '../../lib/list-query';
import { assertSiteAccess } from './cms-sites.service';
import { ensureCmsInteractionExists, isOtherAnswer } from './cms-interactions-shared';

/** 可做交叉分析的题型：需要离散且有限的选项集合 */
const CROSS_ANALYZABLE_TYPES = new Set<CmsInteractionQuestionType>(['single', 'multiple']);

/**
 * 答案值展开：`value` 为 jsonb，可能是标量字符串或字符串数组。
 * 用 LATERAL 两分支统一摊平成一行一值，避免把整表拉进内存做聚合。
 */
const ANSWER_VALUE_LATERAL = sql`
  CROSS JOIN LATERAL (
    SELECT jsonb_array_elements_text(a.value) AS val WHERE jsonb_typeof(a.value) = 'array'
    UNION ALL
    SELECT a.value #>> '{}' AS val WHERE jsonb_typeof(a.value) <> 'array'
  ) v
`;

/** 需要值分布直方图的题型（桶数天然有界） */
const HISTOGRAM_TYPES = sql`('single','multiple','matrix','rating','nps')`;
/** 结果面板直接返回的文本样本条数；更多走 /stats/texts 分页接口 */
const TEXT_SAMPLE_LIMIT = 50;

/** 选项分布：给定命中计数与分母，产出带百分比的选项数组 */
function distributionOf(
  options: { id: string; label: string; value: string }[],
  counts: Map<string, number>,
  answered: number,
) {
  return options.map((option) => {
    const count = counts.get(option.value) ?? 0;
    return {
      ...option,
      count,
      percent: sharedPercentOf(count, answered) ?? 0,
    };
  });
}

/** 本文件统计口径：分母为 0 时返回 0（而非 null） */
function percentOf(count: number, total: number): number {
  return sharedPercentOf(count, total) ?? 0;
}

/** NPS 净推荐值：推荐者（9-10）占比 - 贬损者（0-6）占比 */
export function npsScoreOf(scores: number[]): number | null {
  if (scores.length === 0) return null;
  const promoters = scores.filter((score) => score >= 9).length;
  const detractors = scores.filter((score) => score <= 6).length;
  return Math.round(((promoters - detractors) / scores.length) * 1000) / 10;
}

/** 由「分值 → 人数」直方图还原均值与 NPS，无需回表逐行扫描 */
export function scaleStatsFromHistogram(buckets: Map<string, number>): {
  average: number | null;
  scores: number[];
} {
  let sum = 0;
  let total = 0;
  const scores: number[] = [];
  buckets.forEach((count, value) => {
    const score = Number(value);
    if (!Number.isFinite(score)) return;
    sum += score * count;
    total += count;
    for (let index = 0; index < count; index += 1) scores.push(score);
  });
  return { average: total > 0 ? Math.round((sum / total) * 100) / 100 : null, scores };
}

interface StatsAggregates {
  /** questionId → (value → count) */
  histogram: Map<number, Map<string, number>>;
  /** questionId → 作答人数 */
  answered: Map<number, number>;
  /** questionId → 均值（仅数字题走 SQL AVG） */
  numericAverage: Map<number, number>;
  /** questionId → 文本样本 */
  texts: Map<number, string[]>;
}

/** 全部聚合在 SQL 侧完成，结果规模仅与题目/选项数相关，与答卷量无关 */
async function loadStatsAggregates(id: number): Promise<StatsAggregates> {
  const [histogramRows, answeredRows, numericRows, textRows] = await Promise.all([
    db.execute(sql`
      SELECT a.question_id AS question_id, v.val AS val, COUNT(*)::int AS cnt
      FROM ${cmsInteractionAnswers} a
      JOIN ${cmsInteractionResponses} r ON r.id = a.response_id
      JOIN ${cmsInteractionQuestions} q ON q.id = a.question_id
      ${ANSWER_VALUE_LATERAL}
      WHERE r.interaction_id = ${id} AND q.type::text IN ${HISTOGRAM_TYPES}
      GROUP BY a.question_id, v.val
    `) as unknown as Promise<{ question_id: number; val: string; cnt: number }[]>,
    db.execute(sql`
      SELECT a.question_id AS question_id, COUNT(*)::int AS answered
      FROM ${cmsInteractionAnswers} a
      JOIN ${cmsInteractionResponses} r ON r.id = a.response_id
      WHERE r.interaction_id = ${id}
      GROUP BY a.question_id
    `) as unknown as Promise<{ question_id: number; answered: number }[]>,
    db.execute(sql`
      SELECT a.question_id AS question_id, AVG((a.value #>> '{}')::numeric) AS avg
      FROM ${cmsInteractionAnswers} a
      JOIN ${cmsInteractionResponses} r ON r.id = a.response_id
      JOIN ${cmsInteractionQuestions} q ON q.id = a.question_id
      WHERE r.interaction_id = ${id}
        AND q.type = 'number'
        AND jsonb_typeof(a.value) = 'string'
        AND (a.value #>> '{}') ~ '^-?[0-9]+(\\.[0-9]+)?$'
      GROUP BY a.question_id
    `) as unknown as Promise<{ question_id: number; avg: string | number | null }[]>,
    db.execute(sql`
      SELECT question_id, val FROM (
        SELECT a.question_id AS question_id, v.val AS val,
               ROW_NUMBER() OVER (PARTITION BY a.question_id ORDER BY a.id DESC) AS rn
        FROM ${cmsInteractionAnswers} a
        JOIN ${cmsInteractionResponses} r ON r.id = a.response_id
        JOIN ${cmsInteractionQuestions} q ON q.id = a.question_id
        ${ANSWER_VALUE_LATERAL}
        WHERE r.interaction_id = ${id}
          AND (q.type::text IN ('text','date','number') OR (q.allow_other AND starts_with(v.val, ${CMS_INTERACTION_OTHER_PREFIX})))
      ) t
      WHERE rn <= ${TEXT_SAMPLE_LIMIT}
      ORDER BY question_id, rn
    `) as unknown as Promise<{ question_id: number; val: string }[]>,
  ]);

  const histogram = new Map<number, Map<string, number>>();
  for (const row of histogramRows) {
    const buckets = histogram.get(row.question_id) ?? new Map<string, number>();
    buckets.set(row.val, Number(row.cnt));
    histogram.set(row.question_id, buckets);
  }
  const texts = new Map<number, string[]>();
  for (const row of textRows) {
    const list = texts.get(row.question_id) ?? [];
    list.push(row.val.startsWith(CMS_INTERACTION_OTHER_PREFIX)
      ? row.val.slice(CMS_INTERACTION_OTHER_PREFIX.length)
      : row.val);
    texts.set(row.question_id, list);
  }
  return {
    histogram,
    answered: new Map(answeredRows.map((row) => [row.question_id, Number(row.answered)])),
    numericAverage: new Map(numericRows
      .filter((row) => row.avg !== null)
      .map((row) => [row.question_id, Math.round(Number(row.avg) * 100) / 100])),
    texts,
  };
}

export async function getCmsInteractionStatsInternal(id: number): Promise<CmsInteractionStats> {
  const interaction = await db.query.cmsInteractions.findFirst({
    where: eq(cmsInteractions.id, id),
    with: { questions: true },
  });
  const row = requireRow(interaction, '互动问卷不存在');
  const aggregates = await loadStatsAggregates(id);
  return {
    interactionId: id,
    responseCount: row.responseCount,
    questions: [...row.questions].sort((a, b) => a.sort - b.sort || a.id - b.id).map((question) => {
      const buckets = aggregates.histogram.get(question.id) ?? new Map<string, number>();
      const answered = aggregates.answered.get(question.id) ?? 0;
      const base: CmsInteractionQuestionStats = {
        id: question.id,
        label: question.label,
        type: question.type,
        options: [],
        texts: aggregates.texts.get(question.id) ?? [],
        answered,
        average: null,
        npsScore: null,
        matrixRows: [],
      };

      if (question.type === 'text' || question.type === 'date') return base;

      if (question.type === 'number') {
        return { ...base, average: aggregates.numericAverage.get(question.id) ?? null };
      }

      if (question.type === 'rating' || question.type === 'nps') {
        const { average, scores } = scaleStatsFromHistogram(buckets);
        const max = question.type === 'nps' ? CMS_INTERACTION_NPS_MAX : question.ratingMax;
        const min = question.type === 'nps' ? 0 : 1;
        const scale = Array.from({ length: max - min + 1 }, (_, index) => String(min + index));
        return {
          ...base,
          options: distributionOf(scale.map((value) => ({ id: value, label: `${value} 分`, value })), buckets, answered),
          average,
          npsScore: question.type === 'nps' ? npsScoreOf(scores) : null,
        };
      }

      if (question.type === 'matrix') {
        return {
          ...base,
          matrixRows: (question.matrixRows ?? []).map((row) => {
            const prefix = `${row.id}${CMS_INTERACTION_MATRIX_SEPARATOR}`;
            const rowCounts = new Map<string, number>();
            let rowTotal = 0;
            buckets.forEach((count, value) => {
              if (!value.startsWith(prefix)) return;
              rowCounts.set(value.slice(prefix.length), count);
              rowTotal += count;
            });
            return {
              id: row.id,
              label: row.label,
              options: distributionOf(question.options ?? [], rowCounts, rowTotal),
            };
          }),
        };
      }

      // 单选 / 多选：「其他」不论自由文本内容如何，统一归入同一个桶
      const counts = new Map<string, number>();
      let otherCount = 0;
      buckets.forEach((count, value) => {
        if (isOtherAnswer(value)) otherCount += count;
        else counts.set(value, count);
      });
      const options = [...(question.options ?? [])];
      if (question.allowOther) {
        options.push({
          id: CMS_INTERACTION_OTHER_VALUE,
          label: question.otherLabel?.trim() || '其他',
          value: CMS_INTERACTION_OTHER_VALUE,
        });
        counts.set(CMS_INTERACTION_OTHER_VALUE, otherCount);
      }
      return { ...base, options: distributionOf(options, counts, answered) };
    }),
  };
}

export interface ListCmsInteractionTextsQuery {
  interactionId: number;
  questionId: number;
  keyword?: string;
  page: number;
  pageSize: number;
}

/** 文本 / 日期 / 「其他」填空的完整答案分页；结果面板只给前 50 条样本 */
export async function listCmsInteractionTexts(q: ListCmsInteractionTextsQuery) {
  const current = await ensureCmsInteractionExists(q.interactionId);
  await assertSiteAccess(current.siteId);
  const [question] = await db.select().from(cmsInteractionQuestions)
    .where(and(
      eq(cmsInteractionQuestions.id, q.questionId),
      eq(cmsInteractionQuestions.interactionId, q.interactionId),
    ))
    .limit(1);
  requireRow(question, '题目不存在');
  const isFreeText = question.type === 'text' || question.type === 'date' || question.type === 'number';
  if (!isFreeText && !question.allowOther) {
    throw new HTTPException(400, { message: '该题型没有文本答案' });
  }
  const valueFilter = isFreeText
    ? sql`TRUE`
    : sql`starts_with(v.val, ${CMS_INTERACTION_OTHER_PREFIX})`;
  const keywordMatch = keywordCondition(q.keyword, [sql`v.val`], 'ilike');
  const keywordFilter = keywordMatch ? sql`AND ${keywordMatch}` : sql``;
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => (db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM ${cmsInteractionAnswers} a
      JOIN ${cmsInteractionResponses} r ON r.id = a.response_id
      ${ANSWER_VALUE_LATERAL}
      WHERE r.interaction_id = ${q.interactionId} AND a.question_id = ${q.questionId}
        AND ${valueFilter} ${keywordFilter}
    `) as unknown as Promise<{ total: number }[]>).then((r) => r[0]?.total ?? 0),
    rows: () => db.execute(sql`
      SELECT a.response_id AS response_id, v.val AS val, r.created_at AS created_at
      FROM ${cmsInteractionAnswers} a
      JOIN ${cmsInteractionResponses} r ON r.id = a.response_id
      ${ANSWER_VALUE_LATERAL}
      WHERE r.interaction_id = ${q.interactionId} AND a.question_id = ${q.questionId}
        AND ${valueFilter} ${keywordFilter}
      ORDER BY a.id DESC
      LIMIT ${q.pageSize} OFFSET ${pageOffset(q.page, q.pageSize)}
    `) as unknown as Promise<{ response_id: number; val: string; created_at: Date }[]>,
    map: (row): CmsInteractionTextAnswer => ({
      responseId: row.response_id,
      value: row.val.startsWith(CMS_INTERACTION_OTHER_PREFIX)
        ? row.val.slice(CMS_INTERACTION_OTHER_PREFIX.length)
        : row.val,
      createdAt: formatDateTime(row.created_at),
    }),
  });
}

/** 交叉分析：两道选择题按同一份答卷联合统计 */
export async function getCmsInteractionCrossStats(
  interactionId: number,
  xQuestionId: number,
  yQuestionId: number,
): Promise<CmsInteractionCrossStats> {
  const current = await ensureCmsInteractionExists(interactionId);
  await assertSiteAccess(current.siteId);
  if (xQuestionId === yQuestionId) {
    throw new HTTPException(400, { message: '交叉分析需要选择两道不同的题目' });
  }
  const questions = await db.select().from(cmsInteractionQuestions)
    .where(and(
      eq(cmsInteractionQuestions.interactionId, interactionId),
      inArray(cmsInteractionQuestions.id, [xQuestionId, yQuestionId]),
    ));
  const x = questions.find((question) => question.id === xQuestionId);
  const y = questions.find((question) => question.id === yQuestionId);
  if (!x || !y) throw new HTTPException(404, { message: '题目不存在' });
  if (!CROSS_ANALYZABLE_TYPES.has(x.type) || !CROSS_ANALYZABLE_TYPES.has(y.type)) {
    throw new HTTPException(400, { message: '交叉分析仅支持单选或多选题' });
  }
  const rows = await db.execute(sql`
    SELECT xv.val AS x_val, yv.val AS y_val, COUNT(DISTINCT ax.response_id)::int AS cnt
    FROM ${cmsInteractionAnswers} ax
    JOIN ${cmsInteractionAnswers} ay ON ay.response_id = ax.response_id AND ay.question_id = ${yQuestionId}
    JOIN ${cmsInteractionResponses} r ON r.id = ax.response_id
    CROSS JOIN LATERAL (
      SELECT jsonb_array_elements_text(ax.value) AS val WHERE jsonb_typeof(ax.value) = 'array'
      UNION ALL
      SELECT ax.value #>> '{}' AS val WHERE jsonb_typeof(ax.value) <> 'array'
    ) xv
    CROSS JOIN LATERAL (
      SELECT jsonb_array_elements_text(ay.value) AS val WHERE jsonb_typeof(ay.value) = 'array'
      UNION ALL
      SELECT ay.value #>> '{}' AS val WHERE jsonb_typeof(ay.value) <> 'array'
    ) yv
    WHERE r.interaction_id = ${interactionId} AND ax.question_id = ${xQuestionId}
    GROUP BY xv.val, yv.val
  `) as unknown as { x_val: string; y_val: string; cnt: number }[];

  const optionsOf = (question: CmsInteractionQuestionRow) => {
    const list = (question.options ?? []).map((option) => ({ value: option.value, label: option.label }));
    if (question.allowOther) {
      list.push({ value: CMS_INTERACTION_OTHER_VALUE, label: question.otherLabel?.trim() || '其他' });
    }
    return list;
  };
  // 「其他」的自由文本收敛到哨兵桶，保证行列与选项一一对应
  const bucketOf = (value: string) => (isOtherAnswer(value) ? CMS_INTERACTION_OTHER_VALUE : value);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${bucketOf(row.x_val)}\u0000${bucketOf(row.y_val)}`;
    counts.set(key, (counts.get(key) ?? 0) + Number(row.cnt));
  }
  const columns = optionsOf(y);
  return {
    xQuestionId,
    xLabel: x.label,
    yQuestionId,
    yLabel: y.label,
    columns,
    rows: optionsOf(x).map((option) => {
      const cells = columns.map((column) => counts.get(`${option.value}\u0000${column.value}`) ?? 0);
      const total = cells.reduce((sum, count) => sum + count, 0);
      return {
        value: option.value,
        label: option.label,
        total,
        cells: cells.map((count) => ({ count, percent: percentOf(count, total) })),
      };
    }),
  };
}

/** 答卷提交趋势：按天补齐空缺日期，便于前台直接画折线 */
export async function getCmsInteractionTrend(
  interactionId: number,
  days: number,
): Promise<CmsInteractionTrendStats> {
  const current = await ensureCmsInteractionExists(interactionId);
  await assertSiteAccess(current.siteId);
  const span = Math.min(Math.max(days, 1), 180);
  const rows = await db.execute(sql`
    SELECT to_char(date_trunc('day', ${cmsInteractionResponses.createdAt}), 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS cnt
    FROM ${cmsInteractionResponses}
    WHERE ${cmsInteractionResponses.interactionId} = ${interactionId}
      AND ${cmsInteractionResponses.createdAt} >= (CURRENT_DATE - ${span - 1} * INTERVAL '1 day')
    GROUP BY 1
    ORDER BY 1
  `) as unknown as { day: string; cnt: number }[];
  const byDay = new Map(rows.map((row) => [row.day, Number(row.cnt)]));
  const points = Array.from({ length: span }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (span - 1 - index));
    const key = formatDate(date);
    return { date: key, count: byDay.get(key) ?? 0 };
  });
  return { interactionId, days: span, points };
}

export function toCmsInteractionPublicStats(stats: CmsInteractionStats): CmsInteractionPublicStats {
  return {
    interactionId: stats.interactionId,
    responseCount: stats.responseCount,
    questions: stats.questions.map((question) => ({
      id: question.id,
      label: question.label,
      type: question.type,
      options: question.options.map((option) => ({ ...option })),
      average: question.average,
      npsScore: question.npsScore,
    })),
  };
}

export async function getCmsInteractionStats(id: number): Promise<CmsInteractionStats> {
  const current = await ensureCmsInteractionExists(id);
  await assertSiteAccess(current.siteId);
  return getCmsInteractionStatsInternal(id);
}
