/**
 * 短信配置 / 短信模板 / 短信发送记录 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const SmsConfigDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    provider: z.enum(['aliyun', 'tencent']),
    accessKeyId: z.string(),
    accessKeySecret: z.string().optional(), // 列表脱敏不返回
    region: z.string().nullable(),
    signName: z.string(),
    isDefault: z.boolean(),
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('SmsConfig');

export const SmsTemplateDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    code: z.string(),
    templateCode: z.string(),
    signName: z.string().nullable(),
    content: z.string(),
    variables: z.string().nullable(),
    provider: z.enum(['aliyun', 'tencent']),
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('SmsTemplate');

export const SmsSendLogDTO = z
  .object({
    id: z.number().int(),
    configId: z.number().int().nullable(),
    configName: z.string().nullable(),
    templateId: z.number().int().nullable(),
    templateName: z.string().nullable(),
    provider: z.enum(['aliyun', 'tencent']),
    phone: z.string(),
    content: z.string(),
    status: z.enum(['pending', 'success', 'failed']),
    errorMsg: z.string().nullable(),
    bizId: z.string().nullable(),
    deliveryStatus: z.string().nullable(),
    deliveredAt: z.string().nullable(),
    source: z.enum(['manual', 'test', 'system', 'api']),
    userId: z.number().int().nullable(),
    username: z.string().nullable(),
    ip: z.string().nullable(),
    sentAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('SmsSendLog');

export const SmsSendResultDTO = z
  .object({
    logId: z.number().int(),
    status: z.enum(['pending', 'success', 'failed']),
    bizId: z.string().nullable(),
    errorMsg: z.string().nullable(),
  })
  .openapi('SmsSendResult');
