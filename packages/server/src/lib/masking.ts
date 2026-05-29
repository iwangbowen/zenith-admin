/**
 * 数据脱敏核心工具函数（纯函数，零依赖）
 *
 * 脱敏示例：
 *  - phone:     13812341234 → 138****1234
 *  - email:     admin@example.com → adm***@example.com
 *  - id_card:   110101199001011234 → 110101********1234
 *  - name:      张三丰 → 张*丰
 *  - bank_card: 6222021234567890 → 622202**********90  (后 4 位明文)
 *  - custom:    自定义保留位数
 */

export type MaskType = 'phone' | 'email' | 'id_card' | 'name' | 'bank_card' | 'custom';

export interface CustomMaskRule {
  prefixKeep: number;
  suffixKeep: number;
  maskChar?: string;
}

/** 手机号：138****1234（保留前 3 + 后 4） */
export function maskPhone(v: string): string {
  return v.replace(/^(\d{3})\d+(\d{4})$/, '$1****$2');
}

/** 邮箱：保留本地名前 1/3 + 域名 */
export function maskEmail(v: string): string {
  const atIdx = v.indexOf('@');
  if (atIdx <= 0) return v;
  const local = v.slice(0, atIdx);
  const domain = v.slice(atIdx);
  const keep = Math.max(1, Math.ceil(local.length / 3));
  return local.slice(0, keep) + '*'.repeat(local.length - keep) + domain;
}

/** 身份证：保留前 6 + 后 4 */
export function maskIdCard(v: string): string {
  if (v.length <= 10) return v;
  return v.slice(0, 6) + '*'.repeat(v.length - 10) + v.slice(-4);
}

/** 姓名：保留首尾，中间 * */
export function maskName(v: string): string {
  if (v.length <= 1) return v;
  if (v.length === 2) return v[0] + '*';
  return v[0] + '*'.repeat(v.length - 2) + v.at(-1);
}

/** 银行卡：仅保留后 4 位 */
export function maskBankCard(v: string): string {
  if (v.length <= 4) return v;
  return '*'.repeat(v.length - 4) + v.slice(-4);
}

/** 自定义规则：保留前 N + 后 M 位 */
export function maskCustom(v: string, rule: CustomMaskRule): string {
  const { prefixKeep, suffixKeep, maskChar = '*' } = rule;
  const len = v.length;
  if (len <= prefixKeep + suffixKeep) return v;
  return (
    v.slice(0, prefixKeep) +
    maskChar.repeat(len - prefixKeep - suffixKeep) +
    (suffixKeep > 0 ? v.slice(-suffixKeep) : '')
  );
}

/** 统一脱敏入口 */
export function applyMask(
  value: string | null | undefined,
  type: MaskType,
  customRule?: CustomMaskRule | null,
): string | null | undefined {
  if (!value) return value;
  switch (type) {
    case 'phone':     return maskPhone(value);
    case 'email':     return maskEmail(value);
    case 'id_card':   return maskIdCard(value);
    case 'name':      return maskName(value);
    case 'bank_card': return maskBankCard(value);
    case 'custom':    return customRule ? maskCustom(value, customRule) : value;
    default:          return value;
  }
}
