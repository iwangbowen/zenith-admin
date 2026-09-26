import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Popover, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag';
import MonthCalendar from '@/components/MonthCalendar';
import { useCmsContentCalendar } from '@/hooks/queries/cms-contents';
import type { CmsContentCalendarDay, CmsContentCalendarEventKind } from '@zenith/shared/cms';

const { Text } = Typography;

/** 事件类型的展示顺序与样式（图例、格子徽标、悬浮列表共用一处） */
const EVENT_KINDS: { kind: CmsContentCalendarEventKind; label: string; color: TagColor; dot: string }[] = [
  { kind: 'published', label: '已发布', color: 'green', dot: 'var(--semi-color-success)' },
  { kind: 'scheduled', label: '计划发布', color: 'blue', dot: 'var(--semi-color-primary)' },
  { kind: 'due', label: '审稿截止', color: 'orange', dot: 'var(--semi-color-warning)' },
  { kind: 'expire', label: '过期下线', color: 'red', dot: 'var(--semi-color-danger)' },
];

const kindMeta = (kind: CmsContentCalendarEventKind) => EVENT_KINDS.find((entry) => entry.kind === kind);

/**
 * 内容日历：月视图格子显示当日事件数量，悬浮格子列出当天明细，点击标题进编辑页。
 *
 * 口径 = 实际发布时间（`cms_contents.published_at`）+ 稿件上的三类日程（计划发布 / 审稿截止 / 过期下线）。
 * 直接发布的内容没有计划发布时间，只有实际发布时间，所以「今天发布了什么」在日历里以已发布事件呈现。
 *
 * 服务端按应用时区返回 `YYYY-MM-DD`（与全站日期展示一致），因此这里直接按字符串取月份 / 日，
 * 不再做二次时区换算，避免月初月末的边界被本地时区推错一格。
 */
export default function CmsContentCalendar({ siteId, onOpen }: Readonly<{ siteId?: number; onOpen: (id: number) => void }>) {
  const [month, setMonth] = useState(() => dayjs().startOf('month'));
  const query = useCmsContentCalendar(siteId, month.format('YYYY-MM'), !!siteId);
  const dayMap = useMemo(() => new Map((query.data ?? []).map((day) => [day.date, day])), [query.data]);

  function renderDayDetail(day: CmsContentCalendarDay) {
    const total = EVENT_KINDS.reduce((sum, item) => sum + day.counts[item.kind], 0);
    const hidden = total - day.items.length;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 200, maxWidth: 280 }}>
        <Text strong>{day.date}</Text>
        <div style={{ maxHeight: 240, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {day.items.map((item) => (
            <div key={`${item.kind}-${item.contentId}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Tag color={kindMeta(item.kind)?.color} size="small">{kindMeta(item.kind)?.label}</Tag>
              <Text link ellipsis={{ showTooltip: true }} style={{ maxWidth: 160 }} onClick={() => onOpen(item.contentId)}>
                {item.title || `#${item.contentId}`}
              </Text>
            </div>
          ))}
        </div>
        {hidden > 0 && <Text type="tertiary" size="small">另有 {hidden} 项，可在内容列表按日期查看</Text>}
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        {EVENT_KINDS.map((item) => (
          <span key={item.kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.dot }} />
            {item.label}
          </span>
        ))}
      </div>

      <Spin spinning={query.isFetching}>
        <MonthCalendar
          month={month}
          onMonthChange={setMonth}
          hint="格子显示当日件数，悬浮查看明细；点击标题进入编辑页。"
          height={520}
          dateGridRender={(_, date) => {
            const day = dayMap.get(dayjs(date).format('YYYY-MM-DD'));
            if (!day) return null;
            return (
              <Popover content={renderDayDetail(day)} trigger="hover" position="top" showArrow>
                <div style={{ position: 'absolute', bottom: 6, left: 4, right: 4, display: 'flex', flexWrap: 'wrap', gap: 4, cursor: 'pointer' }}>
                  {EVENT_KINDS.filter((item) => day.counts[item.kind] > 0).map((item) => (
                    <span
                      key={item.kind}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        padding: '0 5px',
                        borderRadius: 'var(--semi-border-radius-small)',
                        fontSize: 11,
                        lineHeight: '16px',
                        color: 'var(--semi-color-text-0)',
                        background: 'var(--semi-color-fill-0)',
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: item.dot }} />
                      {day.counts[item.kind]}
                    </span>
                  ))}
                </div>
              </Popover>
            );
          }}
        />
      </Spin>
    </div>
  );
}
