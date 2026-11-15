import { useEffect, useRef, useState } from 'react';
import { Button, Empty, Typography } from '@douyinfe/semi-ui';
import { RefreshCw } from 'lucide-react';
import { emptyIllustration } from '@/components/EmptyIllustration';
import { usePublicMaintenanceStatus } from '@/hooks/queries/maintenance';

const { Text } = Typography;

/**
 * 让一次请求的「进行中」状态至少可见 minMs。
 *
 * 维护状态接口在本机/内网通常 20~50ms 就返回，若直接用它控制 loading，
 * 转圈还没绘制出来请求就结束了，用户会觉得按钮点了没反应。
 */
function useMinVisibleDuration(active: boolean, minMs: number): boolean {
  const [visible, setVisible] = useState(active);
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (active) {
      startedAtRef.current = Date.now();
      setVisible(true);
      return;
    }
    if (!startedAtRef.current) return;
    const remaining = minMs - (Date.now() - startedAtRef.current);
    const timer = setTimeout(() => setVisible(false), Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [active, minMs]);

  return visible;
}

interface MaintenanceInfo {
  message: string;
  estimatedEndAt: string | null;
  startedAt: string | null;
}

interface Props {
  info: MaintenanceInfo;
  onAdminLogin?: () => void;
}

export default function MaintenanceOverlay({ info, onAdminLogin }: Readonly<Props>) {
  // 轮询交给查询本身：本组件只在维护生效期间挂载，卸载即自动停止，
  // 无需手写 setInterval。恢复后 App 依据同一份缓存直接停止渲染本遮罩。
  // 手动点击与 30 秒自动轮询都走同一个 isFetching，转圈至少保持 600ms 才看得见。
  const { isFetching, isError, refetch } = usePublicMaintenanceStatus({ refetchInterval: 30_000 });
  const checking = useMinVisibleDuration(isFetching, 600);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-content-bg)',
        padding: 24,
        overflow: 'auto',
      }}
    >
      {/* 维护态复用 Semi 空状态：插画、标题、描述与操作区的间距交给组件默认排版。
          「建设中」表达"正在施工、能力暂不可用"，比「神游四方」的"空/发呆"语义更贴近计划内维护 */}
      <Empty
        {...emptyIllustration('Construction', 160)}
        title="系统维护中"
        description={info.message || '系统正在进行维护升级，请稍后再试。'}
        style={{ maxWidth: 460, width: '100%' }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          {info.estimatedEndAt && (
            <div
              style={{
                background: 'var(--semi-color-fill-1)',
                borderRadius: 'var(--semi-border-radius-medium)',
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
            onClick={() => void refetch()}
          >
            {checking ? '正在检查' : '检查是否恢复'}
          </Button>

          <Text type="tertiary" size="small" aria-live="polite">
            {checking ? '正在获取最新维护状态…' : isError ? '状态检查失败，登录凭证已保留，请重试' : '每 30 秒自动检查一次；预计时间不代表自动开放'}
          </Text>
          {info.estimatedEndAt && Date.parse(info.estimatedEndAt.replace(' ', 'T')) < Date.now() ? <Text type="warning">维护已超过预计时间，请等待管理员确认恢复</Text> : null}
          {onAdminLogin ? <Button theme="borderless" onClick={onAdminLogin}>管理员登录 / 恢复管理</Button> : null}
        </div>
      </Empty>
    </div>
  );
}
