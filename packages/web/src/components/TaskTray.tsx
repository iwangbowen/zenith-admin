import { useMemo, useState } from 'react';
import { Badge, Button, Empty, Popover, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { IllustrationIdle, IllustrationIdleDark } from '@douyinfe/semi-illustrations';
import { ListChecks } from 'lucide-react';
import type { AsyncTask, AsyncTaskStatus } from '@zenith/shared';
import { request } from '@/utils/request';
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import { formatDateTime } from '@/utils/date';

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

  const handleCancel = async (task: AsyncTask) => {
    setCancelingId(task.id);
    try {
      const res = await request.post<AsyncTask>(`/api/async-tasks/${task.id}/cancel`);
      if (res.code === 0) {
        Toast.success('已请求取消');
        void refresh({ silent: true });
      }
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
        <div style={{ width: 380, maxHeight: 460, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px 8px', fontWeight: 600, fontSize: 14, borderBottom: '1px solid var(--semi-color-border)' }}>
            我的任务{activeCount > 0 ? `（${activeCount} 个进行中）` : ''}
          </div>
          {trayTasks.length === 0 ? (
            <Empty
              image={<IllustrationIdle style={{ width: 100, height: 100 }} />}
              darkModeImage={<IllustrationIdleDark style={{ width: 100, height: 100 }} />}
              description="暂无进行中的任务"
              style={{ padding: '24px 0 28px' }}
            />
          ) : (
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {trayTasks.map((task) => (
                <div key={task.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--semi-color-border)' }}>
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
                  <div style={{ margin: '6px 0 2px' }}>
                    <AsyncTaskProgress task={task} />
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
