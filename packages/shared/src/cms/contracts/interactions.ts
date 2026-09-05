import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import {
  CMS_INTERACTION_CAPTCHA_POLICIES,
  CMS_INTERACTION_CONDITION_OPS,
  CMS_INTERACTION_KINDS,
  CMS_INTERACTION_PARTICIPANT_SCOPES,
  CMS_INTERACTION_QUESTION_TYPES,
  CMS_INTERACTION_REPEAT_POLICIES,
  CMS_INTERACTION_RESULT_VISIBILITIES,
  CMS_INTERACTION_STATUSES,
} from '../constants';
import {
  batchCmsInteractionStatusSchema,
  createCmsInteractionSchema,
  setCmsInteractionStatusSchema,
  updateCmsInteractionSchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const cmsInteractionKindSchema = z.enum(CMS_INTERACTION_KINDS);

export const cmsInteractionStatusSchema = z.enum(CMS_INTERACTION_STATUSES);

export const cmsInteractionQuestionTypeSchema = z.enum(CMS_INTERACTION_QUESTION_TYPES);

export const cmsInteractionOptionViewSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
}).meta({ id: 'CmsInteractionOption' });

export type CmsInteractionOption = z.infer<typeof cmsInteractionOptionViewSchema>;

/** 矩阵题的行定义（列复用 options） */
export const cmsInteractionMatrixRowViewSchema = z.object({
  id: z.string(),
  label: z.string(),
}).meta({ id: 'CmsInteractionMatrixRow' });

export type CmsInteractionMatrixRow = z.infer<typeof cmsInteractionMatrixRowViewSchema>;

/** 条件显示：依赖同一问卷中排在前面的某道选择题 */
export const cmsInteractionVisibleWhenViewSchema = z.object({
  questionIndex: z.int().meta({ description: '依赖题目的 0 基序号，必须小于当前题目序号' }),
  op: z.enum(CMS_INTERACTION_CONDITION_OPS),
  values: z.array(z.string()).meta({ description: '触发的选项 value 列表' }),
}).meta({ id: 'CmsInteractionVisibleWhen' });

export type CmsInteractionVisibleWhen = z.infer<typeof cmsInteractionVisibleWhenViewSchema>;

export const cmsInteractionQuestionViewSchema = z.object({
  id: z.int(),
  interactionId: z.int(),
  label: z.string().meta({ example: '您最常用的功能是？' }),
  type: cmsInteractionQuestionTypeSchema,
  required: z.boolean(),
  options: z.array(cmsInteractionOptionViewSchema),
  minChoices: z.int(),
  maxChoices: z.int(),
  sort: z.int(),
  allowOther: z.boolean().meta({ description: '单选/多选题是否提供「其他 ___」填空' }),
  otherLabel: z.string().nullable(),
  ratingMax: z.int().meta({ description: '评分题上限；NPS 固定 0-10' }),
  matrixRows: z.array(cmsInteractionMatrixRowViewSchema),
  pageNo: z.int().meta({ description: '分页问卷页码，从 1 开始' }),
  visibleWhen: cmsInteractionVisibleWhenViewSchema.nullable(),
}).meta({ id: 'CmsInteractionQuestion' });

export type CmsInteractionQuestion = z.infer<typeof cmsInteractionQuestionViewSchema>;

