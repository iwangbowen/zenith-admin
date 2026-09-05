import * as z from 'zod';
import { batchIdsBody, entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { CMS_FORM_CAPTCHA_PROVIDERS, CMS_FORM_FIELD_TYPES } from '../constants';
import { createCmsFormSchema, updateCmsFormSchema } from '../validation';
import { cmsSeoListQuery } from './seo';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const cmsFormFieldViewSchema = z.object({
  name: z.string(),
  label: z.string(),
  fieldType: z.enum(CMS_FORM_FIELD_TYPES),
  required: z.boolean(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).nullable().optional(),
  minLength: z.int().nullable().optional(),
  maxLength: z.int().nullable().optional(),
  pattern: z.string().nullable().optional(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
}).meta({ id: 'CmsFormField' });

export type CmsFormField = z.infer<typeof cmsFormFieldViewSchema>;

export const cmsFormSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  code: z.string().meta({ example: 'contact' }),
  name: z.string(),
  fields: z.array(cmsFormFieldViewSchema),
  successMessage: z.string().nullable(),
  notifyEmail: z.string().nullable().meta({ description: '新提交通知邮箱（逗号分隔多个）' }),
  captchaProvider: z.enum(CMS_FORM_CAPTCHA_PROVIDERS),
  turnstileSiteKey: z.string().nullable(),
  turnstileSecret: z.string().nullable().meta({ description: 'write-only 掩码；空串/掩码保留，null 清除' }),
  status: entityStatusSchema,
  submissionCount: z.int().optional().meta({ description: '提交数（列表返回）' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsForm' });

export type CmsForm = z.infer<typeof cmsFormSchema>;

export const cmsFormSubmissionSchema = z.object({
  id: z.int(),
  formId: z.int(),
  data: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'CmsFormSubmission' });

export type CmsFormSubmission = z.infer<typeof cmsFormSubmissionSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsFormContract = defineContract('/api/cms/forms', {
  list: op.get('/', { query: cmsSeoListQuery, response: paginated(cmsFormSchema), summary: '表单分页列表' }),
  create: op.post('/', { body: createCmsFormSchema, response: cmsFormSchema, summary: '创建表单' }),
  update: op.put('/{id}', { params: idParam, body: updateCmsFormSchema, response: cmsFormSchema, summary: '更新表单' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除表单（含全部提交数据）' }),
  submissions: op.get('/{id}/submissions', { params: idParam, query: paginationQuery, response: paginated(cmsFormSubmissionSchema), summary: '表单提交数据列表' }),
  deleteSubmissions: op.post('/{id}/submissions/delete', { params: idParam, body: batchIdsBody, summary: '批量删除提交数据' }),
}, { tags: ['CMS-表单管理'] });
