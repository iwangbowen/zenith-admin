import { eq, and, asc, desc, like, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsSurveys, cmsSurveyQuestions, cmsSurveyAnswers } from '../../db/schema';
import type { CmsSurveyRow, CmsSurveyQuestionRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { config } from '../../config';
import redis from '../../lib/redis';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { assertSiteAccess } from './cms-sites.service';
import type { CreateCmsSurveyInput, UpdateCmsSurveyInput, SubmitCmsSurveyInput, CmsSurveyStats } from '@zenith/shared';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsSurveyQuestion(row: CmsSurveyQuestionRow) {
  return {
    id: row.id,
    surveyId: row.surveyId,
    label: row.label,
    type: row.type,
    required: row.required,
    options: row.options ?? [],
    sort: row.sort,
  };
}

export function mapCmsSurvey(row: CmsSurveyRow, questions?: CmsSurveyQuestionRow[]) {
  return {
    id: row.id,
    siteId: row.siteId,
    code: row.code,
    title: row.title,
    description: row.description ?? null,
    status: row.status,
    allowAnonymous: row.allowAnonymous,
    startAt: formatNullableDateTime(row.startAt),
    endAt: formatNullableDateTime(row.endAt),
    answerCount: row.answerCount,
    ...(questions ? { questions: [...questions].sort((a, b) => a.sort - b.sort || a.id - b.id).map(mapCmsSurveyQuestion) } : {}),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureCmsSurveyExists(id: number): Promise<CmsSurveyRow> {
  const [row] = await db.select().from(cmsSurveys).where(eq(cmsSurveys.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '问卷不存在' });
  return row;
}

// ─── 查询 ─────────────────────────────────────────────────────────────────────
export interface ListCmsSurveysQuery {
  siteId: number;
  keyword?: string;
  status?: 'draft' | 'published' | 'closed';
  page: number;
  pageSize: number;
}

export async function listCmsSurveys(q: ListCmsSurveysQuery) {
  await assertSiteAccess(q.siteId);
  const conditions: SQL[] = [eq(cmsSurveys.siteId, q.siteId)];
  if (q.keyword) conditions.push(like(cmsSurveys.title, `%${escapeLike(q.keyword)}%`));
  if (q.status) conditions.push(eq(cmsSurveys.status, q.status));
  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(cmsSurveys, where),
    withPagination(
      db.select().from(cmsSurveys).where(where).orderBy(desc(cmsSurveys.id)).$dynamic(),
      q.page,
      q.pageSize,
    ),
  ]);
  return { list: list.map((r) => mapCmsSurvey(r)), total, page: q.page, pageSize: q.pageSize };
}

export async function getCmsSurvey(id: number) {
  const row = await db.query.cmsSurveys.findFirst({
    where: eq(cmsSurveys.id, id),
    with: { questions: true },
  });
  if (!row) throw new HTTPException(404, { message: '问卷不存在' });
  return mapCmsSurvey(row, row.questions);
}

// ─── 写入（题目全量替换）──────────────────────────────────────────────────────
function assertQuestionsValid(questions: CreateCmsSurveyInput['questions']): void {
  for (const q of questions ?? []) {
    if ((q.type === 'single' || q.type === 'multiple') && (!q.options || q.options.length < 2)) {
      throw new HTTPException(400, { message: `选择题「${q.label}」至少配置 2 个选项` });
    }
  }
}

async function replaceQuestions(tx: DbExecutor, surveyId: number, questions: NonNullable<CreateCmsSurveyInput['questions']>): Promise<void> {
  await tx.delete(cmsSurveyQuestions).where(eq(cmsSurveyQuestions.surveyId, surveyId));
  if (questions.length > 0) {
    await tx.insert(cmsSurveyQuestions).values(questions.map((q, i) => ({
      surveyId,
      label: q.label,
      type: q.type ?? 'single',
      required: q.required ?? true,
      options: (q.type ?? 'single') === 'text' ? [] : (q.options ?? []),
      sort: q.sort ?? i,
    })));
  }
}

export async function createCmsSurvey(data: CreateCmsSurveyInput) {
  await assertSiteAccess(data.siteId);
  assertQuestionsValid(data.questions);
  const { questions, startAt, endAt, ...rest } = data;
  try {
    const row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(cmsSurveys).values({
        ...rest,
        startAt: parseDateTimeInput(startAt),
        endAt: parseDateTimeInput(endAt),
      }).returning();
      await replaceQuestions(tx, created.id, questions);
      return created;
    });
    return getCmsSurvey(row.id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同标识的问卷');
  }
}

