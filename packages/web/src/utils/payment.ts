/**
 * 支付中心前端公共工具：金额格式化与渠道/状态色映射。
 * 各支付页面统一从此处导入，禁止在页面内重复定义。
 */
import type { PaymentChannel, PaymentMethod, PaymentOrderStatus, PaymentRefundStatus } from '@zenith/shared/payment';

/** 分 → 元展示（`¥0.00`）；空值显示 nullText（默认 '-'）。 */
export function formatYuan(cents: number | null | undefined, nullText = '-'): string {
  if (cents == null) return nullText;
  return `¥${((Number(cents) || 0) / 100).toFixed(2)}`;
}

/** 精确格式化后端十进制最小单位字符串，避免 bigint 金额经过 Number 丢失精度。 */
export function formatMinorAmount(value: string | null | undefined, currency = 'CNY'): string {
  if (!value || !/^-?\d+$/.test(value)) return `${currency} 0`;
  const negative = value.startsWith('-');
  const digits = (negative ? value.slice(1) : value).replace(/^0+(?=\d)/, '');
  const scale = currency === 'JPY' ? 0 : 2;
  const sign = negative && digits !== '0' ? '-' : '';
  if (scale === 0) return `${currency} ${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  const padded = digits.padStart(scale + 1, '0');
  const integer = padded.slice(0, -scale).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = padded.slice(-scale);
  return `${currency === 'CNY' ? '¥' : `${currency} `}${sign}${integer}.${fraction}`;
}

/** 二维码支付提示按实际支付方式展示，避免把云闪付等渠道误写成微信。 */
export function getPaymentQrInstruction(method: PaymentMethod | null | undefined): string {
  if (method === 'unionpay_qr') return '请使用云闪付扫码支付';
  if (method?.startsWith('alipay_')) return '请使用支付宝扫码支付';
  if (method?.startsWith('wechat_')) return '请使用微信扫码支付';
  return '请使用对应支付应用扫码支付';
}

/** 渠道 Tag 颜色（微信绿 / 支付宝蓝 / 云闪付红） */
export const PAYMENT_CHANNEL_TAG_COLOR: Record<PaymentChannel, 'green' | 'blue' | 'red'> = {
  wechat: 'green',
  alipay: 'blue',
  unionpay: 'red',
};

export const PAYMENT_REFUND_STATUS_TAG_COLOR: Record<PaymentRefundStatus, 'grey' | 'blue' | 'green' | 'red' | 'amber'> = {
  pending: 'grey',
  processing: 'blue',
  unknown: 'amber',
  success: 'green',
  failed: 'red',
};

export const PAYMENT_ORDER_STATUS_TAG_COLOR: Record<PaymentOrderStatus, 'grey' | 'blue' | 'green' | 'amber' | 'orange' | 'red'> = {
  pending: 'grey',
  paying: 'blue',
  unknown: 'amber',
  success: 'green',
  closed: 'grey',
  refunding: 'amber',
  refunded: 'orange',
  failed: 'red',
};
