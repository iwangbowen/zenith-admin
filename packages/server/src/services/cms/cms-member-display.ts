import { maskEmail, maskName, maskPhone } from '../../lib/masking';

export interface CmsMemberDisplaySource {
  nickname: string | null;
  username: string | null;
  phone: string | null;
  email: string | null;
}

/**
 * CMS 治理页展示会员的脱敏名称：昵称 → 用户名 → 手机号 → 邮箱依次回退并打码；
 * 全部为空时返回调用方给定的兜底文案（互动回收为「游客」、订阅为「会员」）。
 */
export function maskedMemberDisplay(row: CmsMemberDisplaySource, fallback: string): string {
  if (row.nickname) return maskName(row.nickname);
  if (row.username) return maskName(row.username);
  if (row.phone) return maskPhone(row.phone);
  if (row.email) return maskEmail(row.email);
  return fallback;
}
