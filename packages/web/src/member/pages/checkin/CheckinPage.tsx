import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Button, Calendar, Spin, Table, Tag, Toast } from '@douyinfe/semi-ui';
import type { MemberCheckin, MemberCheckinStatus, PaginatedResponse } from '@zenith/shared';
import { CalendarCheck, ChevronLeft, ChevronRight, Flame, Trophy } from 'lucide-react';
import { memberRequest } from '../../utils/member-request';
import { MemberPage } from '../../components/MemberPage';
import { useMemberAuth } from '../../hooks/useMemberAuth';

const HISTORY_PAGE_SIZE = 10;

interface CheckinResult {
  consecutiveDays: number;
  points: number;
  experience: number;
  checkinDate: string;
}

export default function CheckinPage() {
  const { refresh } = useMemberAuth();
  const [status, setStatus] = useState<MemberCheckinStatus | null>(null);
  const [history, setHistory] = useState<MemberCheckin[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [displayMonth, setDisplayMonth] = useState(() => dayjs().startOf('month'));
  const [calendarDates, setCalendarDates] = useState<Set<string>>(new Set());
  const [calendarLoading, setCalendarLoading] = useState(false);
  const isCurrentMonth = displayMonth.isSame(dayjs().startOf('month'), 'month');

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await memberRequest.get<MemberCheckinStatus>('/api/member/checkin/status', { silent: true });
      if (res.code === 0) setStatus(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCalendarDates = useCallback(async (month: typeof displayMonth) => {
    setCalendarLoading(true);
    try {
      const dateStart = month.format('YYYY-MM-DD');
      const dateEnd = month.endOf('month').format('YYYY-MM-DD');
      const res = await memberRequest.get<PaginatedResponse<MemberCheckin>>(
        `/api/member/checkin/history?page=1&pageSize=31&dateStart=${dateStart}&dateEnd=${dateEnd}`,
        { silent: true },
      );
      if (res.code === 0) {
        setCalendarDates(new Set(res.data.list.map((r) => r.checkinDate)));
      }
    } finally {
      setCalendarLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async (page = 1) => {
    setHistoryLoading(true);
    try {
      const res = await memberRequest.get<PaginatedResponse<MemberCheckin>>(
        `/api/member/checkin/history?page=${page}&pageSize=${HISTORY_PAGE_SIZE}`,
        { silent: true },
      );
      if (res.code === 0) {
        setHistory(res.data.list);
        setHistoryTotal(res.data.total);
        setHistoryPage(page);
      }
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadHistory(1);
    void loadCalendarDates(displayMonth);
  }, [loadHistory, loadStatus, loadCalendarDates, displayMonth]);

  const handleCheckin = async () => {
    const res = await memberRequest.post<CheckinResult>('/api/member/checkin', {});
    if (res.code === 0) {
      Toast.success(`签到成功，获得 ${res.data.points} 积分 / ${res.data.experience} 经验`);
      await Promise.all([loadStatus(), loadHistory(1), loadCalendarDates(displayMonth), refresh()]);
    }
  };

  const handlePrevMonth = () => {
    const prev = displayMonth.subtract(1, 'month');
    setDisplayMonth(prev);
    void loadCalendarDates(prev);
  };

  const handleNextMonth = () => {
    const next = displayMonth.add(1, 'month');
    if (next.isAfter(dayjs().startOf('month'), 'month')) return;
    setDisplayMonth(next);
    void loadCalendarDates(next);
  };

  const calendarHeader = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px 10px' }}>
      <span style={{ fontWeight: 600, fontSize: 15 }}>{displayMonth.format('YYYY年M月')}</span>
      <div style={{ display: 'flex', gap: 4 }}>
        <Button size="small" theme="borderless" icon={<ChevronLeft size={16} />} onClick={handlePrevMonth} />
        <Button size="small" theme="borderless" disabled={isCurrentMonth} icon={<ChevronRight size={16} />} onClick={handleNextMonth} />
      </div>
    </div>
  );

  return (
    <MemberPage title="每日签到">
      <div style={{
        background: 'linear-gradient(135deg, #07c160 0%, #19be6b 100%)',
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
              loading={loading}
              disabled={status?.checkedToday}
              onClick={handleCheckin}
              style={{ background: '#fff', color: '#07c160', borderColor: '#fff' }}
            >
              {status?.checkedToday ? '今日已签到' : '立即签到'}
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

      <div style={{ background: '#fff', border: '1px solid var(--m-border)', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
        <Spin spinning={calendarLoading} size="middle">
          <Calendar
            mode="month"
            displayValue={displayMonth.toDate()}
            weekStartsOn={1}
            height={360}
            header={calendarHeader}
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
                  background: '#07c160',
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
          loading={historyLoading}
          rowKey="id"
          size="small"
          bordered
          pagination={{
            currentPage: historyPage,
            pageSize: HISTORY_PAGE_SIZE,
            total: historyTotal,
            onChange: (page) => void loadHistory(page),
            showSizeChanger: false,
          }}
          empty={<div className="m-empty">暂无签到记录</div>}
        />
      </div>
    </MemberPage>
  );
}
