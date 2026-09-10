// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountFollow } from './follow';
import * as member from './shared/member';
import { flush, html, setMemberToken, stubFetch } from './test-utils';

const BUTTON = '<button type="button" class="cms-follow" data-island="follow" data-site="1" data-subject-type="site" data-subject-id="1" aria-pressed="false">关注</button>';

describe('follow island', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('未登录：文案改为「登录后关注」，点击跳会员端登录，不发请求', () => {
    const { calls } = stubFetch([]);
    const goToLogin = vi.spyOn(member, 'goToMemberLogin').mockImplementation(() => {});
    const button = html(BUTTON).querySelector<HTMLButtonElement>('button')!;
    mountFollow(button);
    expect(button.textContent).toBe('登录后关注');
    button.click();
    expect(goToLogin).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it('已登录：拉取订阅状态并渲染已关注；点击 DELETE 取消；再点击 POST 关注', async () => {
    setMemberToken('t0k3n');
    const { calls } = stubFetch([
      { code: 0, data: { id: 42 } },        // status → 已关注
      { code: 0, data: null },              // DELETE
      { code: 0, data: { id: 43 } },        // POST
    ]);
    const button = html(BUTTON).querySelector<HTMLButtonElement>('button')!;
    mountFollow(button);
    await flush();
    expect(calls[0].url).toMatch(/^\/api\/member\/cms\/subscriptions\/status\?/);
    expect(calls[0].url).toContain('siteId=1');
    expect(calls[0].url).toContain('subjectType=site');
    expect(calls[0].headers.Authorization).toBe('Bearer t0k3n');
    expect(button.textContent).toBe('已关注');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.dataset.subscriptionId).toBe('42');

    button.click();
    await flush();
    expect(calls[1]).toMatchObject({ url: '/api/member/cms/subscriptions/42', method: 'DELETE' });
    expect(button.textContent).toBe('关注');
    expect(button.dataset.subscriptionId).toBe('');
    expect(button.disabled).toBe(false);

    button.click();
    await flush();
    expect(calls[2]).toMatchObject({ url: '/api/member/cms/subscriptions', method: 'POST' });
    expect(calls[2].body).toEqual({ siteId: 1, subjectType: 'site', subjectId: 1, notificationEnabled: true });
    expect(calls[2].headers['X-Idempotency-Key']).toMatch(/^follow-\d+$/);
    expect(button.textContent).toBe('已关注');
    expect(button.dataset.subscriptionId).toBe('43');
  });

  it('接口返回业务错误时提示且状态不变', async () => {
    setMemberToken('t0k3n');
    stubFetch([{ code: 0, data: null }, { code: 500, message: '服务繁忙' }]);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const button = html(BUTTON).querySelector<HTMLButtonElement>('button')!;
    mountFollow(button);
    await flush();
    button.click();
    await flush();
    expect(alertSpy).toHaveBeenCalledWith('服务繁忙');
    expect(button.textContent).toBe('关注');
  });
});
