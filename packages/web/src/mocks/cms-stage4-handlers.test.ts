import { afterEach, describe, expect, it } from 'vitest';
import {
  mockCmsAdEvents,
  mockCmsAds,
  mockCmsInteractions,
  mockCmsInteractionResponses,
  mockCmsPages,
  mockCmsSubscriptions,
} from '@/mocks/data/cms';
import {
  cmsStage4Handlers,
  mockCmsSubscriptionPointAwards,
  resetMockCmsAdEventTokens,
} from '@/mocks/handlers/cms-stage4';

const snapshots = {
  ads: structuredClone(mockCmsAds),
  adEvents: structuredClone(mockCmsAdEvents),
  interactions: structuredClone(mockCmsInteractions),
  responses: structuredClone(mockCmsInteractionResponses),
  subscriptions: structuredClone(mockCmsSubscriptions),
  pages: structuredClone(mockCmsPages),
  pointAwards: new Set(mockCmsSubscriptionPointAwards),
};

afterEach(() => {
  mockCmsAds.splice(0, mockCmsAds.length, ...structuredClone(snapshots.ads));
  mockCmsAdEvents.splice(0, mockCmsAdEvents.length, ...structuredClone(snapshots.adEvents));
  mockCmsInteractions.splice(0, mockCmsInteractions.length, ...structuredClone(snapshots.interactions));
  mockCmsInteractionResponses.splice(0, mockCmsInteractionResponses.length, ...structuredClone(snapshots.responses));
  mockCmsSubscriptions.splice(0, mockCmsSubscriptions.length, ...structuredClone(snapshots.subscriptions));
  mockCmsPages.splice(0, mockCmsPages.length, ...structuredClone(snapshots.pages));
  mockCmsSubscriptionPointAwards.clear();
  snapshots.pointAwards.forEach((id) => mockCmsSubscriptionPointAwards.add(id));
  resetMockCmsAdEventTokens();
});

