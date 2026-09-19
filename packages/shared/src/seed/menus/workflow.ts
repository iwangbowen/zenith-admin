import type { Menu } from '../../identity/contracts';
import { SEED_DATE } from '../_base';

/** 工作流引擎（4000 段）— 按角色分三组:审批中心(4200)/流程管理(4300)/运维与集成(4400) */
export const SEED_MENUS_WORKFLOW: Menu[] = [
  { id: 4000, parentId: 0, title: '工作流引擎', name: 'Workflow', icon: 'GitFork', type: 'directory', sort: 6, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ─── 审批中心（全员日常）───────────────────────────────────────────────
  { id: 4200, parentId: 4000, title: '审批中心', name: 'WorkflowApprovalCenter', icon: 'Inbox', type: 'directory', sort: 0, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4010, parentId: 4200, title: '发起工作台', name: 'WorkflowLaunchpad', path: '/workflow/launchpad', component: 'workflow/launchpad/WorkflowLaunchpadPage', icon: 'LayoutGrid', type: 'menu', sort: 0, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4080, parentId: 4200, title: '待我审批', name: 'PendingApprovals', path: '/workflow/pending', component: 'workflow/tasks/PendingApprovalsPage', icon: 'ClipboardCheck', type: 'menu', sort: 1, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4070, parentId: 4200, title: '我的申请', name: 'MyApplications', path: '/workflow/applications', component: 'workflow/instances/MyApplicationsPage', icon: 'FilePlus2', type: 'menu', sort: 2, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4090, parentId: 4200, title: '抄送我的', name: 'WorkflowCcToMe', path: '/workflow/cc', component: 'workflow/cc/CcToMePage', icon: 'Send', type: 'menu', sort: 3, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4100, parentId: 4200, title: '我已办', name: 'WorkflowHandled', path: '/workflow/handled', component: 'workflow/handled/HandledPage', icon: 'CircleCheckBig', type: 'menu', sort: 4, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4160, parentId: 4200, title: '审批代理', name: 'WorkflowDelegations', path: '/workflow/delegations', component: 'workflow/delegations/WorkflowDelegationsPage', icon: 'UserRoundCog', type: 'menu', sort: 5, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ─── 流程管理（流程管理员）─────────────────────────────────────────────
  { id: 4300, parentId: 4000, title: '流程管理', name: 'WorkflowManagement', icon: 'PencilRuler', type: 'directory', sort: 1, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4020, parentId: 4300, title: '流程定义', name: 'WorkflowDefinitions', path: '/workflow/definitions', component: 'workflow/definitions/WorkflowDefinitionsPage', icon: 'Workflow', type: 'menu', sort: 0, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4030, parentId: 4020, title: '流程设计', name: 'WorkflowDesigner', path: '/workflow/designer', component: 'workflow/designer/WorkflowDesignerPage', icon: 'PencilRuler', type: 'menu', sort: 5, status: 'enabled', visible: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4040, parentId: 4300, title: '流程模板', name: 'WorkflowTemplates', path: '/workflow/templates', component: 'workflow/templates/WorkflowTemplatesPage', icon: 'LayoutTemplate', type: 'menu', sort: 1, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4050, parentId: 4300, title: '表单库', name: 'WorkflowForms', path: '/workflow/forms', component: 'workflow/forms/WorkflowFormsPage', icon: 'LayoutList', type: 'menu', sort: 2, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4060, parentId: 4050, title: '表单设计', name: 'WorkflowFormDesigner', path: '/workflow/forms/designer', component: 'workflow/forms/WorkflowFormDesignerPage', icon: 'PencilRuler', type: 'menu', sort: 4, status: 'enabled', visible: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4140, parentId: 4300, title: '流程自动化', name: 'WorkflowAutomations', path: '/workflow/automations', component: 'workflow/automations/WorkflowAutomationsPage', icon: 'Bot', type: 'menu', sort: 3, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4170, parentId: 4300, title: '定时发起', name: 'WorkflowSchedules', path: '/workflow/schedules', component: 'workflow/schedules/WorkflowSchedulesPage', icon: 'CalendarClock', type: 'menu', sort: 4, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ─── 运维与集成（运维人员）─────────────────────────────────────────────
  { id: 4400, parentId: 4000, title: '运维与集成', name: 'WorkflowOps', icon: 'Activity', type: 'directory', sort: 2, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4110, parentId: 4400, title: '流程监控', name: 'WorkflowMonitor', path: '/workflow/monitor', component: 'workflow/monitor/WorkflowMonitorPage', icon: 'BarChart2', type: 'menu', sort: 0, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4150, parentId: 4400, title: '健康巡检', name: 'WorkflowHealth', path: '/workflow/health', component: 'workflow/health/WorkflowHealthPage', icon: 'Stethoscope', type: 'menu', sort: 1, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4120, parentId: 4400, title: '事件订阅', name: 'WorkflowEventSubscriptions', path: '/workflow/event-subscriptions', component: 'workflow/event-subscriptions/WorkflowEventSubscriptionsPage', icon: 'Webhook', type: 'menu', sort: 2, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4130, parentId: 4400, title: '触发器执行', name: 'WorkflowTriggerExecutions', path: '/workflow/trigger-executions', component: 'workflow/trigger-executions/WorkflowTriggerExecutionsPage', icon: 'Zap', type: 'menu', sort: 3, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4180, parentId: 4400, title: '远程数据源', name: 'WorkflowDataSources', path: '/workflow/data-sources', component: 'workflow/data-sources/WorkflowDataSourcesPage', icon: 'DatabaseZap', type: 'menu', sort: 4, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4190, parentId: 4400, title: '连接器', name: 'WorkflowConnectors', path: '/workflow/connectors', component: 'workflow/connectors/WorkflowConnectorsPage', icon: 'Cable', type: 'menu', sort: 5, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ─── 会话中心（5000 段）
];
