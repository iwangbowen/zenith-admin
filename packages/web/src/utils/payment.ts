/**
 * 支付中心前端公共工具：金额格式化与渠道/状态色映射。
 * 各支付页面统一从此处导入，禁止在页面内重复定义。
 */
import type { PaymentChannel } from '@zenith/shared';

/** 分 → 元展示（`¥0.00`）；空值显示 nullText（默认 '-'）。 */
export function formatYuan(cents: number | null | undefined, nullText = '-'): string {
  if (cents == null) return nullText;
  return `¥${((Number(cents) || 0) / 100).toFixed(2)}`;
}

/** 渠道 Tag 颜色（微信绿 / 支付宝蓝 / 云闪付红） */
export const PAYMENT_CHANNEL_TAG_COLOR: Record<PaymentChannel, 'green' | 'blue' | 'red'> = {
  wechat: 'green',
  alipay: 'blue',
  unionpay: 'red',
};
