/**
 * 流程「发起 / 详情」两栏布局壳
 *
 * - 宽屏（≥ lg）：复用共享 MasterDetailLayout（右栏为 master、可拖拽/持久化宽度），
 *   右栏内置 Tabs 切换「审批流程 / 流程图」，左栏为表单主体（独立滚动）。
 * - 窄屏（< lg）：单栏堆叠回退——表单在上，审批侧栏（含同样的 Tabs）接在下方。
 *
 * 需要父级提供高度（SideSheet body / page-container--stretch）。
 */
import { useState, type ReactNode } from 'react';
import { Tabs } from '@douyinfe/semi-ui';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { mediaDown } from '@/lib/breakpoints';
import './WorkflowProcessLayout.css';

type RightTab = 'chain' | 'graph';

const RIGHT_TABS = [
  { tab: '审批流程', itemKey: 'chain' },
  { tab: '流程图', itemKey: 'graph' },
];

interface Props {
  /** 跨两栏顶部头部（详情态：标题/状态/元信息条），可选 */
  header?: ReactNode;
  /** 左栏内容（表单主体；详情态可含次级 Tabs） */
  left: ReactNode;
  /** 右栏「审批流程」tab 内容 */
  chain: ReactNode;
  /** 右栏「流程图」tab 内容 */
  graph: ReactNode;
  /** 右栏宽度持久化 key（localStorage） */
  persistKey?: string;
  sidebarDefault?: number;
  sidebarMin?: number;
  sidebarMax?: number;
  defaultRightTab?: RightTab;
}

export default function WorkflowProcessLayout({
  header,
  left,
  chain,
  graph,
  persistKey,
  sidebarDefault = 340,
  sidebarMin = 280,
  sidebarMax = 480,
  defaultRightTab = 'chain',
}: Readonly<Props>) {
  const narrow = useMediaQuery(mediaDown('lg'));
  const [active, setActive] = useState<RightTab>(defaultRightTab);

  const sidebar = (stacked: boolean) => (
    <div className={`wf-process-sidebar${stacked ? ' wf-process-sidebar--stacked' : ''}`}>
      <Tabs
        type="line"
        size="small"
        className="wf-process-sidebar__bar"
        tabList={RIGHT_TABS}
        activeKey={active}
        onChange={(key) => setActive(key as RightTab)}
      />
      <div className="wf-process-sidebar__body">
        {/* 仅渲染激活页签，避免隐藏态流程图零宽度计算异常 */}
        {active === 'chain' ? chain : graph}
      </div>
    </div>
  );

  if (narrow) {
    return (
      <div className="wf-process-layout">
        {header ? <div className="wf-process-layout__header">{header}</div> : null}
        <div className="wf-process-stack">
          <div className="wf-process-form wf-process-form--stacked">{left}</div>
          {sidebar(true)}
        </div>
      </div>
    );
  }

  return (
    <div className="wf-process-layout">
      {header ? <div className="wf-process-layout__header">{header}</div> : null}
      <MasterDetailLayout
        side="right"
        master={sidebar(false)}
        detail={<div className="wf-process-form">{left}</div>}
        defaultSize={sidebarDefault}
        minSize={sidebarMin}
        maxSize={sidebarMax}
        persistKey={persistKey}
        bordered
        gap={12}
        collapsible={false}
        responsiveBreakpoint={0}
        style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
      />
    </div>
  );
}
