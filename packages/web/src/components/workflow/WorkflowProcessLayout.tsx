/**
 * 流程「发起 / 详情」两栏布局壳
 *
 * - 宽屏（≥ lg）：复用共享 MasterDetailLayout（右栏为 master、可拖拽宽度/持久化），
 *   两栏之间以可拖拽的分割线分隔（无卡片边框）。右栏只展示「审批流程」，
 *   顶部提供「流程图」按钮，点击在 SideSheet 中查看流程图。左栏为表单主体（独立滚动）。
 * - 窄屏（< lg）：单栏堆叠回退——表单在上，审批侧栏接在下方（同样的「流程图」按钮）。
 *
 * 需要父级提供高度（SideSheet body / page-container--stretch）。
 */
import { useState, type ReactNode } from 'react';
import { Button, SideSheet, Typography } from '@douyinfe/semi-ui';
import { Workflow } from 'lucide-react';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { mediaDown } from '@/lib/breakpoints';
import './WorkflowProcessLayout.css';

interface Props {
  /** 跨两栏顶部头部（详情态：标题/状态/元信息条），可选 */
  header?: ReactNode;
  /** 左栏内容（表单主体；详情态可含次级 Tabs） */
  left: ReactNode;
  /** 右栏「审批流程」内容 */
  chain: ReactNode;
  /** 流程图内容（在 SideSheet 中展示） */
  graph: ReactNode;
  /** 右栏宽度持久化 key（localStorage） */
  persistKey?: string;
  sidebarDefault?: number;
  sidebarMin?: number;
  sidebarMax?: number;
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
}: Readonly<Props>) {
  const narrow = useMediaQuery(mediaDown('lg'));
  const [graphVisible, setGraphVisible] = useState(false);

  const sidebar = (stacked: boolean) => (
    <div className={`wf-process-sidebar${stacked ? ' wf-process-sidebar--stacked' : ''}`}>
      <div className="wf-process-sidebar__bar">
        <Typography.Text strong className="wf-process-sidebar__title">审批流程</Typography.Text>
        <Button
          size="small"
          theme="borderless"
          icon={<Workflow size={14} />}
          onClick={() => setGraphVisible(true)}
        >
          流程图
        </Button>
      </div>
      <div className="wf-process-sidebar__body">{chain}</div>
    </div>
  );

  const body = narrow ? (
    <div className="wf-process-stack">
      <div className="wf-process-form wf-process-form--stacked">{left}</div>
      {sidebar(true)}
    </div>
  ) : (
    <MasterDetailLayout
      side="right"
      master={sidebar(false)}
      detail={<div className="wf-process-form">{left}</div>}
      defaultSize={sidebarDefault}
      minSize={sidebarMin}
      maxSize={sidebarMax}
      persistKey={persistKey}
      collapsible={false}
      responsiveBreakpoint={0}
      style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
    />
  );

  return (
    <div className="wf-process-layout">
      {header ? <div className="wf-process-layout__header">{header}</div> : null}
      {body}
      <SideSheet
        title="流程图"
        visible={graphVisible}
        onCancel={() => setGraphVisible(false)}
        width={narrow ? '100%' : 880}
        bodyStyle={{ padding: 16, overflow: 'auto' }}
      >
        {graphVisible ? graph : null}
      </SideSheet>
    </div>
  );
}
