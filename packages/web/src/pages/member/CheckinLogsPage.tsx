import { useMemo, useRef, useState } from 'react';
import { Button, Calendar, DatePicker, Form, List, Popover, RadioGroup, Radio, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { CalendarPlus } from 'lucide-react';
import type { MemberCheckin, MemberCheckinCalendarDay } from '@zenith/shared/member';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import { MemberSelect } from '@/components/MemberSelect';
import { formatDateForApi } from '@/utils/date';
import { memberAdminKeys, useCheckinCalendar, useCheckinDayMembersInfinite, useCheckinLogList, useMakeupCheckin } from '@/hooks/queries/member-admin';
import { useListSearch } from '@/hooks/useListSearch';
import { useListDeepLink } from '@/hooks/useListDeepLink';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { DateRangeFilter, KeywordInput } from '@/components/search-filters';
import { dateColumn, dateTimeColumn } from '@/utils/table-columns';
import { abortSubmit } from '@/lib/abort-submit';

interface SearchParams {
  memberKeyword?: string;
  dateRange: [Date, Date] | null;
}

const defaultSearch: SearchParams = {
  memberKeyword: undefined,
  dateRange: null,
};

function formatMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 日历格悬浮层：hover 时才按日分页拉取签到会员，滚动列表 + 「加载更多」，
 * 大名单不会全量下发。
 */
function CheckinDayPopoverContent({ day }: Readonly<{ day: MemberCheckinCalendarDay }>) {
  const membersQuery = useCheckinDayMembersInfinite(day.date);
  const items = (membersQuery.data?.pages ?? []).flatMap((p) => p.list);
  const normalCount = day.count - day.makeupCount;
  return (
    // 弹层经 portal 渲染，但 React 事件仍沿组件树冒泡到日历格子的 onClick（下钻），须在根节点阻断
    <div
      style={{ padding: '10px 12px', width: 260 }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="presentation"
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{day.date} · 签到 {day.count} 人</div>
      <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginBottom: 8 }}>
        正常 {normalCount} · 补签 {day.makeupCount} · 点击日期查看全部明细
      </div>
      {membersQuery.isPending ? (
        <div style={{ textAlign: 'center', padding: 16 }}><Spin /></div>
      ) : (
        <List
          size="small"
          dataSource={items}
          style={{ maxHeight: 240, overflowY: 'auto' }}
          renderItem={(item) => (
            <List.Item
              main={(
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.memberNickname || `#${item.memberId}`}
                  </span>
                  <Typography.Text type="tertiary" size="small">{item.createdAt.slice(11, 16)}</Typography.Text>
                  {item.isMakeup && <Tag color="orange" size="small">补签</Tag>}
                </span>
              )}
              style={{ padding: '6px 4px' }}
            />
          )}
          loadMore={membersQuery.hasNextPage ? (
            <div style={{ textAlign: 'center', padding: '6px 0 2px' }}>
              <Button
                size="small"
                theme="borderless"
                loading={membersQuery.isFetchingNextPage}
                onClick={() => void membersQuery.fetchNextPage()}
              >
                加载更多（还有 {day.count - items.length} 人）
              </Button>
            </div>
          ) : null}
        />
      )}
    </div>
  );
}

