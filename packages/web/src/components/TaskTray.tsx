import { lazy, Suspense, useMemo, useState } from 'react';
import { Badge, Button, Empty, Popover, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { ListChecks } from 'lucide-react';
import type { AsyncTask, AsyncTaskStatus } from '@zenith/shared/tasks';
import { useAsyncTaskAction } from '@/hooks/queries/async-tasks';
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import { formatDateTime } from '@/utils/date';

// 空态插图只在打开托盘且无任务时出现，懒加载使 ~130KB 的 semi-illustrations 不随布局首屏下载
const IllustrationIdle = lazy(() => import('@douyinfe/semi-illustrations').then((m) => ({ default: m.IllustrationIdle })));
const IllustrationIdleDark = lazy(() => import('@douyinfe/semi-illustrations').then((m) => ({ default: m.IllustrationIdleDark })));

const statusTagMap = {
  pending: { color: 'blue', label: '排队中' },
  running: { color: 'cyan', label: '执行中' },
  success: { color: 'green', label: '已完成' },
  failed: { color: 'red', label: '失败' },
  cancelled: { color: 'grey', label: '已取消' },
} as const satisfies Record<AsyncTaskStatus, { color: 'blue' | 'cyan' | 'green' | 'red' | 'grey'; label: string }>;

const ACTIVE_STATUSES = new Set<AsyncTaskStatus>(['pending', 'running']);
/** 结束后在托盘里继续展示的时间窗口（毫秒） */
const RECENT_WINDOW_MS = 10 * 60_000;

function isRecent(task: AsyncTask): boolean {
  if (!task.completedAt) return false;
  const ts = new Date(task.completedAt.replace(' ', 'T')).getTime();
  return Number.isFinite(ts) && Date.now() - ts < RECENT_WINDOW_MS;
}

/**
 * 全局任务托盘：顶栏图标 + Popover 展示我的进行中 / 最近完成任务。
 * 数据源与业务页共享 useMyAsyncTasks（WS 实时 + 轮询兜底），跨页面可见。
 */
export default function TaskTray() {
  const [visible, setVisible] = useState(false);
  const [cancelingId, setCancelingId] = useState<number | null>(null);
  const { tasks, refresh, hasActive } = useMyAsyncTasks({ pageSize: 30 });

  const trayTasks = useMemo(
    () => tasks.filter((task) => ACTIVE_STATUSES.has(task.status) || isRecent(task)).slice(0, 8),
    [tasks],
  );
  const activeCount = useMemo(() => tasks.filter((task) => ACTIVE_STATUSES.has(task.status)).length, [tasks]);

  const cancelMutation = useAsyncTaskAction('cancel');

  const handleCancel = async (task: AsyncTask) => {
    setCancelingId(task.id);
    try {
      await cancelMutation.mutateAsync({ params: { id: task.id } });
      Toast.success('已请求取消');
      void refresh({ silent: true });
    } finally {
      setCancelingId(null);
    }
  };

  return (
    <Popover
      visible={visible}
      onVisibleChange={(v) => {
        setVisible(v);
        if (v) void refresh({ silent: true });
      }}
      position="bottomRight"
      trigger="hover"
      mouseEnterDelay={200}
      mouseLeaveDelay={300}
      showArrow
      content={
        <div style={{ width: 340, maxHeight: 420, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 14px 6px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--semi-color-border)' }}>
            我的任务{activeCount > 0 ? `（${activeCount} 个进行中）` : ''}
          </div>
          {trayTasks.length === 0 ? (
            <Empty
              image={<Suspense fallback={null}><IllustrationIdle style={{ width: 80, height: 80 }} /></Suspense>}
              darkModeImage={<Suspense fallback={null}><IllustrationIdleDark style={{ width: 80, height: 80 }} /></Suspense>}
              description="暂无进行中的任务"
              style={{ padding: '16px 0 20px' }}
            />
          ) : (
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {trayTasks.map((task) => (
                <div key={task.id} style={{ padding: '6px 14px 7px', borderBottom: '1px solid var(--semi-color-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <Typography.Text strong ellipsis={{ showTooltip: true }} style={{ fontSize: 13, flex: 1 }}>
                      {task.title}
                    </Typography.Text>
                    {task.status === 'running' && task.cancelRequested
                      ? <Tag color="orange" size="small">取消中</Tag>
                      : task.status === 'pending' && task.nextRunAt
                        ? <Tag color="orange" size="small">等待重试</Tag>
                        : <Tag color={statusTagMap[task.status].color} size="small">{statusTagMap[task.status].label}</Tag>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 2px' }}>
                    <AsyncTaskProgress task={task} noteDisplay="tooltip" fluid />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography.Text type="tertiary" size="small">
                      {formatDateTime(task.createdAt)}
                    </Typography.Text>
                    {ACTIVE_STATUSES.has(task.status) && !task.cancelRequested && (
                      <Button
                        theme="borderless"
                        type="danger"
                        size="small"
                        loading={cancelingId === task.id}
                        onClick={() => void handleCancel(task)}
                      >
                        取消
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      }
    >
      <div className="admin-header-action admin-header-action--tasks" style={{ display: 'inline-flex', cursor: 'pointer' }}>
        <Badge count={activeCount > 0 ? activeCount : undefined} overflowCount={9} className="admin-notify-badge" style={{ zIndex: 1 }}>
          <button type="button" className="admin-theme-btn" title={hasActive ? `我的任务（${activeCount} 个进行中）` : '我的任务'}>
            <ListChecks size={16} strokeWidth={1.5} />
          </button>
        </Badge>
      </div>
    </Popover>
  );
}
