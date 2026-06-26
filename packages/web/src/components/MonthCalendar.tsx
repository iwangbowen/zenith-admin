import { useState, type ComponentProps, type ReactNode } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { Button, Calendar, Tooltip, Typography } from '@douyinfe/semi-ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './MonthCalendar.css';

const { Text } = Typography;

type CalendarProps = ComponentProps<typeof Calendar>;
type MonthInput = Dayjs | Date | string | number;
type MonthDisabled = boolean | ((targetMonth: Dayjs) => boolean);

export interface MonthCalendarProps extends Omit<CalendarProps, 'mode' | 'displayValue' | 'header'> {
  month?: MonthInput;
  defaultMonth?: MonthInput;
  onMonthChange?: (month: Dayjs) => void;
  monthFormat?: string;
  showToday?: boolean;
  todayText?: string;
  prevTooltip?: string;
  nextTooltip?: string;
  disablePrev?: MonthDisabled;
  disableNext?: MonthDisabled;
  headerExtra?: ReactNode;
  headerClassName?: string;
}

function normalizeMonth(month: MonthInput | undefined) {
  return dayjs(month ?? new Date()).startOf('month');
}

function isMonthDisabled(disabled: MonthDisabled | undefined, targetMonth: Dayjs) {
  return typeof disabled === 'function' ? disabled(targetMonth) : Boolean(disabled);
}

export default function MonthCalendar({
  month,
  defaultMonth,
  onMonthChange,
  monthFormat = 'YYYY年M月',
  showToday = true,
  todayText = '本月',
  prevTooltip = '上个月',
  nextTooltip = '下个月',
  disablePrev,
  disableNext,
  headerExtra,
  headerClassName,
  className,
  weekStartsOn = 1,
  ...calendarProps
}: MonthCalendarProps) {
  const [innerMonth, setInnerMonth] = useState(() => normalizeMonth(defaultMonth));
  const currentMonth = month === undefined ? innerMonth : normalizeMonth(month);
  const prevMonth = currentMonth.subtract(1, 'month');
  const nextMonth = currentMonth.add(1, 'month');
  const isCurrentMonth = currentMonth.isSame(dayjs(), 'month');
  const calendarClassName = ['month-calendar', className].filter(Boolean).join(' ');
  const calendarHeaderClassName = ['month-calendar__header', headerClassName].filter(Boolean).join(' ');

  function updateMonth(next: Dayjs) {
    if (month === undefined) {
      setInnerMonth(next);
    }
    onMonthChange?.(next);
  }

  const header = (
    <div className={calendarHeaderClassName}>
      <Text strong className="month-calendar__title">{currentMonth.format(monthFormat)}</Text>
      <div className="month-calendar__actions">
        <Tooltip content={prevTooltip} position="top">
          <Button
            theme="borderless"
            size="small"
            icon={<ChevronLeft size={16} />}
            disabled={isMonthDisabled(disablePrev, prevMonth)}
            aria-label={prevTooltip}
            onClick={() => updateMonth(prevMonth)}
          />
        </Tooltip>
        {showToday && (
          <Button
            theme="borderless"
            size="small"
            type="tertiary"
            disabled={isCurrentMonth}
            onClick={() => updateMonth(dayjs().startOf('month'))}
          >
            {todayText}
          </Button>
        )}
        <Tooltip content={nextTooltip} position="top">
          <Button
            theme="borderless"
            size="small"
            icon={<ChevronRight size={16} />}
            disabled={isMonthDisabled(disableNext, nextMonth)}
            aria-label={nextTooltip}
            onClick={() => updateMonth(nextMonth)}
          />
        </Tooltip>
        {headerExtra}
      </div>
    </div>
  );

  return (
    <Calendar
      {...calendarProps}
      className={calendarClassName}
      mode="month"
      displayValue={currentMonth.toDate()}
      weekStartsOn={weekStartsOn}
      header={header}
    />
  );
}
