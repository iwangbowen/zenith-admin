import { useState, type ComponentProps, type ReactNode } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { Calendar, DatePicker, Typography } from '@douyinfe/semi-ui';
import { useOptionalPreferences } from '@/hooks/usePreferences';
import './MonthCalendar.css';

const { Text } = Typography;

type CalendarProps = ComponentProps<typeof Calendar>;
type MonthInput = Dayjs | Date | string | number;
type MonthDisabled = boolean | ((targetMonth: Dayjs) => boolean);

export interface MonthCalendarProps extends Omit<CalendarProps, 'mode' | 'displayValue' | 'header'> {
  month?: MonthInput;
  defaultMonth?: MonthInput;
  onMonthChange?: (month: Dayjs) => void;
  /** 月份选择器右侧的说明文案（如「点击日期查看当天签到明细」） */
  hint?: ReactNode;
  /** 月份选择器宽度，默认 140 */
  monthPickerWidth?: number;
  /** 禁止切换到更早的月份（谓词收到候选月份） */
  disablePrev?: MonthDisabled;
  /** 禁止切换到更晚的月份（谓词收到候选月份） */
  disableNext?: MonthDisabled;
  /** 月份选择器右侧的附加节点 */
  headerExtra?: ReactNode;
  headerClassName?: string;
}

function normalizeMonth(month: MonthInput | undefined) {
  return dayjs(month ?? new Date()).startOf('month');
}

function isMonthDisabled(disabled: MonthDisabled | undefined, targetMonth: Dayjs) {
  return typeof disabled === 'function' ? disabled(targetMonth) : Boolean(disabled);
}

/**
 * 月视图日历：左上角一个月份选择器（`DatePicker type="month"`）+ 可选说明文案，下方是月历栅格。
 *
 * 月份切换只用选择器，不再有「上一月 / 下一月」箭头——跳「三个月前」本来要点三次，
 * 而月份选择器一步到位，且与全站其它月份选择（报表、导出中心）是同一个控件。
 * `weekStartsOn` 默认跟随「一周起始日」偏好（`PreferencesProvider` 只改写了 DatePicker 的默认值，
 * Calendar 需要显式传入），未接入 Provider 的入口（会员前台）回落到周一。
 */
export default function MonthCalendar({
  month,
  defaultMonth,
  onMonthChange,
  hint,
  monthPickerWidth = 140,
  disablePrev,
  disableNext,
  headerExtra,
  headerClassName,
  className,
  weekStartsOn,
  ...calendarProps
}: MonthCalendarProps) {
  const [innerMonth, setInnerMonth] = useState(() => normalizeMonth(defaultMonth));
  const currentMonth = month === undefined ? innerMonth : normalizeMonth(month);
  const preferredWeekStart = useOptionalPreferences()?.preferences.weekStart;
  const calendarClassName = ['month-calendar', className].filter(Boolean).join(' ');
  const calendarHeaderClassName = ['month-calendar__header', headerClassName].filter(Boolean).join(' ');

  function updateMonth(next: Dayjs) {
    if (month === undefined) {
      setInnerMonth(next);
    }
    onMonthChange?.(next);
  }

  return (
    <div className={calendarClassName}>
      <div className={calendarHeaderClassName}>
        <DatePicker
          type="month"
          value={currentMonth.toDate()}
          onChange={(value) => { if (value instanceof Date) updateMonth(dayjs(value).startOf('month')); }}
          disabledDate={(date) => {
            const target = dayjs(date).startOf('month');
            if (target.isBefore(currentMonth, 'month')) return isMonthDisabled(disablePrev, target);
            if (target.isAfter(currentMonth, 'month')) return isMonthDisabled(disableNext, target);
            return false;
          }}
          style={{ width: monthPickerWidth }}
        />
        {hint ? <Text type="tertiary" size="small">{hint}</Text> : null}
        {headerExtra}
      </div>
      <Calendar
        {...calendarProps}
        mode="month"
        displayValue={currentMonth.toDate()}
        weekStartsOn={weekStartsOn ?? (preferredWeekStart === 'sunday' ? 0 : 1)}
      />
    </div>
  );
}
