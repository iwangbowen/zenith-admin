import type { WorkflowDefinition } from '@zenith/shared/workflow';

/** 是否可在轻页发起：仅设计器表单（业务自定义表单需到桌面端）；发起人自选审批人已由轻页选人组件支持 */
export function canLaunchOnMobile(def: Pick<WorkflowDefinition, 'formType' | 'customForm'>): boolean {
  return def.formType === 'designer' || (def.formType === 'custom' && def.customForm?.createComponent === 'biz/access/AccessRequestWorkflowForm');
}
