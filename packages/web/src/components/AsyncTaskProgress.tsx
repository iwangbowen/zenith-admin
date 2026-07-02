import { Progress, Spin, Typography } from '@douyinfe/semi-ui';
import type { AsyncTask } from '@zenith/shared';

/** 通用异步任务进度单元格：确定进度显示进度条，不定进度显示 Spin + 说明文案 */
export default function AsyncTaskProgress({ task }: { task: AsyncTask }) {
  const percent = task.totalCount
    ? Math.min(100, Math.round((task.processedCount / Math.max(task.totalCount, 1)) * 100))
    : null;

  if (task.status === 'pending') {
    const resumed = task.processedCount > 0;
    return (
      <Typography.Text type="tertiary" size="small">
        {resumed ? `排队中（已处理 ${task.processedCount}${task.totalCount ? `/${task.totalCount}` : ''}，等待续跑）` : '排队中'}
      </Typography.Text>
    );
  }

  if (task.status === 'running') {
    return (
      <div>
        {percent != null ? (
          <Progress percent={percent} showInfo size="small" style={{ width: 150 }} />
        ) : (
          <Spin size="small" />
        )}
        <div>
          <Typography.Text type="tertiary" size="small">{task.progressNote ?? '执行中…'}</Typography.Text>
        </div>
      </div>
    );
  }

  const stroke = task.status === 'success'
    ? 'var(--semi-color-success)'
    : task.status === 'failed'
      ? 'var(--semi-color-danger)'
      : 'var(--semi-color-text-3)';
  return (
    <div>
      {percent != null && <Progress percent={percent} showInfo size="small" stroke={stroke} style={{ width: 150 }} />}
      <div>
        <Typography.Text type="tertiary" size="small">{task.progressNote ?? '-'}</Typography.Text>
      </div>
    </div>
  );
}
