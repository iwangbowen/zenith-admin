import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MonthCalendar from './MonthCalendar';

describe('MonthCalendar 月份切换', () => {
  /**
   * 月份切换统一走 `DatePicker type="month"`：没有「上一月 / 下一月」箭头，
   * 当前月由选择器显示成 `YYYY-MM`，说明文案在选择器右侧。
   * 面板内的月份禁用（disablePrev / disableNext）依赖 Semi 的浮层，不在这里断言。
   */
  it('月份切换只有选择器，没有上一月 / 下一月箭头', () => {
    render(<MonthCalendar month={new Date(2026, 8, 26)} hint="点击日期查看当天签到明细" />);

    expect(screen.queryByRole('button', { name: '上个月' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下个月' })).not.toBeInTheDocument();
    expect(screen.getByText('点击日期查看当天签到明细')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-09')).toBeInTheDocument();
  });
});
