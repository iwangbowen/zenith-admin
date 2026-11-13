// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComments } from './comments';
import * as analytics from './analytics';
import { flush, html, setMemberToken, stubFetch } from './test-utils';

const SECTION = `<section class="comments" data-island="comments">
  <div class="comment-item">
    <button type="button" class="comment-reply-btn" data-comment-id="12" data-nickname="小明">回复</button>
  </div>
  <form class="front-form" id="comment-form" method="post" action="/comments" data-member-api="/api/member/comments">
    <input type="hidden" name="parentId" id="comment-parent-id" value="0">
    <div id="reply-hint" style="display:none">回复给：<span id="reply-target"></span> <button type="button" id="cancel-reply">取消回复</button></div>
    <label id="comment-nick-row">昵称 <input type="text" name="nickname" required></label>
    <label>评论内容 <textarea name="content" required></textarea></label>
    <div class="cms-captcha-box"><input type="hidden" name="captchaId"><input type="text" name="captchaAnswer" required></div>
    <button type="submit">提交评论</button>
  </form>
</section>`;

function mount(): { section: HTMLElement; form: HTMLFormElement } {
  const section = html(SECTION).querySelector<HTMLElement>('section')!;
  section.querySelector<HTMLFormElement>('form')!.scrollIntoView = vi.fn();
  mountComments(section);
  return { section, form: section.querySelector<HTMLFormElement>('form')! };
}

describe('comments island', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('会员评论将页面身份上下文随业务请求提交', async () => {
    const attribution = { contextToken: 'signed', visitorId: '13a2e23f-6d22-4a58-ab1a-6110142be161', sessionId: '24a2e23f-6d22-4a58-ab1a-6110142be161', pageViewId: '35a2e23f-6d22-4a58-ab1a-6110142be161', entryPath: '/', entrySource: 'direct' };
    vi.spyOn(analytics, 'getCmsAttributionContext').mockReturnValue(attribution);
    setMemberToken('member-token'); const { calls } = stubFetch([{ code: 0, message: '已收到' }]);
    const { form } = mount(); form.querySelector<HTMLTextAreaElement>('textarea')!.value = '评论正文';
    form.dispatchEvent(new Event('submit', { cancelable: true })); await flush();
    expect(calls[0].body).toMatchObject({ content: '评论正文', attribution });
  });

  it('回复时提交父评论 ID，取消回复后按顶级评论提交', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    setMemberToken('member-token');
    const { calls } = stubFetch([{ code: 400, message: '重试' }, { code: 0 }]);
    const { section, form } = mount();
    form.querySelector<HTMLTextAreaElement>('textarea')!.value = '回复正文';
    section.querySelector<HTMLButtonElement>('.comment-reply-btn')!.click();
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(calls[0].body).toMatchObject({ parentId: 12, content: '回复正文' });

    form.querySelector<HTMLButtonElement>('#cancel-reply')!.click();
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(calls[1].body).toMatchObject({ parentId: 0, content: '回复正文' });
  });

  it('游客：不改动表单（保持原生 POST），昵称与验证码仍必填', () => {
    stubFetch([]);
    const { form } = mount();
    expect(form.querySelector<HTMLInputElement>('input[name="nickname"]')!.required).toBe(true);
    expect(form.querySelector<HTMLInputElement>('input[name="captchaAnswer"]')!.required).toBe(true);
  });

  it('会员评论使用鉴权 JSON 接口，不再要求游客昵称和验证码', async () => {
    setMemberToken('member-token');
    const { calls } = stubFetch([{ code: 0, message: '已收到' }]);
    const { form } = mount();
    const nickRow = form.querySelector<HTMLElement>('#comment-nick-row')!;
    expect(nickRow.querySelector('input')!.required).toBe(false);
    expect(form.querySelector<HTMLInputElement>('input[name="captchaAnswer"]')!.required).toBe(false);

    form.querySelector<HTMLInputElement>('#comment-parent-id')!.value = '12';
    form.querySelector<HTMLTextAreaElement>('textarea')!.value = '  很好的文章  ';
    const submit = new Event('submit', { cancelable: true });
    form.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    await flush();
    expect(calls[0]).toMatchObject({ url: '/api/member/comments', method: 'POST', body: { content: '很好的文章', parentId: 12 } });
    expect(calls[0].headers.Authorization).toBe('Bearer member-token');
  });

  it('会员接口 401 后恢复游客校验，不再拦截为会员请求', async () => {
    setMemberToken('expired');
    stubFetch([{ code: 401 }]);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { form } = mount();
    form.querySelector<HTMLTextAreaElement>('textarea')!.value = 'x';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    const nickRow = form.querySelector<HTMLElement>('#comment-nick-row')!;
    expect(nickRow.querySelector('input')!.required).toBe(true);
    expect(form.hasAttribute('data-member-api')).toBe(false);
    // 回退后再提交：不再拦截（走原生 POST）
    const submit = new Event('submit', { cancelable: true });
    form.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(false);
  });
});
