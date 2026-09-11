import { requireRow } from '../../lib/db-assert';
import type { QueryOutputOf } from '@zenith/shared/core';
import { buildListResult } from '../../lib/list-query';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  sql,
  } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { createCmsInteractionSchema, CMS_INTERACTION_CHOICE_QUESTION_TYPES, CMS_INTERACTION_MATRIX_SEPARATOR, CMS_INTERACTION_NPS_MAX, CMS_INTERACTION_OTHER_PREFIX, CMS_INTERACTION_OTHER_VALUE, cmsInteractionContract } from '@zenith/shared/cms';
import type { CmsInteractionPublicStats, CreateCmsInteractionInput, SubmitCmsInteractionInput, UpdateCmsInteractionInput } from '@zenith/shared/cms';
import { db } from '../../db';
import {
  cmsInteractionAnswers,
  cmsInteractionQuestions,
  cmsInteractionResponses,
  cmsInteractions,
  cmsSites,
} from '../../db/schema';
import type {
  CmsInteractionQuestionRow,
  CmsInteractionRow,
} from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { resolveEffectiveCmsSite } from './cms-site-inheritance.service';
import { refreshCmsPublicConfiguration } from './cms-public-config-refresh.service';
import { isCaptchaEnabled } from './cms-captcha.service';
import {
  type CmsResolvedCaptchaProvider,
  verifyCmsCaptchaAdapter,
} from './cms-captcha-adapter.service';
import { hashCmsRequestKey, hashCmsVisitor, hashCmsIp } from './cms-visitor';
import { ensureCmsInteractionExists, isOtherAnswer, repeatKeyFor } from './cms-interactions-shared';
import { getCmsInteractionStatsInternal, toCmsInteractionPublicStats } from './cms-interactions-stats.service';
import { canExposeCmsInteractionResults } from './cms-interactions-responses.service';

/** 与 schema 中 `cms_interactions.code` / `.title` 的列长度保持一致 */
const CMS_INTERACTION_CODE_MAX = 50;
const CMS_INTERACTION_TITLE_MAX = 200;
const COPY_TITLE_SUFFIX = '（副本）';

export function mapCmsInteractionQuestion(row: CmsInteractionQuestionRow) {
  return {
    id: row.id,
    interactionId: row.interactionId,
    label: row.label,
    type: row.type,
    required: row.required,
    options: row.options ?? [],
    minChoices: row.minChoices,
    maxChoices: row.maxChoices,
    sort: row.sort,
    allowOther: row.allowOther,
    otherLabel: row.otherLabel ?? null,
    ratingMax: row.ratingMax,
    matrixRows: row.matrixRows ?? [],
    pageNo: row.pageNo,
    visibleWhen: row.visibleWhen ?? null,
  };
}

export function mapCmsInteraction(row: CmsInteractionRow, questions?: CmsInteractionQuestionRow[]) {
  return {
    id: row.id,
    siteId: row.siteId,
    code: row.code,
    kind: row.kind,
    title: row.title,
    description: row.description ?? null,
    status: row.status,
    participantScope: row.participantScope,
    repeatPolicy: row.repeatPolicy,
    resultVisibility: row.resultVisibility,
    captchaPolicy: row.captchaPolicy,
    turnstileSiteKey: row.turnstileSiteKey ?? null,
    turnstileSecretConfigured: !!row.turnstileSecret,
    thankYouMessage: row.thankYouMessage,
    startAt: formatNullableDateTime(row.startAt),
    endAt: formatNullableDateTime(row.endAt),
    responseCount: row.responseCount,
    ...(questions
      ? { questions: [...questions].sort((a, b) => a.sort - b.sort || a.id - b.id).map(mapCmsInteractionQuestion) }
      : {}),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function listCmsInteractions(q: QueryOutputOf<typeof cmsInteractionContract.list>) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const where = buildWhere(
    eq(cmsInteractions.siteId, q.siteId),
    keywordCondition(q.keyword, [cmsInteractions.title], 'ilike'),
    q.kind ? eq(cmsInteractions.kind, q.kind) : undefined,
    q.status ? eq(cmsInteractions.status, q.status) : undefined,
  );
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(cmsInteractions, where),
    rows: () => withPagination(
      db.select().from(cmsInteractions).where(where).orderBy(desc(cmsInteractions.id)).$dynamic(),
      q.page,
      q.pageSize,
    ),
    map: (row) => mapCmsInteraction(row),
  });
}

