import { http, HttpResponse } from 'msw';
import type {
  CmsInteraction,
  CmsInteractionQuestion,
  CmsInteractionResponse,
  CmsMemberSubscription,
  CmsPageBlock,
} from '@zenith/shared';
import {
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
  mockCmsPublishChannels,
  mockCmsSites,
  mockCmsSubscriptions,
} from '../data/cms';
import { mockDateTime } from '../utils/date';
import { createProgressingMockTask } from './async-tasks';

type Body = Record<string, unknown>;
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

function ok<T>(data: T, message = 'ok') {
  return HttpResponse.json({ code: 0, message, data });
}

function error(status: 400 | 401 | 403 | 404 | 409, message: string) {
  return HttpResponse.json({ code: status, message, data: null }, { status });
}

function paging(request: Request) {
  const url = new URL(request.url);
  return {
    url,
    page: Number(url.searchParams.get('page')) || 1,
    pageSize: Number(url.searchParams.get('pageSize')) || 10,
  };
}

function paginate<T>(list: T[], page: number, pageSize: number) {
  return {
    list: list.slice((page - 1) * pageSize, page * pageSize),
    total: list.length,
    page,
    pageSize,
  };
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

function interactionStats(interaction: CmsInteraction) {
  const responses = mockCmsInteractionResponses.filter((response) => response.interactionId === interaction.id);
  return {
    interactionId: interaction.id,
    responseCount: responses.length,
    questions: (interaction.questions ?? []).map((question) => {
      if (question.type === 'text') {
        return {
          id: question.id,
          label: question.label,
          type: question.type,
          options: [],
          texts: responses
            .map((response) => response.answers[String(question.id)])
            .filter((value): value is string => typeof value === 'string')
            .slice(0, 50),
        };
      }

      const answered = responses.filter((response) => response.answers[String(question.id)] !== undefined);
      return {
        id: question.id,
        label: question.label,
        type: question.type,
        options: question.options.map((option) => {
          const count = answered.filter((response) => {
            const value = response.answers[String(question.id)];
            return Array.isArray(value) ? value.includes(option.value) : value === option.value;
          }).length;
          return {
            ...option,
            count,
            percent: answered.length ? Math.round((count / answered.length) * 1000) / 10 : 0,
          };
        }),
        texts: [],
      };
    }),
  };
}

function publicInteractionStats(interaction: CmsInteraction) {
  const stats = interactionStats(interaction);
  return {
    ...stats,
    questions: stats.questions.map(({ texts: _texts, ...question }) => question),
  };
}

function normalizeQuestions(interactionId: number, raw: unknown): CmsInteractionQuestion[] {
  return (Array.isArray(raw) ? raw : []).map((item, index) => {
    const question = item as Partial<CmsInteractionQuestion>;
    return {
      id: question.id ?? interactionId * 100 + index + 1,
      interactionId,
      label: String(question.label ?? ''),
      type: question.type ?? 'single',
      required: question.required ?? true,
      options: question.options?.map((option) => ({ ...option })) ?? [],
      minChoices: question.minChoices ?? (question.required ? 1 : 0),
      maxChoices: question.type === 'single' ? 1 : (question.maxChoices ?? 1),
      sort: question.sort ?? index,
    };
  });
}

function publicInteractionState(interaction: CmsInteraction, member: boolean) {
  const responses = mockCmsInteractionResponses.filter((response) => response.interactionId === interaction.id);
  const submitted = responses.some((response) => member ? response.memberId === 1 : response.memberId === null);
  const resultsVisible = interaction.resultVisibility === 'always'
    || (interaction.resultVisibility === 'after_submit' && submitted)
    || (interaction.resultVisibility === 'after_close' && interaction.status === 'closed');
  const {
    responseCount: _responseCount,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    turnstileSecretConfigured: _turnstileSecretConfigured,
    turnstileSiteKey: _turnstileSiteKey,
    ...publicInteraction
  } = interaction;
  const captcha = interaction.captchaPolicy === 'turnstile'
    ? { provider: 'turnstile', siteKey: interaction.turnstileSiteKey }
    : interaction.captchaPolicy === 'math'
      ? { provider: 'math', siteKey: null }
      : { provider: 'none', siteKey: null };
  return {
    interaction: publicInteraction,
    open: interaction.status === 'published',
    submitted,
    captchaRequired: captcha.provider !== 'none',
    captcha,
    resultsVisible,
    results: resultsVisible ? publicInteractionStats(interaction) : null,
  };
}

function submitInteraction(
  interaction: CmsInteraction,
  body: Body,
  member: boolean,
): ReturnType<typeof ok> {
  if (interaction.status !== 'published') return error(400, '互动问卷未开放') as ReturnType<typeof ok>;
  if (interaction.participantScope === 'member' && !member) return error(401, '该互动仅限会员参与') as ReturnType<typeof ok>;
  if (interaction.captchaPolicy === 'math' && !String(body.captchaAnswer ?? '').trim()) {
    return error(400, '验证码错误或已过期，请重试') as ReturnType<typeof ok>;
  }
  if (interaction.captchaPolicy === 'turnstile' && !String(body.turnstileToken ?? '').trim()) {
    return error(400, '验证码验证失败，请重试') as ReturnType<typeof ok>;
  }
  const idempotencyKey = String(body.idempotencyKey ?? '');
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
  if (duplicate && interaction.repeatPolicy !== 'multiple') return error(409, '您已参与过本次互动') as ReturnType<typeof ok>;
  const response: CmsInteractionResponse = {
    id: getNextCmsInteractionResponseId(),
    interactionId: interaction.id,
    interactionTitle: interaction.title,
    kind: interaction.kind,
    memberId: member ? 1 : null,
    memberDisplay: member ? '演***员' : '游客',
    visitorHash: 'demo-visitor-hash',
    ipHash: 'demo-ip-hash',
    answers: (body.answers as Record<string, string | string[]>) ?? {},
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

export const cmsStage4Handlers = [
  http.post('/api/cms/contents/:id/publish', ({ params }) => {
    const content = mockCmsContents.find((item) => item.id === Number(params.id));
    if (!content) return error(404, '内容不存在');
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
  http.get('/api/cms/interactions/responses', ({ request }) => {
    const { url, page, pageSize } = paging(request);
    const siteId = Number(url.searchParams.get('siteId'));
    const kind = url.searchParams.get('kind');
    const start = url.searchParams.get('startTime');
    const end = url.searchParams.get('endTime');
    const interactionIds = new Set(mockCmsInteractions
      .filter((interaction) => interaction.siteId === siteId && (!kind || interaction.kind === kind))
      .map((interaction) => interaction.id));
    let list = mockCmsInteractionResponses.filter((response) => interactionIds.has(response.interactionId));
    if (start) list = list.filter((response) => response.createdAt >= start);
    if (end) list = list.filter((response) => response.createdAt <= end);
    return ok(paginate(list, page, pageSize));
  }),
  http.get('/api/cms/interactions/:id/stats', ({ params }) => {
    const interaction = mockCmsInteractions.find((item) => item.id === Number(params.id));
    return interaction ? ok(interactionStats(interaction)) : error(404, '互动问卷不存在');
  }),
  http.get('/api/cms/interactions/:id', ({ params }) => {
    const interaction = mockCmsInteractions.find((item) => item.id === Number(params.id));
    return interaction ? ok(interaction) : error(404, '互动问卷不存在');
  }),
  http.get('/api/cms/interactions', ({ request }) => {
    const { url, page, pageSize } = paging(request);
    const siteId = Number(url.searchParams.get('siteId'));
    const keyword = url.searchParams.get('keyword')?.trim() ?? '';
    const kind = url.searchParams.get('kind');
    const status = url.searchParams.get('status');
    let list = mockCmsInteractions.filter((interaction) => interaction.siteId === siteId);
    if (keyword) list = list.filter((interaction) => interaction.title.includes(keyword) || interaction.code.includes(keyword));
    if (kind) list = list.filter((interaction) => interaction.kind === kind);
    if (status) list = list.filter((interaction) => interaction.status === status);
    return ok(paginate(list, page, pageSize));
  }),
  http.post('/api/cms/interactions', async ({ request }) => {
    const body = await request.json() as Body;
    const id = getNextCmsInteractionId();
    const questions = normalizeQuestions(id, body.questions);
    if (body.kind === 'poll' && (questions.length !== 1 || questions[0]?.type === 'text')) {
      return error(400, '投票必须且只能包含一道选择题');
    }
    if (body.repeatPolicy === 'once_per_member' && body.participantScope !== 'member') {
      return error(400, '每位会员一次仅适用于仅会员参与');
    }
    const interaction: CmsInteraction = {
      id,
      siteId: Number(body.siteId),
      code: String(body.code ?? ''),
      kind: body.kind === 'poll' ? 'poll' : 'survey',
      title: String(body.title ?? ''),
      description: body.description ? String(body.description) : null,
      status: (body.status as CmsInteraction['status']) ?? 'draft',
      participantScope: (body.participantScope as CmsInteraction['participantScope']) ?? 'anonymous',
      repeatPolicy: (body.repeatPolicy as CmsInteraction['repeatPolicy']) ?? 'once_per_ip',
      resultVisibility: (body.resultVisibility as CmsInteraction['resultVisibility']) ?? 'after_submit',
      captchaPolicy: (body.captchaPolicy as CmsInteraction['captchaPolicy']) ?? 'inherit',
      turnstileSiteKey: body.turnstileSiteKey ? String(body.turnstileSiteKey) : null,
      turnstileSecretConfigured: !!body.turnstileSecret,
      thankYouMessage: String(body.thankYouMessage ?? '感谢您的参与！'),
      startAt: body.startAt ? String(body.startAt) : null,
      endAt: body.endAt ? String(body.endAt) : null,
      responseCount: 0,
      questions,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockCmsInteractions.unshift(interaction);
    return ok(interaction, '创建成功');
  }),
  http.put('/api/cms/interactions/:id', async ({ params, request }) => {
    const interaction = mockCmsInteractions.find((item) => item.id === Number(params.id));
    if (!interaction) return error(404, '互动问卷不存在');
    const body = await request.json() as Body;
    if (body.questions && interaction.responseCount > 0) return error(409, '已有答卷，不可替换题目');
    const { turnstileSecret, ...safeBody } = body;
    Object.assign(interaction, safeBody, {
      turnstileSecretConfigured: turnstileSecret ? true : interaction.turnstileSecretConfigured,
      questions: body.questions ? normalizeQuestions(interaction.id, body.questions) : interaction.questions,
      updatedAt: mockDateTime(),
    });
    return ok(interaction, '更新成功');
  }),
  http.post('/api/cms/interactions/:id/status', async ({ params, request }) => {
    const interaction = mockCmsInteractions.find((item) => item.id === Number(params.id));
    if (!interaction) return error(404, '互动问卷不存在');
    const body = await request.json() as { status: CmsInteraction['status'] };
    interaction.status = body.status;
    interaction.updatedAt = mockDateTime();
    return ok(interaction, '状态已更新');
  }),
  http.post('/api/cms/interactions/batch/status', async ({ request }) => {
    const body = await request.json() as { ids: number[]; status: 'published' | 'closed' };
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
  http.delete('/api/cms/interactions/:id', ({ params }) => {
    const index = mockCmsInteractions.findIndex((item) => item.id === Number(params.id));
    if (index < 0) return error(404, '互动问卷不存在');
    const [removed] = mockCmsInteractions.splice(index, 1);
    for (let responseIndex = mockCmsInteractionResponses.length - 1; responseIndex >= 0; responseIndex -= 1) {
      if (mockCmsInteractionResponses[responseIndex].interactionId === removed.id) mockCmsInteractionResponses.splice(responseIndex, 1);
    }
    return ok(null, '删除成功');
  }),

  // ─── 统一互动问卷公开/会员提交 ──────────────────────────────────────────────
  http.get('/api/public/cms/interactions/:siteCode/:code', ({ params, request }) => {
    const site = mockCmsSites.find((item) => item.code === params.siteCode);
    const interaction = site && mockCmsInteractions.find((item) => item.siteId === site.id && item.code === params.code && item.status !== 'draft');
    if (!interaction) return error(404, '互动问卷不存在');
    return ok(publicInteractionState(interaction, request.headers.has('authorization')));
  }),
  http.post('/api/public/cms/interactions/:siteCode/:code/submit', async ({ params, request }) => {
    const site = mockCmsSites.find((item) => item.code === params.siteCode);
    const interaction = site && mockCmsInteractions.find((item) => item.siteId === site.id && item.code === params.code);
    if (!interaction) return error(404, '互动问卷不存在');
    return submitInteraction(interaction, await request.json() as Body, request.headers.has('authorization'));
  }),
  http.post('/api/member/cms/interactions/:id/submit', async ({ params, request }) => {
    const interaction = mockCmsInteractions.find((item) => item.id === Number(params.id));
    if (!interaction) return error(404, '互动问卷不存在');
    return submitInteraction(interaction, await request.json() as Body, true);
  }),

  // ─── 广告事件明细/统计/清理与公开采集 ─────────────────────────────────────
  http.get('/api/cms/ads/events/stats', ({ request }) => {
    const url = new URL(request.url);
    const siteId = Number(url.searchParams.get('siteId'));
    const list = mockCmsAdEvents.filter((event) => event.siteId === siteId);
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
  http.get('/api/cms/ads/events', ({ request }) => {
    const { url, page, pageSize } = paging(request);
    let list = mockCmsAdEvents.filter((event) => event.siteId === Number(url.searchParams.get('siteId')));
    const numericFilters = ['adId', 'slotId', 'publishChannelId'] as const;
    numericFilters.forEach((key) => {
      const value = Number(url.searchParams.get(key));
      if (value) list = list.filter((event) => event[key] === value);
    });
    const eventType = url.searchParams.get('eventType');
    const device = url.searchParams.get('device');
    const start = url.searchParams.get('startTime');
    const end = url.searchParams.get('endTime');
    if (eventType) list = list.filter((event) => event.eventType === eventType);
    if (device) list = list.filter((event) => event.device === device);
    if (start) list = list.filter((event) => event.occurredAt >= start);
    if (end) list = list.filter((event) => event.occurredAt <= end);
    return ok(paginate(list, page, pageSize));
  }),
  http.post('/api/cms/ads/events/cleanup', async ({ request }) => {
    const body = await request.json() as { siteId?: number; retentionDays?: number };
    return ok(createProgressingMockTask({
      taskType: 'cms-ad-events-cleanup',
      title: `CMS 广告事件清理（保留 ${body.retentionDays ?? 180} 天）`,
      payload: body,
      totalItems: Math.max(1, mockCmsAdEvents.filter((event) => !body.siteId || event.siteId === body.siteId).length),
    }), '清理任务已提交');
  }),
  http.post('/api/public/cms/ads/tokens/:siteCode', async ({ params, request }) => {
    const site = mockCmsSites.find((item) => item.code === params.siteCode && item.status === 'enabled');
    if (!site) return error(404, '站点不存在或未启用');
    const body = await request.json() as { ads?: Array<{ adId: number; renderProof: string }> };
    const requests = body.ads ?? [];
    if (requests.some((item) => !item.renderProof)) return error(403, '广告渲染凭证无效');
    const path = '/news/';
    const data = [...new Map(requests.map((item) => [item.adId, item])).values()].flatMap(({ adId: id }) => {
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
    if (!eventToken) return error(409, '广告事件令牌无效或已使用');
    if (!ad?.linkUrl || (!ad.linkUrl.startsWith('/') && !/^https?:\/\//i.test(ad.linkUrl))) {
      return new HttpResponse('广告不存在或未投放', { status: 404 });
    }
    const bucket = Math.floor(Date.now() / 10_000);
    const key = `click:${ad.id}:${bucket}`;
    if (!adEventDedupe.has(key)) {
      adEventDedupe.add(key);
      const seed = mockCmsAdEvents.find((event) => event.adId === ad.id);
      mockCmsAdEvents.unshift({
        id: getNextCmsAdEventId(),
        siteId: seed?.siteId ?? 1,
        adId: ad.id,
        adName: ad.name,
        slotId: ad.slotId,
        slotName: seed?.slotName ?? null,
        eventType: 'click',
        occurredAt: mockDateTime(),
        visitorHash: 'demo-visitor-hash',
        ipHash: 'demo-ip-hash',
        userAgent: 'MSW Demo',
        device: 'pc',
        referrer: request.headers.get('referer'),
        path: eventToken.path,
        publishChannelId: 1,
        publishChannelName: mockCmsPublishChannels[0]?.name ?? null,
        memberId: null,
      });
      ad.clickCount += 1;
    }
    return HttpResponse.redirect(new URL(ad.linkUrl, request.url).toString(), 302);
  }),
  http.post('/api/public/cms/ads/view', async ({ request }) => {
    const body = await request.json() as { tokens?: string[] };
    const eventTokens = (body.tokens ?? []).map((token) => consumeDemoAdToken(token, 'impression'));
    if (eventTokens.length === 0 || eventTokens.some((token) => !token)) {
      return error(409, '广告事件令牌无效或已使用');
    }
    const bucket = Math.floor(Date.now() / 60_000);
    for (const eventToken of eventTokens) {
      const id = eventToken!.adId;
      const ad = mockCmsAds.find((item) => item.id === id && item.status === 'enabled');
      if (!ad) continue;
      const key = `impression:${id}:${bucket}`;
      if (adEventDedupe.has(key)) continue;
      adEventDedupe.add(key);
      const slot = mockCmsAdEvents.find((event) => event.adId === id);
      mockCmsAdEvents.unshift({
        id: getNextCmsAdEventId(),
        siteId: slot?.siteId ?? 1,
        adId: id,
        adName: ad.name,
        slotId: ad.slotId,
        slotName: slot?.slotName ?? null,
        eventType: 'impression',
        occurredAt: mockDateTime(),
        visitorHash: 'demo-visitor-hash',
        ipHash: 'demo-ip-hash',
        userAgent: 'MSW Demo',
        device: 'pc',
        referrer: null,
        path: eventToken!.path,
        publishChannelId: 1,
        publishChannelName: mockCmsPublishChannels[0]?.name ?? null,
        memberId: null,
      });
      ad.viewCount += 1;
    }
    return new HttpResponse(null, { status: 204 });
  }),

  // ─── 会员订阅前台与后台 ────────────────────────────────────────────────────
  http.get('/api/member/cms/subscriptions/status', ({ request }) => {
    const url = new URL(request.url);
    const resolved = resolveMockSubscriptionSubject({
      siteId: Number(url.searchParams.get('siteId')),
      subjectType: url.searchParams.get('subjectType') as CmsMemberSubscription['subjectType'],
      subjectId: url.searchParams.get('subjectId') ? Number(url.searchParams.get('subjectId')) : null,
      subjectKey: String(url.searchParams.get('subjectKey') ?? ''),
    });
    if (!resolved) return error(404, '订阅对象不存在或未开放');
    const row = mockCmsSubscriptions.find((item) =>
      item.active
      && item.siteId === Number(url.searchParams.get('siteId'))
      && item.subjectType === url.searchParams.get('subjectType')
      && item.subjectKey === resolved.subjectKey);
    return ok(row ?? null);
  }),
  http.get('/api/member/cms/subscriptions', ({ request }) => {
    const { url, page, pageSize } = paging(request);
    const type = url.searchParams.get('subjectType');
    let list = mockCmsSubscriptions.filter((item) => item.memberId === 1 && item.active);
    if (type) list = list.filter((item) => item.subjectType === type);
    return ok(paginate(list, page, pageSize));
  }),
  http.post('/api/member/cms/subscriptions', async ({ request }) => {
    const body = await request.json() as Body;
    const siteId = Number(body.siteId);
    const subjectType = body.subjectType as CmsMemberSubscription['subjectType'];
    const subjectId = body.subjectId ? Number(body.subjectId) : null;
    const rawKey = String(body.subjectKey ?? '');
    const resolved = resolveMockSubscriptionSubject({ siteId, subjectType, subjectId, subjectKey: rawKey });
    if (!resolved) return error(404, '订阅对象不存在或未开放');
    const subjectKey = resolved.subjectKey;
    let row = mockCmsSubscriptions.find((item) =>
      item.memberId === 1 && item.siteId === siteId && item.subjectType === subjectType && item.subjectKey === subjectKey);
    if (!row) {
      row = {
        id: Math.max(0, ...mockCmsSubscriptions.map((item) => item.id)) + 1,
        memberId: 1,
        memberDisplay: '演***员',
        siteId,
        siteName: mockCmsSites.find((site) => site.id === siteId)?.name ?? null,
        subjectType,
        subjectKey,
        subjectId: resolved.subjectId,
        subjectLabel: resolved.subjectLabel,
        notificationEnabled: body.notificationEnabled !== false,
        active: true,
        pointsAwardedAt: mockDateTime(),
        createdAt: mockDateTime(),
        updatedAt: mockDateTime(),
      };
      mockCmsSubscriptions.push(row);
      awardedSubscriptionIds.add(row.id);
    } else {
      row.active = true;
      row.notificationEnabled = body.notificationEnabled !== false;
      row.updatedAt = mockDateTime();
    }
    return ok(row, '订阅成功');
  }),
  http.put('/api/member/cms/subscriptions/:id', async ({ params, request }) => {
    const row = mockCmsSubscriptions.find((item) => item.id === Number(params.id) && item.memberId === 1);
    if (!row) return error(404, '订阅不存在');
    const body = await request.json() as { notificationEnabled: boolean };
    row.notificationEnabled = body.notificationEnabled;
    row.updatedAt = mockDateTime();
    return ok(row, '订阅已更新');
  }),
  http.delete('/api/member/cms/subscriptions/:id', ({ params }) => {
    const row = mockCmsSubscriptions.find((item) => item.id === Number(params.id) && item.memberId === 1);
    if (!row) return error(404, '订阅不存在');
    row.active = false;
    row.updatedAt = mockDateTime();
    return ok(row, '已取消订阅');
  }),
  http.get('/api/cms/subscriptions/aggregates', ({ request }) => {
    const url = new URL(request.url);
    const siteId = Number(url.searchParams.get('siteId'));
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
  http.get('/api/cms/subscriptions', ({ request }) => {
    const { url, page, pageSize } = paging(request);
    const siteId = Number(url.searchParams.get('siteId'));
    const type = url.searchParams.get('subjectType');
    const keyword = url.searchParams.get('subjectKeyword') ?? '';
    let list = mockCmsSubscriptions.filter((item) => item.siteId === siteId && item.active);
    if (type) list = list.filter((item) => item.subjectType === type);
    if (keyword) list = list.filter((item) => item.subjectLabel.includes(keyword));
    return ok(paginate(list, page, pageSize));
  }),

  // ─── 页面区块 ACL / 展示条件安全更新 ──────────────────────────────────────
  http.get('/api/cms/pages/:id/block-acls', ({ params }) => {
    return ok(mockCmsPageBlockAcls.filter((acl) => acl.pageId === Number(params.id)));
  }),
  http.put('/api/cms/pages/:id/block-acls', async ({ params, request }) => {
    const pageId = Number(params.id);
    const page = mockCmsPages.find((item) => item.id === pageId);
    if (!page) return error(404, '页面不存在');
    const body = await request.json() as {
      blockIds: string[];
      grants: Array<{ subjectType: 'user' | 'role'; subjectId: number }>;
    };
    if (body.blockIds.some((blockId) => !page.blocks.some((block) => block.id === blockId))) {
      return error(404, '所选页面区块包含不存在或已替换的 blockId');
    }
    for (let index = mockCmsPageBlockAcls.length - 1; index >= 0; index -= 1) {
      if (mockCmsPageBlockAcls[index].pageId === pageId && body.blockIds.includes(mockCmsPageBlockAcls[index].blockId)) {
        mockCmsPageBlockAcls.splice(index, 1);
      }
    }
    body.blockIds.forEach((blockId) => body.grants.forEach((grant) => {
      mockCmsPageBlockAcls.push({
        id: Math.max(0, ...mockCmsPageBlockAcls.map((item) => item.id)) + 1,
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
  http.put('/api/cms/pages/:id', async ({ params, request }) => {
    const page = mockCmsPages.find((item) => item.id === Number(params.id));
    if (!page) return error(404, '页面不存在');
    const body = await request.json() as Body;
    const incoming = Array.isArray(body.blocks) ? body.blocks as CmsPageBlock[] : null;
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
          return error(403, `区块「${previous.id}」不可管理，禁止修改、删除、替换或重排`);
        }
      }
      body.blocks = incoming.map((block) => ({ ...block, canManage: true, aclConfigured: false, disabledReason: null }));
      body.requiresDynamic = incoming.some((block) =>
        ['guest', 'member'].includes(block.displayCondition?.audience ?? 'always')
        || !!block.displayCondition?.startAt
        || !!block.displayCondition?.endAt);
    }
    Object.assign(page, body, { updatedAt: mockDateTime() });
    return ok(page, '更新成功');
  }),
];

export { awardedSubscriptionIds as mockCmsSubscriptionPointAwards };
export function resetMockCmsAdEventTokens(): void {
  adEventTokens.clear();
  adEventDedupe.clear();
}
