import * as z from 'zod';

/** 协议 / 预授权等资源按支付应用隔离，读写都必须显式指定应用 */
export const paymentApplicationQuery = z.object({
  applicationId: z.coerce.number().int().positive().meta({ description: '支付应用 ID' }),
});
