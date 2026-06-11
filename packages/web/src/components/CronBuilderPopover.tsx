import { useState, useEffect } from 'react';
import type React from 'react';
import { Button, Checkbox, InputNumber, Popover, Radio, Select, Space, Tooltip, Typography } from '@douyinfe/semi-ui';
import { Settings } from 'lucide-react';
import { CronBuilderModal } from './CronBuilderModal';

const addWeekday = (day: string, set: React.Dispatch<React.SetStateAction<string[]>>) =>
  set((prev) => [...prev, day]);
const removeWeekday = (day: string, set: React.Dispatch<React.SetStateAction<string[]>>) =>
  set((prev) => prev.filter((v) => v !== day));

type CronMode = 'minutes' | 'hours' | 'daily' | 'weekly' | 'monthly' | 'custom';

const WEEKDAYS = [
  { value: '1', label: '周一' },
  { value: '2', label: '周二' },
  { value: '3', label: '周三' },
  { value: '4', label: '周四' },
  { value: '5', label: '周五' },
  { value: '6', label: '周六' },
  { value: '0', label: '周日' },
];

function parseExpression(expr: string): {
  mode: CronMode;
  minuteInterval: number;
  hourInterval: number;
  dailyHour: number;
  dailyMinute: number;
  weeklyDays: string[];
  weeklyHour: number;
  weeklyMinute: number;
  monthlyDays: number[];
  monthlyHour: number;
  monthlyMinute: number;
} {
  const defaults = {
    mode: 'custom' as CronMode,
    minuteInterval: 30,
    hourInterval: 1,
    dailyHour: 8,
    dailyMinute: 0,
    weeklyDays: ['1'],
    weeklyHour: 9,
    weeklyMinute: 0,
    monthlyDays: [1],
    monthlyHour: 9,
    monthlyMinute: 0,
  };
  if (!expr) return defaults;
  const p = expr.trim().split(/\s+/);
  if (p.length !== 6) return { ...defaults, mode: 'custom' };
  const [sec, min, hour, dom, mon, dow] = p;
  // Every N minutes: 0 */N * * * *
  if (sec === '0' && /^\*\/(\d+)$/.test(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    const n = Number.parseInt(/^\*\/(\d+)$/.exec(min)?.[1] ?? '1', 10);
    return { ...defaults, mode: 'minutes', minuteInterval: n };
  }
  // Every N hours: 0 0 */N * * *
  if (sec === '0' && min === '0' && /^\*\/(\d+)$/.test(hour) && dom === '*' && mon === '*' && dow === '*') {
    const n = Number.parseInt(/^\*\/(\d+)$/.exec(hour)?.[1] ?? '1', 10);
    return { ...defaults, mode: 'hours', hourInterval: n };
  }
  // Daily: 0 MIN HOUR * * *
  if (sec === '0' && /^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*') {
    return { ...defaults, mode: 'daily', dailyHour: Number.parseInt(hour, 10), dailyMinute: Number.parseInt(min, 10) };
  }
  // Weekly: 0 MIN HOUR * * DOW[,DOW...]
  const dowParts = dow.split(',');
  const validDow = dowParts.every((d) => /^\d+$/.test(d) && Number(d) >= 0 && Number(d) <= 7);
  if (sec === '0' && /^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && validDow && dow !== '*') {
    return { ...defaults, mode: 'weekly', weeklyHour: Number.parseInt(hour, 10), weeklyMinute: Number.parseInt(min, 10), weeklyDays: dowParts };
  }
  // Monthly: 0 MIN HOUR DOM[,DOM...] * *
  const domParts = dom.split(',');
  const validDom = domParts.every((d) => /^\d+$/.test(d) && Number(d) >= 1 && Number(d) <= 31);
  if (sec === '0' && /^\d+$/.test(min) && /^\d+$/.test(hour) && validDom && dom !== '*' && mon === '*' && dow === '*') {
    return { ...defaults, mode: 'monthly', monthlyHour: Number.parseInt(hour, 10), monthlyMinute: Number.parseInt(min, 10), monthlyDays: domParts.map(Number) };
  }
  return { ...defaults, mode: 'custom' };
}

function buildExpression(
  mode: CronMode,
  values: {
    minuteInterval: number;
    hourInterval: number;
    dailyHour: number;
    dailyMinute: number;
    weeklyDays: string[];
    weeklyHour: number;
    weeklyMinute: number;
    monthlyDays: number[];
    monthlyHour: number;
    monthlyMinute: number;
    customExpr: string;
  },
): string {
  switch (mode) {
    case 'minutes':  return `0 */${values.minuteInterval} * * * *`;
    case 'hours':    return `0 0 */${values.hourInterval} * * *`;
    case 'daily':    return `0 ${values.dailyMinute} ${values.dailyHour} * * *`;
    case 'weekly': {
      const days = [...values.weeklyDays].sort((a, b) => Number(a) - Number(b)).join(',');
      return `0 ${values.weeklyMinute} ${values.weeklyHour} * * ${days}`;
    }
    case 'monthly': {
      const days = [...values.monthlyDays].sort((a, b) => a - b).join(',');
      return `0 ${values.monthlyMinute} ${values.monthlyHour} ${days} * *`;
    }
    default:         return values.customExpr;
  }
}

function describeExpression(
  mode: CronMode,
  values: {
    minuteInterval: number;
    hourInterval: number;
    dailyHour: number;
    dailyMinute: number;
    weeklyDays: string[];
    weeklyHour: number;
    weeklyMinute: number;
    monthlyDays: number[];
    monthlyHour: number;
    monthlyMinute: number;
  },
): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const weekLabels = [...values.weeklyDays]
    .sort((a, b) => Number(a) - Number(b))
    .map((d) => WEEKDAYS.find((w) => w.value === d)?.label ?? d)
    .join('、');
  const monthLabels = [...values.monthlyDays].sort((a, b) => a - b).map((d) => `${d} 日`).join('、');
  switch (mode) {
    case 'minutes':  return `每 ${values.minuteInterval} 分钟执行一次`;
    case 'hours':    return `每 ${values.hourInterval} 小时执行一次（整点）`;
    case 'daily':    return `每天 ${pad(values.dailyHour)}:${pad(values.dailyMinute)} 执行`;
    case 'weekly':   return `每周${weekLabels} ${pad(values.weeklyHour)}:${pad(values.weeklyMinute)} 执行`;
    case 'monthly':  return `每月 ${monthLabels} ${pad(values.monthlyHour)}:${pad(values.monthlyMinute)} 执行`;
    default:         return '自定义表达式';
  }
}

