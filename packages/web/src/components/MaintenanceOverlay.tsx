import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Typography } from '@douyinfe/semi-ui';
import { Wrench, RefreshCw } from 'lucide-react';
import { config } from '@/config';

const { Title, Text } = Typography;

interface MaintenanceInfo {
  message: string;
  estimatedEndAt: string | null;
  startedAt: string | null;
}

interface Props {
  info: MaintenanceInfo;
  onResolved: () => void;
}

export default function MaintenanceOverlay({ info, onResolved }: Readonly<Props>) {
  const [checking, setChecking] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/maintenance/status`);
      const data = await res.json();
      if (data.code === 0 && !data.data?.enabled) {
        onResolved();
      }
    } catch {
      // ignore
    } finally {
      setChecking(false);
    }
  }, [onResolved]);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      void checkStatus();
    }, 30_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [checkStatus]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--semi-color-bg-0)',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 460,
          width: '100%',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'var(--semi-color-warning-light-default)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 8,
          }}
        >
          <Wrench size={36} style={{ color: 'var(--semi-color-warning)' }} />
        </div>

        <Title heading={3} style={{ margin: 0 }}>系统维护中</Title>

        <Text
          type="secondary"
          style={{ fontSize: 15, lineHeight: 1.6, maxWidth: 360 }}
        >
          {info.message || '系统正在进行维护升级，请稍后再试。'}
        </Text>

        {info.estimatedEndAt && (
          <div
            style={{
              background: 'var(--semi-color-fill-1)',
              borderRadius: 8,
              padding: '10px 20px',
            }}
          >
            <Text type="secondary" size="small">预计恢复时间：</Text>
            <Text strong>{info.estimatedEndAt}</Text>
          </div>
        )}

        <Button
          icon={<RefreshCw size={14} />}
          loading={checking}
          onClick={() => void checkStatus()}
          style={{ marginTop: 8 }}
        >
          检查是否恢复
        </Button>
        <Text type="tertiary" size="small">每 30 秒自动检查一次</Text>
      </div>
    </div>
  );
}
