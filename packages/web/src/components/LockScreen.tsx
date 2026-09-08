import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@douyinfe/semi-ui';
import { Lock } from 'lucide-react';
import { Lunar } from 'lunar-typescript';
import { UserAvatar } from './UserAvatar';

interface LockScreenProps {
  user: { nickname?: string; avatar?: string | null };
  /** 仅校验密码是否正确，不改变锁屏状态 */
  onVerify: (password: string) => boolean;
  /** 动画结束后调用，真正解锁 */
  onUnlocked: () => void;
  onReLogin: () => void;
}

export function LockScreen({ user, onVerify, onUnlocked, onReLogin }: Readonly<LockScreenProps>) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [time, setTime] = useState(new Date());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // 锁屏后自动聚焦输入框
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleUnlock = () => {
    if (!password) return;
    const success = onVerify(password);
    if (success) {
      setLeaving(true);
      // 退出动画结束后解锁
      setTimeout(() => onUnlocked(), 380);
    } else {
      setError(true);
      setShaking(true);
      setPassword('');
      setTimeout(() => setShaking(false), 500);
    }
  };

  const h = time.getHours().toString().padStart(2, '0');
  const m = time.getMinutes().toString().padStart(2, '0');
  const s = time.getSeconds().toString().padStart(2, '0');
  const dateStr = time.toLocaleDateString('zh-CN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const lunar = Lunar.fromDate(time);
  const lunarStr = `农历 ${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`;
  const solarTerm = lunar.getJieQi();
  const displayName = user.nickname || '用户';

  return (
    <div className={`lock-screen${leaving ? ' lock-screen--leaving' : ''}`}>
      <div className="lock-screen__content">
        <div className="lock-screen__clock">
          <div className="lock-screen__time">
            {h}<span className="lock-screen__colon">:</span>{m}<span className="lock-screen__colon">:</span>{s}
          </div>
          <div className="lock-screen__date">{dateStr}</div>
          <div className="lock-screen__lunar">
            {lunarStr}
            {solarTerm && <span className="lock-screen__solar-term">{solarTerm}</span>}
          </div>
        </div>

        <div className="lock-screen__user">
          <UserAvatar
            name={displayName}
            avatar={user.avatar}
            size={64}
            className="lock-screen__avatar"
            style={{ fontSize: 26 }}
          />
          <div className="lock-screen__username">{displayName}</div>
        </div>

        <form
          className={`lock-screen__form${shaking ? ' lock-screen__form--shake' : ''}`}
          onSubmit={(e) => { e.preventDefault(); handleUnlock(); }}
        >
          <Input
            ref={inputRef}
            mode="password"
            size="large"
            prefix={<Lock size={15} />}
            placeholder="请输入锁屏密码"
            value={password}
            validateStatus={error ? 'error' : 'default'}
            onChange={(v) => { setPassword(v); setError(false); }}
            className="lock-screen__input"
            aria-label="锁屏密码"
          />
          {/* 固定占位高度：错误提示出现时不推动下方按钮 */}
          <div className="lock-screen__error" role="alert">
            {error ? '密码错误，请重试' : ''}
          </div>
          <Button htmlType="submit" type="primary" theme="solid" size="large" block className="lock-screen__unlock">
            解锁
          </Button>
          <Button type="tertiary" theme="borderless" block className="lock-screen__relogin" onClick={onReLogin}>
            重新登录
          </Button>
        </form>
      </div>
    </div>
  );
}
