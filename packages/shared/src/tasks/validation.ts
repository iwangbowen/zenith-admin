import * as z from 'zod';
import { EXPORT_JOB_FORMATS, EXPORT_JOB_REQUEST_MODES, TASK_DEMO_TYPES } from './constants';

export const createExportJobSchema = z.object({
  entity: z.string().min(1, '导出实体不能为空').max(128),
  format: z.enum(EXPORT_JOB_FORMATS).default('xlsx'),
  query: z.record(z.string(), z.unknown()).default({}),
  columns: z.array(z.string().min(1).max(128)).optional(),
  raw: z.boolean().default(false),
  watermark: z.boolean().default(true),
  executionMode: z.enum(EXPORT_JOB_REQUEST_MODES).default('sync'),
});

export type CreateExportJobInput = z.infer<typeof createExportJobSchema>;

/** 提交数据导入任务 */
export const submitImportJobSchema = z.object({
  entity: z.string().min(1).max(64),
  /** 文件中心 fileId（先经 `fileContract.upload` 上传） */
  fileId: z.string().min(8).max(64),
  /** 预检模式：仅逐行校验不落库，输出行级校验报告 */
  dryRun: z.boolean().optional(),
  /** 实体上下文参数（如 CMS 内容导入的 siteId/channelId），由实体的 contextSchema 校验 */
  context: z.record(z.string(), z.unknown()).optional(),
});

export type SubmitImportJobInput = z.infer<typeof submitImportJobSchema>;

/** 更新任务类型运行时策略 */
export const updateAsyncTaskTypePolicySchema = z.object({
  enabled: z.boolean(),
  allowConcurrent: z.boolean(),
  maxAttempts: z.number().int().min(1).max(10),
  retryDelayMs: z.number().int().min(1000).max(900_000),
  retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
});

export type UpdateAsyncTaskTypePolicyInput = z.infer<typeof updateAsyncTaskTypePolicySchema>;

/** 提交演示异步任务 */
export const submitTaskDemoSchema = z.object({
  taskType: z.enum(TASK_DEMO_TYPES),
  totalItems: z.number().int().min(1).max(10000).optional(),
  itemDelayMs: z.number().int().min(10).max(5000).optional(),
  failAtItem: z.number().int().min(1).max(10000).nullable().optional(),
  failEveryN: z.number().int().min(2).max(10000).nullable().optional(),
  stageDelayMs: z.number().int().min(500).max(30000).optional(),
  /** 幂等键（可选）：相同 key 重复提交返回同一任务 */
  idempotencyKey: z.string().min(1).max(128).nullable().optional(),
});

export type SubmitTaskDemoInput = z.infer<typeof submitTaskDemoSchema>;
