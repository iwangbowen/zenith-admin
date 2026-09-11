/**
 * 审批单打印的流程级配置读取（轻量：只依赖 db / schema）。
 * 打印渲染主链路与归档作业注册都从这里取配置，避免作业注册模块被拖进 pdf / 报表渲染的大模块图。
 */
import { eq } from 'drizzle-orm';
import type { WorkflowFlowData, WorkflowPrintSettings } from '@zenith/shared/workflow';
import { db } from '../../db';
import { workflowDefinitions } from '../../db/schema';

export interface DefinitionPrintConfig {
  templateId: number | null;
  settings: WorkflowPrintSettings;
}

/** 流程定义上的打印配置：绑定模板列 + flowData.settings.print（实例快照的设置随定义变化，打印按当前定义生效） */
export async function loadDefinitionPrintConfig(definitionId: number): Promise<DefinitionPrintConfig> {
  const [row] = await db.select({ printTemplateId: workflowDefinitions.printTemplateId, flowData: workflowDefinitions.flowData })
    .from(workflowDefinitions).where(eq(workflowDefinitions.id, definitionId)).limit(1);
  const settings = (row?.flowData as WorkflowFlowData | null)?.settings?.print ?? {};
  return { templateId: row?.printTemplateId ?? null, settings };
}
