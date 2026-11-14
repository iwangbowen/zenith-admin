import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { idParam } from '../../core/api-schemas';
import { EXPORT_JOB_FORMATS } from '../constants';
export const exportPresetInputSchema = z.object({
  name: z.string().trim().min(1).max(64), entity: z.string().min(1).max(128), format: z.enum(EXPORT_JOB_FORMATS),
  columns: z.array(z.string().min(1).max(128)).min(1).max(256).optional(),
  query: z.record(z.string(), z.unknown()).default({}),
  shared: z.boolean().default(false), cron: z.string().trim().min(9).max(100).nullable().default(null),
});
export const exportPresetSchema = exportPresetInputSchema.extend({ id: z.int(), createdBy: z.int().nullable(), nextRunAt: z.string().nullable(), lastJobId: z.int().nullable(), lastError: z.string().nullable(), createdAt: z.string() });
export type ExportPreset = z.infer<typeof exportPresetSchema>;
export const exportPresetContract = defineContract('/api/export-jobs', {
  listPresets: op.get('/presets', { access: 'authenticated', response: z.array(exportPresetSchema), summary: '我的和团队导出模板' }),
  createPreset: op.post('/presets', { access: 'authenticated', audit: '保存导出模板', body: exportPresetInputSchema, response: exportPresetSchema, summary: '保存个人/团队模板或定时导出' }),
  removePreset: op.delete('/presets/{id}', { access: 'authenticated', audit: '删除导出模板', params: idParam, summary: '删除模板并停止调度' }),
}, { auditModule: '导出中心', tags: ['ExportJobs'] });
