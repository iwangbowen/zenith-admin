// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComments } from './comments';
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

  it('回复定位：点击「回复」写入 parentId 并显示提示；「取消回复」还原', () => {
    stubFetch([]);
    const { section, form } = mount();
    section.querySelector<HTMLButtonElement>('.comment-reply-btn')!.click();
    expect(form.querySelector<HTMLInputElement>('#comment-parent-id')!.value).toBe('12');
    expect(form.querySelector('#reply-target')!.textContent).toBe('小明');
    expect(form.querySelector<HTMLElement>('#reply-hint')!.style.display).toBe('block');
    expect(form.scrollIntoView).toHaveBeenCalled();

    form.querySelector<HTMLButtonElement>('#cancel-reply')!.click();
    expect(form.querySelector<HTMLInputElement>('#comment-parent-id')!.value).toBe('0');
    expect(form.querySelector<HTMLElement>('#reply-hint')!.style.display).toBe('none');
  });

  it('游客：不改动表单（保持原生 POST），昵称与验证码仍必填', () => {
    stubFetch([]);
    const { form } = mount();
    expect(form.querySelector<HTMLInputElement>('input[name="nickname"]')!.required).toBe(true);
    expect(form.querySelector<HTMLInputElement>('input[name="captchaAnswer"]')!.required).toBe(true);
    expect(form.querySelector('p')).toBeNull();
  });

  it('会员：隐藏昵称 / 验证码行并提示；提交改走 JSON 接口，成功后替换为完成提示', async () => {
    setMemberToken('member-token');
    const { calls } = stubFetch([{ code: 0, message: '已收到' }]);
    const { form } = mount();
    const nickRow = form.querySelector<HTMLElement>('#comment-nick-row')!;
    expect(nickRow.style.display).toBe('none');
    expect(nickRow.querySelector('input')!.required).toBe(false);
    expect(form.querySelector<HTMLElement>('.cms-captcha-box')!.style.display).toBe('none');
    expect(form.querySelector('p')!.textContent).toBe('已以会员身份登录，评论将使用会员昵称');

    form.querySelector<HTMLInputElement>('#comment-parent-id')!.value = '12';
    form.querySelector<HTMLTextAreaElement>('textarea')!.value = '  很好的文章  ';
    const submit = new Event('submit', { cancelable: true });
    form.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    await flush();
    expect(calls[0]).toMatchObject({ url: '/api/member/comments', method: 'POST', body: { content: '很好的文章', parentId: 12 } });
    expect(calls[0].headers.Authorization).toBe('Bearer member-token');
    expect(form.textContent).toBe('已收到');
    expect(form.querySelector('.survey-done')).not.toBeNull();
  });

  it('会员接口 401：回退游客表单（昵称 / 验证码恢复必填，提示移除）', async () => {
    setMemberToken('expired');
    stubFetch([{ code: 401 }]);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { form } = mount();
    form.querySelector<HTMLTextAreaElement>('textarea')!.value = 'x';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(alertSpy).toHaveBeenCalledWith('会员登录已过期，请以游客身份提交或重新登录');
    const nickRow = form.querySelector<HTMLElement>('#comment-nick-row')!;
    expect(nickRow.style.display).toBe('');
    expect(nickRow.querySelector('input')!.required).toBe(true);
    expect(form.querySelector<HTMLElement>('.cms-captcha-box')!.style.display).toBe('');
    expect(form.hasAttribute('data-member-api')).toBe(false);
    expect(form.querySelector('p:not(#reply-hint)')).toBeNull();
    // 回退后再提交：不再拦截（走原生 POST）
    const submit = new Event('submit', { cancelable: true });
    form.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(false);
  });
});
