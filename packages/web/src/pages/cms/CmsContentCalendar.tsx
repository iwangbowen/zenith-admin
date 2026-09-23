import { useState } from 'react';
import { Button, DatePicker, Empty, Space, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import { useCmsContentList } from '@/hooks/queries/cms-contents';
import { usePagination } from '@/hooks/usePagination';
import { ListPagination } from '@/components/ListPagination';
import { formatDateTimeForApi } from '@/utils/date';

/** 日历查询按三类业务日期命中分页；保留页码，避免仅展示前 100 条而造成遗漏。 */
export default function CmsContentCalendar({ siteId, onOpen }: Readonly<{ siteId?: number; onOpen: (id: number) => void }>) {
  const [month, setMonth] = useState(() => new Date());
  const pagination = usePagination({ pageSize: 30, resetKey: `${siteId}-${month.getFullYear()}-${month.getMonth()}` });
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59);
  const list = useCmsContentList({ siteId: siteId ?? 0, page: pagination.page, pageSize: pagination.pageSize, calendarFrom: formatDateTimeForApi(start), calendarTo: formatDateTimeForApi(end) }, !!siteId);
  const events = (list.data?.list ?? []).flatMap((content) => [
    { date: content.scheduledAt, label: '计划发布', color: 'blue' as const, content },
    { date: content.dueAt, label: '审稿截止', color: 'orange' as const, content },
    { date: content.expireAt, label: '过期下线', color: 'red' as const, content },
  ]).filter((event) => event.date && event.date.slice(0, 7) === `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`).sort((a, b) => a.date!.localeCompare(b.date!));
  return <div style={{ padding: 16 }}>
    <Space wrap spacing={12} style={{ marginBottom: 16 }}><DatePicker type="month" value={month} onChange={(value) => { if (value instanceof Date) setMonth(value); }} /><Typography.Text type="tertiary">显示本月发布、审稿截止和过期事项。共 {list.data?.total ?? 0} 篇内容，翻页查看全部事项。</Typography.Text></Space>
    <Spin spinning={list.isFetching}>
      {events.length ? <Space vertical align="start" spacing={12} style={{ width: '100%' }}>{events.map((event) => <div key={`${event.content.id}-${event.label}`} style={{ width: '100%', padding: 12, borderBottom: '1px solid var(--semi-color-border)' }}><Space wrap><Typography.Text strong>{event.date}</Typography.Text><Tag color={event.color}>{event.label}</Tag><Button theme="borderless" onClick={() => onOpen(event.content.id)}>{event.content.title}</Button><Typography.Text type="tertiary">{event.content.locale}</Typography.Text></Space></div>)}</Space> : <Empty title="本页没有日程" />}
    </Spin>
    <ListPagination pagination={pagination.buildPagination(list.data?.total ?? 0)} />
  </div>;
}
