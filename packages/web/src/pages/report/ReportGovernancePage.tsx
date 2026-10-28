import { TabPane, Tabs } from '@douyinfe/semi-ui';
import GovernanceCapacityTab from './governance/GovernanceCapacityTab';
import GovernanceEnvironmentTab from './governance/GovernanceEnvironmentTab';
import GovernanceResourceTab from './governance/GovernanceResourceTab';
import GovernanceSlaTab from './governance/GovernanceSlaTab';
import { GovernanceApprovalTab, GovernanceTransferTab } from './governance/GovernanceWorkflowTabs';

import { useUrlTabState } from '@/hooks/useUrlTabState';
import { usePermission } from '@/hooks/usePermission';
export default function ReportGovernancePage() {
  const { hasPermission } = usePermission();
  const visible = {
    resources: hasPermission('report:folder:list') || hasPermission('report:resource:acl'),
    approvals: hasPermission('report:approval:list'),
    transfers: hasPermission('report:resource:transfer'),
    environments: hasPermission('report:environment:list') && hasPermission('report:environment:promote'),
    capacity: hasPermission('report:query-quota:list') && hasPermission('report:query-cost:list'),
    sla: hasPermission('report:sla:list'),
  };
  const [activeTab, setActiveTab] = useUrlTabState(['resources', 'approvals', 'transfers', 'environments', 'capacity', 'sla'] as const, 'resources');
  const fallbackTab = (Object.keys(visible).find((key) => visible[key as keyof typeof visible]) ?? 'resources') as typeof activeTab;
  const safeActiveTab = visible[activeTab] ? activeTab : fallbackTab;
  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" type="line" activeKey={safeActiveTab} onChange={(k) => setActiveTab(k as typeof activeTab)}>
        {visible.resources && <TabPane tab="目录与资源权限" itemKey="resources"><GovernanceResourceTab /></TabPane>}
        {visible.approvals && <TabPane tab="发布审批" itemKey="approvals"><GovernanceApprovalTab /></TabPane>}
        {visible.transfers && <TabPane tab="所有权转移" itemKey="transfers"><GovernanceTransferTab /></TabPane>}
        {visible.environments && <TabPane tab="环境与发布" itemKey="environments"><GovernanceEnvironmentTab /></TabPane>}
        {visible.capacity && <TabPane tab="配额与成本" itemKey="capacity"><GovernanceCapacityTab /></TabPane>}
        {visible.sla && <TabPane tab="SLA 与违规" itemKey="sla"><GovernanceSlaTab /></TabPane>}
      </Tabs>
    </div>
  );
}
