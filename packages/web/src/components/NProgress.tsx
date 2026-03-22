import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import './NProgress.css';

/**
 * 顶部路由切换进度条
 * 监听 useLocation() pathname 变化模拟进度条动画
 */
export default function NProgress() {
  const location = useLocation();
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPathRef = useRef(location.pathname);

  useEffect(() => {
    if (location.pathname === prevPathRef.current) return;
    prevPathRef.current = location.pathname;

    // 开始进度
    if (timerRef.current) clearInterval(timerRef.current);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setVisible(true);
    setWidth(20);

    timerRef.current = setInterval(() => {
      setWidth((prev) => {
        if (prev >= 90) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 90;
        }
        return prev + Math.random() * 15;
      });
    }, 200);

    // 短暂后完成
    hideTimerRef.current = setTimeout(() => {
      if (timerRef.current) clearInterval(timerRef.current);
      setWidth(100);
      setTimeout(() => {
        setVisible(false);
        setWidth(0);
      }, 300);
    }, 400);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [location.pathname]);

  if (!visible) return null;

  return (
    <div
      className="nprogress-bar"
      style={{
        width: `${width}%`,
        opacity: width === 100 ? 0 : 1,
        transition: width === 100
          ? 'width 0.1s ease, opacity 0.3s ease'
          : 'width 0.2s ease',
      }}
    />
  );
}