interface CronBuilderPopoverProps {
  readonly value?: string;
  readonly onApply: (expr: string) => void;
}

export function CronBuilderPopover({ value, onApply }: CronBuilderPopoverProps) {
  const parsed = parseExpression(value ?? '');
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<CronMode>(parsed.mode);
  const [minuteInterval, setMinuteInterval] = useState(parsed.minuteInterval);
  const [hourInterval, setHourInterval] = useState(parsed.hourInterval);
  const [dailyHour, setDailyHour] = useState(parsed.dailyHour);
  const [dailyMinute, setDailyMinute] = useState(parsed.dailyMinute);
  const [weeklyDays, setWeeklyDays] = useState<string[]>(parsed.weeklyDays);
  const [weeklyHour, setWeeklyHour] = useState(parsed.weeklyHour);
  const [weeklyMinute, setWeeklyMinute] = useState(parsed.weeklyMinute);
  const [monthlyDays, setMonthlyDays] = useState<number[]>(parsed.monthlyDays);
  const [monthlyHour, setMonthlyHour] = useState(parsed.monthlyHour);
  const [monthlyMinute, setMonthlyMinute] = useState(parsed.monthlyMinute);
  const [customExpr, setCustomExpr] = useState(value ?? '');
  const [modalVisible, setModalVisible] = useState(false);

  // Re-sync when value changes externally
  useEffect(() => {
    const p = parseExpression(value ?? '');
    setMode(p.mode);
    setMinuteInterval(p.minuteInterval);
    setHourInterval(p.hourInterval);
    setDailyHour(p.dailyHour);
    setDailyMinute(p.dailyMinute);
    setWeeklyDays(p.weeklyDays);
    setWeeklyHour(p.weeklyHour);
    setWeeklyMinute(p.weeklyMinute);
    setMonthlyDays(p.monthlyDays);
    setMonthlyHour(p.monthlyHour);
    setMonthlyMinute(p.monthlyMinute);
    if (p.mode === 'custom') setCustomExpr(value ?? '');
  }, [value]);

  const vals = { minuteInterval, hourInterval, dailyHour, dailyMinute, weeklyDays, weeklyHour, weeklyMinute, monthlyDays, monthlyHour, monthlyMinute, customExpr };
  const expr = buildExpression(mode, vals);
  const isCustom = mode === 'custom';
  const desc = isCustom ? '' : describeExpression(mode, vals);

  let isApplyDisabled = false;
  if (mode === 'weekly' && weeklyDays.length === 0) isApplyDisabled = true;
  if (mode === 'monthly' && monthlyDays.length === 0) isApplyDisabled = true;

  const handleApply = () => {
    onApply(expr);
    setVisible(false);
  };

  const inputStyle = { width: 72 };
  const timeInputs = (
    hour: number, setHour: (v: number) => void,
    minute: number, setMinute: (v: number) => void,
  ) => (
    <Space>
      <span>执行时间</span>
      <InputNumber value={hour} onChange={(v) => setHour(Number(v) || 0)} min={0} max={23} style={inputStyle} />
      <span>时</span>
      <InputNumber value={minute} onChange={(v) => setMinute(Number(v) || 0)} min={0} max={59} style={inputStyle} />
      <span>分</span>
    </Space>
  );

  const content = (
    <div style={{ padding: '12px 4px', width: 360 }}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>可视化配置</Typography.Text>
      <Radio.Group
        value={mode}
        onChange={(e) => setMode(e.target.value as CronMode)}
        type="button"
        style={{ marginBottom: 16 }}
      >
        <Radio value="minutes">按分钟</Radio>
        <Radio value="hours">按小时</Radio>
        <Radio value="daily">每天</Radio>
        <Radio value="weekly">每周</Radio>
        <Radio value="monthly">每月</Radio>
        <Radio value="custom">自定义</Radio>
      </Radio.Group>

      <div style={{ marginBottom: 16, minHeight: 48 }}>
        {mode === 'minutes' && (
          <Space>
            <span>每隔</span>
            <InputNumber value={minuteInterval} onChange={(v) => setMinuteInterval(Number(v) || 1)} min={1} max={59} style={inputStyle} />
            <span>分钟执行一次</span>
          </Space>
        )}
        {mode === 'hours' && (
          <Space>
            <span>每隔</span>
            <InputNumber value={hourInterval} onChange={(v) => setHourInterval(Number(v) || 1)} min={1} max={23} style={inputStyle} />
            <span>小时执行一次（整点）</span>
          </Space>
        )}
        {mode === 'daily' && timeInputs(dailyHour, setDailyHour, dailyMinute, setDailyMinute)}
        {mode === 'weekly' && (
          <Space vertical align="start" style={{ gap: 8 }}>
            <div>
              <span style={{ fontSize: 13 }}>每周</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {WEEKDAYS.map((d) => (
                  <Checkbox
                    key={d.value}
                    checked={weeklyDays.includes(d.value)}
                    onChange={(e) => { if (e.target.checked) addWeekday(d.value, setWeeklyDays); else removeWeekday(d.value, setWeeklyDays); }}
                  >{d.label}</Checkbox>
                ))}
              </div>
            </div>
            {timeInputs(weeklyHour, setWeeklyHour, weeklyMinute, setWeeklyMinute)}
          </Space>
        )}
        {mode === 'monthly' && (
          <Space vertical align="start" style={{ gap: 8 }}>
            <Space>
              <span>每月</span>
              <Select
                multiple
                value={monthlyDays}
                onChange={(v) => setMonthlyDays(v as number[])}
                optionList={Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: `${i + 1} 日` }))}
                style={{ width: 220 }}
                placeholder="请选择日期"
                maxTagCount={4}
              />
            </Space>
            {timeInputs(monthlyHour, setMonthlyHour, monthlyMinute, setMonthlyMinute)}
          </Space>
        )}
        {mode === 'custom' && (
          <Typography.Text type="tertiary" size="small">请在输入框内直接编辑表达式</Typography.Text>
        )}
      </div>

      <div style={{ background: 'var(--semi-color-fill-2)', borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 2 }}>生成表达式</Typography.Text>
        <Typography.Text code style={{ fontSize: 13 }}>{isCustom ? (value || '—') : expr}</Typography.Text>
        {desc && <Typography.Text type="secondary" size="small" style={{ display: 'block', marginTop: 4 }}>{desc}</Typography.Text>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Button
          size="small"
          theme="borderless"
          type="tertiary"
          icon={<Settings size={12} />}
          onClick={() => { setVisible(false); setModalVisible(true); }}
        >高级配置</Button>
        <Space>
          <Button size="small" onClick={() => setVisible(false)}>取消</Button>
          {!isCustom && <Button size="small" type="primary" disabled={isApplyDisabled} onClick={handleApply}>应用</Button>}
        </Space>
      </div>
    </div>
  );

  return (
    <>
      <Popover
        trigger="custom"
        visible={visible}
        onClickOutSide={() => setVisible(false)}
        content={content}
        position="bottomRight"
      >
        <Tooltip content="可视化配置">
          <div style={{ display: 'inline-flex' }}>
            <Button
              icon={<Settings size={14} />}
              size="small"
              theme="borderless"
              type="tertiary"
              onClick={(e) => { e.stopPropagation(); setVisible((v) => !v); }}
            />
          </div>
        </Tooltip>
      </Popover>
      <CronBuilderModal
        visible={modalVisible}
        value={isCustom ? (value ?? '') : expr}
        onClose={() => setModalVisible(false)}
        onApply={(e) => { onApply(e); setModalVisible(false); }}
      />
    </>
  );
}
