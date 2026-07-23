import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  createCmsInteractionSchema,
  type CmsInteractionKind,
  type CmsInteractionRepeatPolicy,
  type CmsInteractionResponse,
  type CmsInteractionPublicStats,
  type CmsInteractionStats,
  type CreateCmsInteractionInput,
  type SubmitCmsInteractionInput,
  type UpdateCmsInteractionInput,
} from '@zenith/shared';
import { db } from '../../db';
import {
  cmsInteractionAnswers,
  cmsInteractionQuestions,
  cmsInteractionResponses,
  cmsInteractions,
  cmsSites,
  members,
} from '../../db/schema';
import type {
  CmsInteractionQuestionRow,
  CmsInteractionRow,
} from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { formatDateTime, formatNullableDateTime, parseDateRangeEnd, parseDateRangeStart, parseDateTimeInput } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { maskEmail, maskName, maskPhone } from '../../lib/masking';
import { escapeLike, withPagination } from '../../lib/where-helpers';
import { streamByDescendingId } from '../../lib/export-center/cursor-stream';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { isCaptchaEnabled } from './cms-captcha.service';
import {
  type CmsResolvedCaptchaProvider,
  verifyCmsCaptchaAdapter,
} from './cms-captcha-adapter.service';
import { hashCmsRequestKey, hashCmsVisitor, hashCmsIp } from './cms-visitor';

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

export async function ensureCmsInteractionExists(id: number): Promise<CmsInteractionRow> {
  const [row] = await db.select().from(cmsInteractions).where(eq(cmsInteractions.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '互动问卷不存在' });
  return row;
}

export interface ListCmsInteractionsQuery {
  siteId: number;
  keyword?: string;
  kind?: CmsInteractionKind;
  status?: 'draft' | 'published' | 'closed';
  page: number;
  pageSize: number;
}

export async function listCmsInteractions(q: ListCmsInteractionsQuery) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const conditions: SQL[] = [eq(cmsInteractions.siteId, q.siteId)];
  if (q.keyword) conditions.push(ilike(cmsInteractions.title, `%${escapeLike(q.keyword)}%`));
  if (q.kind) conditions.push(eq(cmsInteractions.kind, q.kind));
  if (q.status) conditions.push(eq(cmsInteractions.status, q.status));
  const where = and(...conditions);
  const [total, rows] = await Promise.all([
    db.$count(cmsInteractions, where),
    withPagination(
      db.select().from(cmsInteractions).where(where).orderBy(desc(cmsInteractions.id)).$dynamic(),
      q.page,
      q.pageSize,
    ),
  ]);
  return { list: rows.map((row) => mapCmsInteraction(row)), total, page: q.page, pageSize: q.pageSize };
}

