import { randomInt } from 'node:crypto';

/**
 * 支付域业务单号：`前缀 + 毫秒时间戳 + 4 位随机数`。
 * 订单 / 退款 / 对账批次 / 争议 / 结算 / 预授权 / 转账 / 分账 / 支付链接 / 签约 / 风控审核共用同一形态，
 * 前缀由调用方给出（`PAY` / `REF` / `RECON` / `DSP` / `SETTLE` / `PRE` / `TRF` / `SHR` / `LINK` / `CT` / `RSK`）。
 */
export function genPaymentNo(prefix: string): string {
  return `${prefix}${Date.now()}${randomInt(1000, 9999)}`;
}
