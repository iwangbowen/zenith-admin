import { useEffect, useState } from 'react';
import type { TopbarClockMode } from '@/hooks/usePreferences';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 按偏好把当前时刻格式化为时钟文本；纯函数便于测试 */
export function formatTopbarClock(now: Date, mode: Exclude<TopbarClockMode, 'off'>, showDate: boolean): string {
  const hours = now.getHours();
  const minutes = pad(now.getMinutes());
  const time = mode === '24h'
    ? `${pad(hours)}:${minutes}`
    : `${hours < 12 ? '上午' : '下午'}${hours % 12 === 0 ? 12 : hours % 12}:${minutes}`;
  if (!showDate) return time;
  return `${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAYS[now.getDay()]} ${time}`;
}

/**
 * 顶栏时钟：分钟对齐 tick（59 秒内最多晚一分钟，无秒级定时器开销）。
 * 调用方在 `topbarClock === 'off'` 时不渲染。
 */
export function TopbarClock({ mode, showDate }: Readonly<{ mode: Exclude<TopbarClockMode, 'off'>; showDate: boolean }>) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60 * 1000);
    }, (60 - new Date().getSeconds()) * 1000 + 50);
    return () => {
      clearTimeout(timeout);
      if (interval !== undefined) clearInterval(interval);
    };
  }, []);
  return (
    <span className="admin-topbar-clock" title={formatTopbarClock(now, mode, true)}>
      {formatTopbarClock(now, mode, showDate)}
    </span>
  );
}
