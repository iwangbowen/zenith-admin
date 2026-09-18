import * as z from 'zod';
import { auditFieldsSchema, defineContract, entityStatusQuery, entityStatusSchema, idParam, keywordQuery, op, paginated, paginationQuery, queryEnum } from '../../core';
import { PAYMENT_CHANNELS, PAYMENT_CHANNEL_OPTIONS, PAYMENT_CHANNEL_ENVIRONMENTS, PAYMENT_CHANNEL_ENVIRONMENT_OPTIONS } from '../constants';

export const paymentChannelAccountSchema = z.object({
  id: z.int(),
  name: z.string(),
  channel: z.enum(PAYMENT_CHANNELS),
  environment: z.enum(PAYMENT_CHANNEL_ENVIRONMENTS),
  merchantId: z.string(),
  subMerchantId: z.string(),
  billTimezone: z.string(),
  status: entityStatusSchema,
  tenantId: z.int().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentChannelAccount' });
export type PaymentChannelAccount = z.infer<typeof paymentChannelAccountSchema>;

export const paymentChannelAccountContract = defineContract('/api/payment/channel-accounts', {
  all: op.get('/all', {
    access: { permission: ['payment:channel:list', 'payment:recon:list', 'payment:settlement:list'] },
    response: z.array(paymentChannelAccountSchema), summary: '渠道账户下拉',
  }),
  list: op.get('/', {
    access: { permission: ['payment:channel:list', 'payment:recon:list', 'payment:settlement:list'] },
    query: paginationQuery.extend({
      keyword: keywordQuery('名称 / 商户号'),
      channel: queryEnum(PAYMENT_CHANNELS, { options: PAYMENT_CHANNEL_OPTIONS }),
      environment: queryEnum(PAYMENT_CHANNEL_ENVIRONMENTS, { options: PAYMENT_CHANNEL_ENVIRONMENT_OPTIONS }),
      status: entityStatusQuery,
    }),
    response: paginated(paymentChannelAccountSchema), summary: '渠道资金账户列表',
  }),
  detail: op.get('/{id}', {
    access: { permission: ['payment:channel:list', 'payment:recon:list', 'payment:settlement:list'] },
    params: idParam, response: paymentChannelAccountSchema, summary: '渠道资金账户详情',
  }),
}, { auditModule: '支付中心', tags: ['支付中心'] });
