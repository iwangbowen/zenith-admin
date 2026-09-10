import { apiHeaders, apiJson, isOk } from './shared/api';
import { goToMemberLogin, readMemberToken } from './shared/member';

interface InteractionState {
  liked: boolean;
  favorited: boolean;
  likeCount: number;
  favoriteCount: number;
}

/**
 * 详情页点赞 / 收藏条（`#interaction-bar`，容器契约：data-content-id；子元素 #btn-like / #btn-fav / #like-count / #fav-count）。
 * 已登录：拉取互动状态并上报浏览历史；点击在 POST / DELETE 间切换。未登录或 401：跳会员端登录。
 */
export function mountLikes(el: HTMLElement): void {
  const contentId = el.dataset.contentId;
  const token = readMemberToken();
  const likeButton = el.querySelector<HTMLButtonElement>('#btn-like');
  const favButton = el.querySelector<HTMLButtonElement>('#btn-fav');
  const likeCount = el.querySelector<HTMLElement>('#like-count');
  const favCount = el.querySelector<HTMLElement>('#fav-count');

  const api = (method: string, path: string) =>
    apiJson<InteractionState>(`/api/member/cms/contents/${contentId}${path}`, { method, headers: apiHeaders(token, true) });

  const paint = (state: InteractionState | undefined) => {
    if (!state || !likeButton || !favButton) return;
    likeButton.classList.toggle('active', !!state.liked);
    favButton.classList.toggle('active', !!state.favorited);
    if (likeCount) likeCount.textContent = String(state.likeCount);
    if (favCount) favCount.textContent = String(state.favoriteCount);
    likeButton.dataset.on = state.liked ? '1' : '';
    favButton.dataset.on = state.favorited ? '1' : '';
  };

  if (token) {
    api('GET', '/interaction-state').then((result) => { if (isOk(result)) paint(result.data); }).catch(() => {});
    api('POST', '/view').catch(() => {});
  }

  el.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest('button');
    if (!button) return;
    if (!token) {
      goToMemberLogin();
      return;
    }
    const isLike = button.id === 'btn-like';
    const on = button.dataset.on === '1';
    api(on ? 'DELETE' : 'POST', isLike ? '/like' : '/favorite')
      .then((result) => {
        if (isOk(result)) paint(result.data);
        else if (result?.code === 401) goToMemberLogin();
      })
      .catch(() => {});
  });
}
