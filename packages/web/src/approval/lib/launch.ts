import type { WorkflowDefinition } from '@zenith/shared';

/** 是否可在轻页发起：仅设计器表单且不含「发起人自选审批人」节点 */
export function canLaunchOnMobile(def: WorkflowDefinition): boolean {
  if (def.formType !== 'designer') return false;
  const hasInitiatorSelect = def.flowData?.nodes.some(
    (n) => n.data.assigneeType === 'initiatorSelect' || n.data.assigneeType === 'initiatorSelectScope',
  ) ?? false;
  return !hasInitiatorSelect;
}
