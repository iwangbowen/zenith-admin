import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@douyinfe/semi-ui';
import { Lock } from 'lucide-react';
import { UserAvatar } from './UserAvatar';

interface LockScreenProps {
  user: { nickname?: string; avatar?: string | null };
  onUnlock: (password: string) => boolean;
  onReLogin: () => void;
}

export function LockScreen({ user, onUnlock, onReLogin }: LockScreenProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [shaking, setShaking] = useState(false);
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
    const success = onUnlock(password);
    if (!success) {
      setError(true);
      setShaking(true);
      setPassword('');
      setTimeout(() => setShaking(false), 500);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleUnlock();
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

  return (
    <div className="lock-screen">
      <div className="lock-screen__content">
        <div className="lock-screen__time">
          {h}<span className="lock-screen__colon">:</span>{m}<span className="lock-screen__colon">:</span>{s}
        </div>
        <div className="lock-screen__date">{dateStr}</div>

        <div className="lock-screen__user">
          <UserAvatar
            name={user.nickname || '用户'}
            avatar={user.avatar}
            size={72}
            style={{ fontSize: 28 }}
          />
          <div className="lock-screen__username">{user.nickname || '用户'}</div>
        </div>

        <div className={`lock-screen__form${shaking ? ' lock-screen__form--shake' : ''}`}>
          <div className="lock-screen__input-wrap">
            <Lock size={15} className="lock-screen__input-icon" />
            <Input
              ref={inputRef}
              type="password"
              placeholder="请输入锁屏密码"
              value={password}
              onChange={(v) => { setPassword(v); setError(false); }}
              onKeyDown={handleKeyDown}
              className="lock-screen__input"
            />
          </div>
          {error && <div className="lock-screen__error">密码错误，请重试</div>}
          <Button type="primary" block onClick={handleUnlock} style={{ marginTop: 10 }}>
            解锁
          </Button>
          <Button
            type="tertiary"
            theme="borderless"
            block
            onClick={onReLogin}
            style={{ marginTop: 4 }}
          >
            重新登录
          </Button>
        </div>
      </div>
    </div>
  );
}