export default function CheckinLogsPage() {
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset, applySearch,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: memberAdminKeys.checkinLogLists });
  // 会员详情等入口的深链筛选（?memberKeyword=，消费后即从 URL 移除）
  useListDeepLink(['memberKeyword'], (p) => applySearch({ memberKeyword: p.memberKeyword, dateRange: null }));
  const [makeupVisible, setMakeupVisible] = useState(false);
  const makeupFormApi = useRef<FormApi | null>(null);
  // 视图切换：列表 / 日历（日历按月聚合展示每日签到量，点击某天回列表查明细）
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date());
  const calendarQuery = useCheckinCalendar(formatMonth(calendarMonth), view === 'calendar');
  const calendarMap = useMemo(
    () => new Map((calendarQuery.data ?? []).map((d) => [d.date, d])),
    [calendarQuery.data],
  );
  const [dateStart, dateEnd] = submittedParams.dateRange ?? [];
  const listQuery = useCheckinLogList({
    page,
    pageSize,
    memberKeyword: submittedParams.memberKeyword || undefined,
    dateStart: dateStart ? formatDateForApi(dateStart) : undefined,
    dateEnd: dateEnd ? formatDateForApi(dateEnd) : undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const makeupMutation = useMakeupCheckin();

  const handleMakeup = async () => {
    let values: { memberId?: number; date?: Date; reason?: string } | undefined;
    try {
      values = await makeupFormApi.current!.validate();
    } catch {
      abortSubmit('validation');
    }
    if (!values?.memberId || !values?.date || !values?.reason) throw new Error('请完整填写补签信息');
    await makeupMutation.mutateAsync({ params: { id: values.memberId }, body: { date: formatDateForApi(values.date), reason: values.reason } });
    Toast.success('补签成功');
    setMakeupVisible(false);
  };

  const columns: ColumnProps<MemberCheckin>[] = [
    { title: 'ID', dataIndex: 'id', width: 90 },
    { title: '会员昵称', dataIndex: 'memberNickname', width: 140, render: (value?: string | null, row?: MemberCheckin) => value || `#${row?.memberId}` },
    dateColumn('签到日期', 'checkinDate'),
    { title: '连续天数', dataIndex: 'consecutiveDays', width: 100, align: 'right' },
    { title: '积分奖励', dataIndex: 'pointsAwarded', width: 100, align: 'right' },
    { title: '经验奖励', dataIndex: 'experienceAwarded', width: 100, align: 'right' },
    {
      title: '类型',
      dataIndex: 'isMakeup',
      width: 90,
      render: (value?: boolean) => (
        <Tag color={value ? 'orange' : 'green'} size="small">{value ? '补签' : '正常'}</Tag>
      ),
    },
    { title: '备注', dataIndex: 'remark', width: 180, render: (v?: string | null) => v || '-' },
    dateTimeColumn('签到时间', 'createdAt'),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="会员ID/昵称" value={draftParams.memberKeyword} onChange={(value) => setDraftParams((prev) => ({ ...prev, memberKeyword: value }))} onSearch={handleSearch} width={180} />
  );

  const renderDateRangeFilter = () => (
    <DateRangeFilter type="dateRange" value={draftParams.dateRange ?? undefined} onChange={(value) => setDraftParams((prev) => ({ ...prev, dateRange: value ? (value as [Date, Date]) : null }))} width={300} />
  );

  const renderSearchButton = () => <SearchButton onClick={handleSearch} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;
  const buildExportQuery = () => {
    const [ds, de] = submittedParams.dateRange ?? [];
    return {
      ...(submittedParams.memberKeyword ? { memberKeyword: submittedParams.memberKeyword } : {}),
      ...(ds ? { dateStart: formatDateForApi(ds) } : {}),
      ...(de ? { dateEnd: formatDateForApi(de) } : {}),
    };
  };
  const renderExportButton = (variant?: 'flat') => hasPermission('member:checkin:log:list') ? (
    <ExportButton entity="member.checkins" query={buildExportQuery()} variant={variant} />
  ) : null;
  const renderMakeupButton = () => hasPermission('member:checkin:makeup') ? (
    <Button type="primary" icon={<CalendarPlus size={14} />} onClick={() => setMakeupVisible(true)}>
      会员补签
    </Button>
  ) : null;

  const renderViewSwitch = () => (
    <RadioGroup type="button" value={view} onChange={(e) => setView(e.target.value as 'list' | 'calendar')}>
      <Radio value="list">列表</Radio>
      <Radio value="calendar">日历</Radio>
    </RadioGroup>
  );

  /** 点击日历某天：切回列表并按该日过滤 */
  const drillDownDate = (date: Date) => {
    setView('list');
    applySearch({ memberKeyword: undefined, dateRange: [date, date] });
  };

  const renderCalendarCell = (dateString?: string) => {
    if (!dateString) return null;
    const key = formatDateForApi(new Date(dateString));
    const day = calendarMap.get(key);
    if (!day) return null;
    return (
      <div style={{ position: 'absolute', right: 6, bottom: 4 }}>
        <Popover position="top" showArrow content={<CheckinDayPopoverContent day={day} />}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
            <Tag color="green" size="small">{day.count} 人签到</Tag>
            {day.makeupCount > 0 && <Tag color="orange" size="small">补签 {day.makeupCount}</Tag>}
          </div>
        </Popover>
      </div>
    );
  };

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderViewSwitch()}
            {view === 'list' && (
              <>
                {renderKeywordSearch()}
                {renderDateRangeFilter()}
                {renderSearchButton()}
                {renderResetButton()}
                {renderExportButton()}
              </>
            )}
            {renderMakeupButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderViewSwitch()}
            {view === 'list' && (
              <>
                {renderKeywordSearch()}
                {renderSearchButton()}
              </>
            )}
            {renderMakeupButton()}
          </>
        )}
        mobileFilters={view === 'list' ? renderDateRangeFilter() : undefined}
        mobileActions={view === 'list' ? renderExportButton('flat') : undefined}
        filterTitle="签到记录筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      {view === 'list' ? (
        <ConfigurableTable
          bordered
          columns={columns}
          dataSource={data}
          loading={listQuery.isFetching}
          onRefresh={() => void listQuery.refetch()}
          refreshLoading={listQuery.isFetching}
          rowKey="id"
          size="small"
          pagination={buildPagination(total)}
          empty="暂无签到记录"
        />
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <DatePicker
              type="month"
              value={calendarMonth}
              onChange={(v) => { if (v instanceof Date) setCalendarMonth(v); }}
              style={{ width: 140 }}
            />
            <Typography.Text type="tertiary" size="small">点击日期查看当天签到明细</Typography.Text>
          </div>
          <Calendar
            mode="month"
            displayValue={calendarMonth}
            dateGridRender={renderCalendarCell}
            onClick={(_e, value) => drillDownDate(value)}
            height={640}
          />
        </div>
      )}

      <AppModal
        title="会员补签"
        visible={makeupVisible}
        width={480}
        closeOnEsc
        onCancel={() => setMakeupVisible(false)}
        onOk={handleMakeup}
      >
        <Form
          key={makeupVisible ? 'makeup-open' : 'makeup-closed'}
          getFormApi={(api) => { makeupFormApi.current = api; }}
          labelPosition="left"
          labelWidth={90}
        >
          <MemberSelect field="memberId" label="会员" required />
          <Form.DatePicker field="date" label="补签日期" type="date" style={{ width: '100%' }} rules={[{ required: true, message: '请选择补签日期' }]} />
          <Form.TextArea field="reason" label="补签原因" placeholder="必填，将记入签到备注与操作审计" maxCount={256} rows={2}
            rules={[{ required: true, message: '请填写补签原因' }, { min: 2, message: '至少 2 个字符' }]} />
        </Form>
      </AppModal>
    </div>
  );
}
