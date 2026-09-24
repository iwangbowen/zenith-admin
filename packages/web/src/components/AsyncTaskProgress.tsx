import { Progress, Space, Spin, Tooltip, Typography } from '@douyinfe/semi-ui';
import { HelpCircle } from 'lucide-react';
import type { AsyncTask } from '@zenith/shared/tasks';

interface AsyncTaskProgressProps {
  task: AsyncTask;
  /** 说明文案展示方式：inline 常驻进度条下方（默认）；tooltip 收进问号图标悬浮查看，适合不允许换行的表格列 */
  noteDisplay?: 'inline' | 'tooltip';
  /** 进度条铺满容器宽度（默认固定 150px） */
  fluid?: boolean;
  /** 隐藏 pending 状态的「排队中」文字（默认展示；调用方已有状态徽标时可关闭，避免重复） */
  hidePendingLabel?: boolean;
}

/** 说明文案的问号悬浮入口，无文案时不渲染 */
function NoteHint({ note }: { note: string | null }) {
  if (!note) return null;
  return (
    <Tooltip content={note} position="top">
      <HelpCircle size={13} style={{ color: 'var(--semi-color-text-2)', flexShrink: 0, cursor: 'help' }} />
    </Tooltip>
  );
}

/** 通用异步任务进度单元格：确定进度显示进度条，不定进度显示 Spin + 说明文案 */
export default function AsyncTaskProgress({ task, noteDisplay = 'inline', fluid = false, hidePendingLabel = false }: Readonly<AsyncTaskProgressProps>) {
  const percent = task.totalCount
    ? Math.min(100, Math.round((task.processedCount / Math.max(task.totalCount, 1)) * 100))
    : null;
  const asTooltip = noteDisplay === 'tooltip';
  const barStyle = fluid ? { flex: 1, width: '100%' } : { width: 150 };
  const rowStyle = fluid ? { width: '100%' } : undefined;

  if (task.status === 'pending') {
    const detail = task.processedCount > 0
      ? `已处理 ${task.processedCount}${task.totalCount ? `/${task.totalCount}` : ''}，等待续跑`
      : null;
    if (hidePendingLabel) {
      if (!detail) return null;
      return asTooltip
        ? (
          <Space spacing={4}>
            <NoteHint note={detail} />
          </Space>
        )
        : (
          <Typography.Text type="tertiary" size="small">
            {detail}
          </Typography.Text>
        );
    }
    if (asTooltip) {
      return (
        <Space spacing={4}>
          <Typography.Text type="tertiary" size="small">排队中</Typography.Text>
          <NoteHint note={detail} />
        </Space>
      );
    }
    return (
      <Typography.Text type="tertiary" size="small">
        {detail ? `排队中（${detail}）` : '排队中'}
      </Typography.Text>
    );
  }

  if (task.status === 'running') {
    const note = task.progressNote ?? '执行中…';
    const bar = percent != null
      ? <Progress percent={percent} showInfo size="small" style={barStyle} />
      : <Spin size="small" />;
    if (asTooltip) {
      return (
        <Space spacing={6} style={rowStyle}>
          {bar}
          <NoteHint note={note} />
        </Space>
      );
    }
    return (
      <div>
        {bar}
        <div>
          <Typography.Text type="tertiary" size="small">{note}</Typography.Text>
        </div>
      </div>
    );
  }

  const stroke = task.status === 'success'
    ? 'var(--semi-color-success)'
    : task.status === 'failed'
      ? 'var(--semi-color-danger)'
      : 'var(--semi-color-text-3)';
  const bar = percent != null
    ? <Progress percent={percent} showInfo size="small" stroke={stroke} style={barStyle} />
    : null;
  if (asTooltip) {
    return (
      <Space spacing={6} style={rowStyle}>
        {bar ?? <Typography.Text type="tertiary" size="small">—</Typography.Text>}
        <NoteHint note={task.progressNote} />
      </Space>
    );
  }
  return (
    <div>
      {bar}
      <div>
        <Typography.Text type="tertiary" size="small">{task.progressNote ?? '-'}</Typography.Text>
      </div>
    </div>
  );
}

