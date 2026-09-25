import React from 'react';
import { Banner, Button, Card, Space, Tag, Typography, Tabs, TabPane } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { CMS_WORKSPACE_QUEUE_LABELS } from '@zenith/shared/cms';
import { useCmsEditorialWorkspace } from '@/hooks/queries/cms-operations';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { ListPagination } from '@/components/ListPagination';
import { formatDateTime } from '@/utils/date';
import { useListDeepLink } from '@/hooks/useListDeepLink';
import CmsEditorialTasks from './CmsEditorialTasks';
import CmsFeedbackSheet from './CmsFeedbackSheet';

export default function CmsEditorialWorkspace({ siteId }: Readonly<{ siteId?: number }>) {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const [queue, setQueue] = React.useState<keyof typeof CMS_WORKSPACE_QUEUE_LABELS>();
  const [feedbackId, setFeedbackId] = React.useState<number>();
  const [tab, setTab] = React.useState('workspace');
  const [taskId, setTaskId] = React.useState<number>();
  const canUseWorkspace = hasPermission('cms:content:list') || hasPermission('cms:form:list') || hasPermission('cms:editorial-task:manage');
  const canManageTasks = hasPermission('cms:editorial-task:manage');
  useListDeepLink(['task'], (picked) => { const id = Number(picked.task); if (canManageTasks && Number.isSafeInteger(id) && id > 0) { setTaskId(id); setTab('tasks'); } });
  const { page, pageSize, buildPagination, setPage } = usePagination({ pageSize: 10, resetKey: siteId });
  const query = useCmsEditorialWorkspace({ siteId: siteId ?? 0, page, pageSize, queue }, canUseWorkspace);
  if (!siteId || !canUseWorkspace) return null;
  return <Card title="编辑与读者反馈工作台" style={{ marginBottom: 16 }}>
    <Tabs collapsible="auto" activeKey={tab} onChange={setTab} lazyRender>
    <TabPane tab="待办队列" itemKey="workspace">
    {query.isError ? <Banner type="danger" description={query.error.message} /> : null}
    <Space wrap style={{ marginBottom: 12 }}>{(query.data?.counters ?? []).map((counter) => <Button key={counter.queue} disabled={!counter.available} theme={(queue ?? query.data?.counters.find((value) => value.available)?.queue) === counter.queue ? 'solid' : 'borderless'} onClick={() => { setQueue(counter.queue); setPage(1); }}>{CMS_WORKSPACE_QUEUE_LABELS[counter.queue]} <Tag>{counter.count}</Tag></Button>)}</Space>
    {query.data?.list.length ? query.data.list.map((item) => <div key={`${item.kind}-${item.id}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--semi-color-border)' }}><Tag>{item.kind === 'content' ? '稿件' : item.kind === 'feedback' ? '来信' : '事项'}</Tag><Typography.Text ellipsis style={{ flex: 1, minWidth: 120 }}>{item.title}</Typography.Text><Typography.Text type="tertiary">{item.ownerName ?? '未分派'}{item.dueAt ? ` · 截止 ${formatDateTime(item.dueAt)}` : ''}</Typography.Text><Button size="small" onClick={() => item.kind === 'feedback' ? setFeedbackId(item.id) : item.kind === 'task' ? (setTaskId(item.id), setTab('tasks')) : navigate(item.href)}>处理</Button></div>) : <Typography.Text type="tertiary">{query.isLoading ? '正在加载待办' : '当前队列没有待处理事项'}</Typography.Text>}
    <ListPagination pagination={buildPagination(query.data?.total ?? 0)} />
    </TabPane>
    {canManageTasks ? <TabPane tab="编辑事项" itemKey="tasks"><CmsEditorialTasks key={siteId} siteId={siteId} initialTaskId={taskId} onTaskOpened={() => setTaskId(undefined)} /></TabPane> : null}
    </Tabs>
    {feedbackId ? <CmsFeedbackSheet key={feedbackId} id={feedbackId} onClose={() => setFeedbackId(undefined)} /> : null}
  </Card>;
}