export async function getCmsInteraction(id: number) {
  const current = await ensureCmsInteractionExists(id);
  await assertSiteAccess(current.siteId);
  const row = await db.query.cmsInteractions.findFirst({
    where: eq(cmsInteractions.id, id),
    with: { questions: true },
  });
  const interaction = requireRow(row, '互动问卷不存在');
  return mapCmsInteraction(interaction, interaction.questions);
}

function assertInteractionDefinition(input: CreateCmsInteractionInput): void {
  const parsed = createCmsInteractionSchema.safeParse(input);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? '互动问卷配置无效' });
  }
}

async function replaceInteractionQuestions(
  tx: DbExecutor,
  interactionId: number,
  questions: CreateCmsInteractionInput['questions'],
): Promise<void> {
  await tx.delete(cmsInteractionQuestions).where(eq(cmsInteractionQuestions.interactionId, interactionId));
  await tx.insert(cmsInteractionQuestions).values(questions.map((question, index) => {
    const type = question.type ?? 'single';
    const isChoice = (CMS_INTERACTION_CHOICE_QUESTION_TYPES as readonly string[]).includes(type);
    return {
      interactionId,
      label: question.label,
      type,
      required: question.required ?? true,
      options: isChoice ? (question.options ?? []) : [],
      minChoices: type === 'multiple' ? (question.minChoices ?? 1) : (type === 'single' ? 1 : 0),
      maxChoices: type === 'multiple' ? (question.maxChoices ?? 1) : 1,
      sort: question.sort ?? index,
      allowOther: (type === 'single' || type === 'multiple') && (question.allowOther ?? false),
      otherLabel: question.otherLabel?.trim() || null,
      ratingMax: type === 'nps' ? CMS_INTERACTION_NPS_MAX : (question.ratingMax ?? 5),
      matrixRows: type === 'matrix' ? (question.matrixRows ?? []) : [],
      pageNo: question.pageNo ?? 1,
      visibleWhen: question.visibleWhen
        ? { ...question.visibleWhen, op: question.visibleWhen.op ?? 'any' }
        : null,
    };
  }));
}

export async function createCmsInteraction(input: CreateCmsInteractionInput) {
  await ensureCmsSiteExists(input.siteId);
  await assertSiteAccess(input.siteId);
  assertInteractionDefinition(input);
  const { questions, startAt, endAt } = input;
  try {
    const id = await db.transaction(async (tx) => {
      const [row] = await tx.insert(cmsInteractions).values({
        siteId: input.siteId,
        code: input.code,
        kind: input.kind ?? 'survey',
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? 'draft',
        participantScope: input.participantScope ?? 'anonymous',
        repeatPolicy: input.repeatPolicy ?? 'once_per_ip',
        resultVisibility: input.resultVisibility ?? 'after_submit',
        captchaPolicy: input.captchaPolicy ?? 'inherit',
        turnstileSiteKey: input.turnstileSiteKey ?? null,
        turnstileSecret: input.turnstileSecret ?? null,
        thankYouMessage: input.thankYouMessage ?? '感谢您的参与！',
        startAt: parseDateTimeInput(startAt),
        endAt: parseDateTimeInput(endAt),
      }).returning({ id: cmsInteractions.id });
      await replaceInteractionQuestions(tx, row.id, questions);
      return row.id;
    });
    const created = await getCmsInteraction(id);
    await refreshCmsPublicConfiguration(created.siteId, '互动问卷创建', `interaction:${created.id}:${created.updatedAt}`);
    return created;
  } catch (error) {
    rethrowPgUniqueViolation(error, '同站点下互动标识已存在');
  }
}

