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

  it('拉取状态失败：隐藏容器', async () => {
    const stub = stubFetch([{ code: 404 }]);
    const el = html(BOX).querySelector<HTMLElement>('.cms-interaction')!;
    mountSurvey(el);
    await flush();
    expect(stub.calls[0].url).toBe('/api/public/cms/interactions/main/feedback');
    expect(el.style.display).toBe('none');
  });

  it('已关闭：直接展示结果（条形图 / NPS / 文字题不公开）', async () => {
    const { el } = await mount(state({ open: false, resultsVisible: true, results: RESULTS }));
    expect(el.querySelector('.interaction-results p')!.textContent).toBe('共 12 人参与');
    const rows = el.querySelectorAll('.poll-bar-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.poll-bar-label')!.textContent).toBe('搜索');
    expect(rows[0].querySelector<HTMLElement>('.poll-bar-fill')!.getAttribute('style')).toBe('width:66.7%');
    expect(rows[0].querySelector('.poll-bar-num')!.textContent).toBe('8 · 66.7%');
    expect([...el.querySelectorAll('.interaction-metric')].map((e) => e.textContent)).toEqual(['NPS：45']);
    expect([...el.querySelectorAll('.interaction-hint')].map((e) => e.textContent)).toEqual(['该题答案不公开展示']);
  });

  it('已关闭且结果不可见：提示结果暂不可见', async () => {
    const { el } = await mount(state({ open: false, results: null }));
    expect(el.textContent).toBe('结果暂不可见');
  });

  it('已提交且结果可见（非多次）：展示结果而不是表单', async () => {
    const { el, form } = await mount(state({ submitted: true, resultsVisible: true, results: RESULTS }));
    expect(form()).toBeNull();
    expect(el.querySelector('.interaction-results')).not.toBeNull();
  });

  it('仅限会员且未登录：提示登录，不渲染表单', async () => {
    const server = state({}, [question({ id: 1, type: 'text', label: '建议' })]);
    server.interaction.participantScope = 'member';
    const { el, form } = await mount(server);
    expect(form()).toBeNull();
    expect(el.querySelector('.interaction-hint')!.textContent).toBe('本互动仅限会员参与，请先登录');
    expect(el.querySelector('a')!.getAttribute('href')).toBe('/member.html#/');
  });

  it('渲染各题型：单选 / 多选（含其他）/ 评分 / NPS / 矩阵 / 文本 / 日期 / 数字', async () => {
    const questions = [
      question({ id: 1, type: 'single', label: '单选', required: true, options: [opt('a', 'A'), opt('b', 'B')], allowOther: true, otherLabel: '别的' }),
      question({ id: 2, type: 'multiple', label: '多选', options: [opt('x', 'X'), opt('y', 'Y'), opt('z', 'Z')], minChoices: 1, maxChoices: 2 }),
      question({ id: 3, type: 'rating', label: '评分', ratingMax: 3 }),
      question({ id: 4, type: 'nps', label: 'NPS' }),
      question({ id: 5, type: 'matrix', label: '矩阵', options: [opt('good', '好'), opt('bad', '差')], matrixRows: [{ id: 'r1', label: '速度' }, { id: 'r2', label: '稳定' }] }),
      question({ id: 6, type: 'text', label: '文本' }),
      question({ id: 7, type: 'date', label: '日期' }),
      question({ id: 8, type: 'number', label: '数字' }),
    ];
    const { form } = await mount(state({}, questions));
    const f = form()!;
    expect(f.querySelectorAll('.survey-question')).toHaveLength(8);
    expect(f.querySelector('legend')!.textContent).toBe('1. 单选 *');
    expect(f.querySelectorAll('input[name="q_1"]')).toHaveLength(3);
    expect(f.querySelector<HTMLInputElement>('input[name="q_1"][value="__other__"]')).not.toBeNull();
    expect(f.querySelector('.survey-option-other')!.textContent).toBe(' 别的');
    expect(f.querySelector<HTMLInputElement>('input[name="q_1_other"]')!.disabled).toBe(true);
    expect(f.querySelectorAll('input[name="q_2"][type=checkbox]')).toHaveLength(3);
    expect(f.querySelector('.survey-choice-hint')!.textContent).toBe('可选 1 ~ 2 项');
    expect([...f.querySelectorAll('.survey-question[data-qid="3"] input')].map((i) => (i as HTMLInputElement).value)).toEqual(['1', '2', '3']);
    expect(f.querySelectorAll('.survey-question[data-qid="4"] input')).toHaveLength(11);
    expect(f.querySelectorAll('.survey-matrix tbody tr')).toHaveLength(2);
    expect(f.querySelector<HTMLInputElement>('input[name="q_5_r1"]')!.value).toBe('r1::good');
    expect(f.querySelector('textarea[name="q_6"]')).not.toBeNull();
    expect(f.querySelector('input[name="q_7"][type=date]')).not.toBeNull();
    expect(f.querySelector('input[name="q_8"][type=number]')).not.toBeNull();
    // 无验证码、单页：只显示提交
    expect(f.querySelector('.cms-captcha-box')).toBeNull();
    expect(f.querySelector<HTMLElement>('.survey-prev')!.hidden).toBe(true);
    expect(f.querySelector<HTMLElement>('.survey-next')!.hidden).toBe(true);
    expect(f.querySelector<HTMLElement>('.survey-submit')!.hidden).toBe(false);
    expect(f.querySelector('.survey-progress')!.textContent).toBe('');
  });

  it('题目文案不会被当作 HTML 解析', async () => {
    const { form } = await mount(state({}, [question({ id: 1, type: 'single', label: '<img src=x onerror=alert(1)>', options: [opt('v', '<b>粗</b>')] })]));
    const f = form()!;
    expect(f.querySelector('legend img')).toBeNull();
    expect(f.querySelector('legend')!.textContent).toBe('1. <img src=x onerror=alert(1)>');
    expect(f.querySelector('.survey-option b')).toBeNull();
  });

  it('条件显隐：依赖题未命中时隐藏并 disabled；命中后显示；none 取反', async () => {
    const questions = [
      question({ id: 1, type: 'single', label: '用过吗', options: [opt('yes', '是'), opt('no', '否')] }),
      question({ id: 2, type: 'text', label: '哪里好', visibleWhen: { questionIndex: 0, op: 'any', values: ['yes'] } }),
      question({ id: 3, type: 'text', label: '为何不用', visibleWhen: { questionIndex: 0, op: 'none', values: ['yes'] } }),
    ];
    const { form } = await mount(state({}, questions));
    const f = form()!;
    const q2 = f.querySelector<HTMLFieldSetElement>('[data-qid="2"]')!;
    const q3 = f.querySelector<HTMLFieldSetElement>('[data-qid="3"]')!;
    expect(q2.hidden).toBe(true); expect(q2.disabled).toBe(true);
    expect(q3.hidden).toBe(false); expect(q3.disabled).toBe(false);

    const yes = f.querySelector<HTMLInputElement>('input[name="q_1"][value="yes"]')!;
    yes.checked = true;
    yes.dispatchEvent(new Event('change', { bubbles: true }));
    expect(q2.hidden).toBe(false); expect(q2.disabled).toBe(false);
    expect(q3.hidden).toBe(true); expect(q3.disabled).toBe(true);
  });

  it('分页：下一页前校验当前页；提交时出错翻回出错页；进度文案', async () => {
    const questions = [
      question({ id: 1, type: 'single', label: '第一页必答', required: true, options: [opt('a', 'A')], pageNo: 1 }),
      question({ id: 2, type: 'text', label: '第二页必答', required: true, pageNo: 2 }),
    ];
    const { form } = await mount(state({}, questions));
    const f = form()!;
    const next = f.querySelector<HTMLButtonElement>('.survey-next')!;
    const prev = f.querySelector<HTMLButtonElement>('.survey-prev')!;
    const submit = f.querySelector<HTMLButtonElement>('.survey-submit')!;
    expect(f.querySelector('.survey-progress')!.textContent).toBe('第 1 / 2 页');
    expect(next.hidden).toBe(false); expect(submit.hidden).toBe(true);

    next.click();
    expect(f.querySelector('.survey-progress')!.textContent).toBe('第 1 / 2 页');
    expect(f.querySelector('[data-qid="1"] .survey-error')!.textContent).toBe('该题为必答题');
    expect(f.querySelector('.survey-form-error')!.textContent).toBe('请先完善标红的题目');

    f.querySelector<HTMLInputElement>('input[name="q_1"]')!.checked = true;
    next.click();
    expect(f.querySelector('.survey-progress')!.textContent).toBe('第 2 / 2 页');
    expect(f.querySelector<HTMLFieldSetElement>('[data-qid="1"]')!.hidden).toBe(true);
    expect(f.querySelector<HTMLFieldSetElement>('[data-qid="2"]')!.hidden).toBe(false);
    expect(prev.hidden).toBe(false); expect(next.hidden).toBe(true); expect(submit.hidden).toBe(false);

    // 回到第一页并清掉答案，再从第二页提交 → 翻回第一页高亮
    prev.click();
    f.querySelector<HTMLInputElement>('input[name="q_1"]')!.checked = false;
    next.click(); // 会被拦住
    f.querySelector<HTMLInputElement>('input[name="q_1"]')!.checked = true;
    next.click();
    f.querySelector<HTMLTextAreaElement>('textarea[name="q_2"]')!.value = 'ok';
    f.querySelector<HTMLInputElement>('input[name="q_1"]')!.checked = false;
    f.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(f.querySelector('.survey-progress')!.textContent).toBe('第 1 / 2 页');
    expect(f.querySelector('[data-qid="1"]')!.classList.contains('survey-question-invalid')).toBe(true);
  });

  it('多选校验：数量范围与「其他」填空', async () => {
    const questions = [question({ id: 1, type: 'multiple', label: '多选', required: true, options: [opt('x', 'X'), opt('y', 'Y'), opt('z', 'Z')], minChoices: 2, maxChoices: 2, allowOther: true })];
    const { form, calls } = await mount(state({}, questions));
    const f = form()!;
    const boxes = [...f.querySelectorAll<HTMLInputElement>('input[name="q_1"]')];
    boxes[0].checked = true;
    f.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(f.querySelector('.survey-error')!.textContent).toBe('需选择 2-2 项，当前 1 项');

    const other = boxes.find((b) => b.value === '__other__')!;
    other.checked = true;
    other.dispatchEvent(new Event('change', { bubbles: true }));
    expect(f.querySelector<HTMLInputElement>('input[name="q_1_other"]')!.disabled).toBe(false);
    f.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(f.querySelector('.survey-error')!.textContent).toBe('请填写「其他」的内容');
    expect(calls).toHaveLength(1); // 只有状态请求，未提交
  });

  it('提交（游客、单次）：payload 含各题答案与 idempotencyKey，成功后展示结果', async () => {
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
    expect(el.querySelector('.interaction-results p')!.textContent).toBe('共 12 人参与');
  });

  it('提交（会员）：走容器声明的会员接口并带鉴权头；无结果时显示完成提示', async () => {
    setMemberToken('mtk');
    const { el, calls } = await mount(state({}, [question({ id: 1, type: 'text', label: '建议' })]), [{ code: 0, data: { responseId: 2, duplicate: false, message: '已收到', results: null } }]);
    const f = el.querySelector('form')!;
    f.querySelector<HTMLTextAreaElement>('textarea')!.value = 'hi';
    f.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(calls[0].headers.Authorization).toBe('Bearer mtk');
    expect(calls[1]).toMatchObject({ url: '/api/member/cms/interactions/9/submit', method: 'POST' });
    expect(calls[1].headers.Authorization).toBe('Bearer mtk');
    expect(el.querySelector('.survey-done')!.textContent).toBe('已收到');
  });

  it('提交失败：显示接口文案、按钮恢复可用、重新拉取算术验证码', async () => {
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
    expect(f.querySelector('.survey-form-error')!.textContent).toBe('请填写验证码');
    f.querySelector<HTMLInputElement>('[name=captchaAnswer]')!.value = '7';
    f.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    const submitCall = calls.find((c) => c.url.endsWith('/submit'))!;
    expect(submitCall.body).toMatchObject({ captchaId: 'cap1', captchaAnswer: '7' });
    expect(f.querySelector('.survey-form-error')!.textContent).toBe('验证码错误');
    expect(f.querySelector<HTMLButtonElement>('.survey-submit')!.disabled).toBe(false);
    expect(f.querySelector<HTMLInputElement>('[name=captchaId]')!.value).toBe('cap2');
  });

  it('多次参与：成功后保留表单、插入完成提示与实时结果、清空答案', async () => {
    const server = state({ resultsVisible: true, results: RESULTS }, [question({ id: 1, type: 'text', label: '建议' })]);
    server.interaction.repeatPolicy = 'multiple';
    const updated = { ...RESULTS, responseCount: 13 };
    const { el } = await mount(server, [{ code: 0, data: { responseId: 3, duplicate: false, message: '', results: updated } }]);
    expect(el.querySelector('.interaction-live-results p')!.textContent).toBe('共 12 人参与');
    const f = el.querySelector('form')!;
    f.querySelector<HTMLTextAreaElement>('textarea')!.value = 'again';
    f.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(el.querySelector('form')).not.toBeNull();
    expect(el.querySelector('.survey-done')!.textContent).toBe('提交成功，可继续参与');
    expect(el.querySelector('.interaction-live-results p')!.textContent).toBe('共 13 人参与');
    expect(el.querySelectorAll('.interaction-live-results')).toHaveLength(1);
    expect(f.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
  });

  it('草稿：变更即保存；重新挂载后恢复并显示提示；清空重填后删除', async () => {
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
    expect(f.querySelector<HTMLElement>('.survey-restored')!.hidden).toBe(true);

    document.body.innerHTML = '';
    const second = await mount(state({}, questions));
    f = second.form()!;
    expect(f.querySelector<HTMLInputElement>('input[name="q_1"][value="b"]')!.checked).toBe(true);
    expect(f.querySelector<HTMLElement>('.survey-restored')!.hidden).toBe(false);

    f.querySelector<HTMLButtonElement>('.survey-clear-draft')!.click();
    expect(localStorage.getItem('zenith:cms-interaction-draft:main:feedback')).toBeNull();
    expect(f.querySelector<HTMLInputElement>('input[name="q_1"][value="b"]')!.checked).toBe(false);
    expect(f.querySelector<HTMLElement>('.survey-restored')!.hidden).toBe(true);
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
