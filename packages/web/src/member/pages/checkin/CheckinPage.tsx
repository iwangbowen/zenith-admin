import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Button, DatePicker, Spin, Table, Tag, Toast } from '@douyinfe/semi-ui';
import { CalendarCheck, CalendarPlus, Flame, Gift, Trophy } from 'lucide-react';
import MonthCalendar from '@/components/MonthCalendar';
import AppModal from '@/components/AppModal';
import { MemberPage } from '../../components/MemberPage';
import { useMemberAuth } from '../../hooks/useMemberAuth';
import {
  useCheckinCalendar,
  useCheckinHistory,
  useCheckinMilestones,
  useCheckinStatus,
  useMakeupCheckin,
  useMemberCheckin,
} from '../../hooks/queries';

const HISTORY_PAGE_SIZE = 10;

export default function CheckinPage() {
  const { refresh } = useMemberAuth();
  const [historyPage, setHistoryPage] = useState(1);
  const [displayMonth, setDisplayMonth] = useState(() => dayjs().startOf('month'));
  const [makeupVisible, setMakeupVisible] = useState(false);
  const [makeupDate, setMakeupDate] = useState<Date | null>(null);
  const monthKey = displayMonth.format('YYYY-MM');
  const dateStart = displayMonth.format('YYYY-MM-DD');
  const dateEnd = displayMonth.endOf('month').format('YYYY-MM-DD');
  const statusQuery = useCheckinStatus();
  const historyQuery = useCheckinHistory({ page: historyPage, pageSize: HISTORY_PAGE_SIZE });
  const calendarQuery = useCheckinCalendar(monthKey, dateStart, dateEnd);
  const milestonesQuery = useCheckinMilestones();
  const checkinMutation = useMemberCheckin();
  const makeupMutation = useMakeupCheckin();
  const status = statusQuery.data ?? null;
  const history = historyQuery.data?.list ?? [];
  const historyTotal = historyQuery.data?.total ?? 0;
  const calendarDates = useMemo(
    () => new Set((calendarQuery.data?.list ?? []).map((r) => r.checkinDate)),
    [calendarQuery.data],
  );
  const milestones = milestonesQuery.data ?? null;

  const handleCheckin = async () => {
    const res = await checkinMutation.mutateAsync();
    Toast.success(`签到成功，获得 ${res.points} 积分 / ${res.experience} 经验`);
    setHistoryPage(1);
    await refresh();
  };

  const handleMakeup = async () => {
    if (!makeupDate) {
      Toast.warning('请选择补签日期');
      return;
    }
    const res = await makeupMutation.mutateAsync(dayjs(makeupDate).format('YYYY-MM-DD'));
    Toast.success(`补签成功，消耗 ${res.costPoints} 积分，获得 ${res.pointsAwarded} 积分`);
    setMakeupVisible(false);
    setMakeupDate(null);
    setHistoryPage(1);
    await refresh();
  };

  const handleCalendarMonthChange = (month: typeof displayMonth) => {
    setDisplayMonth(month);
  };

  return (
    <MemberPage title="每日签到">
      <div style={{
        background: 'linear-gradient(135deg, var(--m-primary-dark) 0%, var(--m-primary) 100%)',
        borderRadius: 16,
        color: '#fff',
        padding: 24,
        marginBottom: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 700 }}>
              <CalendarCheck size={20} />
              今日签到
            </div>
            <div style={{ marginTop: 10, fontSize: 28, fontWeight: 700 }}>
              +{status?.todayPoints ?? 0} 积分 / +{status?.todayExperience ?? 0} 经验
            </div>
            <div style={{ marginTop: 8, opacity: 0.9 }}>
              {status?.checkedToday ? '今日已完成签到' : `明日可得 ${status?.nextDayPoints ?? 0} 积分 / ${status?.nextDayExperience ?? 0} 经验`}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {status?.checkedToday && <Tag color="green" shape="circle">已签到</Tag>}
            <Button
              type="primary"
              theme="solid"
              loading={checkinMutation.isPending || statusQuery.isFetching}
              disabled={status?.checkedToday}
              onClick={handleCheckin}
              style={{ background: '#fff', color: 'var(--m-primary)', borderColor: '#fff' }}
            >
              {status?.checkedToday ? '今日已签到' : '立即签到'}
            </Button>
            <Button
              theme="borderless"
              icon={<CalendarPlus size={16} />}
              onClick={() => setMakeupVisible(true)}
              style={{ color: '#fff' }}
            >
              补签
            </Button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, marginBottom: 20 }}>
        <div style={{ background: '#fff', border: '1px solid var(--m-border)', borderRadius: 12, padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--m-text-secondary)' }}>
            <Trophy size={16} color="var(--m-primary)" />
            累计签到
          </div>
          <div style={{ marginTop: 12, fontSize: 30, fontWeight: 700 }}>{status?.totalDays ?? 0}</div>
          <div style={{ marginTop: 4, color: 'var(--m-text-secondary)' }}>累计签到天数</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid var(--m-border)', borderRadius: 12, padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--m-text-secondary)' }}>
            <Flame size={16} color="#ff7d00" />
            连续签到
          </div>
          <div style={{ marginTop: 12, fontSize: 30, fontWeight: 700 }}>{status?.consecutiveDays ?? 0}</div>
          <div style={{ marginTop: 4, color: 'var(--m-text-secondary)' }}>连续签到天数</div>
        </div>
      </div>

      {milestones && milestones.milestones.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid var(--m-border)', borderRadius: 12, padding: 18, marginBottom: 20 }}>
          <div className="mc-card-title" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Gift size={16} color="var(--m-primary)" />
            签到里程碑
            <span style={{ fontWeight: 400, color: 'var(--m-text-secondary)', fontSize: 13 }}>
              累计签到 {milestones.totalDays} 天
            </span>
          </div>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
            {milestones.milestones.map((m) => (
              <div
                key={m.id}
                style={{
                  flex: '0 0 auto',
                  minWidth: 130,
                  border: `1px solid ${m.achieved ? 'var(--m-primary)' : 'var(--m-border)'}`,
                  borderRadius: 12,
                  padding: 14,
                  background: m.achieved ? 'var(--m-primary-light, #e8f9ee)' : '#fafafa',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{m.title}</div>
                <div style={{ color: 'var(--m-text-secondary)', fontSize: 13 }}>累计 {m.cumulativeDays} 天</div>
                <div style={{ marginTop: 6, fontSize: 13 }}>
                  {m.rewardType === 'coupon' ? `券：${m.couponName ?? '-'}` : `+${m.rewardPoints} 积分`}
                </div>
                <Tag color={m.achieved ? 'green' : 'grey'} size="small" style={{ marginTop: 8 }}>
                  {m.achieved ? '已达成' : '未达成'}
                </Tag>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid var(--m-border)', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
        <Spin spinning={calendarQuery.isFetching} size="middle">
          <MonthCalendar
            month={displayMonth}
            onMonthChange={handleCalendarMonthChange}
            showToday={false}
            disableNext={(nextMonth) => nextMonth.isAfter(dayjs().startOf('month'), 'month')}
            height={360}
            dateGridRender={(_, date) => {
              const dateStr = dayjs(date).format('YYYY-MM-DD');
              if (!calendarDates.has(dateStr)) return null;
              return (
                <div style={{
                  position: 'absolute',
                  bottom: 6,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--m-primary)',
                }}
                />
              );
            }}
          />
        </Spin>
      </div>

      <div style={{ background: '#fff', border: '1px solid var(--m-border)', borderRadius: 12, padding: 18 }}>
        <div className="mc-card-title" style={{ marginBottom: 12 }}>
          最近签到记录
        </div>
        <Table
          columns={[
            { title: '签到日期', dataIndex: 'checkinDate', width: 120 },
            { title: '连续天数', dataIndex: 'consecutiveDays', width: 100 },
            { title: '积分奖励', dataIndex: 'pointsAwarded', width: 100 },
            { title: '经验奖励', dataIndex: 'experienceAwarded', width: 100 },
            { title: '签到时间', dataIndex: 'createdAt' },
          ]}
          dataSource={history}
          loading={historyQuery.isFetching}
          rowKey="id"
          size="small"
          bordered
          pagination={{
            currentPage: historyPage,
            pageSize: HISTORY_PAGE_SIZE,
            total: historyTotal,
            onChange: (page) => setHistoryPage(page),
            showSizeChanger: false,
          }}
          empty={<div className="m-empty">暂无签到记录</div>}
        />
      </div>

      <AppModal
        title="补签"
        visible={makeupVisible}
        onCancel={() => { setMakeupVisible(false); setMakeupDate(null); }}
        onOk={handleMakeup}
        okButtonProps={{ loading: makeupMutation.isPending }}
        okText="确认补签"
        cancelText="取消"
      >
        <div style={{ marginBottom: 12, color: 'var(--m-text-secondary)', fontSize: 13 }}>
          选择需要补签的历史日期，补签将消耗相应积分（具体规则以提交结果为准）。
        </div>
        <DatePicker
          type="date"
          value={makeupDate ?? undefined}
          onChange={(d) => setMakeupDate((d as Date) ?? null)}
          placeholder="请选择补签日期"
          style={{ width: '100%' }}
          disabledDate={(date) => {
            if (!date) return false;
            const d = dayjs(date);
            if (!d.isBefore(dayjs(), 'day')) return true;
            return calendarDates.has(d.format('YYYY-MM-DD'));
          }}
        />
      </AppModal>
    </MemberPage>
  );
}
