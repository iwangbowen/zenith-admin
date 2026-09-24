import React from 'react';
import { Banner, Button, Card, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { CMS_WORKSPACE_QUEUE_LABELS } from '@zenith/shared/cms';
import { useCmsEditorialWorkspace } from '@/hooks/queries/cms-operations';
import { usePermission } from '@/hooks/usePermission';

export default function CmsEditorialWorkspace({ siteId }: Readonly<{ siteId?: number }>) {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const [queue, setQueue] = React.useState<keyof typeof CMS_WORKSPACE_QUEUE_LABELS>('mine');
  const query = useCmsEditorialWorkspace(siteId, queue);
  if (!siteId || !hasPermission('cms:dashboard:view')) return null;
  return <Card title="编辑与读者反馈工作台" style={{ marginBottom: 16 }}>
    {query.isError ? <Banner type="danger" description={query.error.message} /> : null}
    <Space wrap style={{ marginBottom: 12 }}>{(query.data?.counters ?? []).map((counter) => <Button key={counter.queue} disabled={!counter.available} theme={queue === counter.queue ? 'solid' : 'borderless'} onClick={() => setQueue(counter.queue as keyof typeof CMS_WORKSPACE_QUEUE_LABELS)}>{CMS_WORKSPACE_QUEUE_LABELS[counter.queue]} <Tag>{counter.count}</Tag></Button>)}</Space>
    {query.data?.list.length ? query.data.list.map((item) => <div key={`${item.kind}-${item.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--semi-color-border)' }}><Tag>{item.kind === 'content' ? '稿件' : item.kind === 'feedback' ? '来信' : '事项'}</Tag><Typography.Text ellipsis style={{ flex: 1 }}>{item.title}</Typography.Text><Typography.Text type="tertiary">{item.ownerName ?? '未分派'}{item.dueAt ? ` · 截止 ${item.dueAt}` : ''}</Typography.Text><Button size="small" onClick={() => navigate(item.href)}>处理</Button></div>) : <Typography.Text type="tertiary">当前队列没有待处理事项</Typography.Text>}
  </Card>;
}
