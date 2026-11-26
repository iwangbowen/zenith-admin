import { definePermissions } from '../core/permissions';

/**
 * workflow 域权限码注册表：code → 权限标题 / 所属页面（菜单 name）。
 * 操作权限只存在于本注册表；契约操作 / 路由门禁 / 前端按钮以 `Permission` 类型引用。
 * `uiOnly` = 服务端没有任何接口检查该码（纯前端门控或待清理）。
 */
const WORKFLOW_CONTROL = { riskLevel: 'critical', approvalPolicy: 'two_person', reviewIntervalDays: 30, selfRequestable: false } as const;
const WORKFLOW_ADMIN = { riskLevel: 'high', approvalPolicy: 'manager_security', reviewIntervalDays: 90, selfRequestable: false } as const;

export const WORKFLOW_PERMISSIONS = definePermissions({
  'workflow:instance:create': { label: '发起申请', menu: ['WorkflowLaunchpad', 'MyApplications'] },
  'workflow:task:list': { label: '查看审批任务', menu: ['PendingApprovals', 'WorkflowHandled'] },
  'workflow:task:handle': { label: '处理审批任务', menu: ['PendingApprovals', 'WorkflowHandled'] },
  'workflow:instance:print': { label: '打印审批单', menu: ['PendingApprovals', 'MyApplications', 'WorkflowMonitor'] },
  'workflow:instance:list': { label: '查询', menu: ['MyApplications', 'WorkflowCcToMe'] },
  'workflow:instance:collaborate': { label: '催办、评论、转发与保存视图', menu: ['MyApplications', 'WorkflowCcToMe'] },
  'workflow:delegation:view': { label: '查询', menu: 'WorkflowDelegations' },
  'workflow:delegation:manage': { label: '管理审批代理', menu: 'WorkflowDelegations' },
  'workflow:definition:list': { label: '查询', menu: ['WorkflowDefinitions', 'WorkflowTemplates', 'WorkflowAutomations'] },
  'workflow:definition:create': { label: '新建流程', menu: 'WorkflowDefinitions', ...WORKFLOW_CONTROL },
  'workflow:definition:edit': { label: '编辑流程 / 自动化规则', menu: ['WorkflowDefinitions', 'WorkflowAutomations'], ...WORKFLOW_CONTROL },
  'workflow:definition:delete': { label: '删除流程', menu: 'WorkflowDefinitions', ...WORKFLOW_CONTROL },
  'workflow:definition:publish': { label: '发布/禁用', menu: 'WorkflowDefinitions', ...WORKFLOW_CONTROL },
  'workflow:form:list': { label: '查询', menu: 'WorkflowForms' },
  'workflow:form:create': { label: '新建表单', menu: 'WorkflowForms' },
  'workflow:form:edit': { label: '编辑表单', menu: 'WorkflowForms' },
  'workflow:form:delete': { label: '删除表单', menu: 'WorkflowForms' },
  'workflow:schedule:list': { label: '查询', menu: 'WorkflowSchedules' },
  'workflow:schedule:create': { label: '新建定时', menu: 'WorkflowSchedules' },
  'workflow:schedule:edit': { label: '编辑定时', menu: 'WorkflowSchedules' },
  'workflow:schedule:delete': { label: '删除定时', menu: 'WorkflowSchedules' },
  'workflow:instance:monitor': { label: '查询', menu: 'WorkflowMonitor' },
  'workflow:instance:cancel': { label: '取消流程', menu: 'WorkflowMonitor', ...WORKFLOW_ADMIN },
  'workflow:instance:delete': { label: '删除流程', menu: 'WorkflowMonitor', ...WORKFLOW_ADMIN },
  'workflow:instance:intervene': { label: '强制干预', menu: 'WorkflowMonitor', ...WORKFLOW_CONTROL },
  'workflow:engine:platform': { label: '平台流程观测', menu: 'WorkflowMonitor', ...WORKFLOW_CONTROL },
  'workflow:engine:operate': { label: '引擎运维', menu: 'WorkflowMonitor', ...WORKFLOW_CONTROL },
  'workflow:task:handover': { label: '离职交接', menu: 'WorkflowMonitor', ...WORKFLOW_ADMIN },
  'workflow:health:view': { label: '查询', menu: 'WorkflowHealth' },
  'workflow:event-subscription:view': { label: '查询', menu: 'WorkflowEventSubscriptions' },
  'workflow:event-subscription:create': { label: '新建订阅', menu: 'WorkflowEventSubscriptions' },
  'workflow:event-subscription:edit': { label: '编辑订阅', menu: 'WorkflowEventSubscriptions' },
  'workflow:event-subscription:delete': { label: '删除订阅', menu: 'WorkflowEventSubscriptions' },
  'workflow:event-delivery:view': { label: '投递记录', menu: 'WorkflowEventSubscriptions' },
  'workflow:event-delivery:retry': { label: '重试投递', menu: 'WorkflowEventSubscriptions' },
  'workflow:trigger-execution:view': { label: '查询', menu: 'WorkflowTriggerExecutions' },
  'workflow:datasource:list': { label: '查询', menu: 'WorkflowDataSources' },
  'workflow:datasource:create': { label: '新增数据源', menu: 'WorkflowDataSources' },
  'workflow:datasource:update': { label: '编辑数据源', menu: 'WorkflowDataSources' },
  'workflow:datasource:delete': { label: '删除数据源', menu: 'WorkflowDataSources' },
  'workflow:connector:list': { label: '查询', menu: 'WorkflowConnectors' },
  'workflow:connector:create': { label: '新增连接器', menu: 'WorkflowConnectors' },
  'workflow:connector:update': { label: '编辑连接器', menu: 'WorkflowConnectors' },
  'workflow:connector:delete': { label: '删除连接器', menu: 'WorkflowConnectors' },
  'workflow:connector:test': { label: '测试连接器', menu: 'WorkflowConnectors' },
});
