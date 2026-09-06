import { describe, expect, it } from 'vitest';
import { SEED_MENUS } from '@zenith/shared/seed';
import { hasPageComponent, lazyPageComponent } from './page-registry';
import { businessFormModules, hasBusinessFormComponent, lazyBusinessFormComponent } from './business-form-registry';

describe('page registry', () => {
  it('reuses the same lazy component identity across parent rerenders', () => {
    const first = lazyPageComponent('users/UsersPage');
    const second = lazyPageComponent('/users/UsersPage.tsx');

    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  it('returns null for unknown page components', () => {
    expect(hasPageComponent('missing/UnknownPage')).toBe(false);
    expect(lazyPageComponent('missing/UnknownPage')).toBeNull();
  });

  it('registers only the new alert center page paths', () => {
    expect(hasPageComponent('alerts/rules/AlertRulesPage')).toBe(true);
    expect(hasPageComponent('alerts/events/AlertEventsPage')).toBe(true);
    expect(hasPageComponent('system/monitor-alerts/MonitorAlertsPage')).toBe(false);
    expect(hasPageComponent('system/monitor-alert-events/MonitorAlertEventsPage')).toBe(false);
  });

  it('excludes tests and loading skeletons', () => {
    expect(hasPageComponent('analytics/AnalyticsDebugTab.test')).toBe(false);
    expect(hasPageComponent('workflow/designer/components/FormDesigner.test')).toBe(false);
    expect(hasPageComponent('dashboard/DashboardSkeleton')).toBe(false);
  });

  it('registers every component referenced by seed menus', () => {
    const referenced = SEED_MENUS.map((m) => m.component).filter((c): c is string => Boolean(c));
    const missing = referenced.filter((c) => !hasPageComponent(c));
    expect(missing).toEqual([]);
  });

  it('registers workflow custom business form components but not page-internal sub components', () => {
    expect(hasPageComponent('biz/demo/DemoBusinessForm')).toBe(true);
    expect(hasPageComponent('biz/leave/LeaveApprovalView')).toBe(true);
    expect(hasPageComponent('cms/ContentApprovalView')).toBe(true);
    // 页面内部的 Tab / 子组件不是路由入口：收进注册表会把它们从所属页面 chunk 中拆出
    expect(hasPageComponent('workflow/monitor/WorkflowJobsView')).toBe(false);
    expect(hasPageComponent('ai/chat/components/ChatComposer')).toBe(false);
    expect(hasPageComponent('analytics/AnalyticsUsersTab')).toBe(false);
  });
});

describe('business form registry', () => {
  it('resolves seeded custom business form components', () => {
    expect(hasBusinessFormComponent('biz/demo/DemoBusinessForm')).toBe(true);
    expect(hasBusinessFormComponent('biz/leave/LeaveApprovalView')).toBe(true);
    expect(hasBusinessFormComponent('cms/ContentApprovalView')).toBe(true);
    expect(lazyBusinessFormComponent('biz/leave/LeaveApprovalView')).toBe(lazyBusinessFormComponent('/biz/leave/LeaveApprovalView.tsx'));
  });

  it('does not contain admin route pages, so the approval entry never bundles them', () => {
    expect(hasBusinessFormComponent('users/UsersPage')).toBe(false);
    expect(hasBusinessFormComponent('alerts/rules/AlertRulesPage')).toBe(false);
    expect(lazyBusinessFormComponent('system/monitor/MonitorPage')).toBeNull();
    // 只允许 biz/**、*BusinessForm.tsx、*ApprovalView.tsx 三类文件
    for (const key of Object.keys(businessFormModules)) {
      expect(key).toMatch(/^\.\.\/pages\/(biz\/|.*BusinessForm\.tsx$|.*ApprovalView\.tsx$)/);
    }
  });
});
