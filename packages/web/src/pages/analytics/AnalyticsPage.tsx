/**
 * 行为分析入口：仅负责页面级 Tab 编排与统计天数上下文，各 Tab 实现见同目录 AnalyticsXxxTab.tsx，
 * 共用格式化 / 小组件见 analytics-format.ts 与 analytics-shared.tsx。
 */
import { useEffect, useRef } from 'react';
import { TabPane, Tabs } from '@douyinfe/semi-ui';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import AnalyticsEventQueryTab from './AnalyticsEventQueryTab';
import AnalyticsExperimentsTab from './AnalyticsExperimentsTab';
import AnalyticsAcquisitionTab from './AnalyticsAcquisitionTab';
import AnalyticsOverviewTab from './AnalyticsOverviewTab';
import AnalyticsRealtimeTab from './AnalyticsRealtimeTab';
import AnalyticsDwellTab from './AnalyticsDwellTab';
import AnalyticsFeatureTab from './AnalyticsFeatureTab';
import AnalyticsSessionsTab from './AnalyticsSessionsTab';
import AnalyticsFunnelTab from './AnalyticsFunnelTab';
import AnalyticsRetentionTab from './AnalyticsRetentionTab';
import AnalyticsPathTab from './AnalyticsPathTab';
import AnalyticsUsersTab from './AnalyticsUsersTab';
import AnalyticsHeatmapTab from './AnalyticsHeatmapTab';
import { BehaviorDaysProvider } from './behavior-days-context';

const BEHAVIOR_TABS = ['overview', 'realtime', 'event-query', 'experiments', 'dwell', 'feature', 'sessions', 'funnel', 'retention', 'path', 'users', 'heatmap', 'acquisition'] as const;

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useUrlTabState(BEHAVIOR_TABS, 'overview');
  const previousTab = useRef(activeTab);

  // Semi 的 Select / DatePicker 浮层挂在 body portal；页签切换不会卸载 portal，
  // 先关闭旧浮层，避免它残留在新页签上遮挡内容。
  useEffect(() => {
    if (previousTab.current === activeTab) return;
    previousTab.current = activeTab;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }, [activeTab]);

  return (
    <div className="page-container page-tabs-page zx-flat-panels">
      <BehaviorDaysProvider>
      <Tabs collapsible="auto" type="line" lazyRender activeKey={activeTab} onChange={(key) => setActiveTab(key as typeof BEHAVIOR_TABS[number])}>
        <TabPane tab="概览" itemKey="overview"><AnalyticsOverviewTab /></TabPane>
        <TabPane tab="实时" itemKey="realtime"><AnalyticsRealtimeTab /></TabPane>
        <TabPane tab="事件分析" itemKey="event-query"><AnalyticsEventQueryTab /></TabPane>
        <TabPane tab="A/B 实验" itemKey="experiments"><AnalyticsExperimentsTab /></TabPane>
        <TabPane tab="页面停留" itemKey="dwell"><AnalyticsDwellTab /></TabPane>
        <TabPane tab="功能使用" itemKey="feature"><AnalyticsFeatureTab /></TabPane>
        <TabPane tab="会话" itemKey="sessions"><AnalyticsSessionsTab /></TabPane>
        <TabPane tab="漏斗" itemKey="funnel"><AnalyticsFunnelTab /></TabPane>
        <TabPane tab="留存" itemKey="retention"><AnalyticsRetentionTab /></TabPane>
        <TabPane tab="路径" itemKey="path"><AnalyticsPathTab /></TabPane>
        <TabPane tab="用户分析" itemKey="users"><AnalyticsUsersTab /></TabPane>
        <TabPane tab="点击分布" itemKey="heatmap"><AnalyticsHeatmapTab /></TabPane>
        <TabPane tab="获客归因" itemKey="acquisition"><AnalyticsAcquisitionTab /></TabPane>
      </Tabs>
      </BehaviorDaysProvider>
    </div>
  );
}
