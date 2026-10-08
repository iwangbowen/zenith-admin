// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountMember } from './member';
import { flush, html, setMemberToken, stubFetch } from './test-utils';

const CONTAINER = '<span class="site-topbar-member" data-island="member"></span>';

describe('member island', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('未登录：渲染「登录」链接指向会员端，不发请求', async () => {
    const { calls } = stubFetch([]);
    const el = html(CONTAINER).querySelector('span')!;
    mountMember(el);
    await flush();
    const link = el.querySelector('a');
    expect(link?.textContent).toBe('登录');
    expect(link?.getAttribute('href')).toBe('/member.html#/');
    expect(calls).toHaveLength(0);
  });

  it('已登录：拉取资料显示昵称与退出；点击退出调用 logout 并清除本地 token', async () => {
    setMemberToken('t0k3n');
    const { calls } = stubFetch([
      { code: 0, data: { nickname: '小白' } }, // me
      { code: 0, data: null },                 // logout
    ]);
    const el = html(CONTAINER).querySelector('span')!;
    mountMember(el);
    await flush();
    expect(calls[0]).toMatchObject({ url: '/api/member/auth/me', method: 'GET' });
    expect(calls[0].headers.Authorization).toBe('Bearer t0k3n');
    expect(el.querySelector('.cms-member__name')?.textContent).toBe('小白');
    expect(el.querySelector('.cms-member__logout')?.textContent).toBe('退出');

    (el.querySelector('.cms-member__logout') as HTMLButtonElement).click();
    await flush();
    expect(calls[1]).toMatchObject({ url: '/api/member/auth/logout', method: 'POST' });
    expect(localStorage.getItem('zenith_member_token')).toBeNull();
    expect(localStorage.getItem('zenith_member_refresh_token')).toBeNull();
    // 退出后回到未登录态
    expect(el.querySelector('a')?.textContent).toBe('登录');
  });

  it('会话失效（me 返回业务错误）：清除本地 token 并回到登录态', async () => {
    setMemberToken('expired');
    stubFetch([{ code: 401, message: '未登录' }]);
    const el = html(CONTAINER).querySelector('span')!;
    mountMember(el);
    await flush();
    expect(localStorage.getItem('zenith_member_token')).toBeNull();
    expect(localStorage.getItem('zenith_member_refresh_token')).toBeNull();
    expect(el.querySelector('a')?.textContent).toBe('登录');
  });

  it('网络异常：仅回落到登录态，不误清 token', async () => {
    setMemberToken('t0k3n');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    const el = html(CONTAINER).querySelector('span')!;
    mountMember(el);
    await flush();
    expect(localStorage.getItem('zenith_member_token')).toBe('t0k3n');
    expect(el.querySelector('a')?.textContent).toBe('登录');
  });
});
