import { http, HttpResponse } from 'msw';
import type * as z from 'zod';
import { badRequest, unauthorized, forbidden, notFound, conflict, nextIdFrom } from '@/mocks/utils/handlers';
import { mock } from '@/mocks/utils/contract';
import {
  cmsAdContract,
  cmsContentContract,
  cmsInteractionContract,
  cmsPageContract,
  cmsSubscriptionContract,
  memberCmsContract,
  publicCmsContract,
} from '@zenith/shared/cms';
import type {
  CmsInteraction,
  CmsInteractionPublicState,
  CmsInteractionPublicStats,
  CmsInteractionQuestion,
  CmsInteractionQuestionStats,
  CmsInteractionResponse,
  CmsInteractionStats,
  CmsInteractionSubmitResult,
  CmsMemberSubscription,
  cmsInteractionQuestionSchema,
  submitCmsInteractionSchema,
} from '@zenith/shared/cms';
import {
  buildMockAnswerDetails,
  getNextCmsAdEventId,
  getNextCmsInteractionId,
  getNextCmsInteractionResponseId,
  mockCmsAdEvents,
  mockCmsAds,
  mockCmsChannels,
  mockCmsContents,
  mockCmsInteractions,
  mockCmsInteractionResponses,
  mockCmsPageBlockAcls,
  mockCmsPages,
  mockCmsSites,
  mockCmsSubscriptions,
} from '../data/cms';
import { mockDate, mockDateTime } from '../utils/date';
import { createProgressingMockTask } from './async-tasks';

type InteractionQuestionInput = z.output<typeof cmsInteractionQuestionSchema>;
type InteractionSubmitInput = z.output<typeof submitCmsInteractionSchema>;
type SubmitOk = (data: CmsInteractionSubmitResult, message?: string) => Response;

const awardedSubscriptionIds = new Set(mockCmsSubscriptions.filter((item) => item.pointsAwardedAt).map((item) => item.id));
const interactionRequestKeys = new Map<string, number>();
const adEventDedupe = new Set<string>();
const adEventTokens = new Map<string, {
  adId: number;
  siteId: number;
  eventType: 'impression' | 'click';
  path: string;
  used: boolean;
}>();

function issueDemoAdToken(input: Omit<NonNullable<ReturnType<typeof adEventTokens.get>>, 'used'>): string {
  const token = `demo-ad-token-${input.eventType}-${input.adId}-${Date.now()}-${Math.random()}`;
  adEventTokens.set(token, { ...input, used: false });
  return token;
}

function consumeDemoAdToken(token: string, eventType: 'impression' | 'click', adId?: number) {
  const row = adEventTokens.get(token);
  if (!row || row.used || row.eventType !== eventType || (adId !== undefined && row.adId !== adId)) return null;
  row.used = true;
  return row;
}

