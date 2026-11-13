// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SurveyQuestion, SurveyState } from './api';
import { mountSurvey } from './index';
import { flush, html, setMemberToken, stubFetch } from '../test-utils';

const BOX = '<div class="cms-interaction" data-island="survey" data-site="main" data-site-id="1" data-code="feedback" data-member-submit-api="/api/member/cms/interactions/9/submit"></div>';

const opt = (value: string, label: string) => ({ id: value, value, label });

function question(partial: Partial<SurveyQuestion> & Pick<SurveyQuestion, 'id' | 'type' | 'label'>): SurveyQuestion {
  return {
    interactionId: 9, required: false, options: [], minChoices: 1, maxChoices: 1, sort: partial.id,
    allowOther: false, otherLabel: null, ratingMax: 5, matrixRows: [], pageNo: 1, visibleWhen: null,
    ...partial,
  };
}

function state(overrides: Partial<SurveyState> = {}, questions: SurveyQuestion[] = []): SurveyState {
  return {
    interaction: {
      id: 9, siteId: 1, code: 'feedback', kind: 'survey', title: '反馈', description: null, status: 'published',
      participantScope: 'anonymous', repeatPolicy: 'once_per_ip', resultVisibility: 'after_submit', captchaPolicy: 'none',
      thankYouMessage: '感谢', startAt: null, endAt: null, questions,
    },
    open: true,
    submitted: false,
    captchaRequired: false,
    captcha: { provider: 'none', siteKey: null },
    resultsVisible: false,
    results: null,
    ...overrides,
  };
}

const RESULTS = {
  interactionId: 9,
  responseCount: 12,
  questions: [
    { id: 1, label: '最常用功能', type: 'single' as const, options: [{ ...opt('a', '搜索'), count: 8, percent: 66.7 }, { ...opt('b', '导出'), count: 4, percent: 33.3 }], average: null, npsScore: null },
    { id: 2, label: '推荐意愿', type: 'nps' as const, options: [], average: 8.2, npsScore: 45 },
    { id: 3, label: '建议', type: 'text' as const, options: [], average: null, npsScore: null },
  ],
};

async function mount(server: SurveyState, extraResponses: unknown[] = []) {
  const stub = stubFetch([{ code: 0, data: server }, ...extraResponses]);
  const el = html(BOX).querySelector<HTMLElement>('.cms-interaction')!;
  Element.prototype.scrollIntoView = vi.fn();
  mountSurvey(el);
  await flush();
  return { el, ...stub, form: () => el.querySelector<HTMLFormElement>('form.interaction-form') };
}

