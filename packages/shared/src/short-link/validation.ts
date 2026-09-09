import * as z from 'zod';
import { httpUrl, partialForUpdate } from '../core/validation';
import {
  SHORT_LINK_CODE_MAX,
  SHORT_LINK_CODE_MIN,
  SHORT_LINK_CODE_PATTERN,
  SHORT_LINK_ENSURE_BIZ_TYPES,
  SHORT_LINK_REDIRECT_TYPES,
} from './constants';
import { entityStatusSchema } from '../core/api-schemas';

export const createShortLinkSchema = z.object({
  targetUrl: httpUrl('目标地址必须是合法的 http(s) URL').max(2048),
  /** 留空自动生成；自定义短码全局唯一 */
  code: z
    .string()
    .min(SHORT_LINK_CODE_MIN, `短码至少 ${SHORT_LINK_CODE_MIN} 个字符`)
    .max(SHORT_LINK_CODE_MAX)
    .regex(SHORT_LINK_CODE_PATTERN, '短码仅支持字母、数字、连字符与下划线')
    .optional(),
  title: z.string().max(128).nullable().optional(),
  redirectType: z.enum(SHORT_LINK_REDIRECT_TYPES).default('302'),
  status: entityStatusSchema.default('enabled'),
  /** YYYY-MM-DD HH:mm:ss；null = 永久有效 */
  expiresAt: z.string().max(19).nullable().optional(),
  maxVisits: z.number().int().positive().max(1_000_000_000).nullable().optional(),
  password: z
    .string()
    .min(4, '访问密码至少 4 位')
    .max(32)
    .nullable()
    .optional(),
  utmSource: z.string().max(128).nullable().optional(),
  utmMedium: z.string().max(128).nullable().optional(),
  utmCampaign: z.string().max(128).nullable().optional(),
  utmTerm: z.string().max(128).nullable().optional(),
  utmContent: z.string().max(128).nullable().optional(),
  remark: z.string().max(256).nullable().optional(),
});

/** code 一经分发不可变更，更新时不允许修改 */
export const updateShortLinkSchema = partialForUpdate(createShortLinkSchema.omit({ code: true }));

export const batchUpdateShortLinkStatusSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, '请选择要操作的记录'),
  status: entityStatusSchema,
});

/** 业务对象幂等取短链：同 bizType+bizRef 复用，目标地址变化时同步更新 */
export const ensureShortLinkSchema = z.object({
  targetUrl: httpUrl('目标地址必须是合法的 http(s) URL').max(2048),
  bizType: z.enum(SHORT_LINK_ENSURE_BIZ_TYPES),
  bizRef: z.string().min(1, '业务标识不能为空').max(64),
  title: z.string().max(128).nullable().optional(),
});

export type CreateShortLinkInput = z.infer<typeof createShortLinkSchema>;

export type UpdateShortLinkInput = z.infer<typeof updateShortLinkSchema>;

export type BatchUpdateShortLinkStatusInput = z.infer<typeof batchUpdateShortLinkStatusSchema>;

export type EnsureShortLinkInput = z.infer<typeof ensureShortLinkSchema>;