export async function updateCmsSurvey(id: number, data: UpdateCmsSurveyInput) {
  const current = await ensureCmsSurveyExists(id);
  await assertSiteAccess(current.siteId);
  if (data.questions) assertQuestionsValid(data.questions);
  const { questions, startAt, endAt, ...rest } = data;
  try {
    await db.transaction(async (tx) => {
      await tx.update(cmsSurveys).set({
        ...rest,
        ...(startAt !== undefined ? { startAt: parseDateTimeInput(startAt) } : {}),
        ...(endAt !== undefined ? { endAt: parseDateTimeInput(endAt) } : {}),
      }).where(eq(cmsSurveys.id, id));
      if (questions) {
        await replaceQuestions(tx, id, questions);
      }
    });
    return getCmsSurvey(id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同标识的问卷');
  }
}

export async function deleteCmsSurvey(id: number) {
  const current = await ensureCmsSurveyExists(id);
  await assertSiteAccess(current.siteId);
  await db.delete(cmsSurveys).where(eq(cmsSurveys.id, id));
}

// ─── 前台提交 ─────────────────────────────────────────────────────────────────
/** 前台取发布中的问卷（含题目；未发布/不在时间窗返回 null） */
export async function getPublishedSurveyByCode(siteId: number, code: string) {
  const row = await db.query.cmsSurveys.findFirst({
    where: and(eq(cmsSurveys.siteId, siteId), eq(cmsSurveys.code, code), eq(cmsSurveys.status, 'published')),
    with: { questions: true },
  });
  return filterInWindow(row ?? null);
}

/** 按 id 取发布中的问卷（会员端 JSON 提交用） */
export async function getPublishedSurveyById(id: number) {
  const row = await db.query.cmsSurveys.findFirst({
    where: and(eq(cmsSurveys.id, id), eq(cmsSurveys.status, 'published')),
    with: { questions: true },
  });
  return filterInWindow(row ?? null);
}

function filterInWindow<T extends CmsSurveyRow>(row: T | null): T | null {
  if (!row) return null;
  const now = new Date();
  if (row.startAt && now < row.startAt) return null;
  if (row.endAt && now > row.endAt) return null;
  return row;
}

/**
 * 提交答卷：题目必答/选项合法性校验；会员一人一份（DB 唯一），
 * 匿名按 IP Redis 限重（24h）；answerCount 原子 +1。
 */
export async function submitCmsSurvey(
  survey: CmsSurveyRow & { questions: CmsSurveyQuestionRow[] },
  input: SubmitCmsSurveyInput,
  ctx: { memberId: number | null; ip: string | null },
): Promise<void> {
  if (!ctx.memberId && !survey.allowAnonymous) {
    throw new HTTPException(401, { message: '该问卷仅限登录会员填写' });
  }
  // 校验答案
  const answers: Record<string, string | string[]> = {};
  for (const q of survey.questions) {
    const raw = input.answers[String(q.id)];
    const empty = raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0);
    if (empty) {
      if (q.required) throw new HTTPException(400, { message: `题目「${q.label}」为必答题` });
      continue;
    }
    if (q.type === 'single') {
      const v = Array.isArray(raw) ? raw[0] : raw;
      if (!q.options.some((o) => o.value === v)) throw new HTTPException(400, { message: `题目「${q.label}」选项无效` });
      answers[String(q.id)] = v;
    } else if (q.type === 'multiple') {
      const values = Array.isArray(raw) ? raw : [raw];
      if (values.some((v) => !q.options.some((o) => o.value === v))) {
        throw new HTTPException(400, { message: `题目「${q.label}」选项无效` });
      }
      answers[String(q.id)] = [...new Set(values)];
    } else {
      answers[String(q.id)] = String(raw).slice(0, 2000);
    }
  }
  // 匿名 IP 限重（24h 一次）
  if (!ctx.memberId) {
    const ipKey = `${config.redis.keyPrefix}cms:survey:${survey.id}:ip:${ctx.ip ?? 'unknown'}`;
    const acquired = await redis.set(ipKey, '1', 'EX', 24 * 3600, 'NX').catch(() => 'OK');
    if (!acquired) throw new HTTPException(429, { message: '您已提交过该问卷，请勿重复提交' });
  }
  try {
    await db.transaction(async (tx) => {
      await tx.insert(cmsSurveyAnswers).values({
        surveyId: survey.id,
        memberId: ctx.memberId,
        ip: ctx.ip,
        answers,
      });
      await tx.update(cmsSurveys)
        .set({ answerCount: sql`${cmsSurveys.answerCount} + 1` })
        .where(eq(cmsSurveys.id, survey.id));
    });
  } catch (err) {
    rethrowPgUniqueViolation(err, '您已提交过该问卷，请勿重复提交');
  }
}

// ─── 结果统计 ─────────────────────────────────────────────────────────────────
export async function getCmsSurveyStats(id: number): Promise<CmsSurveyStats> {
  const survey = await db.query.cmsSurveys.findFirst({
    where: eq(cmsSurveys.id, id),
    with: { questions: true },
  });
  if (!survey) throw new HTTPException(404, { message: '问卷不存在' });
  await assertSiteAccess(survey.siteId);
  const answers = await db.select({ answers: cmsSurveyAnswers.answers })
    .from(cmsSurveyAnswers)
    .where(eq(cmsSurveyAnswers.surveyId, id))
    .orderBy(desc(cmsSurveyAnswers.id))
    .limit(10_000);
  const total = survey.answerCount;
  const questions = [...survey.questions].sort((a, b) => a.sort - b.sort || a.id - b.id).map((q) => {
    if (q.type === 'text') {
      const texts = answers
        .map((a) => a.answers[String(q.id)])
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
        .slice(0, 50);
      return { id: q.id, label: q.label, type: q.type, options: [], texts };
    }
    const counts = new Map<string, number>(q.options.map((o) => [o.value, 0]));
    for (const a of answers) {
      const v = a.answers[String(q.id)];
      const values = Array.isArray(v) ? v : (typeof v === 'string' ? [v] : []);
      for (const value of values) {
        if (counts.has(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    const answered = answers.filter((a) => a.answers[String(q.id)] !== undefined).length;
    return {
      id: q.id,
      label: q.label,
      type: q.type,
      options: q.options.map((o) => ({
        label: o.label,
        value: o.value,
        count: counts.get(o.value) ?? 0,
        percent: answered > 0 ? Math.round(((counts.get(o.value) ?? 0) / answered) * 1000) / 10 : 0,
      })),
      texts: [],
    };
  });
  return { surveyId: id, answerCount: total, questions };
}

/** 站点内发布中的问卷清单（asc 引用保序；供未来栏目挂载选择） */
export async function listPublishedSurveys(siteId: number) {
  return db.select().from(cmsSurveys)
    .where(and(eq(cmsSurveys.siteId, siteId), eq(cmsSurveys.status, 'published')))
    .orderBy(asc(cmsSurveys.id));
}
