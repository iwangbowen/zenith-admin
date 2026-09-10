// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountLikes } from './likes';
import * as member from './shared/member';
import { flush, html, setMemberToken, stubFetch } from './test-utils';

const BAR = `<div class="interaction-bar" id="interaction-bar" data-island="likes" data-content-id="7">
  <button type="button" id="btn-like">👍 赞 <span id="like-count">2</span></button>
  <button type="button" id="btn-fav">⭐ 收藏 <span id="fav-count">1</span></button>
</div>`;

describe('likes island', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('未登录：不拉状态；点击任一按钮跳会员端登录', () => {
    const { calls } = stubFetch([]);
    const goToLogin = vi.spyOn(member, 'goToMemberLogin').mockImplementation(() => {});
    const bar = html(BAR).querySelector<HTMLElement>('#interaction-bar')!;
    mountLikes(bar);
    bar.querySelector<HTMLButtonElement>('#btn-fav')!.click();
    expect(goToLogin).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it('已登录：拉取状态 + 上报浏览；点击点赞 POST、再点 DELETE，计数与 active 同步', async () => {
    setMemberToken('tk');
    const { calls } = stubFetch([
      { code: 0, data: { liked: true, favorited: false, likeCount: 3, favoriteCount: 1 } },  // GET state
      { code: 0 },                                                                            // POST view
      { code: 0, data: { liked: false, favorited: false, likeCount: 2, favoriteCount: 1 } }, // DELETE like
      { code: 0, data: { liked: false, favorited: true, likeCount: 2, favoriteCount: 2 } },  // POST favorite
    ]);
    const bar = html(BAR).querySelector<HTMLElement>('#interaction-bar')!;
    mountLikes(bar);
    await flush();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/member/cms/contents/7/interaction-state',
      'POST /api/member/cms/contents/7/view',
    ]);
    const like = bar.querySelector<HTMLButtonElement>('#btn-like')!;
    const fav = bar.querySelector<HTMLButtonElement>('#btn-fav')!;
    expect(like.classList.contains('active')).toBe(true);
    expect(like.dataset.on).toBe('1');
    expect(bar.querySelector('#like-count')!.textContent).toBe('3');

    like.click();
    await flush();
    expect(calls[2]).toMatchObject({ method: 'DELETE', url: '/api/member/cms/contents/7/like' });
    expect(like.classList.contains('active')).toBe(false);
    expect(bar.querySelector('#like-count')!.textContent).toBe('2');

    fav.click();
    await flush();
    expect(calls[3]).toMatchObject({ method: 'POST', url: '/api/member/cms/contents/7/favorite' });
    expect(fav.classList.contains('active')).toBe(true);
    expect(bar.querySelector('#fav-count')!.textContent).toBe('2');
  });

  it('接口 401：跳会员端登录', async () => {
    setMemberToken('expired');
    stubFetch([{ code: 401 }, { code: 401 }, { code: 401 }]);
    const goToLogin = vi.spyOn(member, 'goToMemberLogin').mockImplementation(() => {});
    const bar = html(BAR).querySelector<HTMLElement>('#interaction-bar')!;
    mountLikes(bar);
    await flush();
    bar.querySelector<HTMLButtonElement>('#btn-like')!.click();
    await flush();
    expect(goToLogin).toHaveBeenCalledTimes(1);
  });
});