export async function updateCmsInteraction(id: number, input: UpdateCmsInteractionInput) {
  const initial = await ensureCmsInteractionExists(id);
  await assertSiteAccess(initial.siteId);
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(cmsInteractions)
      .where(eq(cmsInteractions.id, id))
      .for('update')
      .limit(1);
    requireRow(current, '互动问卷不存在');
    if (input.questions && current.responseCount > 0) {
      throw new HTTPException(409, { message: '已有答卷的互动问卷不可替换题目；请用「复制」生成副本后修改' });
    }
    const currentQuestions = await tx.select().from(cmsInteractionQuestions)
      .where(eq(cmsInteractionQuestions.interactionId, id))
      .orderBy(asc(cmsInteractionQuestions.sort), asc(cmsInteractionQuestions.id));
    const merged = {
      siteId: current.siteId,
      code: current.code,
      kind: input.kind ?? current.kind,
      title: input.title ?? current.title,
      description: input.description === undefined ? current.description : input.description,
      status: input.status ?? current.status,
      participantScope: input.participantScope ?? current.participantScope,
      repeatPolicy: input.repeatPolicy ?? current.repeatPolicy,
      resultVisibility: input.resultVisibility ?? current.resultVisibility,
      captchaPolicy: input.captchaPolicy ?? current.captchaPolicy,
      turnstileSiteKey: input.turnstileSiteKey === undefined ? current.turnstileSiteKey : input.turnstileSiteKey,
      turnstileSecret: input.turnstileSecret === undefined ? current.turnstileSecret : input.turnstileSecret,
      thankYouMessage: input.thankYouMessage ?? current.thankYouMessage,
      startAt: input.startAt === undefined ? formatNullableDateTime(current.startAt) : input.startAt,
      endAt: input.endAt === undefined ? formatNullableDateTime(current.endAt) : input.endAt,
      questions: input.questions ?? currentQuestions.map((question) => ({
        id: question.id,
        label: question.label,
        type: question.type,
        required: question.required,
        options: question.options,
        minChoices: question.minChoices,
        maxChoices: question.maxChoices,
        sort: question.sort,
      })),
    } satisfies CreateCmsInteractionInput;
    assertInteractionDefinition(merged);
    const { questions, startAt, endAt, turnstileSecret, ...rest } = input;
    await tx.update(cmsInteractions).set({
      ...rest,
      ...(turnstileSecret !== undefined
        ? { turnstileSecret: turnstileSecret?.trim() || null }
        : {}),
      ...(startAt !== undefined ? { startAt: parseDateTimeInput(startAt) } : {}),
      ...(endAt !== undefined ? { endAt: parseDateTimeInput(endAt) } : {}),
    }).where(eq(cmsInteractions.id, id));
    if (questions) await replaceInteractionQuestions(tx, id, questions);
  });
  const updated = await getCmsInteraction(id);
  await refreshCmsPublicConfiguration(updated.siteId, '互动问卷更新', `interaction:${updated.id}:${updated.updatedAt}`);
  return updated;
}

export async function setCmsInteractionStatus(id: number, status: 'draft' | 'published' | 'closed') {
  const current = await ensureCmsInteractionExists(id);
  await assertSiteAccess(current.siteId);
  if (status === 'draft' && current.responseCount > 0) {
    throw new HTTPException(409, { message: '已有答卷的互动问卷不能退回草稿' });
  }
  const [row] = await db.update(cmsInteractions).set({ status }).where(eq(cmsInteractions.id, id)).returning();
  await refreshCmsPublicConfiguration(row.siteId, '互动问卷状态更新', `interaction:${row.id}:${row.updatedAt.getTime()}`);
  return mapCmsInteraction(row);
}

export async function deleteCmsInteraction(id: number): Promise<void> {
  const current = await ensureCmsInteractionExists(id);
  await assertSiteAccess(current.siteId);
  await db.delete(cmsInteractions).where(eq(cmsInteractions.id, id));
  await refreshCmsPublicConfiguration(current.siteId, '互动问卷删除', `interaction:${current.id}:deleted:${Date.now()}`);
}

