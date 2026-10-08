import { apiHeaders, apiJson, isOk } from './shared/api';
import { MEMBER_LOGIN_URL, clearMemberTokens, readMemberToken } from './shared/member';

/** 会员资料（/api/member/auth/me 响应中本岛只消费展示字段） */
interface MemberProfile {
  nickname: string;
}

const ME_URL = '/api/member/auth/me';
const LOGOUT_URL = '/api/member/auth/logout';

/** 未登录态：右上角「登录」入口，链接直达会员端 */
function renderLoggedOut(el: HTMLElement): void {
  el.replaceChildren();
  const link = document.createElement('a');
  link.className = 'cms-member__login';
  link.href = MEMBER_LOGIN_URL;
  link.textContent = '登录';
  el.appendChild(link);
}

/** 已登录态：昵称 + 退出 */
function renderMember(el: HTMLElement, nickname: string, onLogout: () => void): void {
  el.replaceChildren();
  const name = document.createElement('span');
  name.className = 'cms-member__name';
  name.textContent = nickname;
  const logout = document.createElement('button');
  logout.type = 'button';
  logout.className = 'cms-member__logout';
  logout.textContent = '退出';
  logout.addEventListener('click', onLogout);
  el.append(name, logout);
}

/**
 * 顶栏会员区（`.site-topbar-member`，data-island="member"）：
 * 未登录渲染「登录」（跳会员端）；已登录拉取资料渲染「昵称 + 退出」。
 * 资料拉取失败（token 失效 / 网络异常）一律回落到未登录态，保证顶栏始终有可用入口。
 */
export function mountMember(el: HTMLElement): void {
  const token = readMemberToken();
  if (!token) {
    renderLoggedOut(el);
    return;
  }

  const logout = (): void => {
    // 服务端注销尽力而为；本地身份必须立即清除（与会员 SPA 的退出行为一致）
    apiJson(LOGOUT_URL, { method: 'POST', headers: apiHeaders(token, false) }).catch(() => {});
    clearMemberTokens();
    renderLoggedOut(el);
  };

  apiJson<MemberProfile>(ME_URL, { headers: apiHeaders(token, false) })
    .then((result) => {
      if (isOk(result)) renderMember(el, result.data.nickname, logout);
      else {
        // token 已失效：清除本地身份并回到未登录态
        clearMemberTokens();
        renderLoggedOut(el);
      }
    })
    .catch(() => renderLoggedOut(el));
}
