import * as z from 'zod';
import { defineSettingsModule } from '../module-def';

/** 工作流引擎健康度阈值（引擎诊断面板的告警分档） */
export const workflowSettingsSchema = z.object({
  engine: z.object({
    healthWarn: z.number().min(0).max(100).default(90).meta({ title: '健康分预警线', description: '低于该分值显示 warning' }),
    healthCritical: z.number().min(0).max(100).default(70).meta({ title: '健康分严重线', description: '低于该分值显示 critical' }),
    backlogWarn: z.int().min(0).default(50).meta({ title: '积压预警数', description: '待处理任务超过该数量视为预警' }),
    backlogCritical: z.int().min(0).default(200).meta({ title: '积压严重数' }),
    errorRateWarn: z.number().min(0).max(1).default(0.05).meta({ title: '错误率预警', description: '0–1 之间的比例' }),
    errorRateCritical: z.number().min(0).max(1).default(0.15).meta({ title: '错误率严重' }),
    apdexThresholdMs: z.int().min(1).default(100).meta({ title: 'Apdex 满意阈值（ms）' }),
  }).prefault({}).meta({ title: '引擎健康度' }),
}).meta({ id: 'Settings.Workflow' });

export type WorkflowSettings = z.output<typeof workflowSettingsSchema>;

export const workflowSettingsModule = defineSettingsModule({
  schema: workflowSettingsSchema,
  title: '工作流引擎',
  description: '引擎诊断的健康分、积压与错误率阈值',
  scope: 'platform',
  feature: 'workflow',
  readPermission: 'system:setting:view',
  writePermission: 'system:setting:update',
  sort: 100,
});
