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
  aliases: z.array(z.string()).optional().meta({ description: '用户常用表头别名（用于自动映射）' }),
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

export const importInspectionSchema = z.object({
  entity: z.string(),
  filename: z.string().nullable(),
  headers: z.array(z.string()),
  rowCount: z.int(),
  sample: z.array(z.record(z.string(), z.string())),
  suggestedMapping: z.record(z.string(), z.string().nullable()),
}).meta({ id: 'ImportInspection' });
export type ImportInspection = z.infer<typeof importInspectionSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const importEntityParam = z.object({
  entity: z.string().min(1).max(64).meta({ description: '导入实体标识', example: 'member.members' }),
});
export const importTaskParam = z.object({ id: z.coerce.number().int().positive() });

/**
 * 导入中心：历史 / 进度 / 行级明细复用任务中心接口（taskType `data-import`）。
 * 文件先经文件中心 `fileContract.upload` 上传拿到 fileId，再提交导入任务。
 */
export const importJobContract = defineContract('/api/import-jobs', {
  entities: op.get('/entities', { access: 'authenticated', response: z.array(importEntityMetaSchema), summary: '可导入实体列表（按权限过滤）' }),
  template: op.get('/{entity}/template', { access: 'authenticated', params: importEntityParam, kind: 'file', summary: '下载导入模板' }),
  inspect: op.post('/inspect', { access: 'authenticated', audit: { description: '预览导入文件', recordBody: false }, body: submitImportJobSchema.pick({ entity: true, fileId: true, context: true }), response: importInspectionSchema, summary: '读取导入文件表头与样例（不创建任务）' }),
  submit: op.post('/', { access: 'authenticated', audit: '提交数据导入任务', body: submitImportJobSchema, response: asyncTaskSchema, summary: '提交导入任务（文件先经 /api/files/upload 上传）' }),
  confirm: op.post('/{id}/confirm', { access: 'authenticated', audit: '确认导入预检结果', params: importTaskParam, response: asyncTaskSchema, summary: '将通过预检的任务转为正式导入' }),
  errorFile: op.get('/{id}/error-file', { access: 'authenticated', params: importTaskParam, kind: 'file', summary: '下载导入错误行文件' }),
}, { auditModule: '导入中心', tags: ['ImportJobs'] });
