import { HTTPException } from 'hono/http-exception';
import type { WorkflowCustomFormConfig, WorkflowDefinitionSnapshot } from '@zenith/shared/workflow';
import type { WorkflowBusinessAdapter, WorkflowBusinessInstance } from './workflow-business-types';

const adapters = new Map<string, WorkflowBusinessAdapter>();
let sealed = false;
export function registerWorkflowBusinessAdapter(adapter: WorkflowBusinessAdapter): void {
  if (sealed) throw new Error('工作流业务目录已经冻结');
  if (adapters.has(adapter.businessType)) throw new Error(`工作流业务适配器重复注册：${adapter.businessType}`);
  adapters.set(adapter.businessType, Object.freeze({ ...adapter }));
}
export function sealWorkflowBusinessAdapters(): void { sealed = true; }

export function getWorkflowBusinessAdapter(businessType: string | null | undefined): WorkflowBusinessAdapter | undefined {
  return businessType ? adapters.get(businessType) : undefined;
}

export function getWorkflowDefinitionBusinessAdapter(definition: Pick<WorkflowDefinitionSnapshot, 'formType' | 'customForm'>): WorkflowBusinessAdapter | undefined {
  if (definition.formType !== 'custom') return undefined;
  const businessType = (definition.customForm as WorkflowCustomFormConfig | null)?.businessType;
  if (!businessType) return undefined;
  const adapter = getWorkflowBusinessAdapter(businessType);
  if (!adapter) throw new HTTPException(400, { message: '流程配置的业务适配器未注册，请联系管理员' });
  return adapter;
}

export function getWorkflowInstanceBusinessAdapter(instance: Pick<WorkflowBusinessInstance, 'bizType' | 'definitionSnapshot'>): WorkflowBusinessAdapter | undefined {
  const definition = instance.definitionSnapshot;
  const configured = definition ? getWorkflowDefinitionBusinessAdapter(definition) : undefined;
  if (configured && instance.bizType !== configured.businessType) throw new HTTPException(409, { message: '流程实例的业务关联与冻结定义不一致，请联系管理员核对' });
  return configured ?? getWorkflowBusinessAdapter(instance.bizType);
}