export async function getCmsInteraction(id: number) {
  const current = await ensureCmsInteractionExists(id);
  await assertSiteAccess(current.siteId);
  const row = await db.query.cmsInteractions.findFirst({
    where: eq(cmsInteractions.id, id),
    with: { questions: true },
  });
  if (!row) throw new HTTPException(404, { message: '互动问卷不存在' });
  return mapCmsInteraction(row, row.questions);
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
  await tx.insert(cmsInteractionQuestions).values(questions.map((question, index) => ({
    interactionId,
    label: question.label,
    type: question.type ?? 'single',
    required: question.required ?? true,
    options: question.type === 'text' ? [] : (question.options ?? []),
    minChoices: question.type === 'text' ? 0 : (question.minChoices ?? 1),
    maxChoices: question.type === 'single' ? 1 : (question.maxChoices ?? 1),
    sort: question.sort ?? index,
  })));
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
    return getCmsInteraction(id);
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
    if (!current) throw new HTTPException(404, { message: '互动问卷不存在' });
    if (input.questions && current.responseCount > 0) {
      throw new HTTPException(409, { message: '已有答卷的互动问卷不可替换题目；可关闭后复制新建' });
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
  return getCmsInteraction(id);
}

export async function setCmsInteractionStatus(id: number, status: 'draft' | 'published' | 'closed') {
  const current = await ensureCmsInteractionExists(id);
  await assertSiteAccess(current.siteId);
  if (status === 'draft' && current.responseCount > 0) {
    throw new HTTPException(409, { message: '已有答卷的互动问卷不能退回草稿' });
  }
  const [row] = await db.update(cmsInteractions).set({ status }).where(eq(cmsInteractions.id, id)).returning();
  return mapCmsInteraction(row);
}

export async function deleteCmsInteraction(id: number): Promise<void> {
  const current = await ensureCmsInteractionExists(id);
  await assertSiteAccess(current.siteId);
  await db.delete(cmsInteractions).where(eq(cmsInteractions.id, id));
}

function isInteractionOpen(row: CmsInteractionRow, now = new Date()): boolean {
  if (row.status !== 'published') return false;
  if (row.startAt && now < row.startAt) return false;
  if (row.endAt && now > row.endAt) return false;
  return true;
}

export async function getPublicCmsInteractionByCode(siteId: number, code: string) {
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

export async function getPublicCmsInteractionById(id: number) {
  const row = await db.query.cmsInteractions.findFirst({
    where: and(eq(cmsInteractions.id, id), inArray(cmsInteractions.status, ['published', 'closed'])),
    with: { questions: true },
  });
  return row ?? null;
}

function repeatKeyFor(
  policy: CmsInteractionRepeatPolicy,
  memberId: number | null,
  ipHash: string,
): string | null {
  if (policy === 'multiple') return null;
  if (policy === 'once_per_member') {
    if (!memberId) throw new HTTPException(401, { message: '该互动仅限登录会员参与' });
    return `m:${memberId}`;
  }
  return `i:${ipHash}`;
}

function validateInteractionAnswers(
  questions: CmsInteractionQuestionRow[],
  input: SubmitCmsInteractionInput,
): Array<{ questionId: number; value: string | string[] }> {
  const result: Array<{ questionId: number; value: string | string[] }> = [];
  for (const question of questions) {
    const raw = input.answers[String(question.id)];
    const values = Array.isArray(raw)
      ? [...new Set(raw.map(String).filter(Boolean))]
      : raw === undefined || raw === ''
        ? []
        : [String(raw)];
    if (values.length === 0) {
      if (question.required) throw new HTTPException(400, { message: `题目「${question.label}」为必答题` });
      continue;
    }
    if (question.type === 'text') {
      result.push({ questionId: question.id, value: values[0].slice(0, 2000) });
      continue;
    }
    const allowed = new Set((question.options ?? []).map((option) => option.value));
    if (values.some((value) => !allowed.has(value))) {
      throw new HTTPException(400, { message: `题目「${question.label}」选项无效` });
    }
    const maxChoices = question.type === 'single' ? 1 : question.maxChoices;
    const minChoices = question.required ? Math.max(1, question.minChoices) : question.minChoices;
    if (values.length < minChoices || values.length > maxChoices) {
      throw new HTTPException(400, { message: `题目「${question.label}」需选择 ${minChoices}-${maxChoices} 项` });
    }
    result.push({ questionId: question.id, value: question.type === 'single' ? values[0] : values });
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
    const duplicateConditions: SQL[] = [eq(cmsInteractionResponses.interactionId, transactionResult.interaction.id)];
    if (requestKey) duplicateConditions.push(eq(cmsInteractionResponses.requestKey, requestKey));
    else if (transactionResult.repeatKey) duplicateConditions.push(eq(cmsInteractionResponses.repeatKey, transactionResult.repeatKey));
    else throw new HTTPException(409, { message: '请求已处理，请勿重复提交' });
    const [existing] = await db.select({ id: cmsInteractionResponses.id }).from(cmsInteractionResponses)
      .where(and(...duplicateConditions)).limit(1);
    if (!existing) throw new HTTPException(409, { message: '您已参与过本次互动' });
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

async function getCmsInteractionStatsInternal(id: number): Promise<CmsInteractionStats> {
  const interaction = await db.query.cmsInteractions.findFirst({
    where: eq(cmsInteractions.id, id),
    with: { questions: true },
  });
  if (!interaction) throw new HTTPException(404, { message: '互动问卷不存在' });
  const answers = await db.select({
    questionId: cmsInteractionAnswers.questionId,
    value: cmsInteractionAnswers.value,
    responseId: cmsInteractionAnswers.responseId,
  })
    .from(cmsInteractionAnswers)
    .innerJoin(cmsInteractionResponses, eq(cmsInteractionAnswers.responseId, cmsInteractionResponses.id))
    .where(eq(cmsInteractionResponses.interactionId, id))
    .orderBy(desc(cmsInteractionAnswers.id))
    .limit(100_000);
  return {
    interactionId: id,
    responseCount: interaction.responseCount,
    questions: [...interaction.questions].sort((a, b) => a.sort - b.sort || a.id - b.id).map((question) => {
      const questionAnswers = answers.filter((answer) => answer.questionId === question.id);
      if (question.type === 'text') {
        return {
          id: question.id,
          label: question.label,
          type: question.type,
          options: [],
          texts: questionAnswers
            .map((answer) => answer.value)
            .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
            .slice(0, 50),
        };
      }

      const counts = new Map((question.options ?? []).map((option) => [option.value, 0]));
      for (const answer of questionAnswers) {
        const values = Array.isArray(answer.value) ? answer.value : [answer.value];
        for (const value of values) {
          if (counts.has(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
        }
      }
      const answered = new Set(questionAnswers.map((answer) => answer.responseId)).size;
      return {
        id: question.id,
        label: question.label,
        type: question.type,
        options: (question.options ?? []).map((option) => ({
          ...option,
          count: counts.get(option.value) ?? 0,
          percent: answered > 0 ? Math.round(((counts.get(option.value) ?? 0) / answered) * 1000) / 10 : 0,
        })),
        texts: [],
      };
    }),
  };
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
    })),
  };
}

export async function getCmsInteractionStats(id: number): Promise<CmsInteractionStats> {
  const current = await ensureCmsInteractionExists(id);
  await assertSiteAccess(current.siteId);
  return getCmsInteractionStatsInternal(id);
}

function maskedMember(row: {
  nickname: string | null;
  username: string | null;
  phone: string | null;
  email: string | null;
}): string {
  if (row.nickname) return maskName(row.nickname);
  if (row.username) return maskName(row.username);
  if (row.phone) return maskPhone(row.phone);
  if (row.email) return maskEmail(row.email);
  return '游客';
}

export interface ListCmsInteractionResponsesQuery {
  siteId: number;
  interactionId?: number;
  kind?: CmsInteractionKind;
  startTime?: string;
  endTime?: string;
  page: number;
  pageSize: number;
}

export function buildCmsInteractionResponseWhere(
  q: Omit<ListCmsInteractionResponsesQuery, 'page' | 'pageSize'>,
): SQL {
  const conditions: SQL[] = [eq(cmsInteractions.siteId, q.siteId)];
  if (q.interactionId) conditions.push(eq(cmsInteractionResponses.interactionId, q.interactionId));
  if (q.kind) conditions.push(eq(cmsInteractions.kind, q.kind));
  if (q.startTime) {
    const parsed = parseDateRangeStart(q.startTime);
    if (!parsed) throw new HTTPException(400, { message: '开始时间格式无效' });
    conditions.push(gte(cmsInteractionResponses.createdAt, parsed));
  }
  if (q.endTime) {
    const parsed = parseDateRangeEnd(q.endTime);
    if (!parsed) throw new HTTPException(400, { message: '结束时间格式无效' });
    conditions.push(lte(cmsInteractionResponses.createdAt, parsed));
  }
  return and(...conditions)!;
}

async function loadAnswerMap(responseIds: number[]): Promise<Map<number, Record<string, string | string[]>>> {
  if (responseIds.length === 0) return new Map();
  const rows = await db.select({
    responseId: cmsInteractionAnswers.responseId,
    questionId: cmsInteractionAnswers.questionId,
    value: cmsInteractionAnswers.value,
  }).from(cmsInteractionAnswers).where(inArray(cmsInteractionAnswers.responseId, responseIds));
  const map = new Map<number, Record<string, string | string[]>>();
  for (const row of rows) {
    const answer = map.get(row.responseId) ?? {};
    answer[String(row.questionId)] = row.value;
    map.set(row.responseId, answer);
  }
  return map;
}

export async function listCmsInteractionResponses(q: ListCmsInteractionResponsesQuery) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const where = buildCmsInteractionResponseWhere(q);
  const base = db.select({
    response: cmsInteractionResponses,
    interactionTitle: cmsInteractions.title,
    kind: cmsInteractions.kind,
    nickname: members.nickname,
    username: members.username,
    phone: members.phone,
    email: members.email,
  })
    .from(cmsInteractionResponses)
    .innerJoin(cmsInteractions, eq(cmsInteractionResponses.interactionId, cmsInteractions.id))
    .leftJoin(members, eq(cmsInteractionResponses.memberId, members.id))
    .where(where)
    .orderBy(desc(cmsInteractionResponses.createdAt), desc(cmsInteractionResponses.id));
  const [countRows, rows] = await Promise.all([
    db.select({ value: sql<number>`count(*)::int` }).from(cmsInteractionResponses)
      .innerJoin(cmsInteractions, eq(cmsInteractionResponses.interactionId, cmsInteractions.id))
      .where(where),
    withPagination(base.$dynamic(), q.page, q.pageSize),
  ]);
  const answerMap = await loadAnswerMap(rows.map((row) => row.response.id));
  const list: CmsInteractionResponse[] = rows.map((row) => ({
    id: row.response.id,
    interactionId: row.response.interactionId,
    interactionTitle: row.interactionTitle,
    kind: row.kind,
    memberId: row.response.memberId,
    memberDisplay: row.response.memberId ? maskedMember(row) : '游客',
    visitorHash: row.response.visitorHash,
    ipHash: row.response.ipHash,
    answers: answerMap.get(row.response.id) ?? {},
    createdAt: formatDateTime(row.response.createdAt),
  }));
  return { list, total: countRows[0]?.value ?? 0, page: q.page, pageSize: q.pageSize };
}

export async function* streamCmsInteractionResponses(
  q: Omit<ListCmsInteractionResponsesQuery, 'page' | 'pageSize'>,
) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const baseWhere = buildCmsInteractionResponseWhere(q);
  yield* streamByDescendingId(async (beforeId, limit) => {
    const rows = await db.select({
      response: cmsInteractionResponses,
      interactionTitle: cmsInteractions.title,
      kind: cmsInteractions.kind,
      memberId: members.id,
      nickname: members.nickname,
      username: members.username,
      phone: members.phone,
      email: members.email,
    })
      .from(cmsInteractionResponses)
      .innerJoin(cmsInteractions, eq(cmsInteractionResponses.interactionId, cmsInteractions.id))
      .leftJoin(members, eq(cmsInteractionResponses.memberId, members.id))
      .where(and(baseWhere, beforeId === null ? undefined : lt(cmsInteractionResponses.id, beforeId)))
      .orderBy(desc(cmsInteractionResponses.id))
      .limit(limit);
    const answerMap = await loadAnswerMap(rows.map((row) => row.response.id));
    return rows.map((row): CmsInteractionResponse => ({
      id: row.response.id,
      interactionId: row.response.interactionId,
      interactionTitle: row.interactionTitle,
      kind: row.kind,
      memberId: row.response.memberId,
      memberDisplay: row.memberId
        ? row.nickname || row.username || row.phone || row.email || `会员 #${row.memberId}`
        : '游客',
      visitorHash: row.response.visitorHash,
      ipHash: row.response.ipHash,
      answers: answerMap.get(row.response.id) ?? {},
      createdAt: formatDateTime(row.response.createdAt),
    }));
  });
}