export const cmsInteractionSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  code: z.string().meta({ example: 'product-feedback-2026' }),
  kind: cmsInteractionKindSchema,
  title: z.string().meta({ example: '产品反馈互动' }),
  description: z.string().nullable(),
  status: cmsInteractionStatusSchema,
  participantScope: z.enum(CMS_INTERACTION_PARTICIPANT_SCOPES),
  repeatPolicy: z.enum(CMS_INTERACTION_REPEAT_POLICIES),
  resultVisibility: z.enum(CMS_INTERACTION_RESULT_VISIBILITIES),
  captchaPolicy: z.enum(CMS_INTERACTION_CAPTCHA_POLICIES),
  turnstileSiteKey: z.string().nullable(),
  turnstileSecretConfigured: z.boolean(),
  thankYouMessage: z.string(),
  startAt: z.string().nullable(),
  endAt: z.string().nullable(),
  responseCount: z.int(),
  questions: z.array(cmsInteractionQuestionViewSchema).optional().meta({ description: '详情 / 写接口返回，分页列表省略' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsInteraction' });

export type CmsInteraction = z.infer<typeof cmsInteractionSchema>;

const cmsInteractionStatOptionSchema = cmsInteractionOptionViewSchema.extend({
  count: z.int(),
  percent: z.number().meta({ description: '按已答人数计算的百分比（0-100，1 位小数）' }),
});

/** 单题统计。选择题看 options，评分/NPS/数字看 average，矩阵看 matrixRows */
export const cmsInteractionQuestionStatsSchema = z.object({
  id: z.int(),
  label: z.string(),
  type: cmsInteractionQuestionTypeSchema,
  options: z.array(cmsInteractionStatOptionSchema),
  texts: z.array(z.string()).meta({ description: '文字题 / 「其他」填空的最近样本（最多 50 条）' }),
  answered: z.int().meta({ description: '该题实际作答人数（条件显示题会小于总答卷数）' }),
  average: z.number().nullable().meta({ description: '评分 / NPS / 数字题均值' }),
  npsScore: z.number().nullable().meta({ description: 'NPS 净推荐值（推荐者% - 贬损者%）' }),
  matrixRows: z.array(z.object({
    id: z.string(),
    label: z.string(),
    options: z.array(cmsInteractionStatOptionSchema),
  })),
}).meta({ id: 'CmsInteractionQuestionStats' });

export type CmsInteractionQuestionStats = z.infer<typeof cmsInteractionQuestionStatsSchema>;

export const cmsInteractionStatsSchema = z.object({
  interactionId: z.int(),
  responseCount: z.int(),
  questions: z.array(cmsInteractionQuestionStatsSchema),
}).meta({ id: 'CmsInteractionStats' });

export type CmsInteractionStats = z.infer<typeof cmsInteractionStatsSchema>;

/** 文本 / 日期 / 「其他」填空的单条答案样本 */
export const cmsInteractionTextAnswerSchema = z.object({
  responseId: z.int(),
  value: z.string(),
  createdAt: z.string(),
}).meta({ id: 'CmsInteractionTextAnswer' });

export type CmsInteractionTextAnswer = z.infer<typeof cmsInteractionTextAnswerSchema>;

/** 交叉分析：两道选择题的联合分布 */
export const cmsInteractionCrossStatsSchema = z.object({
  xQuestionId: z.int(),
  xLabel: z.string(),
  yQuestionId: z.int(),
  yLabel: z.string(),
  columns: z.array(z.object({ value: z.string(), label: z.string() })).meta({ description: '表头（Y 题选项）' }),
  rows: z.array(z.object({
    value: z.string(),
    label: z.string(),
    total: z.int(),
    cells: z.array(z.object({ count: z.int(), percent: z.number() })).meta({ description: '与 columns 等长' }),
  })),
}).meta({ id: 'CmsInteractionCrossStats' });

export type CmsInteractionCrossStats = z.infer<typeof cmsInteractionCrossStatsSchema>;

/** 答卷提交趋势（按天） */
export const cmsInteractionTrendStatsSchema = z.object({
  interactionId: z.int(),
  days: z.int(),
  points: z.array(z.object({ date: z.string(), count: z.int() })),
}).meta({ id: 'CmsInteractionTrendStats' });

export type CmsInteractionTrendStats = z.infer<typeof cmsInteractionTrendStatsSchema>;

/** 前台可公开的互动统计；文本答卷永不进入公共响应 */
export const cmsInteractionPublicStatsSchema = z.object({
  interactionId: z.int(),
  responseCount: z.int(),
  questions: z.array(z.object({
    id: z.int(),
    label: z.string(),
    type: cmsInteractionQuestionTypeSchema,
    options: z.array(cmsInteractionOptionViewSchema.extend({ count: z.int(), percent: z.number() })),
    average: z.number().nullable(),
    npsScore: z.number().nullable(),
  })),
}).meta({ id: 'CmsInteractionPublicStats' });

export type CmsInteractionPublicStats = z.infer<typeof cmsInteractionPublicStatsSchema>;

export const cmsInteractionSubmitResultSchema = z.object({
  responseId: z.int(),
  duplicate: z.boolean(),
  message: z.string(),
  results: cmsInteractionPublicStatsSchema.nullable(),
}).meta({ id: 'CmsInteractionSubmitResult' });

export type CmsInteractionSubmitResult = z.infer<typeof cmsInteractionSubmitResultSchema>;

export const cmsInteractionAnswerDetailSchema = z.object({
  questionId: z.int(),
  label: z.string(),
  type: cmsInteractionQuestionTypeSchema,
  values: z.array(z.string()).meta({ description: '选择题为命中的选项文案；文本题为单元素数组' }),
  display: z.string().meta({ description: '拼接后的展示文案（多选用「、」连接）' }),
}).meta({ id: 'CmsInteractionAnswerDetail' });

export type CmsInteractionAnswerDetail = z.infer<typeof cmsInteractionAnswerDetailSchema>;

export const cmsInteractionResponseSchema = z.object({
  id: z.int(),
  interactionId: z.int(),
  interactionTitle: z.string(),
  kind: cmsInteractionKindSchema,
  memberId: z.int().nullable(),
  memberDisplay: z.string().nullable(),
  visitorHash: z.string(),
  ipHash: z.string(),
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  answerDetails: z.array(cmsInteractionAnswerDetailSchema).meta({ description: '已关联题目的可读答案，按题目 sort 排序' }),
  createdAt: z.string(),
}).meta({ id: 'CmsInteractionResponse' });

export type CmsInteractionResponse = z.infer<typeof cmsInteractionResponseSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const cmsInteractionListQuery = paginationQuery.extend({
  siteId: z.coerce.number().int().positive(),
  keyword: z.string().optional(),
  kind: cmsInteractionKindSchema.optional(),
  status: cmsInteractionStatusSchema.optional(),
});

export const cmsInteractionResponseListQuery = paginationQuery.extend({
  siteId: z.coerce.number().int().positive(),
  interactionId: z.coerce.number().int().positive().optional(),
  kind: cmsInteractionKindSchema.optional(),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
});

export const cmsInteractionTextsQuery = paginationQuery.extend({
  questionId: z.coerce.number().int().positive(),
  keyword: z.string().optional(),
});

export const cmsInteractionCrossQuery = z.object({
  xQuestionId: z.coerce.number().int().positive(),
  yQuestionId: z.coerce.number().int().positive(),
});

export const cmsInteractionTrendQuery = z.object({
  days: z.coerce.number().int().min(1).max(180).default(30),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsInteractionContract = defineContract('/api/cms/interactions', {
  list: op.get('/', { query: cmsInteractionListQuery, response: paginated(cmsInteractionSchema), summary: '统一互动问卷分页列表' }),
  responses: op.get('/responses', { query: cmsInteractionResponseListQuery, response: paginated(cmsInteractionResponseSchema), summary: '互动答卷明细（会员信息脱敏）' }),
  batchStatus: op.post('/batch/status', { body: batchCmsInteractionStatusSchema, response: asyncTaskSchema, summary: '批量发布/关闭互动问卷（任务中心）' }),
  detail: op.get('/{id}', { params: idParam, response: cmsInteractionSchema, summary: '互动问卷详情（含题目）' }),
  texts: op.get('/{id}/stats/texts', { params: idParam, query: cmsInteractionTextsQuery, response: paginated(cmsInteractionTextAnswerSchema), summary: '文本 / 日期 /「其他」填空答案分页' }),
  crossStats: op.get('/{id}/stats/cross', { params: idParam, query: cmsInteractionCrossQuery, response: cmsInteractionCrossStatsSchema, summary: '两道选择题的交叉分析' }),
  trend: op.get('/{id}/stats/trend', { params: idParam, query: cmsInteractionTrendQuery, response: cmsInteractionTrendStatsSchema, summary: '答卷提交趋势（按天）' }),
  stats: op.get('/{id}/stats', { params: idParam, response: cmsInteractionStatsSchema, summary: '统一互动结果统计' }),
  create: op.post('/', { body: createCmsInteractionSchema, response: cmsInteractionSchema, summary: '创建互动问卷' }),
  update: op.put('/{id}', { params: idParam, body: updateCmsInteractionSchema, response: cmsInteractionSchema, summary: '更新互动问卷' }),
  setStatus: op.post('/{id}/status', { params: idParam, body: setCmsInteractionStatusSchema, response: cmsInteractionSchema, summary: '流转互动问卷状态' }),
  copy: op.post('/{id}/copy', { params: idParam, response: cmsInteractionSchema, summary: '复制互动问卷（生成草稿副本）' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除互动问卷及全部答卷' }),
}, { tags: ['CMS-互动问卷'] });
