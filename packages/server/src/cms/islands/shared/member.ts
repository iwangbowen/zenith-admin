/** 会员端登录页（静态 CMS 页与会员 SPA 同源） */
export const MEMBER_LOGIN_URL = '/member.html#/';

/** 会员端登录后写入的 token（与 packages/web member SPA 约定一致） */
const MEMBER_TOKEN_KEY = 'zenith_member_token';

/** 读取会员 token；隐私模式等导致 localStorage 不可用时视为未登录 */
export function readMemberToken(): string | null {
  try {
    return localStorage.getItem(MEMBER_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** 跳转会员端登录（集中一处便于测试替身） */
export function goToMemberLogin(): void {
  location.href = MEMBER_LOGIN_URL;
}

/** 清除本地会员身份（退出 / 会话失效时调用；与会员 SPA 的键约定一致，见 shared/core/constants） */
export function clearMemberTokens(): void {
  try {
    localStorage.removeItem(MEMBER_TOKEN_KEY);
    localStorage.removeItem('zenith_member_refresh_token');
  } catch {
    /* localStorage 不可用时无需清理 */
  }
}