const INTERACTION_MARKER_RE = /(?:<p[^>]*>)?\s*\[互动:([a-z0-9-]+)\]\s*(?:<\/p>)?/gi;
const LEGACY_INTERACTION_MARKER_RE = /(?:<p[^>]*>)?\s*\[(?:投票|问卷|survey|poll):[^\]\r\n]{1,100}\]\s*(?:<\/p>)?/gi;

export function applyInteractionMarkers(html: string, siteCode: string): string {
  if (!html) return html;
  const withoutLegacy = html.replace(LEGACY_INTERACTION_MARKER_RE, '');
  if (!withoutLegacy.includes('[互动:')) return withoutLegacy;
  const safeSiteCode = siteCode.replace(/[^a-z0-9-]/gi, '');
  return withoutLegacy.replace(INTERACTION_MARKER_RE, (_match, code: string) =>
    `<div class="cms-interaction" data-site="${safeSiteCode}" data-code="${code}"></div>`);
}

export function canExposeCmsInteractionResults(input: {
  visibility: CmsInteractionRow['resultVisibility'];
  status: CmsInteractionRow['status'];
  submitted: boolean;
}): boolean {
  return input.visibility === 'always'
    || (input.visibility === 'after_submit' && input.submitted)
    || (input.visibility === 'after_close' && input.status === 'closed');
}

export function cmsInteractionRepeatIdentity(input: {
  policy: CmsInteractionRepeatPolicy;
  memberId: number | null;
  ipHash: string;
}): string | null {
  return repeatKeyFor(input.policy, input.memberId, input.ipHash);
}
