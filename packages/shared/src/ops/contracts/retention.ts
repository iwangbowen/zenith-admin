import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { RETENTION_MODES } from '../constants';
import { updateRetentionPolicySchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const retentionPolicySchema = z.object({
  key: z.string().meta({ description: '策略唯一键，等于目标物理表名', example: 'operation_logs' }),
  title: z.string().meta({ example: '操作日志' }),
  module: z.string().meta({ example: '系统管理' }),
  tableName: z.string().meta({ description: '目标物理表名', example: 'operation_logs' }),
  timeColumn: z.string().meta({ description: '裁剪依据的时间列（物理列名）', example: 'created_at' }),
  mode: z.enum(RETENTION_MODES),
  enabled: z.boolean(),
  retentionDays: z.int().meta({ description: '保留天数；0 表示不清理' }),
  defaultRetentionDays: z.int().meta({ description: '代码声明的默认保留天数，用于「恢复默认」' }),
  batchSize: z.int(),
  perTenant: z.boolean().meta({ description: '是否按租户各自的保留策略执行' }),
  capColumn: z.string().nullable().meta({ description: '`ageAndCap` 模式下的分组列' }),
  capLimit: z.int().nullable().meta({ description: '`ageAndCap` 模式下每组保留条数' }),
  description: z.string(),
  lastRunAt: z.string().nullable(),
  lastDeleted: z.int(),
}).meta({ id: 'RetentionPolicy' });

export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;

export const retentionPreviewSchema = z.object({
  key: z.string(),
  pending: z.int().meta({ description: '预计待删除行数' }),
  cutoff: z.string().nullable().meta({ description: '裁剪时间点；保留天数为 0 时为 null' }),
}).meta({ id: 'RetentionPreview' });

export type RetentionPreview = z.infer<typeof retentionPreviewSchema>;

export const retentionRunResultSchema = z.object({
  key: z.string(),
  deleted: z.int(),
}).meta({ id: 'RetentionRunResult' });

export type RetentionRunResult = z.infer<typeof retentionRunResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const retentionPolicyKeyParam = z.object({
  key: z.string().min(1).meta({ description: '策略键', example: 'operation_logs' }),
});

export const retentionPolicyContract = defineContract('/api/retention-policies', {
  list: op.get('/', { response: z.array(retentionPolicySchema), summary: '数据保留策略列表' }),
  update: op.put('/{key}', { params: retentionPolicyKeyParam, body: updateRetentionPolicySchema, response: retentionPolicySchema, summary: '更新保留策略' }),
  preview: op.get('/{key}/preview', { params: retentionPolicyKeyParam, response: retentionPreviewSchema, summary: '预览待清理行数' }),
  run: op.post('/{key}/run', { params: retentionPolicyKeyParam, response: retentionRunResultSchema, summary: '立即执行保留策略' }),
}, { tags: ['Retention'] });