function resolveMockSubscriptionSubject(input: {
  siteId: number;
  subjectType: CmsMemberSubscription['subjectType'];
  subjectId: number | null;
  subjectKey: string;
}) {
  const site = mockCmsSites.find((item) => item.id === input.siteId && item.status === 'enabled');
  if (!site) return null;
  if (input.subjectType === 'site') {
    return input.subjectId === site.id
      ? { subjectId: site.id, subjectKey: String(site.id), subjectLabel: site.name }
      : null;
  }
  if (input.subjectType === 'channel') {
    const channel = mockCmsChannels.find((item) =>
      item.id === input.subjectId && item.siteId === site.id && item.status === 'enabled');
    return channel
      ? { subjectId: channel.id, subjectKey: String(channel.id), subjectLabel: channel.name }
      : null;
  }
  const normalized = input.subjectKey.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
  const content = mockCmsContents.find((item) =>
    item.siteId === site.id
    && item.status === 'published'
    && !!item.author
    && item.author.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US') === normalized);
  return content?.author
    ? { subjectId: null, subjectKey: normalized, subjectLabel: content.author.normalize('NFKC').trim() }
    : null;
}

function interactionStats(interaction: CmsInteraction): CmsInteractionStats {
  const responses = mockCmsInteractionResponses.filter((response) => response.interactionId === interaction.id);
  return {
    interactionId: interaction.id,
    responseCount: responses.length,
    questions: (interaction.questions ?? []).map((question): CmsInteractionQuestionStats => {
      const answered = responses.filter((response) => response.answers[String(question.id)] !== undefined);
      const base: CmsInteractionQuestionStats = {
        id: question.id,
        label: question.label,
        type: question.type,
        options: [],
        texts: [],
        answered: answered.length,
        average: null,
        npsScore: null,
        matrixRows: [],
      };
      if (question.type === 'text' || question.type === 'date') {
        return {
          ...base,
          texts: responses
            .map((response) => response.answers[String(question.id)])
            .filter((value): value is string => typeof value === 'string')
            .slice(0, 50),
        };
      }
      if (question.type === 'rating' || question.type === 'nps' || question.type === 'number') {
        const scores = answered
          .map((response) => Number(response.answers[String(question.id)]))
          .filter((score) => Number.isFinite(score));
        const promoters = scores.filter((score) => score >= 9).length;
        const detractors = scores.filter((score) => score <= 6).length;
        return {
          ...base,
          average: scores.length
            ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100
            : null,
          npsScore: question.type === 'nps' && scores.length
            ? Math.round(((promoters - detractors) / scores.length) * 1000) / 10
            : null,
        };
      }
      const countFor = (predicate: (value: string) => boolean) => answered.filter((response) => {
        const value = response.answers[String(question.id)];
        return Array.isArray(value) ? value.some(predicate) : predicate(String(value));
      }).length;
      if (question.type === 'matrix') {
        return {
          ...base,
          matrixRows: question.matrixRows.map((row) => ({
            id: row.id,
            label: row.label,
            options: question.options.map((option) => {
              const count = countFor((value) => value === `${row.id}::${option.value}`);
              return { ...option, count, percent: answered.length ? Math.round((count / answered.length) * 1000) / 10 : 0 };
            }),
          })),
        };
      }
      const options = [...question.options];
      if (question.allowOther) {
        options.push({ id: '__other__', label: question.otherLabel || '其他', value: '__other__' });
      }
      return {
        ...base,
        options: options.map((option) => {
          const count = option.value === '__other__'
            ? countFor((value) => value === '__other__' || value.startsWith('__other__:'))
            : countFor((value) => value === option.value);
          return { ...option, count, percent: answered.length ? Math.round((count / answered.length) * 1000) / 10 : 0 };
        }),
      };
    }),
  };
}

function publicInteractionStats(interaction: CmsInteraction): CmsInteractionPublicStats {
  const stats = interactionStats(interaction);
  return {
    ...stats,
    questions: stats.questions.map(({ texts: _texts, answered: _answered, matrixRows: _matrixRows, ...question }) => question),
  };
}

function normalizeQuestions(interactionId: number, raw: InteractionQuestionInput[]): CmsInteractionQuestion[] {
  return raw.map((question, index) => ({
    id: question.id ?? interactionId * 100 + index + 1,
    interactionId,
    label: question.label,
    type: question.type,
    required: question.required,
    options: question.options.map((option) => ({ ...option })),
    minChoices: question.minChoices,
    maxChoices: question.type === 'single' ? 1 : question.maxChoices,
    sort: question.sort,
    allowOther: question.allowOther,
    otherLabel: question.otherLabel ?? null,
    ratingMax: question.ratingMax,
    matrixRows: question.matrixRows.map((row) => ({ ...row })),
    pageNo: question.pageNo,
    visibleWhen: question.visibleWhen ?? null,
  }));
}

function publicInteractionState(interaction: CmsInteraction, member: boolean): CmsInteractionPublicState {
  const responses = mockCmsInteractionResponses.filter((response) => response.interactionId === interaction.id);
  const submitted = responses.some((response) => member ? response.memberId === 1 : response.memberId === null);
  const resultsVisible = interaction.resultVisibility === 'always'
    || (interaction.resultVisibility === 'after_submit' && submitted)
    || (interaction.resultVisibility === 'after_close' && interaction.status === 'closed');
  const captcha = interaction.captchaPolicy === 'turnstile'
    ? { provider: 'turnstile' as const, siteKey: interaction.turnstileSiteKey }
    : interaction.captchaPolicy === 'math'
      ? { provider: 'math' as const, siteKey: null }
      : { provider: 'none' as const, siteKey: null };
  return {
    interaction: {
      id: interaction.id,
      siteId: interaction.siteId,
      code: interaction.code,
      kind: interaction.kind,
      title: interaction.title,
      description: interaction.description,
      status: interaction.status,
      participantScope: interaction.participantScope,
      repeatPolicy: interaction.repeatPolicy,
      resultVisibility: interaction.resultVisibility,
      captchaPolicy: interaction.captchaPolicy,
      thankYouMessage: interaction.thankYouMessage,
      startAt: interaction.startAt,
      endAt: interaction.endAt,
      questions: interaction.questions ?? [],
    },
    open: interaction.status === 'published',
    submitted,
    captchaRequired: captcha.provider !== 'none',
    captcha,
    resultsVisible,
    results: resultsVisible ? publicInteractionStats(interaction) : null,
  };
}

function submitInteraction(interaction: CmsInteraction, body: InteractionSubmitInput, member: boolean, ok: SubmitOk): Response {
  if (interaction.status !== 'published') return badRequest('互动问卷未开放', { status: 400 });
  if (interaction.participantScope === 'member' && !member) return unauthorized('该互动仅限会员参与', { status: 401 });
  if (interaction.captchaPolicy === 'math' && !body.captchaAnswer?.trim()) {
    return badRequest('验证码错误或已过期，请重试', { status: 400 });
  }
  if (interaction.captchaPolicy === 'turnstile' && !body.turnstileToken?.trim()) {
    return badRequest('验证码验证失败，请重试', { status: 400 });
  }
  const idempotencyKey = body.idempotencyKey ?? '';
  const requestKey = `${interaction.id}:${idempotencyKey}`;
  if (idempotencyKey && interactionRequestKeys.has(requestKey)) {
    const responseId = interactionRequestKeys.get(requestKey)!;
    return ok({ responseId, duplicate: true, message: interaction.thankYouMessage, results: publicInteractionStats(interaction) }, interaction.thankYouMessage);
  }
  const duplicate = mockCmsInteractionResponses.find((response) =>
    response.interactionId === interaction.id
    && (interaction.repeatPolicy === 'once_per_member'
      ? response.memberId === 1 && member
      : interaction.repeatPolicy === 'once_per_ip'
        ? response.memberId === (member ? 1 : null)
        : false));
  if (duplicate && interaction.repeatPolicy !== 'multiple') return conflict('您已参与过本次互动', { status: 409 });
  const response: CmsInteractionResponse = {
    id: getNextCmsInteractionResponseId(),
    interactionId: interaction.id,
    interactionTitle: interaction.title,
    kind: interaction.kind,
    memberId: member ? 1 : null,
    memberDisplay: member ? '演***员' : '游客',
    visitorHash: 'demo-visitor-hash',
    ipHash: 'demo-ip-hash',
    answers: body.answers,
    answerDetails: buildMockAnswerDetails(interaction.id, body.answers),
    createdAt: mockDateTime(),
  };
  mockCmsInteractionResponses.unshift(response);
  interaction.responseCount += 1;
  if (idempotencyKey) interactionRequestKeys.set(requestKey, response.id);
  const results = ['always', 'after_submit'].includes(interaction.resultVisibility)
    ? publicInteractionStats(interaction)
    : null;
  return ok({ responseId: response.id, duplicate: false, message: interaction.thankYouMessage, results }, interaction.thankYouMessage);
}

function recordAdEvent(adId: number, eventType: 'impression' | 'click', path: string, referrer: string | null) {
  const ad = mockCmsAds.find((item) => item.id === adId && item.status === 'enabled');
  if (!ad) return;
  const seed = mockCmsAdEvents.find((event) => event.adId === adId);
  mockCmsAdEvents.unshift({
    id: getNextCmsAdEventId(),
    siteId: seed?.siteId ?? 1,
    adId,
    adName: ad.name,
    slotId: ad.slotId,
    slotName: seed?.slotName ?? null,
    eventType,
    occurredAt: mockDateTime(),
    visitorHash: 'demo-visitor-hash',
    ipHash: 'demo-ip-hash',
    userAgent: 'MSW Demo',
    device: 'pc',
    referrer,
    path,
    memberId: null,
  });
  if (eventType === 'click') ad.clickCount += 1;
  else ad.viewCount += 1;
}

export const cmsStage4Handlers = [
  mock(cmsContentContract.publish, ({ params, ok }) => {
    const content = mockCmsContents.find((item) => item.id === params.id);
    if (!content) return notFound('内容不存在', { status: 404 });
    content.status = 'published';
    content.version += 1;
    content.updatedAt = mockDateTime();
    createProgressingMockTask({
      taskType: 'cms-subscription-notify',
      title: `CMS 订阅通知：${content.title}`,
      payload: {
        contentId: content.id,
        contentVersion: content.version,
        siteId: content.siteId,
        channelId: content.channelId,
      },
      totalItems: mockCmsSubscriptions.filter((item) => item.siteId === content.siteId && item.active && item.notificationEnabled).length || 1,
    });
    return ok(content, '发布成功');
  }),

  // ─── 统一互动问卷后台 ───────────────────────────────────────────────────────
  mock(cmsInteractionContract.responses, ({ query, ok, paginate }) => {
    const { siteId, kind, startTime, endTime, interactionId } = query;
    const interactionIds = new Set(mockCmsInteractions
      .filter((interaction) => interaction.siteId === siteId && (!kind || interaction.kind === kind))
      .map((interaction) => interaction.id));
    let list = mockCmsInteractionResponses.filter((response) => interactionIds.has(response.interactionId));
    if (interactionId) list = list.filter((response) => response.interactionId === interactionId);
    if (startTime) list = list.filter((response) => response.createdAt >= startTime);
    if (endTime) list = list.filter((response) => response.createdAt <= endTime);
    return ok(paginate(list));
  }),
  mock(cmsInteractionContract.texts, ({ params, query, ok, paginate }) => {
    const interaction = mockCmsInteractions.find((item) => item.id === params.id);
    if (!interaction) return notFound('互动问卷不存在', { status: 404 });
    const { questionId } = query;
    const keyword = query.keyword?.trim() ?? '';
    const question = (interaction.questions ?? []).find((item) => item.id === questionId);
    if (!question) return notFound('题目不存在', { status: 404 });
    const isFreeText = ['text', 'date', 'number'].includes(question.type);
    if (!isFreeText && !question.allowOther) return badRequest('该题型没有文本答案', { status: 400 });
    const list = mockCmsInteractionResponses
      .filter((response) => response.interactionId === interaction.id)
      .flatMap((response) => {
        const raw = response.answers[String(questionId)];
        const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
        return values
          .filter((value) => isFreeText || value.startsWith('__other__:'))
          .map((value) => ({
            responseId: response.id,
            value: value.startsWith('__other__:') ? value.slice('__other__:'.length) : value,
            createdAt: response.createdAt,
          }));
      })
      .filter((item) => !keyword || item.value.includes(keyword))
      .reverse();
    return ok(paginate(list));
  }),
  mock(cmsInteractionContract.crossStats, ({ params, query, ok }) => {
    const interaction = mockCmsInteractions.find((item) => item.id === params.id);
    if (!interaction) return notFound('互动问卷不存在', { status: 404 });
    const { xQuestionId: xId, yQuestionId: yId } = query;
    if (xId === yId) return badRequest('交叉分析需要选择两道不同的题目', { status: 400 });
    const questions = interaction.questions ?? [];
    const x = questions.find((item) => item.id === xId);
    const y = questions.find((item) => item.id === yId);
    if (!x || !y) return notFound('题目不存在', { status: 404 });
    if (!['single', 'multiple'].includes(x.type) || !['single', 'multiple'].includes(y.type)) {
      return badRequest('交叉分析仅支持单选或多选题', { status: 400 });
    }
    const bucket = (value: string) => (value.startsWith('__other__') ? '__other__' : value);
    const valuesOf = (response: CmsInteractionResponse, questionId: number) => {
      const raw = response.answers[String(questionId)];
      const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
      return [...new Set(list.map(bucket))];
    };
    const optionsOf = (question: CmsInteractionQuestion) => {
      const list = question.options.map((option) => ({ value: option.value, label: option.label }));
      if (question.allowOther) list.push({ value: '__other__', label: question.otherLabel || '其他' });
      return list;
    };
    const columns = optionsOf(y);
    const responses = mockCmsInteractionResponses.filter((response) => response.interactionId === interaction.id);
    return ok({
      xQuestionId: xId,
      xLabel: x.label,
      yQuestionId: yId,
      yLabel: y.label,
      columns,
      rows: optionsOf(x).map((option) => {
        const cells = columns.map((column) => responses.filter((response) =>
          valuesOf(response, xId).includes(option.value) && valuesOf(response, yId).includes(column.value)).length);
        const total = cells.reduce((sum, count) => sum + count, 0);
        return {
          value: option.value,
          label: option.label,
          total,
          cells: cells.map((count) => ({ count, percent: total ? Math.round((count / total) * 1000) / 10 : 0 })),
        };
      }),
    });
  }),
  mock(cmsInteractionContract.trend, ({ params, query, ok }) => {
    const interaction = mockCmsInteractions.find((item) => item.id === params.id);
    if (!interaction) return notFound('互动问卷不存在', { status: 404 });
    const days = query.days ?? 30;
    const byDay = new Map<string, number>();
    mockCmsInteractionResponses
      .filter((response) => response.interactionId === interaction.id)
      .forEach((response) => {
        const day = response.createdAt.slice(0, 10);
        byDay.set(day, (byDay.get(day) ?? 0) + 1);
      });
    const points = Array.from({ length: days }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - index));
      const key = mockDate(date);
      return { date: key, count: byDay.get(key) ?? 0 };
    });
    return ok({ interactionId: interaction.id, days, points });
  }),
  mock(cmsInteractionContract.stats, ({ params, ok }) => {
    const interaction = mockCmsInteractions.find((item) => item.id === params.id);
    return interaction ? ok(interactionStats(interaction)) : notFound('互动问卷不存在', { status: 404 });
  }),
  mock(cmsInteractionContract.detail, ({ params, ok }) => {
    const interaction = mockCmsInteractions.find((item) => item.id === params.id);
    return interaction ? ok(interaction) : notFound('互动问卷不存在', { status: 404 });
  }),
  mock(cmsInteractionContract.list, ({ query, ok, paginate }) => {
    const { siteId, kind, status } = query;
    const keyword = query.keyword?.trim() ?? '';
    let list = mockCmsInteractions.filter((interaction) => interaction.siteId === siteId);
    if (keyword) list = list.filter((interaction) => interaction.title.includes(keyword) || interaction.code.includes(keyword));
    if (kind) list = list.filter((interaction) => interaction.kind === kind);
    if (status) list = list.filter((interaction) => interaction.status === status);
    return ok(paginate(list));
  }),
  mock(cmsInteractionContract.create, ({ body, ok }) => {
    const id = getNextCmsInteractionId();
    const interaction: CmsInteraction = {
      id,
      siteId: body.siteId,
      code: body.code,
      kind: body.kind,
      title: body.title,
      description: body.description || null,
      status: body.status,
      participantScope: body.participantScope,
      repeatPolicy: body.repeatPolicy,
      resultVisibility: body.resultVisibility,
      captchaPolicy: body.captchaPolicy,
      turnstileSiteKey: body.turnstileSiteKey || null,
      turnstileSecretConfigured: !!body.turnstileSecret,
      thankYouMessage: body.thankYouMessage,
      startAt: body.startAt || null,
      endAt: body.endAt || null,
      responseCount: 0,
      questions: normalizeQuestions(id, body.questions),
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockCmsInteractions.unshift(interaction);
    return ok(interaction, '创建成功');
  }),
  mock(cmsInteractionContract.update, ({ params, body, ok }) => {
    const interaction = mockCmsInteractions.find((item) => item.id === params.id);
    if (!interaction) return notFound('互动问卷不存在', { status: 404 });
    if (body.questions && interaction.responseCount > 0) return conflict('已有答卷，不可替换题目', { status: 409 });
    const { turnstileSecret, questions, ...safeBody } = body;
    Object.assign(interaction, safeBody, {
      turnstileSecretConfigured: turnstileSecret ? true : interaction.turnstileSecretConfigured,
      questions: questions ? normalizeQuestions(interaction.id, questions) : interaction.questions,
      updatedAt: mockDateTime(),
    });
    return ok(interaction, '更新成功');
  }),
  mock(cmsInteractionContract.copy, ({ params, ok }) => {
    const source = mockCmsInteractions.find((item) => item.id === params.id);
    if (!source) return notFound('互动问卷不存在', { status: 404 });
    const stem = source.code.replace(/-copy(?:-\d+)?$/, '') || source.code;
    const taken = new Set(mockCmsInteractions.filter((item) => item.siteId === source.siteId).map((item) => item.code));
    let code = `${stem}-copy`;
    for (let index = 2; taken.has(code) && index <= 100; index += 1) code = `${stem}-copy-${index}`;
    const id = getNextCmsInteractionId();
    const copied: CmsInteraction = {
      ...source,
      id,
      code,
      title: `${source.title}（副本）`,
      status: 'draft',
      responseCount: 0,
      questions: (source.questions ?? []).map((question, index) => ({
        ...question,
        id: id * 1000 + index + 1,
        interactionId: id,
        options: question.options.map((option) => ({ ...option })),
      })),
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockCmsInteractions.unshift(copied);
    return ok(copied, '复制成功');
  }),
  mock(cmsInteractionContract.setStatus, ({ params, body, ok }) => {
    const interaction = mockCmsInteractions.find((item) => item.id === params.id);
    if (!interaction) return notFound('互动问卷不存在', { status: 404 });
    interaction.status = body.status;
    interaction.updatedAt = mockDateTime();
    return ok(interaction, '状态已更新');
  }),
  mock(cmsInteractionContract.batchStatus, ({ body, ok }) => {
    mockCmsInteractions.forEach((interaction) => {
      if (body.ids.includes(interaction.id)) interaction.status = body.status;
    });
    return ok(createProgressingMockTask({
      taskType: 'cms-interactions-batch-status',
      title: body.status === 'published' ? 'CMS 互动问卷批量发布' : 'CMS 互动问卷批量关闭',
      payload: body,
      totalItems: body.ids.length,
    }), '批量任务已提交');
  }),
  mock(cmsInteractionContract.remove, ({ params, ok }) => {
    const index = mockCmsInteractions.findIndex((item) => item.id === params.id);
    if (index < 0) return notFound('互动问卷不存在', { status: 404 });
    const [removed] = mockCmsInteractions.splice(index, 1);
    for (let responseIndex = mockCmsInteractionResponses.length - 1; responseIndex >= 0; responseIndex -= 1) {
      if (mockCmsInteractionResponses[responseIndex].interactionId === removed.id) mockCmsInteractionResponses.splice(responseIndex, 1);
    }
    return ok(null, '删除成功');
  }),

  // ─── 统一互动问卷公开/会员提交 ──────────────────────────────────────────────
  mock(publicCmsContract.interaction, ({ params, request, ok }) => {
    const site = mockCmsSites.find((item) => item.code === params.siteCode);
    const interaction = site && mockCmsInteractions.find((item) => item.siteId === site.id && item.code === params.code && item.status !== 'draft');
    if (!interaction) return notFound('互动问卷不存在', { status: 404 });
    return ok(publicInteractionState(interaction, request.headers.has('authorization')));
  }),
  mock(publicCmsContract.submitInteraction, ({ params, body, request, ok }) => {
    const site = mockCmsSites.find((item) => item.code === params.siteCode);
    const interaction = site && mockCmsInteractions.find((item) => item.siteId === site.id && item.code === params.code);
    if (!interaction) return notFound('互动问卷不存在', { status: 404 });
    return submitInteraction(interaction, body, request.headers.has('authorization'), ok);
  }),
  mock(memberCmsContract.submitInteraction, ({ params, query, body, ok }) => {
    const interaction = mockCmsInteractions.find((item) => item.id === params.id);
    if (!interaction || query.siteId !== interaction.siteId) return notFound('互动问卷不存在', { status: 404 });
    return submitInteraction(interaction, body, true, ok);
  }),

  // ─── 广告事件明细/统计/清理与公开采集 ─────────────────────────────────────
  mock(cmsAdContract.eventStats, ({ query, ok }) => {
    const list = mockCmsAdEvents.filter((event) => event.siteId === query.siteId);
    const grouped = new Map<string, { impressions: number; clicks: number }>();
    list.forEach((event) => {
      const date = event.occurredAt.slice(0, 10);
      const row = grouped.get(date) ?? { impressions: 0, clicks: 0 };
      if (event.eventType === 'impression') row.impressions += 1;
      else row.clicks += 1;
      grouped.set(date, row);
    });
    const trend = [...grouped].map(([date, row]) => ({
      date,
      ...row,
      ctr: row.impressions ? Math.round((row.clicks / row.impressions) * 10_000) / 100 : 0,
    }));
    const impressions = trend.reduce((sum, row) => sum + row.impressions, 0);
    const clicks = trend.reduce((sum, row) => sum + row.clicks, 0);
    return ok({
      summary: { impressions, clicks, ctr: impressions ? Math.round((clicks / impressions) * 10_000) / 100 : 0 },
      trend,
    });
  }),
  mock(cmsAdContract.events, ({ query, ok, paginate }) => {
    const { siteId, adId, slotId, eventType, device, startTime, endTime } = query;
    let list = mockCmsAdEvents.filter((event) => event.siteId === siteId);
    if (adId) list = list.filter((event) => event.adId === adId);
    if (slotId) list = list.filter((event) => event.slotId === slotId);
    if (eventType) list = list.filter((event) => event.eventType === eventType);
    if (device) list = list.filter((event) => event.device === device);
    if (startTime) list = list.filter((event) => event.occurredAt >= startTime);
    if (endTime) list = list.filter((event) => event.occurredAt <= endTime);
    return ok(paginate(list));
  }),
  mock(cmsAdContract.cleanupEvents, ({ body, ok }) => ok(createProgressingMockTask({
    taskType: 'cms-ad-events-cleanup',
    title: `CMS 广告事件清理（保留 ${body.retentionDays ?? 180} 天）`,
    payload: body,
    totalItems: Math.max(1, mockCmsAdEvents.filter((event) => !body.siteId || event.siteId === body.siteId).length),
  }), '清理任务已提交')),
  mock(publicCmsContract.issueAdTokens, ({ params, body, ok }) => {
    const site = mockCmsSites.find((item) => item.code === params.siteCode && item.status === 'enabled');
    if (!site) return notFound('站点不存在或未启用', { status: 404 });
    if (body.ads.some((item) => !item.renderProof)) return forbidden('广告渲染凭证无效', { status: 403 });
    const path = '/news/';
    const data = [...new Map(body.ads.map((item) => [item.adId, item])).values()].flatMap(({ adId: id }) => {
      const ad = mockCmsAds.find((item) => item.id === id && item.status === 'enabled');
      if (!ad) return [];
      return [{
        adId: id,
        viewToken: issueDemoAdToken({ adId: id, siteId: site.id, eventType: 'impression', path }),
        clickToken: ad.linkUrl
          ? issueDemoAdToken({ adId: id, siteId: site.id, eventType: 'click', path })
          : null,
      }];
    });
    return ok(data);
  }),
  http.get('/api/public/cms/ads/:id/click', ({ params, request }) => {
    const ad = mockCmsAds.find((item) => item.id === Number(params.id) && item.status === 'enabled');
    const token = new URL(request.url).searchParams.get('token') ?? '';
    const eventToken = consumeDemoAdToken(token, 'click', ad?.id);
    if (!eventToken) return conflict('广告事件令牌无效或已使用', { status: 409 });
    if (!ad?.linkUrl || (!ad.linkUrl.startsWith('/') && !/^https?:\/\//i.test(ad.linkUrl))) {
      return new HttpResponse('广告不存在或未投放', { status: 404 });
    }
    const key = `click:${ad.id}:${Math.floor(Date.now() / 10_000)}`;
    if (!adEventDedupe.has(key)) {
      adEventDedupe.add(key);
      recordAdEvent(ad.id, 'click', eventToken.path, request.headers.get('referer'));
    }
    return HttpResponse.redirect(new URL(ad.linkUrl, request.url).toString(), 302);
  }),
  http.post('/api/public/cms/ads/view', async ({ request }) => {
    const body = await request.json() as { tokens?: string[] };
    const eventTokens = (body.tokens ?? []).map((token) => consumeDemoAdToken(token, 'impression'));
    if (eventTokens.length === 0 || eventTokens.some((token) => !token)) {
      return conflict('广告事件令牌无效或已使用', { status: 409 });
    }
    const bucket = Math.floor(Date.now() / 60_000);
    for (const eventToken of eventTokens) {
      const key = `impression:${eventToken!.adId}:${bucket}`;
      if (adEventDedupe.has(key)) continue;
      adEventDedupe.add(key);
      recordAdEvent(eventToken!.adId, 'impression', eventToken!.path, null);
    }
    return new HttpResponse(null, { status: 204 });
  }),

  // ─── 会员订阅前台与后台 ────────────────────────────────────────────────────
  mock(memberCmsContract.subscriptionStatus, ({ query, ok }) => {
    const resolved = resolveMockSubscriptionSubject({
      siteId: query.siteId,
      subjectType: query.subjectType,
      subjectId: query.subjectId ?? null,
      subjectKey: query.subjectKey ?? '',
    });
    if (!resolved) return notFound('订阅对象不存在或未开放', { status: 404 });
    const row = mockCmsSubscriptions.find((item) =>
      item.active
      && item.siteId === query.siteId
      && item.subjectType === query.subjectType
      && item.subjectKey === resolved.subjectKey);
    return ok(row ?? null);
  }),
  mock(memberCmsContract.subscriptions, ({ query, ok, paginate }) => {
    let list = mockCmsSubscriptions.filter((item) => item.memberId === 1 && item.active);
    if (query.subjectType) list = list.filter((item) => item.subjectType === query.subjectType);
    return ok(paginate(list));
  }),
  mock(memberCmsContract.subscribe, ({ body, ok }) => {
    const { siteId, subjectType } = body;
    const resolved = resolveMockSubscriptionSubject({
      siteId,
      subjectType,
      subjectId: body.subjectId ?? null,
      subjectKey: body.subjectKey ?? '',
    });
    if (!resolved) return notFound('订阅对象不存在或未开放', { status: 404 });
    const subjectKey = resolved.subjectKey;
    let row = mockCmsSubscriptions.find((item) =>
      item.memberId === 1 && item.siteId === siteId && item.subjectType === subjectType && item.subjectKey === subjectKey);
    if (!row) {
      row = {
        id: nextIdFrom(mockCmsSubscriptions),
        memberId: 1,
        memberDisplay: '演***员',
        siteId,
        siteName: mockCmsSites.find((site) => site.id === siteId)?.name ?? null,
        subjectType,
        subjectKey,
        subjectId: resolved.subjectId,
        subjectLabel: resolved.subjectLabel,
        notificationEnabled: body.notificationEnabled,
        active: true,
        pointsAwardedAt: mockDateTime(),
        createdAt: mockDateTime(),
        updatedAt: mockDateTime(),
      };
      mockCmsSubscriptions.push(row);
      awardedSubscriptionIds.add(row.id);
    } else {
      row.active = true;
      row.notificationEnabled = body.notificationEnabled;
      row.updatedAt = mockDateTime();
    }
    return ok(row, '订阅成功');
  }),
  mock(memberCmsContract.updateSubscription, ({ params, body, ok }) => {
    const row = mockCmsSubscriptions.find((item) => item.id === params.id && item.memberId === 1);
    if (!row) return notFound('订阅不存在', { status: 404 });
    row.notificationEnabled = body.notificationEnabled;
    row.updatedAt = mockDateTime();
    return ok(row, '订阅已更新');
  }),
  mock(memberCmsContract.cancelSubscription, ({ params, ok }) => {
    const row = mockCmsSubscriptions.find((item) => item.id === params.id && item.memberId === 1);
    if (!row) return notFound('订阅不存在', { status: 404 });
    row.active = false;
    row.updatedAt = mockDateTime();
    return ok(row, '已取消订阅');
  }),
  mock(cmsSubscriptionContract.aggregates, ({ query, ok }) => {
    const { siteId } = query;
    const groups = new Map<string, typeof mockCmsSubscriptions>();
    mockCmsSubscriptions.filter((item) => item.siteId === siteId && item.active).forEach((item) => {
      const key = `${item.subjectType}:${item.subjectKey}`;
      const rows = groups.get(key) ?? [];
      rows.push(item);
      groups.set(key, rows);
    });
    return ok([...groups.values()].map((rows) => ({
      siteId,
      subjectType: rows[0].subjectType,
      subjectKey: rows[0].subjectKey,
      subjectId: rows[0].subjectId,
      subjectLabel: rows[0].subjectLabel,
      subscriberCount: new Set(rows.map((item) => item.memberId)).size,
      notificationEnabledCount: new Set(rows.filter((item) => item.notificationEnabled).map((item) => item.memberId)).size,
    })));
  }),
  mock(cmsSubscriptionContract.list, ({ query, ok, paginate }) => {
    const { siteId, subjectType, subjectKeyword } = query;
    let list = mockCmsSubscriptions.filter((item) => item.siteId === siteId && item.active);
    if (subjectType) list = list.filter((item) => item.subjectType === subjectType);
    if (subjectKeyword) list = list.filter((item) => item.subjectLabel.includes(subjectKeyword));
    return ok(paginate(list));
  }),

  // ─── 页面区块 ACL / 展示条件安全更新 ──────────────────────────────────────
  mock(cmsPageContract.blockAcls, ({ params, ok }) => ok(mockCmsPageBlockAcls.filter((acl) => acl.pageId === params.id))),
  mock(cmsPageContract.setBlockAcls, ({ params, body, ok }) => {
    const pageId = params.id;
    const page = mockCmsPages.find((item) => item.id === pageId);
    if (!page) return notFound('页面不存在', { status: 404 });
    if (body.blockIds.some((blockId) => !page.blocks.some((block) => block.id === blockId))) {
      return notFound('所选页面区块包含不存在或已替换的 blockId', { status: 404 });
    }
    for (let index = mockCmsPageBlockAcls.length - 1; index >= 0; index -= 1) {
      if (mockCmsPageBlockAcls[index].pageId === pageId && body.blockIds.includes(mockCmsPageBlockAcls[index].blockId)) {
        mockCmsPageBlockAcls.splice(index, 1);
      }
    }
    body.blockIds.forEach((blockId) => body.grants.forEach((grant) => {
      mockCmsPageBlockAcls.push({
        id: nextIdFrom(mockCmsPageBlockAcls),
        pageId,
        blockId,
        ...grant,
        subjectName: grant.subjectType === 'role' ? `角色 #${grant.subjectId}` : `用户 #${grant.subjectId}`,
        createdAt: mockDateTime(),
      });
    }));
    page.blocks = page.blocks.map((block) => {
      if (!body.blockIds.includes(block.id)) return block;
      const canManage = body.grants.length === 0 || body.grants.some((grant) =>
        (grant.subjectType === 'user' && grant.subjectId === 1)
        || (grant.subjectType === 'role' && grant.subjectId === 1));
      return {
        ...block,
        aclConfigured: body.grants.length > 0,
        canManage,
        disabledReason: canManage ? null : '该区块已配置独立权限，当前用户未获授权',
      };
    });
    return ok(mockCmsPageBlockAcls.filter((acl) => acl.pageId === pageId), '区块权限已更新');
  }),
  mock(cmsPageContract.update, ({ params, body, ok }) => {
    const page = mockCmsPages.find((item) => item.id === params.id);
    if (!page) return notFound('页面不存在', { status: 404 });
    const { blocks: incoming, ...patch } = body;
    if (incoming) {
      const immutableBefore = page.blocks.filter((block) => block.canManage === false);
      const immutableIds = new Set(immutableBefore.map((block) => block.id));
      const immutableAfter = incoming.filter((block) => immutableIds.has(block.id));
      for (let index = 0; index < immutableBefore.length; index += 1) {
        const previous = immutableBefore[index];
        const next = immutableAfter[index];
        const comparable = { id: previous.id, type: previous.type, props: previous.props, displayCondition: previous.displayCondition };
        const nextComparable = next
          ? { id: next.id, type: next.type, props: next.props, displayCondition: next.displayCondition }
          : null;
        if (!nextComparable || JSON.stringify(comparable) !== JSON.stringify(nextComparable)) {
          return forbidden(`区块「${previous.id}」不可管理，禁止修改、删除、替换或重排`, { status: 403 });
        }
      }
      page.blocks = incoming.map((block) => ({ ...block, canManage: true, aclConfigured: false, disabledReason: null }));
      page.requiresDynamic = incoming.some((block) =>
        ['guest', 'member'].includes(block.displayCondition?.audience ?? 'always')
        || !!block.displayCondition?.startAt
        || !!block.displayCondition?.endAt);
    }
    Object.assign(page, patch, { updatedAt: mockDateTime() });
    return ok(page, '更新成功');
  }),
];

export { awardedSubscriptionIds as mockCmsSubscriptionPointAwards };
export function resetMockCmsAdEventTokens(): void {
  adEventTokens.clear();
  adEventDedupe.clear();
}