async function call(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  for (const handler of cmsStage4Handlers) {
    const request = new Request(`${window.location.origin}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await (handler as unknown as {
      run(args: unknown): Promise<{ response?: Response } | null>;
    }).run({ request, requestId: `cms-stage4-${Math.random()}` });
    if (result?.response) {
      const contentType = result.response.headers.get('content-type') ?? '';
      return {
        status: result.response.status,
        body: contentType.includes('json') ? await result.response.json() : await result.response.text(),
      };
    }
  }
  throw new Error(`No handler matched ${method} ${path}`);
}

describe('CMS Stage 4 MSW handlers', () => {
  it('deduplicates ad impressions and exposes retention cleanup through task center', async () => {
    const beforeEvents = mockCmsAdEvents.length;
    const beforeViews = mockCmsAds[0].viewCount;
    const issued = await call('POST', '/api/public/cms/ads/tokens/main', {
      ads: [{ adId: 1, renderProof: 'demo-render-proof' }],
    });
    const viewToken = (issued.body as { data: Array<{ viewToken: string }> }).data[0].viewToken;
    await call('POST', '/api/public/cms/ads/view', { tokens: [viewToken] });
    const replay = await call('POST', '/api/public/cms/ads/view', { tokens: [viewToken] });
    expect(replay.status).toBe(409);
    expect(mockCmsAdEvents).toHaveLength(beforeEvents + 1);
    expect(mockCmsAds[0].viewCount).toBe(beforeViews + 1);

    const list = await call('GET', '/api/cms/ads/events?page=1&pageSize=20&siteId=1&eventType=impression');
    expect((list.body as { data: { total: number } }).data.total).toBeGreaterThan(0);
    const cleanup = await call('POST', '/api/cms/ads/events/cleanup', { siteId: 1, retentionDays: 180 });
    expect((cleanup.body as { data: { taskType: string } }).data.taskType).toBe('cms-ad-events-cleanup');
  });

  it('keeps subscription APIs idempotent, blocks IDOR and never re-awards first points', async () => {
    const payload = { siteId: 1, subjectType: 'author', subjectKey: '  管理员  ', notificationEnabled: true };
    const first = await call('POST', '/api/member/cms/subscriptions', payload);
    const second = await call('POST', '/api/member/cms/subscriptions', { ...payload, subjectKey: '管理员' });
    const firstId = (first.body as { data: { id: number } }).data.id;
    expect((second.body as { data: { id: number } }).data.id).toBe(firstId);
    expect(mockCmsSubscriptions.filter((item) => item.id === firstId)).toHaveLength(1);
    expect(mockCmsSubscriptionPointAwards.has(firstId)).toBe(true);

    mockCmsSubscriptions.push({
      ...structuredClone(mockCmsSubscriptions[0]),
      id: 9999,
      memberId: 2,
    });
    expect((await call('DELETE', '/api/member/cms/subscriptions/9999')).status).toBe(404);
  });

  it('enforces unified poll constraints, repeat policy, captcha and result visibility', async () => {
    const invalid = await call('POST', '/api/cms/interactions', {
      siteId: 1,
      code: 'invalid-poll',
      kind: 'poll',
      title: 'Invalid',
      questions: [{ label: 'Text', type: 'text', options: [] }],
    });
    expect(invalid.status).toBe(400);

    const interaction = mockCmsInteractions.find((item) => item.id === 2)!;
    interaction.captchaPolicy = 'math';
    const missingCaptcha = await call('POST', `/api/member/cms/interactions/${interaction.id}/submit`, {
      answers: { '4': 'page-builder' },
      idempotencyKey: 'stage4-captcha-1',
    });
    expect(missingCaptcha.status).toBe(400);
    const submitted = await call('POST', `/api/member/cms/interactions/${interaction.id}/submit`, {
      answers: { '4': 'page-builder' },
      captchaAnswer: '2',
      idempotencyKey: 'stage4-captcha-2',
    });
    expect(submitted.status).toBe(409);

    mockCmsInteractions.find((item) => item.code === 'satisfaction')!.resultVisibility = 'hidden';
    const state = await call('GET', '/api/public/cms/interactions/main/satisfaction');
    expect((state.body as { data: { resultsVisible: boolean } }).data.resultsVisible).toBe(false);

    const survey = mockCmsInteractions.find((item) => item.code === 'satisfaction')!;
    survey.resultVisibility = 'always';
    const publicState = await call('GET', '/api/public/cms/interactions/main/satisfaction');
    expect(JSON.stringify(publicState.body)).not.toContain('"texts"');
    expect((publicState.body as { data: { interaction: Record<string, unknown> } }).data.interaction)
      .not.toHaveProperty('responseCount');

    survey.captchaPolicy = 'turnstile';
    survey.turnstileSiteKey = 'demo-site-key';
    survey.turnstileSecretConfigured = true;
    const missingTurnstile = await call('POST', '/api/public/cms/interactions/main/satisfaction/submit', {
      answers: { '1': 'very-satisfied' },
      idempotencyKey: 'stage4-turnstile-missing',
    });
    expect(missingTurnstile.status).toBe(400);
  });

  it('rejects forged updates to read-only blocks and marks member conditions dynamic', async () => {
    const page = mockCmsPages[0];
    page.blocks[0].canManage = false;
    page.blocks[0].disabledReason = '未授权';
    const forged = await call('PUT', `/api/cms/pages/${page.id}`, {
      blocks: page.blocks.map((block, index) => index === 0
        ? { id: block.id, type: block.type, props: { title: 'forged' }, displayCondition: block.displayCondition }
        : { id: block.id, type: block.type, props: block.props, displayCondition: block.displayCondition }),
    });
    expect(forged.status).toBe(403);

    page.blocks[0].canManage = true;
    const updated = await call('PUT', `/api/cms/pages/${page.id}`, {
      blocks: page.blocks.map((block, index) => ({
        id: block.id,
        type: block.type,
        props: block.props,
        displayCondition: index === 0 ? { audience: 'member' } : block.displayCondition,
      })),
    });
    expect((updated.body as { data: { requiresDynamic: boolean } }).data.requiresDynamic).toBe(true);
  });
});