describe('survey island', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('状态请求失败时不暴露可提交表单', async () => {
    const stub = stubFetch([{ code: 404 }]);
    const el = html(BOX).querySelector<HTMLElement>('.cms-interaction')!;
    mountSurvey(el);
    await flush();
    expect(stub.calls[0].url).toBe('/api/public/cms/interactions/main/feedback');
    expect(el.querySelector('form')).toBeNull();
  });

  it('公开结果不暴露可填写的文本表单', async () => {
    const { el } = await mount(state({ open: false, resultsVisible: true, results: RESULTS }));
    expect(el.querySelector('textarea')).toBeNull();
    expect(el.querySelector('form')).toBeNull();
  });

  it('已提交且结果可见（非多次）：展示结果而不是表单', async () => {
    const { form } = await mount(state({ submitted: true, resultsVisible: true, results: RESULTS }));
    expect(form()).toBeNull();
  });

  it('仅限会员且未登录：提示登录，不渲染表单', async () => {
    const server = state({}, [question({ id: 1, type: 'text', label: '建议' })]);
    server.interaction.participantScope = 'member';
    const { el, form } = await mount(server);
    expect(form()).toBeNull();
    expect(el.querySelector('a')!.getAttribute('href')).toBe('/member.html#/');
  });

  it('题目文案不会被当作 HTML 解析', async () => {
    const { form } = await mount(state({}, [question({ id: 1, type: 'single', label: '<img src=x onerror=alert(1)>', options: [opt('v', '<b>粗</b>')] })]));
    const f = form()!;
    expect(f.querySelector('img')).toBeNull();
    expect(f.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(f.querySelector('b')).toBeNull();
  });

  it('提交答案排除条件不匹配的问题，并保留匹配的问题', async () => {
    const questions = [
      question({ id: 1, type: 'single', label: '用过吗', options: [opt('yes', '是'), opt('no', '否')] }),
      question({ id: 2, type: 'text', label: '哪里好', visibleWhen: { questionIndex: 0, op: 'any', values: ['yes'] } }),
      question({ id: 3, type: 'text', label: '为何不用', visibleWhen: { questionIndex: 0, op: 'none', values: ['yes'] } }),
    ];
    const { form, calls } = await mount(state({}, questions), [{ code: 0, data: { responseId: 1, duplicate: false, message: '', results: null } }]);
    const f = form()!;
    f.querySelector<HTMLTextAreaElement>('textarea[name=q_2]')!.value = '可见答案';
    f.querySelector<HTMLTextAreaElement>('textarea[name=q_3]')!.value = '不应提交的答案';
    const yes = f.querySelector<HTMLInputElement>('input[name=q_1][value=yes]')!;
    yes.checked = true;
    yes.dispatchEvent(new Event('change', { bubbles: true }));
    f.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(calls[1].body).toMatchObject({ answers: { '1': 'yes', '2': '可见答案' } });
    expect((calls[1].body as { answers: Record<string, unknown> }).answers).not.toHaveProperty('3');
  });

  it('提交前校验所有页面的必填答案，完整时按原始问题 ID 提交', async () => {
    const questions = [
      question({ id: 1, type: 'single', label: '第一页必答', required: true, options: [opt('a', 'A')], pageNo: 1 }),
      question({ id: 2, type: 'text', label: '第二页必答', required: true, pageNo: 2 }),
    ];
    const { form, calls } = await mount(state({}, questions), [{ code: 0, data: { responseId: 1, duplicate: false, message: '', results: null } }]);
    const f = form()!;
    f.querySelector<HTMLTextAreaElement>('textarea[name=q_2]')!.value = 'ok';
    f.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(0);
    f.querySelector<HTMLInputElement>('input[name=q_1]')!.checked = true;
    f.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(calls[1].body).toMatchObject({ answers: { '1': 'a', '2': 'ok' } });
  });

  it('拒绝选项数不足和未填写的其他答案，合法后才提交', async () => {
    const questions = [question({ id: 1, type: 'multiple', label: '多选', required: true, options: [opt('x', 'X'), opt('y', 'Y'), opt('z', 'Z')], minChoices: 2, maxChoices: 2, allowOther: true })];
    const { form, calls } = await mount(state({}, questions), [{ code: 0, data: { responseId: 1, duplicate: false, message: '', results: null } }]);
    const f = form()!;
    const boxes = [...f.querySelectorAll<HTMLInputElement>('input[name=q_1]')];
    boxes[0].checked = true;
    f.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(0);
    const other = boxes.find(box => box.value === '__other__')!;
    other.checked = true;
    other.dispatchEvent(new Event('change', { bubbles: true }));
    f.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(0);
    f.querySelector<HTMLInputElement>('input[name=q_1_other]')!.value = '自定义';
    f.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(calls[1].body).toMatchObject({ answers: { '1': ['x', '__other__:自定义'] } });
  });

  it('游客提交使用公开接口并携带各题答案与 idempotencyKey', async () => {
    const questions = [
      question({ id: 1, type: 'single', label: '单选', options: [opt('a', 'A')], allowOther: true }),
      question({ id: 2, type: 'multiple', label: '多选', options: [opt('x', 'X'), opt('y', 'Y')], maxChoices: 2 }),
      question({ id: 3, type: 'matrix', label: '矩阵', options: [opt('good', '好')], matrixRows: [{ id: 'r1', label: '速度' }] }),
      question({ id: 4, type: 'number', label: '数字' }),
    ];
    const { el, form, calls } = await mount(state({}, questions), [{ code: 0, data: { responseId: 1, duplicate: false, message: '感谢参与', results: RESULTS } }]);
    const f = form()!;
    const other = f.querySelector<HTMLInputElement>('input[name="q_1"][value="__other__"]')!;
    other.checked = true;
    other.dispatchEvent(new Event('change', { bubbles: true }));
    f.querySelector<HTMLInputElement>('input[name="q_1_other"]')!.value = ' 自定义 ';
    for (const b of f.querySelectorAll<HTMLInputElement>('input[name="q_2"]')) b.checked = true;
    f.querySelector<HTMLInputElement>('input[name="q_3_r1"]')!.checked = true;
    f.querySelector<HTMLInputElement>('input[name="q_4"]')!.value = '42';
    f.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(calls[1]).toMatchObject({ url: '/api/public/cms/interactions/main/feedback/submit', method: 'POST' });
    expect(calls[1].headers.Authorization).toBeUndefined();
    const body = calls[1].body as { answers: Record<string, unknown>; idempotencyKey: string };
    expect(body.answers).toEqual({ '1': '__other__:自定义', '2': ['x', 'y'], '3': ['r1::good'], '4': '42' });
    expect(body.idempotencyKey).toMatch(/^[a-z0-9]{10,}$/);
    expect(el.querySelector('form')).toBeNull();
  });

  it('会员提交使用容器声明的会员接口与鉴权头', async () => {
    setMemberToken('mtk');
    const { el, calls } = await mount(state({}, [question({ id: 1, type: 'text', label: '建议' })]), [{ code: 0, data: { responseId: 2, duplicate: false, message: '已收到', results: null } }]);
    const f = el.querySelector('form')!;
    f.querySelector<HTMLTextAreaElement>('textarea')!.value = 'hi';
    f.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(calls[0].headers.Authorization).toBe('Bearer mtk');
    expect(calls[1]).toMatchObject({ url: '/api/member/cms/interactions/9/submit', method: 'POST' });
    expect(calls[1].headers.Authorization).toBe('Bearer mtk');
  });

  it('缺少验证码时不提交，验证码失败后换取新的 captchaId', async () => {
    const server = state({ captchaRequired: true, captcha: { provider: 'math', siteKey: null } }, [question({ id: 1, type: 'text', label: '建议' })]);
    const { form, calls } = await mount(server, [
      { code: 0, data: { id: 'cap1', svg: '<svg/>' } },   // 首次验证码
      { code: 400, message: '验证码错误' },                 // 提交
      { code: 0, data: { id: 'cap2', svg: '<svg/>' } },   // 重取验证码
    ]);
    await flush();
    const f = form()!;
    expect(f.querySelector<HTMLInputElement>('[name=captchaId]')!.value).toBe('cap1');
    f.querySelector<HTMLTextAreaElement>('textarea')!.value = 'x';
    // 未填验证码：本地拦截
    f.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(0);
    f.querySelector<HTMLInputElement>('[name=captchaAnswer]')!.value = '7';
    f.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    const submitCall = calls.find((c) => c.url.endsWith('/submit'))!;
    expect(submitCall.body).toMatchObject({ captchaId: 'cap1', captchaAnswer: '7' });
    expect(f.querySelector<HTMLInputElement>('[name=captchaId]')!.value).toBe('cap2');
  });

  it('允许多次参与，每次提交只携带本次填写的答案', async () => {
    const server = state({}, [question({ id: 1, type: 'text', label: '建议' })]);
    server.interaction.repeatPolicy = 'multiple';
    const accepted = { code: 0, data: { responseId: 3, duplicate: false, message: '', results: null } };
    const { form, calls } = await mount(server, [accepted, accepted]);
    const f = form()!;
    f.querySelector<HTMLTextAreaElement>('textarea')!.value = '第一次';
    f.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    f.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    const bodies = calls.filter(call => call.method === 'POST').map(call => call.body);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ answers: { '1': '第一次' } });
    expect(bodies[1]).toMatchObject({ answers: {} });
  });

  it('持久化并恢复未提交答案，用户明确清空后删除草稿', async () => {
    const questions = [
      question({ id: 1, type: 'single', label: '单选', options: [opt('a', 'A'), opt('b', 'B')] }),
      question({ id: 2, type: 'text', label: '文本' }),
    ];
    const first = await mount(state({}, questions));
    let f = first.form()!;
    const b = f.querySelector<HTMLInputElement>('input[name="q_1"][value="b"]')!;
    b.checked = true;
    b.dispatchEvent(new Event('change', { bubbles: true }));
    const raw = localStorage.getItem('zenith:cms-interaction-draft:main:feedback');
    expect(JSON.parse(raw!)).toEqual({ page: 0, fields: { q_1: ['b'] } });

    document.body.innerHTML = '';
    const second = await mount(state({}, questions));
    f = second.form()!;
    expect(f.querySelector<HTMLInputElement>('input[name="q_1"][value="b"]')!.checked).toBe(true);

    f.querySelector<HTMLButtonElement>('.survey-clear-draft')!.click();
    expect(localStorage.getItem('zenith:cms-interaction-draft:main:feedback')).toBeNull();
    expect(f.querySelector<HTMLInputElement>('input[name="q_1"][value="b"]')!.checked).toBe(false);
  });

  it('Turnstile：注入官方脚本并在就绪后渲染挂件', async () => {
    const server = state({ captchaRequired: true, captcha: { provider: 'turnstile', siteKey: 'site-key' } }, [question({ id: 1, type: 'text', label: '建议' })]);
    const { form } = await mount(server);
    const f = form()!;
    const target = f.querySelector<HTMLElement>('.cms-turnstile')!;
    const script = document.querySelector<HTMLScriptElement>('script[data-cms-turnstile]')!;
    expect(script.src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    const render = vi.fn(() => 'w1');
    window.turnstile = { render, reset: vi.fn() };
    script.dispatchEvent(new Event('load'));
    expect(render).toHaveBeenCalledWith(target, { sitekey: 'site-key' });
    expect(target.dataset.widgetId).toBe('w1');
    delete window.turnstile;
    script.remove();
  });
});
