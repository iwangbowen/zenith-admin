import type { Permission } from '../core/permissions';

interface PageRouteRule {
  owner: string;
  path?: string;
  anyPermission?: readonly Permission[];
}

/** Keys are the stable names of installed pages. Navigation ancestry is presentation data. */
export const PAGE_ROUTE_RULES: Readonly<Partial<Record<string, PageRouteRule>>> = {
  WorkflowDesigner: { owner: 'WorkflowDefinitions', path: '/workflow/designer/:id', anyPermission: ['workflow:definition:list'] },
  WorkflowFormDesigner: { owner: 'WorkflowForms', anyPermission: ['workflow:form:create', 'workflow:form:edit'] },
  CmsContentEdit: { owner: 'CmsContents', anyPermission: ['cms:content:create', 'cms:content:update'] },
  CmsWidgetEdit: { owner: 'CmsWidgets', anyPermission: ['cms:widget:create', 'cms:widget:update'] },
  CmsInteractionEdit: { owner: 'CmsInteractions', anyPermission: ['cms:interaction:manage'] },
  WikiDocEdit: { owner: 'WikiDocCenter', anyPermission: ['wiki:doc:create', 'wiki:doc:edit'] },
  WikiDocHistory: { owner: 'WikiDocCenter' },
};

interface ContextRoute {
  path: string;
  component: string;
  /** Resource deep links use the same capabilities as their API and retain entity-level checks. */
  anyPermission: readonly Permission[];
  owner?: string;
  feature?: string;
}

export const ADMIN_CONTEXT_ROUTES: readonly ContextRoute[] = [
  { path: '/workflow/launch/:definitionId', component: 'workflow/launchpad/WorkflowLaunchPage', owner: 'WorkflowLaunchpad', anyPermission: ['workflow:instance:create'] },
  { path: '/workflow/instance/:id', component: 'workflow/instances/WorkflowInstancePage', feature: 'workflow', anyPermission: ['workflow:instance:list', 'workflow:task:list', 'workflow:task:handle', 'workflow:instance:monitor', 'workflow:instance:create'] },
  { path: '/report/dashboards/:id/design', component: 'report/designer/DashboardDesignerPage', owner: 'ReportDashboards', anyPermission: ['report:dashboard:update'] },
  { path: '/report/print/:id/design', component: 'report/designer/PrintDesignerPage', owner: 'ReportPrintTemplates', anyPermission: ['report:print:update'] },
  { path: '/report/dashboards/:id/view', component: 'report/DashboardViewPage', feature: 'report', anyPermission: ['report:dashboard:list'] },
  { path: '/report/fill/:code', component: 'report/FillEntryPage', feature: 'report', anyPermission: ['report:fill:record:create', 'report:fill:record:update'] },
  { path: '/system/oauth2-apps/:id', component: 'open-platform/apps/OAuth2AppDetailPage', owner: 'SystemOAuth2Apps', anyPermission: ['system:oauth2-apps:view'] },
];

export const ADMIN_SHELL_ROUTES = new Set(['/', '/profile', '/announcements', '/inbox', '/search']);

export function menuRoutePattern(menu: {
  id: number; type: string; status: string; name?: string | null; path?: string | null;
  component?: string | null; isExternal?: boolean; embed?: boolean;
}): string | null {
  if (menu.type !== 'menu' || menu.status !== 'enabled' || !menu.path) return null;
  if (menu.isExternal) return menu.embed ? `/embed/${menu.id}` : null;
  if (!menu.component || ADMIN_SHELL_ROUTES.has(menu.path)) return null;
  return PAGE_ROUTE_RULES[menu.name ?? '']?.path ?? menu.path;
}
