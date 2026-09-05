import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { submitImportJobSchema } from '../validation';
import { asyncTaskSchema } from './async-tasks';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 导入模板列说明（模板生成与前端展示共用） */
export const importColumnMetaSchema = z.object({
  key: z.string(),
  header: z.string().meta({ description: '表头文案（上传文件按它定位列）' }),
  required: z.boolean().optional(),
  example: z.string().optional().meta({ description: '示例值（模板示例行）' }),
  enumValues: z.array(z.string()).optional().meta({ description: '枚举可选值（模板做数据验证下拉）' }),
  note: z.string().optional().meta({ description: '补充说明（如格式要求）' }),
}).meta({ id: 'ImportColumnMeta' });

export type ImportColumnMeta = z.infer<typeof importColumnMetaSchema>;

/** 可导入实体元信息（按权限过滤后返回前端） */
export const importEntityMetaSchema = z.object({
  entity: z.string().meta({ example: 'member.members' }),
  title: z.string(),
  module: z.string(),
  description: z.string().nullable(),
  maxRows: z.int().meta({ description: '单文件最大数据行数' }),
  requiresContext: z.boolean().meta({ description: '是否需要页面上下文（如 CMS 内容的 siteId/channelId），需到业务页面发起导入' }),
  columns: z.array(importColumnMetaSchema),
}).meta({ id: 'ImportEntityMeta' });

export type ImportEntityMeta = z.infer<typeof importEntityMetaSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const importEntityParam = z.object({
  entity: z.string().min(1).max(64).meta({ description: '导入实体标识', example: 'member.members' }),
});

/**
 * 导入中心：历史 / 进度 / 行级明细复用任务中心接口（taskType `data-import`）。
 * 文件先经文件中心 `fileContract.upload` 上传拿到 fileId，再提交导入任务。
 */
export const importJobContract = defineContract('/api/import-jobs', {
  entities: op.get('/entities', { response: z.array(importEntityMetaSchema), summary: '可导入实体列表（按权限过滤）' }),
  template: op.get('/{entity}/template', { params: importEntityParam, kind: 'file', summary: '下载导入模板' }),
  submit: op.post('/', { body: submitImportJobSchema, response: asyncTaskSchema, summary: '提交导入任务（文件先经 /api/files/upload 上传）' }),
}, { tags: ['ImportJobs'] });