/** 去掉已有的 `-copy` / `-copy-N` 后缀，避免复制副本时无限累加 */
export function interactionCodeStem(code: string): string {
  return code.replace(/-copy(?:-\d+)?$/, '') || code;
}

/** 在已占用标识集合中挑一个未使用的副本标识，并保证不超过列长度上限 */
export function nextInteractionCopyCode(baseCode: string, taken: ReadonlySet<string>): string {
  const stem = interactionCodeStem(baseCode);
  for (let index = 1; index <= 100; index += 1) {
    const suffix = index === 1 ? '-copy' : `-copy-${index}`;
    const candidate = `${stem.slice(0, CMS_INTERACTION_CODE_MAX - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new HTTPException(400, { message: '副本过多，请先清理已有副本或手动指定标识' });
}

/** 在站点内找一个未被占用的副本标识 */
async function nextAvailableInteractionCode(siteId: number, baseCode: string): Promise<string> {
  const stem = interactionCodeStem(baseCode);
  const rows = await db.select({ code: cmsInteractions.code })
    .from(cmsInteractions)
    .where(and(
      eq(cmsInteractions.siteId, siteId),
      keywordCondition(`${stem}-copy`, [cmsInteractions.code], 'ilike', 'prefix'),
    ));
  return nextInteractionCopyCode(baseCode, new Set(rows.map((row) => row.code)));
}

/**
 * 复制互动问卷：配置与题目全量克隆，标识自动去重，状态强制为草稿且答卷数归零。
 * 「已有答卷不可替换题目」时的官方出路。
 */
export async function copyCmsInteraction(id: number) {
  const current = await ensureCmsInteractionExists(id);
  await assertSiteAccess(current.siteId);
  const questions = await db.select().from(cmsInteractionQuestions)
    .where(eq(cmsInteractionQuestions.interactionId, id))
    .orderBy(asc(cmsInteractionQuestions.sort), asc(cmsInteractionQuestions.id));
  const code = await nextAvailableInteractionCode(current.siteId, current.code);
  const title = `${current.title.slice(0, CMS_INTERACTION_TITLE_MAX - COPY_TITLE_SUFFIX.length)}${COPY_TITLE_SUFFIX}`;
  try {
    const newId = await db.transaction(async (tx) => {
      const [row] = await tx.insert(cmsInteractions).values({
        siteId: current.siteId,
        code,
        kind: current.kind,
        title,
        description: current.description,
        status: 'draft',
        participantScope: current.participantScope,
        repeatPolicy: current.repeatPolicy,
        resultVisibility: current.resultVisibility,
        captchaPolicy: current.captchaPolicy,
        turnstileSiteKey: current.turnstileSiteKey,
        turnstileSecret: current.turnstileSecret,
        thankYouMessage: current.thankYouMessage,
        startAt: current.startAt,
        endAt: current.endAt,
      }).returning({ id: cmsInteractions.id });
      if (questions.length > 0) {
        await tx.insert(cmsInteractionQuestions).values(questions.map((question) => ({
          interactionId: row.id,
          label: question.label,
          type: question.type,
          required: question.required,
          options: question.options ?? [],
          minChoices: question.minChoices,
          maxChoices: question.maxChoices,
          sort: question.sort,
          allowOther: question.allowOther,
          otherLabel: question.otherLabel,
          ratingMax: question.ratingMax,
          matrixRows: question.matrixRows ?? [],
          pageNo: question.pageNo,
          visibleWhen: question.visibleWhen,
        })));
      }
      return row.id;
    });
    return getCmsInteraction(newId);
  } catch (error) {
    rethrowPgUniqueViolation(error, '同站点下互动标识已存在');
  }
}

function isInteractionOpen(row: CmsInteractionRow, now = new Date()): boolean {
  if (row.status !== 'published') return false;
  if (row.startAt && now < row.startAt) return false;
  if (row.endAt && now > row.endAt) return false;
  return true;
}

export async function getPublicCmsInteractionByCode(siteId: number, code: string) {
  const effective = await resolveEffectiveCmsSite(siteId).catch(() => null);
  if (!effective || !effective.chain.every((site) => site.status === 'enabled')) return null;
  const row = await db.query.cmsInteractions.findFirst({
    where: and(
      eq(cmsInteractions.siteId, siteId),
      eq(cmsInteractions.code, code),
      inArray(cmsInteractions.status, ['published', 'closed']),
    ),
    with: { questions: true },
  });
  return row ?? null;
}

export async function getPublicCmsInteractionById(id: number, siteId: number) {
  const effective = await resolveEffectiveCmsSite(siteId).catch(() => null);
  if (!effective || !effective.chain.every((site) => site.status === 'enabled')) return null;
  const row = await db.query.cmsInteractions.findFirst({
    where: and(
      eq(cmsInteractions.id, id),
      eq(cmsInteractions.siteId, siteId),
      inArray(cmsInteractions.status, ['published', 'closed']),
    ),
    with: { questions: true },
  });
  return row ?? null;
}

/** 判断条件显示题目在本次作答下是否可见；不可见的题目不参与必答校验也不落库 */
function isQuestionVisible(
  question: CmsInteractionQuestionRow,
  questionsBySort: CmsInteractionQuestionRow[],
  answered: Map<number, string[]>,
): boolean {
  const rule = question.visibleWhen;
  if (!rule) return true;
  const source = questionsBySort[rule.questionIndex];
  if (!source) return true;
  const picked = answered.get(source.id) ?? [];
  const hit = picked.some((value) => rule.values.includes(value));
  return rule.op === 'none' ? !hit : hit;
}

function assertChoiceAnswers(
  question: CmsInteractionQuestionRow,
  values: string[],
): void {
  const allowed = new Set((question.options ?? []).map((option) => option.value));
  const invalid = values.filter((value) => !allowed.has(value) && !(question.allowOther && isOtherAnswer(value)));
  if (invalid.length > 0) {
    throw new HTTPException(400, { message: `题目「${question.label}」选项无效` });
  }
  if (question.allowOther && values.filter(isOtherAnswer).length > 1) {
    throw new HTTPException(400, { message: `题目「${question.label}」只能填写一项「其他」` });
  }
  const maxChoices = question.type === 'single' ? 1 : question.maxChoices;
  const minChoices = question.required ? Math.max(1, question.minChoices) : question.minChoices;
  if (values.length < minChoices || values.length > maxChoices) {
    throw new HTTPException(400, { message: `题目「${question.label}」需选择 ${minChoices}-${maxChoices} 项` });
  }
}

/** 其他填空的自由文本统一截断，防止绕过 answers 的长度上限 */
function normalizeOtherAnswer(value: string): string {
  if (!isOtherAnswer(value)) return value;
  const text = value.slice(CMS_INTERACTION_OTHER_PREFIX.length).trim();
  return text ? `${CMS_INTERACTION_OTHER_PREFIX}${text.slice(0, 200)}` : CMS_INTERACTION_OTHER_VALUE;
}

function assertMatrixAnswers(question: CmsInteractionQuestionRow, values: string[]): void {
  const rowIds = new Set((question.matrixRows ?? []).map((row) => row.id));
  const optionValues = new Set((question.options ?? []).map((option) => option.value));
  const seenRows = new Set<string>();
  for (const value of values) {
    const separator = value.indexOf(CMS_INTERACTION_MATRIX_SEPARATOR);
    const rowId = separator < 0 ? '' : value.slice(0, separator);
    const optionValue = separator < 0 ? '' : value.slice(separator + CMS_INTERACTION_MATRIX_SEPARATOR.length);
    if (!rowIds.has(rowId) || !optionValues.has(optionValue)) {
      throw new HTTPException(400, { message: `题目「${question.label}」矩阵作答无效` });
    }
    if (seenRows.has(rowId)) {
      throw new HTTPException(400, { message: `题目「${question.label}」每行只能选择一项` });
    }
    seenRows.add(rowId);
  }
  if (question.required && seenRows.size !== rowIds.size) {
    throw new HTTPException(400, { message: `题目「${question.label}」需要每行都作答` });
  }
}

function assertScaleAnswer(question: CmsInteractionQuestionRow, value: string): number {
  const parsed = Number(value);
  const max = question.type === 'nps' ? CMS_INTERACTION_NPS_MAX : question.ratingMax;
  const min = question.type === 'nps' ? 0 : 1;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HTTPException(400, { message: `题目「${question.label}」需在 ${min}-${max} 之间` });
  }
  return parsed;
}

function validateInteractionAnswers(
  questions: CmsInteractionQuestionRow[],
  input: SubmitCmsInteractionInput,
): Array<{ questionId: number; value: string | string[] }> {
  const result: Array<{ questionId: number; value: string | string[] }> = [];
  // 条件显示依赖题序，按 sort 排序后逐题推进，保证被依赖题已先行判定
  const ordered = [...questions].sort((a, b) => a.sort - b.sort || a.id - b.id);
  const answered = new Map<number, string[]>();
  for (const question of ordered) {
    const raw = input.answers[String(question.id)];
    const values = Array.isArray(raw)
      ? [...new Set(raw.map(String).filter(Boolean))]
      : raw === undefined || raw === ''
        ? []
        : [String(raw)];
    if (!isQuestionVisible(question, ordered, answered)) {
      // 条件未命中：即使前端误传也不落库，避免脏数据混入统计
      continue;
    }
    if (values.length === 0) {
      if (question.required) throw new HTTPException(400, { message: `题目「${question.label}」为必答题` });
      continue;
    }
    switch (question.type) {
      case 'text': {
        result.push({ questionId: question.id, value: values[0].slice(0, 2000) });
        break;
      }
      case 'rating':
      case 'nps': {
        const score = assertScaleAnswer(question, values[0]);
        result.push({ questionId: question.id, value: String(score) });
        break;
      }
      case 'number': {
        const parsed = Number(values[0]);
        if (!Number.isFinite(parsed)) {
          throw new HTTPException(400, { message: `题目「${question.label}」需填写数字` });
        }
        result.push({ questionId: question.id, value: String(parsed) });
        break;
      }
      case 'date': {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(values[0])) {
          throw new HTTPException(400, { message: `题目「${question.label}」日期格式无效` });
        }
        result.push({ questionId: question.id, value: values[0] });
        break;
      }
      case 'matrix': {
        assertMatrixAnswers(question, values);
        answered.set(question.id, values);
        result.push({ questionId: question.id, value: values });
        break;
      }
      default: {
        const normalized = values.map(normalizeOtherAnswer);
        assertChoiceAnswers(question, normalized);
        answered.set(question.id, normalized);
        result.push({ questionId: question.id, value: question.type === 'single' ? normalized[0] : normalized });
        break;
      }
    }
  }
  return result;
}

export interface CmsInteractionCaptchaConfig {
  provider: CmsResolvedCaptchaProvider;
  siteKey: string | null;
}

interface CmsInteractionCaptchaInternalConfig extends CmsInteractionCaptchaConfig {
  secret: string | null;
}

async function resolveCmsInteractionCaptchaInternal(
  interaction: CmsInteractionRow,
  executor: DbExecutor = db,
): Promise<CmsInteractionCaptchaInternalConfig> {
  if (interaction.captchaPolicy === 'none') return { provider: 'none', siteKey: null, secret: null };
  if (interaction.captchaPolicy === 'math') return { provider: 'math', siteKey: null, secret: null };
  if (interaction.captchaPolicy === 'turnstile') {
    return {
      provider: 'turnstile',
      siteKey: interaction.turnstileSiteKey ?? null,
      secret: interaction.turnstileSecret ?? null,
    };
  }
  const [site] = await executor.select().from(cmsSites).where(eq(cmsSites.id, interaction.siteId)).limit(1);
  return {
    provider: site && isCaptchaEnabled(site) ? 'math' : 'none',
    siteKey: null,
    secret: null,
  };
}

export async function resolveCmsInteractionCaptcha(
  interaction: CmsInteractionRow,
): Promise<CmsInteractionCaptchaConfig> {
  const { secret: _secret, ...config } = await resolveCmsInteractionCaptchaInternal(interaction);
  return config;
}

async function assertInteractionCaptcha(
  interaction: CmsInteractionRow,
  input: SubmitCmsInteractionInput,
  ip: string | null,
): Promise<CmsInteractionCaptchaInternalConfig> {
  const config = await resolveCmsInteractionCaptchaInternal(interaction);
  const passed = await verifyCmsCaptchaAdapter({
    provider: config.provider,
    captchaId: input.captchaId,
    captchaAnswer: input.captchaAnswer,
    turnstileToken: input.turnstileToken,
    turnstileSecret: config.secret,
    ip: ip ?? 'unknown',
  });
  if (!passed) throw new HTTPException(400, { message: '验证码验证失败，请重试' });
  return config;
}

export interface SubmitCmsInteractionMeta {
  memberId: number | null;
  ip: string | null;
  userAgent: string | null;
  idempotencyKey?: string | null;
}

export async function submitCmsInteraction(
  interaction: CmsInteractionRow & { questions: CmsInteractionQuestionRow[] },
  input: SubmitCmsInteractionInput,
  meta: SubmitCmsInteractionMeta,
): Promise<{ responseId: number; duplicate: boolean; message: string; results: CmsInteractionPublicStats | null }> {
  if (!isInteractionOpen(interaction)) throw new HTTPException(400, { message: '互动问卷未开放或已关闭' });
  if (interaction.participantScope === 'member' && !meta.memberId) {
    throw new HTTPException(401, { message: '该互动仅限登录会员参与' });
  }
  const verifiedCaptcha = await assertInteractionCaptcha(interaction, input, meta.ip);
  const ipHash = hashCmsIp(meta.ip);
  const visitorHash = hashCmsVisitor(meta.ip, meta.userAgent);
  const rawRequestKey = meta.idempotencyKey ?? input.idempotencyKey;
  const requestKey = rawRequestKey ? hashCmsRequestKey(`${interaction.id}:${rawRequestKey}`) : null;
  const transactionResult = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(cmsInteractions)
      .where(eq(cmsInteractions.id, interaction.id))
      .for('update')
      .limit(1);
    if (!locked || !isInteractionOpen(locked)) {
      throw new HTTPException(400, { message: '互动问卷未开放或已关闭' });
    }
    if (locked.participantScope === 'member' && !meta.memberId) {
      throw new HTTPException(401, { message: '该互动仅限登录会员参与' });
    }
    const currentCaptcha = await resolveCmsInteractionCaptchaInternal(locked, tx);
    if (
      currentCaptcha.provider !== verifiedCaptcha.provider
      || currentCaptcha.siteKey !== verifiedCaptcha.siteKey
      || currentCaptcha.secret !== verifiedCaptcha.secret
    ) {
      throw new HTTPException(409, { message: '验证码策略已更新，请刷新后重试' });
    }
    const questions = await tx.select().from(cmsInteractionQuestions)
      .where(eq(cmsInteractionQuestions.interactionId, locked.id))
      .orderBy(asc(cmsInteractionQuestions.sort), asc(cmsInteractionQuestions.id));
    const answers = validateInteractionAnswers(questions, input);
    const repeatKey = repeatKeyFor(locked.repeatPolicy, meta.memberId, ipHash);
    const rows = await tx.insert(cmsInteractionResponses).values({
      interactionId: locked.id,
      memberId: meta.memberId,
      visitorHash,
      ipHash,
      repeatKey,
      requestKey,
    }).onConflictDoNothing().returning({ id: cmsInteractionResponses.id });
    const created = rows[0];
    if (created) {
      await tx.insert(cmsInteractionAnswers).values(answers.map((answer) => ({
        responseId: created.id,
        questionId: answer.questionId,
        value: answer.value,
      })));
      await tx.update(cmsInteractions)
        .set({ responseCount: sql`${cmsInteractions.responseCount} + 1` })
        .where(eq(cmsInteractions.id, locked.id));
    }
    return { responseId: created?.id ?? null, repeatKey, interaction: locked };
  });
  let responseId = transactionResult.responseId;
  let duplicate = false;
  if (!responseId) {
    if (!requestKey && !transactionResult.repeatKey) throw new HTTPException(409, { message: '请求已处理，请勿重复提交' });
    const [existing] = await db.select({ id: cmsInteractionResponses.id }).from(cmsInteractionResponses)
      .where(buildWhere(
        eq(cmsInteractionResponses.interactionId, transactionResult.interaction.id),
        requestKey ? eq(cmsInteractionResponses.requestKey, requestKey) : undefined,
        !requestKey && transactionResult.repeatKey ? eq(cmsInteractionResponses.repeatKey, transactionResult.repeatKey) : undefined,
      )).limit(1);
    requireRow(existing, '您已参与过本次互动', 409);
    if (!requestKey) throw new HTTPException(409, { message: '您已参与过本次互动' });
    responseId = existing.id;
    duplicate = true;
  }
  const finalInteraction = transactionResult.interaction;
  const canSee = finalInteraction.resultVisibility === 'always' || finalInteraction.resultVisibility === 'after_submit';
  return {
    responseId,
    duplicate,
    message: finalInteraction.thankYouMessage,
    results: canSee ? toCmsInteractionPublicStats(await getCmsInteractionStatsInternal(finalInteraction.id)) : null,
  };
}

async function hasResponded(
  interaction: CmsInteractionRow,
  meta: Pick<SubmitCmsInteractionMeta, 'memberId' | 'ip'>,
): Promise<boolean> {
  const ipHash = hashCmsIp(meta.ip);
  if (interaction.repeatPolicy === 'once_per_member' && !meta.memberId) return false;
  const repeatKey = repeatKeyFor(interaction.repeatPolicy, meta.memberId, ipHash);
  const where = repeatKey
    ? and(eq(cmsInteractionResponses.interactionId, interaction.id), eq(cmsInteractionResponses.repeatKey, repeatKey))
    : meta.memberId
      ? and(eq(cmsInteractionResponses.interactionId, interaction.id), eq(cmsInteractionResponses.memberId, meta.memberId))
      : and(eq(cmsInteractionResponses.interactionId, interaction.id), eq(cmsInteractionResponses.ipHash, ipHash));
  return (await db.$count(cmsInteractionResponses, where)) > 0;
}

export async function getCmsInteractionPublicState(
  interaction: CmsInteractionRow & { questions: CmsInteractionQuestionRow[] },
  meta: Pick<SubmitCmsInteractionMeta, 'memberId' | 'ip'>,
) {
  const submitted = await hasResponded(interaction, meta);
  const resultsVisible = canExposeCmsInteractionResults({
    visibility: interaction.resultVisibility,
    status: interaction.status,
    submitted,
  });
  const captcha = await resolveCmsInteractionCaptcha(interaction);
  return {
    interaction: {
      id: interaction.id,
      siteId: interaction.siteId,
      code: interaction.code,
      kind: interaction.kind,
      title: interaction.title,
      description: interaction.description ?? null,
      status: interaction.status,
      participantScope: interaction.participantScope,
      repeatPolicy: interaction.repeatPolicy,
      resultVisibility: interaction.resultVisibility,
      captchaPolicy: interaction.captchaPolicy,
      thankYouMessage: interaction.thankYouMessage,
      startAt: formatNullableDateTime(interaction.startAt),
      endAt: formatNullableDateTime(interaction.endAt),
      questions: [...interaction.questions]
        .sort((a, b) => a.sort - b.sort || a.id - b.id)
        .map(mapCmsInteractionQuestion),
    },
    open: isInteractionOpen(interaction),
    submitted,
    captchaRequired: captcha.provider !== 'none',
    captcha,
    resultsVisible,
    results: resultsVisible
      ? toCmsInteractionPublicStats(await getCmsInteractionStatsInternal(interaction.id))
      : null,
  };
}
